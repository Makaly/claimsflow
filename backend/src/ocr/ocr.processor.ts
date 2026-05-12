import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { OcrService } from './ocr.service';
import { PrismaService } from '../prisma/prisma.service';
import { EoxegenIntegrationService } from '../common/services/eoxegen-integration.service';
import { DocumentClassifierService } from '../document-classifier/document-classifier.service';

// concurrency: 2 — OCR is CPU-bound via Tesseract; more than 2 saturates the process
@Processor({ name: 'ocr' }, { concurrency: 2 })
export class OcrProcessor extends WorkerHost {
  private readonly logger = new Logger(OcrProcessor.name);

  constructor(
    private ocrService: OcrService,
    private prisma: PrismaService,
    private eoxegenService: EoxegenIntegrationService,
    private classifierService: DocumentClassifierService,
  ) {
    super();
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
    const { documentId, filePath, mimetype } = job.data;
    this.logger.log(`Processing OCR for document: ${documentId}`);

    try {
      await this.prisma.document.update({
        where: { id: documentId },
        data: { ocrStatus: 'processing' },
      });

      // ── Step 1: AI document classifier (zone-guided — highest accuracy) ────
      let classifierResult: Awaited<ReturnType<typeof this.classifierService.classifyAndExtract>> | null = null;
      try {
        classifierResult = await this.classifierService.classifyAndExtract(filePath, mimetype);
        if (classifierResult?.templateName) {
          this.logger.log(`Classifier matched "${classifierResult.templateName}" for document ${documentId}`);
        } else {
          this.logger.log(`No classifier template matched for document ${documentId} — using Tesseract/Ollama`);
        }
      } catch (err: any) {
        this.logger.warn(`Classifier skipped for ${documentId}: ${err?.message}`);
      }

      // ── Step 2: Tesseract/Ollama — fills any gaps the classifier missed ────
      const { invoices, pageCount } = await this.ocrService.extractAndParseInvoice(filePath, mimetype);
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
      const safeServiceDate = rawServiceDate && !isNaN(new Date(rawServiceDate).getTime())
        ? new Date(rawServiceDate) : null;

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
          },
        });

        // A claim is complete as long as it has an invoice — claim form and
        // authorization letter are optional supporting documents. Proceed without
        // them so the workflow is not blocked waiting for docs that may not exist.
        const hasInvoice = !!(mergedInvoiceNumber || mergedInvoiceAmount);

        await this.prisma.claim.update({
          where: { id: claimId },
          data: {
            memberNumber:         mergedMemberNumber  || undefined,
            memberName:           mergedPatientName   || undefined,
            patientName:          mergedPatientName   || undefined,
            patientId:            mergedPatientId     || undefined,
            invoiceNumber:        mergedInvoiceNumber || undefined,
            invoiceDate:          safeInvoiceDate     || undefined,
            invoiceAmount:        mergedInvoiceAmount || undefined,
            dateOfService:        safeServiceDate     || undefined,
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

        this.logger.log(
          `Indexing done for claim ${claimId} — engine: ${engine}, ` +
          `confidence: ${mergedConfidence !== null ? (mergedConfidence * 100).toFixed(0) + '%' : 'n/a'}, ` +
          `status: ${finalStatus}`
        );
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
