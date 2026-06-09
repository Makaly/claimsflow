import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { BarcodeService } from '../common/services/barcode.service';
import { PdfWatermarkService } from '../common/services/pdf-watermark.service';
import { OcrService } from '../ocr/ocr.service';
import { StorageService } from '../common/services/storage.service';
import { EmailService } from '../notifications/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MakerCheckerService } from '../workflow/maker-checker.service';
import * as fs from 'fs';
import * as path from 'path';
import { AUTO_DETECT_PROVIDER_NAME } from '../common/constants/auto-detect-provider';

@Injectable()
export class BatchSubmissionService {
  private readonly appUrl = process.env.APP_URL || 'http://localhost:3000';

  constructor(
    private prisma: PrismaService,
    private barcodeService: BarcodeService,
    private pdfWatermarkService: PdfWatermarkService,
    private ocrService: OcrService,
    private emailService: EmailService,
    private storage: StorageService,
    private notifications: NotificationsService,
    private makerChecker: MakerCheckerService,
    @InjectQueue('batch-processing') private batchQueue: Queue,
  ) {}

  /**
   * Create a batch submission with multiple claim files
   */
  async createBatchSubmission(
    providerId: string,
    files: Express.Multer.File[],
    submissionMethod: string = 'web_upload',
    uploadedBy?: string,
    ipAddress?: string,
    stationId?: string,
    branchId?: string | null,
    jobSetupId?: string | null,
    source?: { sourcePlatform?: string; appVersion?: string; deviceInfo?: string; extractionModel?: string },
  ) {
    // Generate batch number
    const batchCount = await this.prisma.batchSubmission.count({
      where: {
        createdAt: {
          gte: new Date(new Date().setHours(0, 0, 0, 0)),
        },
      },
    });
    const batchNumber = this.barcodeService.generateBatchNumber(batchCount + 1);

    // Calculate total size
    const totalSize = files.reduce((sum, file) => sum + file.size, 0);

    // Create batch record
    const batch = await this.prisma.batchSubmission.create({
      data: {
        batchNumber,
        providerId,
        ...(branchId ? { branchId } : {}),
        ...(jobSetupId ? { jobSetupId } : {}),
        submissionMethod,
        totalClaims: files.length,
        totalSize: BigInt(totalSize),
        status: 'processing',
        uploadedBy,
        ipAddress,
        ...(stationId ? { userAgent: stationId } : {}),
        // Upload-source metadata (mobile sends X-Client-Platform etc.); scan
        // station falls back to its submissionMethod as the platform tag.
        ...(source?.sourcePlatform ? { sourcePlatform: source.sourcePlatform } : (stationId ? { sourcePlatform: 'scan_station' } : {})),
        ...(source?.appVersion ? { appVersion: source.appVersion } : {}),
        ...(source?.deviceInfo ? { deviceInfo: source.deviceInfo } : {}),
        ...(source?.extractionModel ? { extractionModel: source.extractionModel } : {}),
      },
      include: {
        provider: true,
      },
    });

    // Queue batch processing — non-fatal if Redis is unavailable
    this.batchQueue.add('process-batch', {
      batchId: batch.id,
      files: files.map((f) => ({
        path: f.path,
        originalName: f.originalname,
        size: f.size,
        mimetype: f.mimetype,
      })),
    }, { attempts: 1 }).catch(() => {});

    // Notify all maker-checker users of new batch — non-blocking
    const count = files.length;
    const providerName = batch.provider?.name ?? 'Unknown provider';
    // In-app notification to every maker-checker (the email below still sends).
    this.notifications.notifyRole('maker_checker', {
      category: 'claim',
      title: `New batch ${batch.batchNumber}`,
      body: `${count} invoice${count !== 1 ? 's' : ''} from ${providerName} awaiting verification.`,
      deepLink: 'workflow/maker',
    }).catch(() => {});
    this.prisma.user
      .findMany({ where: { role: 'maker_checker', isActive: true }, select: { email: true } })
      .then((makers) =>
        Promise.all(
          makers.map((u) =>
            this.emailService
              .sendWorkflowEmail({
                recipientEmail: u.email,
                subject: `New batch submitted for verification: ${batch.batchNumber}`,
                badgeText: 'New Batch', badgeStyle: 'blue',
                title: `${count} New Invoice${count !== 1 ? 's' : ''} Ready for Verification`,
                subtitle: `Batch ${batch.batchNumber} · submitted by ${providerName}`,
                claimNumber: batch.batchNumber,
                providerName,
                bodyLines: [
                  `A new batch of <strong style="color:#e4e4e7">${count} invoice${count !== 1 ? 's' : ''}</strong> from <strong style="color:#e4e4e7">${providerName}</strong> has been submitted and is awaiting first-level (maker) verification.`,
                  'Please open the Maker Queue to begin processing this batch.',
                ],
                ctaText: 'Open Maker Queue', ctaUrl: `${this.appUrl}/workflow`,
                nextNote: `Batch reference: ${batch.batchNumber}. Individual claims will appear in the queue once document processing is complete (typically within a few minutes).`,
              })
              .catch(() => {}),
          ),
        ),
      )
      .catch(() => {});

    return batch;
  }

