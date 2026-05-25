import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { BarcodeService } from '../common/services/barcode.service';
import { PdfWatermarkService } from '../common/services/pdf-watermark.service';
import { OcrService } from '../ocr/ocr.service';
import { EmailService } from '../notifications/email.service';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class BatchSubmissionService {
  private readonly appUrl = process.env.APP_URL || 'http://localhost:3000';

  constructor(
    private prisma: PrismaService,
    private barcodeService: BarcodeService,
    private pdfWatermarkService: PdfWatermarkService,
    private ocrService: OcrService,
    private emailService: EmailService,
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
        submissionMethod,
        totalClaims: files.length,
        totalSize: BigInt(totalSize),
        status: 'processing',
        uploadedBy,
        ipAddress,
        ...(stationId ? { userAgent: stationId } : {}),
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

    try {
      // Generate barcode
      const barcode = await this.barcodeService.generateClaimBarcode(
        batch.batchNumber,
        folioNumber,
      );

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

      // Generate unique claim number
      const claimNumber = barcode;

      // Create claim record — inherit branchId from the batch so every claim
      // produced by a branch-bound upload is scoped to that branch.
      const claim = await this.prisma.claim.create({
        data: {
          claimNumber,
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

      // Enqueue OCR — this populates claim fields and triggers fraud detection
      await this.ocrService.processDocument(doc.id, processedPath, file.mimetype);

      return claim;
    } catch (error) {
      throw new Error(`Failed to process claim file: ${error.message}`);
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
      sessionId:    c.id ? undefined : c.sessionId,  // ignored in create path
      batchId:      c.batchId      ?? null,
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
    return this.prisma.batchDraftClaim.update({
      where: { barcode },
      data:  this.draftFields(data),
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
