import { parsePageHints, documentPagesFromHints } from './gemini-vision.service';

// A realistic page pre-scan for File Agk1.pdf (Aga Khan IP bill: 9-page invoice,
// discharge summary, auth letter) — the same text Gemini already computes.
const HINTS = [
  '=== PAGE PRE-SCAN (authoritative split map — use as primary guidance) ===',
  'Page 1: INPATIENT INVOICE (Aga Khan) *** NEW CLAIM SPLIT BOUNDARY *** — Invoice: UH283003051',
  'Page 2: INVOICE CONTINUATION (Aga Khan — same invoice UH283003051)',
  'Page 9: INVOICE CONTINUATION (page 9 of 9 — DO NOT SPLIT) [inferred]',
  'Page 10: DISCHARGE SUMMARY (attach to nearest preceding invoice) — MR#: AK00565303',
  'Page 11: LAB RESULTS (attach to nearest preceding invoice)',
  'Page 12: AUTHORIZATION LETTER (attach to nearest preceding invoice) — Member: KE1814500',
  'Page 13: SCANNED/IMAGE',
  '=== END PAGE PRE-SCAN ===',
].join('\n');

describe('Gemini documentPagesFromHints (per-page categories without a vision schema)', () => {
  const hints = parsePageHints(HINTS);

  it('classifies each page type into the DocumentPage category vocabulary', () => {
    const pages = documentPagesFromHints(hints);
    const byPage = Object.fromEntries(pages.map(p => [p.pageNumber, p.category]));
    expect(byPage[1]).toBe('invoice');
    expect(byPage[2]).toBe('invoice');
    expect(byPage[10]).toBe('discharge_summary');
    expect(byPage[11]).toBe('lab_result');
    expect(byPage[12]).toBe('pre_auth');           // authorization letter → pre_auth colour
    expect(byPage[13]).toBe('unknown');            // scanned/image
  });

  it('labels continuation pages distinctly from the first invoice page', () => {
    const pages = documentPagesFromHints(hints);
    expect(pages.find(p => p.pageNumber === 1)?.categoryLabel).toBe('Invoice');
    expect(pages.find(p => p.pageNumber === 2)?.categoryLabel).toBe('Invoice (cont.)');
    expect(pages.find(p => p.pageNumber === 12)?.categoryLabel).toBe('Authorization Letter');
  });

  it('restricts output to the requested page range (used for split claims)', () => {
    const pages = documentPagesFromHints(hints, [10, 12]);
    expect(pages.map(p => p.pageNumber)).toEqual([10, 12]);
    expect(pages.map(p => p.category)).toEqual(['discharge_summary', 'pre_auth']);
  });

  it('returns an empty array when there are no hints (image-only uploads)', () => {
    expect(documentPagesFromHints(new Map())).toEqual([]);
  });

  it('classifies a Medical Claim Form as claim_form', () => {
    const h = parsePageHints('Page 1: MEDICAL CLAIM FORM (belongs with preceding invoice — same claim packet)');
    expect(documentPagesFromHints(h)[0].category).toBe('claim_form');
  });
});
