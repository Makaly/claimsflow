import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { createWorker, OEM } from 'tesseract.js';
import { PDFDocument, StandardFonts, rgb, PDFFont } from 'pdf-lib';

export interface SearchablePdfPage {
  pageNumber: number;
  imagePath: string;
  imageMime: 'image/png' | 'image/jpeg';
  hocrXml: string;
  widthPx: number;
  heightPx: number;
  dpi: number;
}

export interface ParsedWord {
  text: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const DEFAULT_DPI = 200;

/**
 * Produces a "searchable PDF" — original page image as background with an
 * invisible, coordinate-aligned text layer. Lets any PDF viewer perform
 * full-text search and selection without changing how the page looks.
 *
 * Self-contained: renders pages with pdftoppm, OCRs with Tesseract in hOCR
 * mode, then composes the PDF with pdf-lib. Does not touch the main OCR
 * extraction pipeline.
 *
 * hOCR coords are top-left pixels; PDF coords are bottom-left points (1pt =
 * 1/72in). Conversion: pt = px / dpi * 72.
 */
@Injectable()
export class SearchablePdfService {
  private readonly logger = new Logger(SearchablePdfService.name);

  /** Where generated PDFs live. Public so the controller can stream them. */
  outputPath(documentId: string): string {
    return path.join(process.cwd(), 'uploads', 'searchable', `${documentId}.pdf`);
  }

  /** True when a generated PDF already exists on disk. */
  exists(documentId: string): boolean {
    return fs.existsSync(this.outputPath(documentId));
  }

  /**
   * Generate a searchable PDF for the given source file. Idempotent: if the
   * output already exists, returns its path without regenerating.
   */
  async generateFromFile(
    documentId: string,
    filePath: string,
    mimetype: string,
    opts: { force?: boolean; dpi?: number } = {},
  ): Promise<string> {
    const out = this.outputPath(documentId);
    if (!opts.force && fs.existsSync(out)) return out;

    const dpi = opts.dpi ?? DEFAULT_DPI;
    let pages: SearchablePdfPage[] = [];
    try {
      pages = await this.runHocrPass(filePath, mimetype, dpi);
      if (pages.length === 0) {
        throw new Error('No pages produced — pdftoppm/Tesseract returned nothing');
      }
      return await this.composePdf(documentId, pages);
    } finally {
      this.cleanupPages(pages);
    }
  }

  /** Compose only — useful in tests that supply synthetic pages. */
  async composePdf(documentId: string, pages: SearchablePdfPage[]): Promise<string> {
    if (pages.length === 0) {
      throw new Error('composePdf called with no pages');
    }
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);

    for (const page of pages) {
      await this.addPage(pdf, font, page);
    }

    pdf.setTitle(`ClaimsFlow document ${documentId}`);
    pdf.setProducer('ClaimsFlow searchable-pdf');
    pdf.setCreator('ClaimsFlow');
    pdf.setCreationDate(new Date());

    const outPath = this.outputPath(documentId);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const bytes = await pdf.save();
    fs.writeFileSync(outPath, bytes);
    return outPath;
  }

  private async addPage(
    pdf: PDFDocument,
    font: PDFFont,
    page: SearchablePdfPage,
  ): Promise<void> {
    const imageBytes = fs.readFileSync(page.imagePath);
    const image =
      page.imageMime === 'image/jpeg'
        ? await pdf.embedJpg(imageBytes)
        : await pdf.embedPng(imageBytes);

    const pageWidthPt = (page.widthPx / page.dpi) * 72;
    const pageHeightPt = (page.heightPx / page.dpi) * 72;

    const pdfPage = pdf.addPage([pageWidthPt, pageHeightPt]);
    pdfPage.drawImage(image, {
      x: 0,
      y: 0,
      width: pageWidthPt,
      height: pageHeightPt,
    });

    const words = parseHocrWords(page.hocrXml);
    if (words.length === 0) {
      this.logger.debug(
        `Page ${page.pageNumber} has no hOCR words — image-only, no searchable layer`,
      );
      return;
    }

    for (const word of words) {
      const fontSizePt = Math.max(
        1,
        ((word.y2 - word.y1) / page.dpi) * 72 * 0.85,
      );
      const xPt = (word.x1 / page.dpi) * 72;
      const yPt = pageHeightPt - ((word.y2 / page.dpi) * 72);

      pdfPage.drawText(word.text, {
        x: xPt,
        y: yPt,
        size: fontSizePt,
        font,
        color: rgb(0, 0, 0),
        opacity: 0,
      });
    }
  }

