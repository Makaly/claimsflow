import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
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

/**
 * Produces a "searchable PDF" — original page image as background with an
 * invisible, coordinate-aligned text layer (PDF text rendering mode 3). This
 * lets any PDF viewer perform full-text search and selection without changing
 * the visual appearance of the scanned page.
 *
 * hOCR coordinates are top-left pixels; PDF coordinates are bottom-left points
 * (1pt = 1/72in). Conversion: pt = px / dpi * 72.
 */
@Injectable()
export class SearchablePdfService {
  private readonly logger = new Logger(SearchablePdfService.name);

  async generate(documentId: string, pages: SearchablePdfPage[]): Promise<string> {
    if (pages.length === 0) {
      throw new Error('SearchablePdfService.generate called with no pages');
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

    const outDir = path.join(process.cwd(), 'uploads', 'searchable');
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `${documentId}.pdf`);
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
