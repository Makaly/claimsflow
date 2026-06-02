import { PDFParse } from 'pdf-parse';

/**
 * Thin wrapper around pdf-parse v2's class API so the rest of the codebase has a
 * single, stable surface for digital-text extraction.
 *
 * pdf-parse v2 replaced the v1 callable default export (and its `pagerender`
 * callback) with a `PDFParse` class whose `getText()` returns per-page text
 * directly. Centralising it here keeps the migration in one place and avoids
 * leaking the `new PDFParse(...).getText()` / `destroy()` lifecycle into every
 * call site.
 */

export interface PdfTextResult {
  /** Full concatenated document text (pages joined with page markers). */
  text: string;
  /** Per-page text in page order. Scanned/image pages yield empty strings. */
  pages: string[];
  /** Number of pages in the document. */
  pageCount: number;
}

/** Extract per-page and full digital text from a PDF buffer. */
export async function extractPdfText(data: Buffer): Promise<PdfTextResult> {
  const parser = new PDFParse({ data });
  try {
    const result = await parser.getText();
    return {
      text: result.text ?? '',
      pages: (result.pages ?? []).map((p) => p.text ?? ''),
      pageCount: result.total ?? result.pages?.length ?? 0,
    };
  } finally {
    await parser.destroy().catch(() => {});
  }
}

/**
 * Return just the page count of a PDF buffer. Uses `getInfo()` rather than
 * `getText()` so it doesn't pay to extract every page's text.
 */
export async function getPdfPageCount(data: Buffer): Promise<number> {
  const parser = new PDFParse({ data });
  try {
    const info = await parser.getInfo();
    return info.total ?? 1;
  } finally {
    await parser.destroy().catch(() => {});
  }
}
