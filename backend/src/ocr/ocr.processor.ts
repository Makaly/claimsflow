import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { OcrService } from './ocr.service';
import { PrismaService } from '../prisma/prisma.service';
import { EoxegenIntegrationService } from '../common/services/eoxegen-integration.service';
import { DocumentClassifierService } from '../document-classifier/document-classifier.service';
import { AnomalyScoringService } from '../claims/anomaly-scoring.service';
import { LineItemFraudService } from '../claims/line-item-fraud.service';
import { DiagnosisBillingService } from '../claims/diagnosis-billing.service';
import { ClaimTypeConfigService } from '../claims/claim-type-config.service';
import { computeFraudSignals, DuplicateClaimRef, CrossProviderMatch } from '../claims/fraud-signals';
import { AUTO_DETECT_PROVIDER_NAME } from '../common/constants/auto-detect-provider';
import { ProviderResolverService } from '../common/services/provider-resolver.service';
import { InvoiceFanoutService } from './invoice-fanout.service';
import { DocumentSeparationService } from './document-separation.service';
import { ImagePreprocessorService, PreprocessOptions } from './image-preprocessor.service';
import { ProviderProfileService } from './provider-profile.service';
import * as fs from 'fs';

// concurrency: 2 — OCR is CPU-bound via Tesseract; more than 2 saturates the process
@Processor({ name: 'ocr' }, { concurrency: 2 })
export class OcrProcessor extends WorkerHost {
  private readonly logger = new Logger(OcrProcessor.name);

  constructor(
    private ocrService: OcrService,
    private prisma: PrismaService,
    private eoxegenService: EoxegenIntegrationService,
    private classifierService: DocumentClassifierService,
    private anomalyScoringService: AnomalyScoringService,
    private lineItemFraudService: LineItemFraudService,
    private diagnosisBillingService: DiagnosisBillingService,
    private claimTypeConfigService: ClaimTypeConfigService,
    private providerResolver: ProviderResolverService,
    private invoiceFanout: InvoiceFanoutService,
    private documentSeparation: DocumentSeparationService,
    private imagePreprocessor: ImagePreprocessorService,
    private providerProfile: ProviderProfileService,
  ) {
    super();
  }

  /** Map a Job Setup's captureSettings to image-preprocessor options. */
  private mapCaptureOptions(c: any): PreprocessOptions {
    const opts: PreprocessOptions = {};
    if (c?.deskew) opts.deskew = true;
    if (c?.autoCrop) opts.cropToPage = true;
    if (c?.despeckle) opts.denoise = true;
    if (c?.colorMode === 'gray' || c?.colorMode === 'bw') opts.grayscale = true;
    if (c?.dpi) opts.targetDpi = Number(c.dpi);
    return opts;
  }

