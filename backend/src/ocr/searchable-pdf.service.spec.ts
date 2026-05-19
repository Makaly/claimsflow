import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as zlib from 'zlib';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const sharp = require('sharp');
import {
  SearchablePdfService,
  SearchablePdfPage,
  parseHocrWords,
} from './searchable-pdf.service';

// Walks a PDF byte buffer, finds every stream/endstream block, tries to
// flate-decode it, and concatenates the decompressed text. pdf-parse trips
// on small synthetic PDFs, so we extract text operators directly.
function decompressAllStreams(buf: Buffer): string {
  const text: string[] = [];
  let cursor = 0;
  while (cursor < buf.length) {
    const streamIdx = buf.indexOf('\nstream\n', cursor);
    if (streamIdx < 0) break;
    const endStreamIdx = buf.indexOf('\nendstream', streamIdx);
    if (endStreamIdx < 0) break;
    const streamBytes = buf.slice(streamIdx + 8, endStreamIdx);
    try {
      const inflated = zlib.inflateSync(streamBytes);
      text.push(inflated.toString('latin1'));
    } catch {
      // Not flate-compressed (e.g., raw images) — fall back to raw bytes.
      text.push(streamBytes.toString('latin1'));
    }
    cursor = endStreamIdx + 10;
  }
  return text.join('\n');
}

function tinyHocr(words: Array<[string, number, number, number, number]>): string {
  const spans = words
    .map(
      ([w, x1, y1, x2, y2]) =>
        `<span class='ocrx_word' title='bbox ${x1} ${y1} ${x2} ${y2}; x_wconf 95'>${w}</span>`,
    )
    .join('\n');
  return `<!DOCTYPE html><html><body>${spans}</body></html>`;
}

describe('parseHocrWords', () => {
  it('extracts words and bboxes from hOCR markup', () => {
    const hocr = tinyHocr([
      ['INVOICE', 100, 50, 280, 80],
      ['12345', 300, 50, 400, 78],
    ]);
    const words = parseHocrWords(hocr);
    expect(words).toHaveLength(2);
    expect(words[0]).toEqual({ text: 'INVOICE', x1: 100, y1: 50, x2: 280, y2: 80 });
    expect(words[1].text).toBe('12345');
  });

  it('skips entries with invalid bboxes', () => {
    const hocr = tinyHocr([
      ['ok', 10, 10, 50, 30],
      ['bad', 100, 100, 50, 50], // x2 <= x1, y2 <= y1
    ]);
    const words = parseHocrWords(hocr);
    expect(words).toHaveLength(1);
    expect(words[0].text).toBe('ok');
  });

  it('decodes HTML entities in word text', () => {
    const hocr = `<span class='ocrx_word' title='bbox 0 0 50 20'>A&amp;B</span>`;
    expect(parseHocrWords(hocr)[0].text).toBe('A&B');
  });

  it('returns empty array for empty or malformed input', () => {
    expect(parseHocrWords('')).toEqual([]);
    expect(parseHocrWords('not hocr at all')).toEqual([]);
  });
});

describe('SearchablePdfService.composePdf', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'spdf-test-'));
  const pageImagePath = path.join(tmpRoot, 'page-1.png');

  beforeAll(async () => {
    // Real-sized white PNG: pdf-parse's image-stream parser bails on 1x1 PNGs.
    const png = await sharp({
      create: {
        width: 300,
        height: 400,
        channels: 3,
        background: { r: 255, g: 255, b: 255 },
      },
    })
      .png()
      .toBuffer();
    fs.writeFileSync(pageImagePath, png);
  });

  afterAll(() => {
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('produces a PDF that contains the OCR words as searchable text', async () => {
    const svc = new SearchablePdfService();
    const docId = `test-${Date.now()}`;
    const pages: SearchablePdfPage[] = [
      {
        pageNumber: 1,
        imagePath: pageImagePath,
        imageMime: 'image/png',
        hocrXml: tinyHocr([
          ['INVOICE', 100, 50, 280, 80],
          ['12345', 300, 50, 400, 78],
          ['CIC', 100, 100, 180, 130],
        ]),
        widthPx: 850,
        heightPx: 1100,
        dpi: 100,
      },
    ];

    const outPath = await svc.composePdf(docId, pages);
    expect(fs.existsSync(outPath)).toBe(true);

    const buf = fs.readFileSync(outPath);
    const streamText = decompressAllStreams(buf);

    // pdf-lib emits each word as a separate Tj operator: `(WORD) Tj`.
    expect(streamText).toContain('(INVOICE) Tj');
    expect(streamText).toContain('(12345) Tj');
    expect(streamText).toContain('(CIC) Tj');

    try { fs.unlinkSync(outPath); } catch { /* ignore */ }
  });

  it('still produces a valid PDF when a page has no hOCR words', async () => {
    const svc = new SearchablePdfService();
    const docId = `test-empty-${Date.now()}`;
    const pages: SearchablePdfPage[] = [
      {
        pageNumber: 1,
        imagePath: pageImagePath,
        imageMime: 'image/png',
        hocrXml: '',
        widthPx: 850,
        heightPx: 1100,
        dpi: 100,
      },
    ];

    const outPath = await svc.composePdf(docId, pages);
    expect(fs.existsSync(outPath)).toBe(true);
    expect(fs.statSync(outPath).size).toBeGreaterThan(100);
    try { fs.unlinkSync(outPath); } catch { /* ignore */ }
  });
});