  private async runHocrPass(
    filePath: string,
    mimetype: string,
    dpi: number,
  ): Promise<SearchablePdfPage[]> {
    const isPdf =
      mimetype === 'application/pdf' || filePath.toLowerCase().endsWith('.pdf');

    const tmpDir = path.join(
      process.cwd(),
      'uploads',
      'ocr-temp',
      `searchable-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    fs.mkdirSync(tmpDir, { recursive: true });

    const pageImages: string[] = [];

    if (isPdf) {
      const { spawnSync } = await import('child_process');
      const result = spawnSync(
        'pdftoppm',
        ['-png', '-r', String(dpi), filePath, path.join(tmpDir, 'page')],
        { timeout: 300_000, stdio: 'pipe' },
      );
      if (result.status !== 0) {
        this.logger.warn(
          `pdftoppm failed: ${result.stderr?.toString()?.slice(0, 200)}`,
        );
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
        return [];
      }
      const files = fs.readdirSync(tmpDir).filter(f => f.endsWith('.png')).sort();
      for (const f of files) pageImages.push(path.join(tmpDir, f));
    } else {
      const ext = path.extname(filePath).toLowerCase() || '.png';
      const dest = path.join(tmpDir, `page-1${ext}`);
      fs.copyFileSync(filePath, dest);
      pageImages.push(dest);
    }

    if (pageImages.length === 0) {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
      return [];
    }

    const sharp = (await import('sharp')).default;
    const worker = await createWorker('eng', OEM.LSTM_ONLY);
    const out: SearchablePdfPage[] = [];

    try {
      for (let i = 0; i < pageImages.length; i++) {
        const imagePath = pageImages[i];
        const meta = await sharp(imagePath).metadata();
        const widthPx = meta.width ?? 0;
        const heightPx = meta.height ?? 0;
        if (widthPx === 0 || heightPx === 0) continue;

        const ext = path.extname(imagePath).toLowerCase();
        const imageMime: 'image/png' | 'image/jpeg' =
          ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';

        const { data } = await worker.recognize(imagePath, {}, { hocr: true } as any);
        const hocrXml = ((data as any).hocr as string | undefined) ?? '';

        out.push({
          pageNumber: i + 1,
          imagePath,
          imageMime,
          hocrXml,
          widthPx,
          heightPx,
          dpi,
        });
      }
    } finally {
      await worker.terminate();
    }

    return out;
  }

  private cleanupPages(pages: SearchablePdfPage[]): void {
    const dirs = new Set<string>();
    for (const p of pages) {
      if (p.imagePath) dirs.add(path.dirname(p.imagePath));
    }
    for (const d of dirs) {
      try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }
}

const WORD_RE =
  /<span[^>]*class=['"]ocrx?_word['"][^>]*title=['"]bbox\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)[^'"]*['"][^>]*>([\s\S]*?)<\/span>/gi;

export function parseHocrWords(hocr: string): ParsedWord[] {
  if (!hocr) return [];
  const out: ParsedWord[] = [];
  let m: RegExpExecArray | null;
  WORD_RE.lastIndex = 0;
  while ((m = WORD_RE.exec(hocr)) !== null) {
    const text = decodeEntities(stripTags(m[5])).trim();
    if (!text) continue;
    const x1 = parseInt(m[1], 10);
    const y1 = parseInt(m[2], 10);
    const x2 = parseInt(m[3], 10);
    const y2 = parseInt(m[4], 10);
    if (
      !Number.isFinite(x1) || !Number.isFinite(y1) ||
      !Number.isFinite(x2) || !Number.isFinite(y2) ||
      x2 <= x1 || y2 <= y1
    ) {
      continue;
    }
    out.push({ text, x1, y1, x2, y2 });
  }
  return out;
}

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, '');
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}
