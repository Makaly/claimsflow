import { Injectable, Logger } from '@nestjs/common';
import { OcrService } from './ocr.service';
import { PdfWatermarkService } from '../common/services/pdf-watermark.service';
import { InvoiceFanoutService } from './invoice-fanout.service';

export interface SeparationRules {
  method: 'none' | 'fixedCount' | 'blankPage' | 'barcode' | 'patchcode' | 'ocrPhrase';
  pagesPerDoc?: number;
  barcodePrefix?: string;
  ocrPhrase?: string;
  maxPages?: number;
}

export interface SeparateParams {
  parentClaimId: string;
  sourcePdfPath: string;
  mimetype: string;
  rules: SeparationRules;
  model?: string;
}

/** A page is treated as blank when its OCR text has fewer than this many chars. */
const BLANK_PAGE_MAX_CHARS = 8;

/**
 * Splits a multi-page upload into separate documents/claims according to a Job
 * Setup's separationRules (Kodak Capture Pro-style separation). It only computes
 * the page-range segments; materialization (split → barcode → sibling claim →
 * re-OCR) is delegated to {@link InvoiceFanoutService.fanOut}, which already
 * keeps segment[0] on the originating claim and fans the rest out.
 *
 * Coverage:
 *  - fixedCount: deterministic, uses page count.
 *  - blankPage / ocrPhrase: per-page OCR text (OcrService.extractTextFromPDF).
 *  - barcode / patchcode: require a per-page scan signal not yet captured —
 *    logged and skipped (no silent no-op).
 */
@Injectable()
export class DocumentSeparationService {
  private readonly logger = new Logger(DocumentSeparationService.name);

  constructor(
    private readonly ocr: OcrService,
    private readonly pdfWatermark: PdfWatermarkService,
    private readonly fanout: InvoiceFanoutService,
  ) {}

  /** Compute 1-indexed inclusive page-range segments for the chosen method. */
  async computeSegments(
    rules: SeparationRules,
    pageCount: number,
    filePath: string,
    mimetype: string,
  ): Promise<Array<{ start: number; end: number }>> {
    if (pageCount < 1) return [];

    switch (rules.method) {
      case 'fixedCount': {
        const n = Math.max(1, Math.floor(rules.pagesPerDoc ?? 1));
        const segs: Array<{ start: number; end: number }> = [];
        for (let s = 1; s <= pageCount; s += n) segs.push({ start: s, end: Math.min(pageCount, s + n - 1) });
        return segs;
      }

      case 'blankPage': {
        const { pages } = await this.ocr.extractTextFromPDF(filePath).catch(() => ({ pages: [] as string[] }));
        if (!pages.length) return [];
        const segs: Array<{ start: number; end: number }> = [];
        let start: number | null = null;
        for (let i = 0; i < pages.length; i++) {
          const blank = (pages[i]?.trim().length ?? 0) < BLANK_PAGE_MAX_CHARS;
          if (blank) {
            if (start != null) { segs.push({ start, end: i }); start = null; }
          } else if (start == null) {
            start = i + 1;
          }
        }
        if (start != null) segs.push({ start, end: pages.length });
        return segs;
      }

      case 'ocrPhrase': {
        const phrase = (rules.ocrPhrase ?? '').trim().toLowerCase();
        if (!phrase) return [];
        const { pages } = await this.ocr.extractTextFromPDF(filePath).catch(() => ({ pages: [] as string[] }));
        if (!pages.length) return [];
        const starts: number[] = [];
        for (let i = 0; i < pages.length; i++) {
          if ((pages[i] ?? '').toLowerCase().includes(phrase)) starts.push(i + 1);
        }
        if (!starts.length) return [{ start: 1, end: pages.length }];
        if (starts[0] !== 1) starts.unshift(1);
        return starts.map((s, i) => ({ start: s, end: (i + 1 < starts.length ? starts[i + 1] - 1 : pages.length) }));
      }

      case 'barcode':
      case 'patchcode':
        this.logger.warn(
          `Separation method "${rules.method}" needs a per-page scan signal that is not yet captured — no split performed for claim document.`,
        );
        return [];

      default:
        return [];
    }
  }

  /** Break any segment longer than maxPages into maxPages-sized chunks. */
  private applyMaxPages(segs: Array<{ start: number; end: number }>, maxPages?: number) {
    if (!maxPages || maxPages < 1) return segs;
    const out: Array<{ start: number; end: number }> = [];
    for (const s of segs) {
      for (let p = s.start; p <= s.end; p += maxPages) out.push({ start: p, end: Math.min(s.end, p + maxPages - 1) });
    }
    return out;
  }

  /**
   * Run separation for one document. Returns how many sibling claims were
   * created. Never throws — failures are logged and the parent claim is intact.
   */
  async separate(params: SeparateParams): Promise<{ created: number; skipped: number; segments: number }> {
    const { parentClaimId, sourcePdfPath, mimetype, rules, model } = params;
    if (!rules || rules.method === 'none') return { created: 0, skipped: 0, segments: 0 };

    const isPdf = mimetype === 'application/pdf' || sourcePdfPath.toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      this.logger.warn(`Separation skipped for claim ${parentClaimId}: source is not a PDF`);
      return { created: 0, skipped: 0, segments: 0 };
    }

    const pageCount = await this.pdfWatermark.getPageCount(sourcePdfPath).catch(() => 0);
    if (pageCount < 2) return { created: 0, skipped: 0, segments: pageCount };

    let segments = await this.computeSegments(rules, pageCount, sourcePdfPath, mimetype);
    segments = this.applyMaxPages(segments, rules.maxPages);

    if (segments.length <= 1) {
      this.logger.log(`Separation (${rules.method}) for claim ${parentClaimId}: 1 segment — nothing to split.`);
      return { created: 0, skipped: 0, segments: segments.length };
    }

    // fanOut keeps segment[0] on the parent claim and creates a sibling for the rest.
    const invoices = segments.map((s) => ({ pageRange: `${s.start}-${s.end}` }));
    const res = await this.fanout.fanOut({ parentClaimId, sourcePdfPath, mimetype, invoices, model });
    this.logger.log(`Separation (${rules.method}) for claim ${parentClaimId}: ${segments.length} segment(s) → ${res.created} sibling(s).`);
    return { ...res, segments: segments.length };
  }
}
