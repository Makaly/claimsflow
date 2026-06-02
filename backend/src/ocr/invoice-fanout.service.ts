import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { BarcodeService } from '../common/services/barcode.service';
import { PdfWatermarkService } from '../common/services/pdf-watermark.service';
import { PdfOperationsService } from '../common/services/pdf-operations.service';

/** Minimal shape of a parsed invoice the fan-out needs (subset of OCR's ParsedInvoice). */
export interface FanoutInvoice {
  pageRange?: string;
}

export interface FanoutParams {
  parentClaimId: string;
  /** Path to the (already barcoded) source PDF that OCR just processed. */
  sourcePdfPath: string;
  mimetype: string;
  /** Every invoice OCR detected on the source file, in page order. Index 0 stays on the parent. */
  invoices: FanoutInvoice[];
  /** Vision model the batch chose, forwarded to each sibling's re-extraction. */
  model?: string;
}

/**
 * Fans a multi-invoice document out into one claim per detected invoice.
 *
 * Context: OCR can detect several invoices in a single uploaded file (merged
 * PDFs), but the primary writeback in {@link OcrProcessor} only applies
 * `invoices[0]` to the originating claim — invoices 1…N were dropped. This
 * service creates a sibling claim + split, barcoded document for each EXTRA
 * invoice and re-enqueues it through the normal `extract-text` pipeline so the
 * sibling gets the same field extraction + fraud detection on its own pages.
 *
 * Design constraints that keep the blast radius small:
 *  - The primary invoice (index 0) and its claim are left UNTOUCHED here.
 *  - Off by default; only runs when ENABLE_INVOICE_FANOUT=true.
 *  - Each sibling job carries `fanoutChild: true` so re-extraction never
 *    re-fans-out (a single-invoice split returns one invoice anyway, but the
 *    flag makes the guard explicit and cheap).
 *  - Best-effort per sibling: one failure logs and continues; the primary
 *    claim is never affected.
 *  - PDFs only — image uploads cannot be page-split and are skipped.
 *
 * v1 limitation: the parent claim keeps the full original PDF (its barcode sits
 * on page 1, which is invoice 0's first page, so it is still correct for that
 * claim). Re-splitting the parent's own document is a follow-up.
 */
@Injectable()
export class InvoiceFanoutService {
  private readonly logger = new Logger(InvoiceFanoutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly barcodeService: BarcodeService,
    private readonly pdfWatermarkService: PdfWatermarkService,
    private readonly pdfOperations: PdfOperationsService,
    @InjectQueue('ocr') private readonly ocrQueue: Queue,
  ) {}

  /** Feature flag — fan-out only runs when explicitly enabled. */
  static isEnabled(): boolean {
    return process.env.ENABLE_INVOICE_FANOUT === 'true';
  }