  /**
   * Apply a Job Setup's capture settings (deskew / auto-crop / grayscale /
   * despeckle / DPI) to an uploaded image before extraction, via the ML sidecar.
   * Returns the path to use for OCR — the preprocessed image when produced, else
   * the original. PDFs and the no-sidecar case pass through unchanged.
   */
  private async applyCaptureSettings(documentId: string, filePath: string, mimetype: string): Promise<string> {
    if (!this.imagePreprocessor.isEnabled()) return filePath;
    if (!/^image\//i.test(mimetype)) return filePath; // PDFs are rendered per-page elsewhere

    // Resolve the batch's Job Setup captureSettings (best-effort).
    const claimId = (await this.prisma.document.findUnique({ where: { id: documentId }, select: { claimId: true } }))?.claimId;
    if (!claimId) return filePath;
    const batchId = (await this.prisma.claim.findUnique({ where: { id: claimId }, select: { batchId: true } }))?.batchId;
    if (!batchId) return filePath;
    const jobSetupId = (await this.prisma.batchSubmission.findUnique({ where: { id: batchId }, select: { jobSetupId: true } }))?.jobSetupId;
    if (!jobSetupId) return filePath;
    const capture = (await this.prisma.jobSetup.findUnique({ where: { id: jobSetupId }, select: { captureSettings: true } }))?.captureSettings as any;

    const opts = this.mapCaptureOptions(capture);
    if (!Object.keys(opts).length) return filePath;

    try {
      const res = await this.imagePreprocessor.preprocess(documentId, filePath, mimetype, { ...opts, force: true });
      if (res?.outputPath && fs.existsSync(res.outputPath)) {
        this.logger.log(`Capture settings applied (${res.stepsApplied.join(', ')}) for document ${documentId}`);
        return res.outputPath;
      }
    } catch (e: any) {
      this.logger.warn(`Capture preprocessing failed for document ${documentId}: ${e?.message ?? e}`);
    }
    return filePath;
  }

  async process(job: Job<any, any, string>): Promise<any> {
    switch (job.name) {
      case 'extract-text':
        return this.handleTextExtraction(job);
      default:
        this.logger.warn(`Unknown job name: ${job.name}`);
    }
  }

  private async handleTextExtraction(job: Job) {
    const { documentId, filePath, mimetype, model, fanoutChild } = job.data;
    this.logger.log(`Processing OCR for document: ${documentId}${model ? ` (model: ${model})` : ''}`);

    try {
      await this.prisma.document.update({
        where: { id: documentId },
        data: { ocrStatus: 'processing' },
      });

      // Resolve claimId upfront so it can be forwarded to the classifier for
      // zone-hit attribution. The document may not yet have a claimId if it was
      // uploaded before claim creation, in which case we fall back gracefully.
      const earlyDoc = await this.prisma.document.findUnique({
        where: { id: documentId },
        select: { claimId: true, originalName: true },
      }).catch(() => null);

      // ── Step 0: Apply Job Setup capture settings to image uploads ─────────
      // Deskew / auto-crop / grayscale / DPI normalize before extraction when
      // the setup configures it and the ML sidecar is available. No-op for PDFs
      // and when no sidecar is configured.
      const workPath = await this.applyCaptureSettings(documentId, filePath, mimetype);

      // ── Step 1: AI document classifier (zone-guided — highest accuracy) ────
      let classifierResult: Awaited<ReturnType<typeof this.classifierService.classifyAndExtract>> | null = null;
      try {
        classifierResult = await this.classifierService.classifyAndExtract(workPath, mimetype, {
          documentId,
          claimId:  earlyDoc?.claimId  ?? undefined,
          fileName: earlyDoc?.originalName ?? undefined,
        });
        if (classifierResult?.templateName) {
          this.logger.log(`Classifier matched "${classifierResult.templateName}" for document ${documentId}`);
        } else {
          this.logger.log(`No classifier template matched for document ${documentId} — using Tesseract/Ollama`);
        }
      } catch (err: any) {
        this.logger.warn(`Classifier skipped for ${documentId}: ${err?.message ?? err}`);
        if (err?.status || err?.response) {
          this.logger.warn(`Classifier API response: status=${err?.status} body=${JSON.stringify(err?.response?.data ?? err?.error ?? {}).slice(0, 200)}`);
        }
      }

      // ── Step 2: Tesseract/Ollama — fills any gaps the classifier missed ────
      // Route through the batch's chosen vision model when one was supplied.
      const { invoices, pageCount, tokenUsage } = await this.ocrService.extractAndParseInvoice(workPath, mimetype, model);
      const primary = invoices[0];

      // ── Step 3: Merge — classifier claimFieldMap takes priority ────────────
      const cf   = classifierResult?.fields       ?? {};
      const cc   = classifierResult?.confidence   ?? {};
      const cmap = classifierResult?.claimFieldMap ?? {};  // explicit zone.claimField mappings

      const mergedPatientName   = cmap.patientName   || cf.patient_name      || primary?.patientName      || null;
      const mergedPatientId     = cmap.patientId     || cf.patient_id        || primary?.patientId        || null;
      const mergedMemberNumber  = cmap.memberNumber  || cf.membership_number || primary?.membershipNumber  || null;
      const mergedProviderName  = cmap.providerName  || cf.provider_name     || primary?.providerName     || null;
      const mergedInvoiceNumber = cmap.invoiceNumber || cf.invoice_number    || primary?.invoiceNumber    || null;
      const mergedDiagnosis     = cmap.diagnosis     || cf.diagnosis         || cf.diagnosis_code         || primary?.diagnosis || null;

      const rawAmountStr = cmap.invoiceAmount || cf.invoice_amount || cf.total_billed || String(primary?.invoiceAmount ?? '');
      const parsedAmount = parseFloat(rawAmountStr.replace(/[^0-9.]/g, ''));
      const mergedInvoiceAmount = !isNaN(parsedAmount) && parsedAmount > 0
        ? parsedAmount : (primary?.invoiceAmount || null);

      const rawInvoiceDate  = cmap.invoiceDate  || cf.invoice_date || primary?.invoiceDate;
      const rawServiceDate  = cmap.dateOfService || cmap.admissionDate || cf.service_date || cf.admission_date || primary?.serviceDate;
      const safeInvoiceDate = rawInvoiceDate && !isNaN(new Date(rawInvoiceDate).getTime())
        ? new Date(rawInvoiceDate) : null;
      // Service date is always the upload date. OCR-extracted dates are not
      // used here because the claim submission date is the authoritative
      // record — users can correct it manually if needed.
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const safeServiceDate = today;

      // Confidence: average of classifier per-field scores (or Tesseract score as fallback)
      const classifierScores = Object.values(cc).filter((v): v is number => typeof v === 'number' && v > 0);
      const classifierAvg = classifierScores.length
        ? classifierScores.reduce((a, b) => a + b, 0) / classifierScores.length : null;
      const mergedConfidence = classifierAvg ?? primary?.confidence ?? null;
      const isHighConfidence = mergedConfidence !== null && mergedConfidence >= 0.7;

      // Validation errors → flag for manual review
      const hasErrors  = (classifierResult?.validation ?? []).some((v) => v.severity === 'error');
      const needsReview = !isHighConfidence || hasErrors;
      const finalStatus = isHighConfidence && !hasErrors ? 'completed' : 'manual_review';
      const engine = classifierResult?.templateId
        ? 'document-classifier'
        : (primary?.confidence && primary.confidence >= 0.85 ? 'ollama-vision' : 'tesseract');

      // ── Document update ─────────────────────────────────────────────────────
      await this.prisma.document.update({
        where: { id: documentId },
        data: {
          ocrText:        primary?.rawText || '',
          ocrStatus:      finalStatus,
          ocrConfidence:  mergedConfidence,
          ocrProcessedAt: new Date(),
          pageCount:      pageCount || null,
          documentType:   classifierResult?.templateName || primary?.documentPages?.[0]?.category || null,
        },
      });

      const doc = await this.prisma.document.findUnique({
        where: { id: documentId },
        select: { claimId: true },
      });

      if (doc?.claimId) {
        const claimId = doc.claimId;

        const perFieldConf = primary?.fieldConfidences
          ? (primary.fieldConfidences as Record<string, number>)
          : Object.keys(cc).length ? cc : undefined;
        const perFieldAnnotations = primary?.fieldAnnotations ?? undefined;
        // Per-page document classification (Invoice / Auth Letter / Discharge
        // Summary …) so the published claim retains the categories the vision
        // model produced — surfaced as tags on the DocumentViewer thumbnails.
        const perDocumentPages = primary?.documentPages?.length ? primary.documentPages : undefined;

        const providerSlug = mergedProviderName
          ? (await import('./provider-profile.service')).ProviderProfileService.detectSlug(mergedProviderName)
          : undefined;

        await this.prisma.ocrExtraction.upsert({
          where: { claimId },
          create: {
            claimId,
            memberNumber:      mergedMemberNumber,
            memberName:        mergedPatientName,
            patientId:         mergedPatientId,
            providerName:      mergedProviderName,
            invoiceNumber:     mergedInvoiceNumber,
            invoiceDate:       safeInvoiceDate,
            invoiceAmount:     mergedInvoiceAmount,
            patientName:       mergedPatientName,
            dateOfService:     safeServiceDate,
            diagnosis:         mergedDiagnosis,
            procedureCodes:    primary?.procedureCode ? [primary.procedureCode] : [],
            overallConfidence: mergedConfidence,
            rawText:           primary?.rawText || null,
            ocrEngine:         engine,
            status:            finalStatus,
            requiresReview:    needsReview,
            anomalyScore:      null,
            possibleFraud:     false,
            fieldConfidences:  perFieldConf as any ?? undefined,
            fieldAnnotations:  perFieldAnnotations as any ?? undefined,
            documentPages:     perDocumentPages as any ?? undefined,
            modelName:         tokenUsage?.modelName    ?? undefined,
            inputTokens:       tokenUsage?.inputTokens  ?? undefined,
            outputTokens:      tokenUsage?.outputTokens ?? undefined,
            cacheReadTokens:   tokenUsage?.cacheReadTokens ?? undefined,
            processingMs:      tokenUsage?.processingMs ?? undefined,
            providerSlug,
          },
          update: {
            memberNumber:      mergedMemberNumber  || undefined,
            memberName:        mergedPatientName   || undefined,
            patientId:         mergedPatientId     || undefined,
            providerName:      mergedProviderName  || undefined,
            invoiceNumber:     mergedInvoiceNumber || undefined,
            invoiceDate:       safeInvoiceDate     || undefined,
            invoiceAmount:     mergedInvoiceAmount || undefined,
            patientName:       mergedPatientName   || undefined,
            dateOfService:     safeServiceDate     || undefined,
            diagnosis:         mergedDiagnosis     || undefined,
            procedureCodes:    primary?.procedureCode ? [primary.procedureCode] : undefined,
            overallConfidence: mergedConfidence    || undefined,
            rawText:           primary?.rawText    || undefined,
            status:            finalStatus,
            requiresReview:    needsReview,
            processedAt:       new Date(),
            fieldConfidences:  perFieldConf as any ?? undefined,
            fieldAnnotations:  perFieldAnnotations as any ?? undefined,
            documentPages:     perDocumentPages as any ?? undefined,
            modelName:         tokenUsage?.modelName    ?? undefined,
            inputTokens:       tokenUsage?.inputTokens  ?? undefined,
            outputTokens:      tokenUsage?.outputTokens ?? undefined,
            cacheReadTokens:   tokenUsage?.cacheReadTokens ?? undefined,
            processingMs:      tokenUsage?.processingMs ?? undefined,
            providerSlug,
          },
        });

        // ── Provider intelligence — fire-and-forget ──────────────────────
        if (providerSlug && mergedProviderName && primary && tokenUsage) {
          this.providerProfile.upsertAfterExtraction(
            providerSlug,
            mergedProviderName,
            primary,
            tokenUsage,
            undefined,
          ).catch((e: any) => this.logger.warn(`Provider profile upsert failed: ${e?.message ?? e}`));
        }

        // ── Job-setup custom index fields ──────────────────────────────────
        // When the batch was uploaded under a Job Setup, copy its extraction-
        // sourced index fields (JobSetupField.extractionKey → OCR value) into
        // OcrExtraction.customFields so the index form and downstream export see
        // server-authoritative values. Best-effort — never blocks indexing.
        // separationRules are captured here for the document-separation step below.
        let setupSeparationRules: any = null;
        try {
          const batchId = (await this.prisma.claim.findUnique({
            where: { id: claimId },
            select: { batchId: true },
          }))?.batchId ?? null;
          const jobSetupId = batchId
            ? (await this.prisma.batchSubmission.findUnique({
                where: { id: batchId },
                select: { jobSetupId: true },
              }))?.jobSetupId ?? null
            : null;
          if (jobSetupId) {
            const setup = await this.prisma.jobSetup.findUnique({
              where: { id: jobSetupId },
              include: { fields: { where: { source: { in: ['extraction', 'ocrZone'] } } } },
            });
            setupSeparationRules = (setup as any)?.separationRules ?? null;
            if (setup?.fields.length) {
              // Map both canonical keys and raw classifier keys so a setup can
              // bind to either "invoiceNumber" or "invoice_number".
              const extractedMap: Record<string, any> = {
                patientName: mergedPatientName,
                patientId: mergedPatientId,
                memberNumber: mergedMemberNumber,
                membershipNumber: mergedMemberNumber,
                providerName: mergedProviderName,
                invoiceNumber: mergedInvoiceNumber,
                invoiceAmount: mergedInvoiceAmount,
                invoiceDate: safeInvoiceDate ? safeInvoiceDate.toISOString().slice(0, 10) : null,
                diagnosis: mergedDiagnosis,
                ...cf,
                ...cmap,
              };
              const custom: Record<string, any> = {};
              for (const f of setup.fields) {
                if (f.source !== 'extraction' || !f.extractionKey) continue;
                const v = extractedMap[f.extractionKey];
                if (v != null && String(v).trim() !== '') custom[f.key] = v;
              }

              // OCR-zone fields: extract from their bound page regions in one pass.
              const zoneSpecs = setup.fields
                .filter((f) => f.source === 'ocrZone' && f.zone)
                .map((f) => {
                  const z = f.zone as any;
                  return {
                    key: f.key, label: f.label,
                    xPercent: Number(z.xPercent) || 0, yPercent: Number(z.yPercent) || 0,
                    widthPercent: Number(z.widthPercent) || 0, heightPercent: Number(z.heightPercent) || 0,
                    page: z.page ? Number(z.page) : undefined,
                    searchPhrase: z.searchPhrase || undefined,
                  };
                })
                .filter((z) => z.widthPercent > 0 && z.heightPercent > 0);
              if (zoneSpecs.length) {
                const zoneVals = await this.classifierService.extractZones(filePath, mimetype, zoneSpecs);
                for (const [k, r] of Object.entries(zoneVals)) custom[k] = r.value;
              }

              await this.prisma.ocrExtraction.update({
                where: { claimId },
                data: { jobSetupId, ...(Object.keys(custom).length ? { customFields: custom } : {}) },
              });
            }
          }
        } catch (cfErr: any) {
          this.logger.warn(`Job-setup custom-field mapping failed for claim ${claimId}: ${cfErr?.message ?? cfErr}`);
        }

        // A claim is complete as long as it has an invoice — claim form and
        // authorization letter are optional supporting documents. Proceed without
        // them so the workflow is not blocked waiting for docs that may not exist.
        const hasInvoice = !!(mergedInvoiceNumber || mergedInvoiceAmount);

        // Provider auto-detect: when the batch was uploaded without a provider
        // (placeholder), resolve the real provider from the detected invoice
        // name and reassign this claim. Only fires while on the placeholder so a
        // staff- or provider-chosen provider is never overridden.
        //
        // Uses ProviderResolverService (alias → fuzzy → auto-create) instead of
        // a direct DB query so:
        //   - previously-seen name variants resolve via the alias table
        //   - the isActive filter is NOT applied (pending providers are valid)
        //   - unrecognised names create a pending record rather than silently
        //     falling back to "Unknown"
        let detectedProviderId: string | undefined;
        if (mergedProviderName) {
          const current = await this.prisma.claim.findUnique({
            where: { id: claimId },
            select: { providerId: true, provider: { select: { name: true } } },
          }).catch(() => null);
          if (current?.provider?.name === AUTO_DETECT_PROVIDER_NAME) {
            const resolvedId = await this.providerResolver.resolve(mergedProviderName).catch(() => null);
            if (resolvedId && resolvedId !== current.providerId) {
              detectedProviderId = resolvedId;
              this.logger.log(`Auto-detected provider "${mergedProviderName}" → ${resolvedId} for claim ${claimId}`);
            }
          }
        }

        await this.prisma.claim.update({
          where: { id: claimId },
          data: {
            ...(detectedProviderId ? { providerId: detectedProviderId } : {}),
            memberNumber:         mergedMemberNumber  || undefined,
            memberName:           mergedPatientName   || undefined,
            patientName:          mergedPatientName   || undefined,
            patientId:            mergedPatientId     || undefined,
            invoiceNumber:        mergedInvoiceNumber || undefined,
            invoiceDate:          safeInvoiceDate     || undefined,
            invoiceAmount:        mergedInvoiceAmount || undefined,
            dateOfService:        safeServiceDate,
            diagnosis:            mergedDiagnosis     || undefined,
            ocrStatus:            finalStatus,
            ocrConfidence:        mergedConfidence    || undefined,
            ocrProcessedAt:       new Date(),
            requiresManualReview: needsReview,
            isComplete:           hasInvoice,
            missingDocuments:     hasInvoice ? [] : ['invoice'],
          },
        });

        await this.eoxegenService.saveOcrData(claimId, {
          memberNumber:  mergedMemberNumber  || undefined,
          memberName:    mergedPatientName   || undefined,
          providerName:  mergedProviderName  || undefined,
          invoiceNumber: mergedInvoiceNumber || undefined,
          invoiceDate:   rawInvoiceDate,
          invoiceAmount: mergedInvoiceAmount || undefined,
        });

        // ── Fraud detection & anomaly scoring ─────────────────────────────
        // Batch claims arrive with no fields — run fraud signals now that
        // OCR has populated member number, invoice number, amounts, and dates.
        try {
          const freshClaim = await this.prisma.claim.findUnique({
            where: { id: claimId },
            select: {
              id: true, providerId: true, batchNumber: true,
              memberNumber: true, memberName: true, invoiceNumber: true,
              invoiceAmount: true, invoiceDate: true, dateOfService: true,
              ocrConfidence: true, procedureCodes: true,
              fraudSignals: true,
            },
          });

          if (freshClaim) {
            const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000);
            const dosDate = freshClaim.dateOfService;

            // T2.4 — configurable cross-provider duplicate-detection window.
            // Falls back to same-day when no claim-type tagging exists yet.
            const dupWindowDays = await this.claimTypeConfigService.getDuplicateWindowDays(null);
            const dupWindowMs = dupWindowDays * 86_400_000;

            const [existingInvoiceClaims, batchSiblings, crossProviderRaw, recentMemberClaims] =
              await Promise.all([
                // Duplicate invoice number within same provider
                this.prisma.claim.findMany({
                  where: { providerId: freshClaim.providerId, invoiceNumber: { not: null }, id: { not: claimId } },
                  select: { invoiceNumber: true, claimNumber: true, uploadedBy: true, submittedAt: true },
                }),
                // Same-batch siblings for velocity check
                freshClaim.batchNumber
                  ? this.prisma.claim.findMany({
                      where: { batchNumber: freshClaim.batchNumber, id: { not: claimId } },
                      select: { memberNumber: true, invoiceAmount: true },
                    })
                  : Promise.resolve([]),
                // Cross-provider same member, within ±dupWindowDays of service date
                dosDate && freshClaim.memberNumber
                  ? this.prisma.claim.findMany({
                      where: {
                        memberNumber: freshClaim.memberNumber,
                        providerId: { not: freshClaim.providerId },
                        dateOfService: {
                          gte: new Date(dosDate.getTime() - dupWindowMs),
                          lte: new Date(dosDate.getTime() + dupWindowMs + 86_399_000),
                        },
                        status: { not: 'rejected' },
                      },
                      select: { claimNumber: true, provider: { select: { name: true } }, dateOfService: true },
                    })
                  : Promise.resolve([]),
                // Procedure code overlap (unbundling check)
                freshClaim.memberNumber
                  ? this.prisma.claim.findMany({
                      where: {
                        memberNumber: freshClaim.memberNumber,
                        id: { not: claimId },
                        submittedAt: { gte: sevenDaysAgo },
                        procedureCodes: { isEmpty: false },
                      },
                      select: { procedureCodes: true },
                    })
                  : Promise.resolve([]),
              ]);

            const invoiceNumSet = new Set(existingInvoiceClaims.map((c: any) => c.invoiceNumber!));
            const duplicateClaimRefs: DuplicateClaimRef[] = freshClaim.invoiceNumber
              ? existingInvoiceClaims
                  .filter((c: any) => c.invoiceNumber?.trim() === freshClaim.invoiceNumber?.trim())
                  .map((c: any) => ({
                    claimNumber: c.claimNumber,
                    uploadedBy: c.uploadedBy,
                    submittedAt: c.submittedAt?.toISOString() ?? null,
                  }))
              : [];
            const crossProviderMatches: CrossProviderMatch[] = (crossProviderRaw as any[]).map(c => ({
              claimNumber: c.claimNumber,
              providerName: c.provider?.name ?? 'Unknown Provider',
              dateOfService: c.dateOfService?.toISOString().slice(0, 10) ?? '',
            }));
            const recentMemberProcedureCodes: string[] = (recentMemberClaims as any[])
              .flatMap(c => (c.procedureCodes as string[]) ?? []).filter(Boolean);

            // Preserve any signals already on the claim (e.g. manual escalations)
            const existingSignals: any[] = Array.isArray(freshClaim.fraudSignals)
              ? freshClaim.fraudSignals as any[]
              : [];

            const newSignals = computeFraudSignals(
              {
                invoiceAmount:  freshClaim.invoiceAmount ?? undefined,
                invoiceNumber:  freshClaim.invoiceNumber ?? undefined,
                memberNumber:   freshClaim.memberNumber  ?? undefined,
                memberName:     freshClaim.memberName    ?? undefined,
                invoiceDate:    freshClaim.invoiceDate   ?? undefined,
                dateOfService:  freshClaim.dateOfService ?? undefined,
                ocrConfidence:  freshClaim.ocrConfidence ?? undefined,
                aiExtracted:    true,
                procedureCodes: (freshClaim.procedureCodes as string[]) ?? [],
              },
              invoiceNumSet,
              batchSiblings as any[],
              duplicateClaimRefs,
              crossProviderMatches,
              recentMemberProcedureCodes,
            );

            // Merge: avoid duplicating signal titles already present
            const existingTitles = new Set(existingSignals.map((s: any) => s.title));
            const merged = [...existingSignals, ...newSignals.filter(s => !existingTitles.has(s.title))];
            const hasCritical = merged.some(s => s.level === 'critical');

            await this.prisma.claim.update({
              where: { id: claimId },
              data: {
                fraudSignals: merged,
                ...(hasCritical && freshClaim.fraudSignals === null
                  ? { status: 'fraud_hold', workflowStage: 'fraud_review' }
                  : {}),
              },
            });

            if (newSignals.length > 0) {
              this.logger.warn(
                `Fraud signals detected for claim ${claimId}: ` +
                newSignals.map(s => `[${s.level}] ${s.title}`).join(', ')
              );
            }

            // Anomaly scoring — fire-and-forget, must not block OCR completion
            this.anomalyScoringService.scoreClaim(claimId).catch(e =>
              this.logger.warn(`Anomaly scoring failed for ${claimId}: ${e.message}`)
            );

            // Line item fraud analysis + billing audit — awaited so the results
            // are fully cached before the claim reaches the publish step.
            const allLineItems = invoices.flatMap(inv => inv.lineItems ?? []);
            if (allLineItems.length > 0) {
              try {
                await this.lineItemFraudService.analyseAndPersist(
                  claimId,
                  mergedProviderName || 'Unknown',
                  allLineItems,
                  mergedInvoiceAmount ?? 0,
                );
                // Diagnosis-billing validation operates on saved InvoiceLineItem rows.
                await this.diagnosisBillingService.validateLineItems(claimId).catch(e =>
                  this.logger.warn(`Diagnosis-billing check failed for ${claimId}: ${e.message}`)
                );
              } catch (e: any) {
                this.logger.warn(`Line item fraud analysis failed for ${claimId}: ${e.message}`);
              }
            }
            // Billing audit always runs (uses text/vision even without structured items).
            await this.diagnosisBillingService.assessFromClaimData(claimId).catch(e =>
              this.logger.warn(`Billing audit (auto) failed for ${claimId}: ${e.message}`)
            );
          }
        } catch (fraudErr: any) {
          this.logger.warn(`Fraud detection post-OCR failed for claim ${claimId}: ${fraudErr.message}`);
        }
        // ── End fraud detection ────────────────────────────────────────────

        this.logger.log(
          `Indexing done for claim ${claimId} — engine: ${engine}, ` +
          `confidence: ${mergedConfidence !== null ? (mergedConfidence * 100).toFixed(0) + '%' : 'n/a'}, ` +
          `status: ${finalStatus}`
        );

        // ── Document separation / multi-invoice fan-out ────────────────────
        // Skipped for fan-out children (no recursion), best-effort — never
        // blocks indexing. Precedence:
        //   1. The Job Setup's explicit separationRules (blank page / fixed
        //      count / OCR phrase…) split the document into sibling claims.
        //   2. Otherwise the legacy invoice-count heuristic fans out one sibling
        //      per EXTRA detected invoice (flag-gated by ENABLE_INVOICE_FANOUT).
        if (!fanoutChild) {
          const rules = setupSeparationRules;
          if (rules?.method && rules.method !== 'none') {
            await this.documentSeparation
              .separate({ parentClaimId: claimId, sourcePdfPath: filePath, mimetype, rules, model })
              .catch((e: any) =>
                this.logger.warn(`Document separation failed for claim ${claimId}: ${e?.message ?? e}`),
              );
          } else if (InvoiceFanoutService.isEnabled() && invoices.length > 1) {
            await this.invoiceFanout
              .fanOut({ parentClaimId: claimId, sourcePdfPath: filePath, mimetype, invoices, model })
              .catch((e: any) =>
                this.logger.warn(`Invoice fan-out failed for claim ${claimId}: ${e?.message ?? e}`),
              );
          }
        }
      }

      return {
        documentId,
        status: 'completed',
        claimsFound: invoices.length,
        classifierMatched: !!classifierResult?.templateId,
        engine,
      };
    } catch (error) {
      this.logger.error(`OCR failed for document ${documentId}:`, error);
      await this.prisma.document.update({
        where: { id: documentId },
        data: { ocrStatus: 'failed' },
      });
      throw error;
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    this.logger.error(`Job ${job.id} failed after ${job.attemptsMade} attempts: ${error.message}`);
  }
}