  /**
   * Find-or-create the [AUTO_DETECT_PROVIDER_NAME] placeholder so a staff batch
   * upload can proceed without picking a provider; the OCR pipeline reassigns
   * each claim to its detected provider afterwards.
   */
  async resolveAutoDetectProviderId(): Promise<string> {
    const found = await this.prisma.provider.findFirst({
      where: { name: AUTO_DETECT_PROVIDER_NAME },
      select: { id: true },
    });
    if (found) return found.id;
    try {
      const created = await this.prisma.provider.create({
        data: {
          name: AUTO_DETECT_PROVIDER_NAME,
          type: 'hospital',
          licenseNumber: 'AUTODETECT-PLACEHOLDER',
          contactPerson: 'Pending',
          email: 'autodetect-pending@provider.local',
          phone: '000',
          physicalAddress: 'Pending',
          status: 'pending',
          approvalStatus: 'pending_approval',
          isActive: false,
          canSubmitClaims: false,
        },
        select: { id: true },
      });
      return created.id;
    } catch {
      // Lost a create race — the row now exists; re-read it.
      const retry = await this.prisma.provider.findFirst({
        where: { name: AUTO_DETECT_PROVIDER_NAME },
        select: { id: true },
      });
      if (retry) return retry.id;
      throw new Error('Could not resolve the auto-detect placeholder provider');
    }
  }

  /**
   * Reserve a unique batch number for a frontend upload session.
   * Combines counts from both Claim and BatchSubmission tables to find
   * the next available BTH-YYYY-NNNNN and guarantees it isn't already taken.
   */
  async reserveBatchNumber(): Promise<{ batchNumber: string }> {
    const year = new Date().getFullYear();
    const prefix = `BTH-${year}-`;

    const [claimBatches, submissionBatches] = await Promise.all([
      this.prisma.claim.findMany({
        where: { batchNumber: { startsWith: prefix } },
        select: { batchNumber: true },
        distinct: ['batchNumber'],
      }),
      this.prisma.batchSubmission.findMany({
        where: { batchNumber: { startsWith: prefix } },
        select: { batchNumber: true },
      }),
    ]);

    const taken = new Set([
      ...claimBatches.map((c) => c.batchNumber).filter(Boolean),
      ...submissionBatches.map((b) => b.batchNumber),
    ]);

    let seq = taken.size + 1;
    let batchNumber = `${prefix}${String(seq).padStart(5, '0')}`;
    while (taken.has(batchNumber)) {
      seq++;
      batchNumber = `${prefix}${String(seq).padStart(5, '0')}`;
    }

    return { batchNumber };
  }