  /**
   * Parse an OCR page-range string into 1-indexed inclusive bounds.
   * Accepts "1-3", "4", " 2 - 5 ". Returns null when unparseable or inverted.
   */
  parsePageRange(raw: string | undefined | null): { start: number; end: number } | null {
    if (!raw) return null;
    const m = raw.trim().match(/^(\d+)\s*(?:-\s*(\d+))?$/);
    if (!m) return null;
    const start = parseInt(m[1], 10);
    const end = m[2] ? parseInt(m[2], 10) : start;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 1 || end < start) return null;
    return { start, end };
  }

  /**
   * Create a sibling claim + document for each invoice after the first.
   * Returns counts for logging/telemetry. Never throws — failures are logged.
   */
  async fanOut(params: FanoutParams): Promise<{ created: number; skipped: number }> {
    const { parentClaimId, sourcePdfPath, mimetype, invoices, model } = params;
    let created = 0;
    let skipped = 0;

    if (invoices.length <= 1) return { created, skipped };

    if (mimetype !== 'application/pdf' && !sourcePdfPath.toLowerCase().endsWith('.pdf')) {
      this.logger.warn(`Fan-out skipped for claim ${parentClaimId}: source is not a PDF (${mimetype})`);
      return { created, skipped: invoices.length - 1 };
    }
    if (!fs.existsSync(sourcePdfPath)) {
      this.logger.warn(`Fan-out skipped for claim ${parentClaimId}: source file missing (${sourcePdfPath})`);
      return { created, skipped: invoices.length - 1 };
    }

    const parent = await this.prisma.claim.findUnique({
      where: { id: parentClaimId },
      select: {
        batchId: true,
        batchNumber: true,
        providerId: true,
        branchId: true,
        sourcePlatform: true,
        appVersion: true,
        deviceInfo: true,
        createdBy: true,
      },
    });
    if (!parent?.batchNumber) {
      this.logger.warn(`Fan-out skipped for claim ${parentClaimId}: no parent batch context`);
      return { created, skipped: invoices.length - 1 };
    }

    // Folio sequence continues after every claim already in the batch. Concurrent
    // fan-outs race here, so a unique-constraint collision on the barcode just
    // bumps the sequence and retries rather than failing the sibling.
    const batchClaimCount = parent.batchId
      ? await this.prisma.claim.count({ where: { batchId: parent.batchId } })
      : invoices.length;
    let nextSeq = batchClaimCount + 1;

    const total = invoices.length;
    const dir = path.dirname(sourcePdfPath);
    const baseName = path.basename(sourcePdfPath);

    for (let i = 1; i < invoices.length; i++) {
      const range = this.parsePageRange(invoices[i].pageRange);
      if (!range) {
        this.logger.warn(`Fan-out: invoice ${i + 1}/${total} on claim ${parentClaimId} has no usable pageRange ("${invoices[i].pageRange}") — skipped`);
        skipped++;
        continue;
      }

      try {
        const claim = await this.createSibling({
          parent,
          range,
          invoiceIndex: i,
          total,
          sourcePdfPath,
          dir,
          baseName,
          mimetype,
          model,
          startSeq: nextSeq,
        });
        // Advance the sequence past whatever folio the sibling actually claimed.
        nextSeq = claim.usedSeq + 1;
        created++;
      } catch (e: any) {
        this.logger.warn(`Fan-out: invoice ${i + 1}/${total} on claim ${parentClaimId} failed: ${e?.message ?? e}`);
        skipped++;
      }
    }

    this.logger.log(`Fan-out for claim ${parentClaimId}: ${created} sibling claim(s) created, ${skipped} skipped (of ${total - 1} extra invoices)`);
    return { created, skipped };
  }

  /** Split → barcode → create claim + document → enqueue OCR for one extra invoice. */
  private async createSibling(args: {
    parent: {
      batchId: string | null;
      batchNumber: string | null;
      providerId: string | null;
      branchId: string | null;
      sourcePlatform: string | null;
      appVersion: string | null;
      deviceInfo: string | null;
      createdBy: string | null;
    };
    range: { start: number; end: number };
    invoiceIndex: number;
    total: number;
    sourcePdfPath: string;
    dir: string;
    baseName: string;
    mimetype: string;
    model?: string;
    startSeq: number;
  }): Promise<{ usedSeq: number }> {
    const { parent, range, invoiceIndex, total, sourcePdfPath, dir, baseName, model, startSeq } = args;
    const batchNumber = parent.batchNumber as string;

    // Split this invoice's pages out of the source into its own file.
    const splitPath = path.join(dir, `split_${invoiceIndex + 1}_${baseName}`);
    await this.pdfOperations.splitPdf(sourcePdfPath, [
      { start: range.start, end: range.end, outputPath: splitPath },
    ]);

    // Allocate a folio + barcode, stamp it on the split, and persist the claim.
    // Retry on a unique-barcode collision (concurrent fan-out) by bumping the folio.
    const MAX_ATTEMPTS = 50;
    let seq = startSeq;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const folioNumber = this.barcodeService.generateFolioNumber(seq);
      const barcode = await this.barcodeService
        .generateClaimBarcode(batchNumber, folioNumber)
        .catch(() => `CIC-${batchNumber}-${folioNumber}`);
      try {
        const claim = await this.prisma.claim.create({
          data: {
            claimNumber: barcode,
            batchNumber,
            folioNumber,
            barcode,
            providerId: parent.providerId,
            ...(parent.branchId ? { branchId: parent.branchId } : {}),
            ...(parent.batchId ? { batchId: parent.batchId } : {}),
            status: 'submitted',
            workflowStage: 'initial_review',
            submittedAt: new Date(),
            ...(parent.createdBy ? { createdBy: parent.createdBy } : {}),
            ...(parent.sourcePlatform ? { sourcePlatform: parent.sourcePlatform } : {}),
            ...(parent.appVersion ? { appVersion: parent.appVersion } : {}),
            ...(parent.deviceInfo ? { deviceInfo: parent.deviceInfo } : {}),
          },
        });

        // Stamp the sibling's own barcode onto its split pages, in place.
        const barcodeImage = await this.barcodeService.generateBarcodeImage(barcode);
        await this.pdfWatermarkService.addWatermarkAndBarcode(
          splitPath,
          batchNumber,
          barcode,
          barcodeImage,
          splitPath,
        );

        let pageCount: number | undefined;
        try {
          pageCount = await this.pdfWatermarkService.getPageCount(splitPath);
        } catch {
          /* page count is best-effort metadata */
        }

        const doc = await this.prisma.document.create({
          data: {
            filename: path.basename(splitPath),
            originalName: `${baseName} [Invoice ${invoiceIndex + 1}/${total}]`,
            mimetype: 'application/pdf',
            size: BigInt(fs.statSync(splitPath).size),
            path: splitPath,
            claimId: claim.id,
            batchNumber,
            folioNumber,
            hasWatermark: true,
            ...(pageCount ? { pageCount } : {}),
            ...(parent.createdBy ? { uploadedBy: parent.createdBy } : {}),
            metadata: {
              splitFrom: baseName,
              invoiceIndex: invoiceIndex + 1,
              totalInvoices: total,
              pageRange: `${range.start}-${range.end}`,
            },
          },
        });

        // Re-run OCR on the single-invoice split so the sibling gets its own
        // field extraction + fraud detection via the normal pipeline. The
        // fanoutChild flag stops it from fanning out again.
        await this.ocrQueue
          .add(
            'extract-text',
            { documentId: doc.id, filePath: splitPath, mimetype: 'application/pdf', model, fanoutChild: true },
            { attempts: 2, backoff: { type: 'fixed', delay: 5_000 } },
          )
          .catch(() => {});

        return { usedSeq: seq };
      } catch (e: any) {
        // Unique-barcode collision with a concurrent fan-out — bump folio and retry.
        if (e?.code === 'P2002') {
          seq++;
          continue;
        }
        throw e;
      }
    }
    throw new Error(`could not allocate a unique folio after ${MAX_ATTEMPTS} attempts`);
  }
}