  /**
   * Process individual claim file within batch
   */
  async processClaimFile(
    batchId: string,
    file: { path: string; originalName: string; size: number; mimetype: string },
    folioNumber: string,
  ) {
    const batch = await this.prisma.batchSubmission.findUnique({
      where: { id: batchId },
      include: { provider: true },
    });

    if (!batch) {
      throw new NotFoundException('Batch not found');
    }

    // Generate barcode first — needed even for the failed-claim record.
    const barcode = await this.barcodeService.generateClaimBarcode(
      batch.batchNumber,
      folioNumber,
    ).catch(() => `CIC-${batch.batchNumber}-${folioNumber}-ERR`);

    try {
      // Generate barcode image
      const barcodeImage = await this.barcodeService.generateBarcodeImage(barcode);

      // Process PDF - add watermark and barcode
      const processedPath = path.join(
        path.dirname(file.path),
        `processed_${path.basename(file.path)}`,
      );

      await this.pdfWatermarkService.addWatermarkAndBarcode(
        file.path,
        batch.batchNumber,
        barcode,
        barcodeImage,
        processedPath,
      );

      // Get page count
      const pageCount = await this.pdfWatermarkService.getPageCount(processedPath);

      // Extract metadata
      const metadata = await this.pdfWatermarkService.extractMetadata(processedPath);

      // Create claim record — inherit branchId from the batch so every claim
      // produced by a branch-bound upload is scoped to that branch.
      const claim = await this.prisma.claim.create({
        data: {
          claimNumber: barcode,
          batchNumber: batch.batchNumber,
          folioNumber,
          barcode,
          providerId: batch.providerId,
          ...(batch.branchId ? { branchId: batch.branchId } : {}),
          batchId: batch.id,
          status: 'submitted',
          workflowStage: 'initial_review',
          submittedAt: new Date(),
          createdBy: batch.uploadedBy,
          // Inherit upload-source metadata from the batch.
          ...(batch.sourcePlatform ? { sourcePlatform: batch.sourcePlatform } : {}),
          ...(batch.appVersion ? { appVersion: batch.appVersion } : {}),
          ...(batch.deviceInfo ? { deviceInfo: batch.deviceInfo } : {}),
        },
      });

      // Create document record
      const doc = await this.prisma.document.create({
        data: {
          filename: path.basename(processedPath),
          originalName: file.originalName,
          mimetype: file.mimetype,
          size: BigInt(fs.statSync(processedPath).size),
          path: processedPath,
          claimId: claim.id,
          batchNumber: batch.batchNumber,
          folioNumber,
          hasWatermark: true,
          pageCount,
          metadata,
          uploadedBy: batch.uploadedBy,
        },
      });

      // Delete original file
      if (fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }

      // Enqueue OCR — this populates claim fields and triggers fraud detection.
      // The batch's chosen vision model (if any) routes the extraction. OCR reads
      // the local processedPath in this session, before any storage upload.
      await this.ocrService.processDocument(doc.id, processedPath, file.mimetype, batch.extractionModel ?? undefined);

      // Persist the durable copy to object storage (when configured) so the
      // watermarked PDF survives container restarts; store the s3:// ref. The
      // local file is left in place for the in-session OCR job above. No-op locally.
      if (this.storage.isEnabled) {
        try {
          const ref = await this.storage.put(`claims/${batch.batchNumber}/${path.basename(processedPath)}`, processedPath, file.mimetype);
          if (ref !== processedPath) {
            await this.prisma.document.update({ where: { id: doc.id }, data: { path: ref } });
          }
        } catch (e) {
          // Non-fatal — the document still serves from the local copy this session.
          console.warn(`Object-storage upload failed for document ${doc.id}: ${(e as Error)?.message}`);
        }
      }

      // Auto-assign to the least-loaded maker-checker right away so the claim
      // lands in a checker's own queue the moment the batch is published. OCR
      // above already ran, so a critical fraud signal will have moved the claim
      // to fraud_review — autoAssignFreshClaim respects that and skips it.
      // Best-effort: assignment must never fail the published claim.
      try {
        await this.makerChecker.autoAssignFreshClaim(claim.id, batch.uploadedBy ?? undefined);
      } catch (e) {
        console.warn(`Auto-assign on publish failed for claim ${claim.id}: ${(e as Error)?.message}`);
      }

      return claim;
    } catch (error) {
      // Create a failed claim stub so the review screen can surface the error
      // reason instead of showing an empty list.
      const errMsg = error instanceof Error ? error.message : String(error);
      await this.prisma.claim.create({
        data: {
          claimNumber: barcode,
          batchNumber: batch.batchNumber,
          folioNumber,
          barcode,
          providerId: batch.providerId,
          ...(batch.branchId ? { branchId: batch.branchId } : {}),
          batchId: batch.id,
          status: 'failed',
          workflowStage: 'initial_review',
          submittedAt: new Date(),
          createdBy: batch.uploadedBy,
          ...(batch.sourcePlatform ? { sourcePlatform: batch.sourcePlatform } : {}),
          ...(batch.appVersion ? { appVersion: batch.appVersion } : {}),
          ...(batch.deviceInfo ? { deviceInfo: batch.deviceInfo } : {}),
          rejectionReason: `Processing failed: ${errMsg}`,
        },
      }).catch(() => { /* ignore if claim creation itself fails */ });
      throw new Error(`Failed to process claim file: ${errMsg}`);
    }
  }

  /**
   * Update batch status
   */
  async updateBatchStatus(
    batchId: string,
    status: string,
    processedClaims?: number,
    failedClaims?: number,
  ) {
    const updateData: any = { status };

    if (processedClaims !== undefined) {
      updateData.processedClaims = processedClaims;
    }

    if (failedClaims !== undefined) {
      updateData.failedClaims = failedClaims;
    }

    if (status === 'completed') {
      updateData.completedAt = new Date();
    }

    return this.prisma.batchSubmission.update({
      where: { id: batchId },
      data: updateData,
    });
  }

  /**
   * Get batch details
   */
  async getBatchById(batchId: string) {
    const batch = await this.prisma.batchSubmission.findUnique({
      where: { id: batchId },
      include: {
        provider: true,
        claims: {
          include: {
            documents: true,
            provider: true,
          },
        },
      },
    });

    if (!batch) {
      throw new NotFoundException('Batch not found');
    }

    return batch;
  }

  /**
   * Get all batches with filters
   */
  async getAllBatches(filters?: {
    providerId?: string;
    status?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    offset?: number;
    submissionMethod?: string;
    stationId?: string;
  }) {
    const where: any = {};

    if (filters?.providerId) {
      where.providerId = filters.providerId;
    }

    if (filters?.status) {
      where.status = filters.status;
    }

    if (filters?.submissionMethod) {
      where.submissionMethod = filters.submissionMethod;
    }

    if (filters?.stationId) {
      where.userAgent = filters.stationId;
    }

    if (filters?.startDate || filters?.endDate) {
      where.createdAt = {};
      if (filters.startDate) {
        where.createdAt.gte = filters.startDate;
      }
      if (filters.endDate) {
        where.createdAt.lte = filters.endDate;
      }
    }

    const [batches, total] = await Promise.all([
      this.prisma.batchSubmission.findMany({
        where,
        include: {
          provider: true,
          _count: {
            select: { claims: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: filters?.limit || 50,
        skip: filters?.offset || 0,
      }),
      this.prisma.batchSubmission.count({ where }),
    ]);

    return {
      batches,
      total,
      limit: filters?.limit || 50,
      offset: filters?.offset || 0,
    };
  }

  /**
   * Get batch statistics
   */
  async getBatchStatistics(providerId?: string) {
    const where: any = {};
    if (providerId) {
      where.providerId = providerId;
    }

    const [
      total,
      processing,
      completed,
      failed,
      totalClaims,
    ] = await Promise.all([
      this.prisma.batchSubmission.count({ where }),
      this.prisma.batchSubmission.count({
        where: { ...where, status: 'processing' },
      }),
      this.prisma.batchSubmission.count({
        where: { ...where, status: 'completed' },
      }),
      this.prisma.batchSubmission.count({
        where: { ...where, status: 'failed' },
      }),
      this.prisma.claim.count({
        where: providerId ? { providerId } : {},
      }),
    ]);

    return {
      total,
      processing,
      completed,
      failed,
      totalClaims,
    };
  }

  // ── Draft claims ──────────────────────────────────────────────────────────

  private draftFields(c: any) {
    return {
      sessionId:    c.sessionId ?? undefined,
      batchId:      c.batchId      ?? null,
      jobSetupId:   c.jobSetupId   ?? null,
      customFields: c.customFields ?? {},
      claimNumber:  c.claimNumber  ?? null,
      fileName:     c.fileName     ?? '',
      fileSize:     c.fileSize     ?? 0,
      fileType:     c.fileType     ?? null,
      providerName: c.providerName ?? null,
      memberNumber: c.memberNumber ?? null,
      patientName:  c.patientName  ?? null,
      patientId:    c.patientId    ?? null,
      invoiceNumber:c.invoiceNumber?? null,
      invoiceDate:  c.invoiceDate  ?? null,
      invoiceAmount:typeof c.invoiceAmount === 'number' ? c.invoiceAmount : parseFloat(c.invoiceAmount) || 0,
      serviceDate:  c.serviceDate  ?? null,
      diagnosis:    c.diagnosis    ?? null,
      diagnosisCode:c.diagnosisCode?? null,
      procedureCode:c.procedureCode?? null,
      treatment:    c.treatment    ?? null,
      aiConfidence: c.aiConfidence ?? 0,
      aiVerified:   c.aiVerified   ?? false,
      status:       c.status       ?? 'extracted',
      pageRange:    c.pageRange    ?? null,
      annotations:  c.annotations  ?? [],
      lineItems:    c.lineItems    ?? [],
      documentPages:c.documentPages?? [],
      // Persist OCR text + field-source data so the billing audit and the
      // Kodak-style overlay survive a draft reload (previously dropped here).
      rawText:          c.rawText          ?? null,
      fieldAnnotations: c.fieldAnnotations ?? undefined,
      fieldConfidences: c.fieldConfidences ?? undefined,
    };
  }

  async upsertDraftClaims(sessionId: string, claims: any[], batchId?: string) {
    const results = await Promise.allSettled(
      claims.map(c =>
        this.prisma.batchDraftClaim.upsert({
          where:  { barcode: c.barcode },
          create: { barcode: c.barcode, sessionId, ...this.draftFields({ ...c, batchId }) },
          update: this.draftFields({ ...c, batchId }),
        })
      )
    );
    const saved = results.filter(r => r.status === 'fulfilled').length;
    return { saved, total: claims.length };
  }

  async updateDraftClaim(barcode: string, data: any) {
    const fields = this.draftFields(data);
    // Use upsert so a PATCH for a claim that only exists in localStorage
    // (never flushed to DB) creates the row rather than throwing P2025.
    return this.prisma.batchDraftClaim.upsert({
      where:  { barcode },
      update: fields,
      create: { barcode, sessionId: data.sessionId ?? '', ...fields },
    });
  }

  async getDraftClaims(sessionId: string) {
    return this.prisma.batchDraftClaim.findMany({
      where:   { sessionId, publishedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }

  async deleteDraftClaims(sessionId: string) {
    return this.prisma.batchDraftClaim.deleteMany({ where: { sessionId } });
  }
}
