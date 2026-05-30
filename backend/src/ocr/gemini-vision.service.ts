import { Injectable, Logger } from '@nestjs/common';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import * as fs from 'fs';
import { ParsedInvoice } from './ocr.service';

// ── Structured page-hint contract ────────────────────────────────────────────
// This is the "master classifier" output.  Both the AI path (Gemini / Claude)
// and the Tesseract fallback consume the same classification so splitting rules
// are identical regardless of the extraction model chosen.
export interface PageHintEntry {
  pg: number;
  /** True  → this page is a NEW claim split boundary (invoice start). */
  isBoundary: boolean;
  /** True  → continuation of the preceding invoice; never start a new group. */
  isContinuation: boolean;
  /** True  → supporting doc (discharge summary / lab / auth letter). */
  isSupporting: boolean;
  /** True  → Medical Claim Form — anchors one claim packet. */
  isMcf: boolean;
  /** True  → image-only page; no usable digital text. */
  isScanned: boolean;
  /** Normalised invoice number extracted from this page ('uh283003051', 'zmc2024/024329', …). */
  invoiceNum: string;
  /** Recognised provider family: 'akh' | 'zion' | 'nomad' | 'generic' | ''. */
  providerHint: string;
  /** Full type string as it appears in the AI prompt. */
  rawType: string;
}

/**
 * Parse the text output of buildPageContextHints into a typed Map.
 * Consumed by the Tesseract fallback to drive categorizePages / groupPagesIntoClaims.
 */
export function parsePageHints(hintsText: string): Map<number, PageHintEntry> {
  const map = new Map<number, PageHintEntry>();
  for (const line of hintsText.split('\n')) {
    const m = line.match(/^Page (\d+): (.+)$/);
    if (!m) continue;
    const pg = parseInt(m[1]);
    const desc = m[2];
    const invM = desc.match(/Invoice:\s*([A-Z0-9][\w_\-/.]{2,})/i);
    map.set(pg, {
      pg,
      // MCF pages must never be boundaries — they belong with the preceding invoice.
      isBoundary:    /\*\*\* NEW CLAIM|\*\*\* SPLIT BOUNDARY|\*\*\* SEPARATE CLAIM/i.test(desc) && !/MEDICAL CLAIM FORM/i.test(desc),
      isContinuation:/CONTINUATION/i.test(desc),
      isSupporting:  /DISCHARGE SUMMARY|LAB RESULTS|AUTHORIZATION LETTER/i.test(desc),
      isMcf:         /MEDICAL CLAIM FORM/i.test(desc),
      isScanned:     /SCANNED/i.test(desc),
      invoiceNum:    invM ? invM[1].toLowerCase() : '',
      providerHint:  /Aga Khan/i.test(desc) ? 'akh' : /Zion/i.test(desc) ? 'zion' : /Dental/i.test(desc) ? 'nomad' : '',
      rawType: desc,
    });
  }
  return map;
}

/**
 * Run the page pre-scan and return a typed Map<pageNum, PageHintEntry>.
 * This is the structured version of buildPageContextHints — same intelligence,
 * consumed by the Tesseract fallback to make it model-agnostic.
 *
 * Controlled by env var OCR_USE_PAGE_HINTS (default 'true').
 */
export async function buildPageHintsMap(pdfPath: string): Promise<Map<number, PageHintEntry>> {
  if (process.env.OCR_USE_PAGE_HINTS === 'false') return new Map();
  const text = await buildPageContextHints(pdfPath);
  return parsePageHints(text);
}

// In-process promise cache: re-uses the in-flight result when the same PDF is
// processed by multiple providers simultaneously (e.g. Claude + Gemini racing).
// Entries auto-evict after 10 minutes; uploads use unique timestamped paths so
// there are no false cache hits.
const _pageHintsCache = new Map<string, Promise<string>>();

export async function buildPageContextHints(pdfPath: string): Promise<string> {
  const cached = _pageHintsCache.get(pdfPath);
  if (cached) return cached;
  const p = _buildPageContextHints(pdfPath);
  _pageHintsCache.set(pdfPath, p);
  p.then(() => setTimeout(() => _pageHintsCache.delete(pdfPath), 10 * 60_000)).catch(() => _pageHintsCache.delete(pdfPath));
  return p;
}

// Shared page pre-scan utility — strips stamped barcodes and classifies pages
// using the digital text layer (fast, no AI required).
async function _buildPageContextHints(pdfPath: string): Promise<string> {
  try {
    // Use pdftotext per-page (subprocess) — more reliable than pdf-parse's async pagerender
    // which can silently drop pages when the callback returns a Promise it doesn't await.
    const { spawnSync } = await import('child_process');
    let pageCount = 0;
    try {
      const infoRes = spawnSync('pdfinfo', [pdfPath], { timeout: 10_000, stdio: 'pipe' });
      const m = (infoRes.stdout?.toString() || '').match(/Pages:\s+(\d+)/);
      pageCount = m ? parseInt(m[1]) : 0;
    } catch { /* pdfinfo unavailable */ }

    const pageTexts: string[] = [];
    if (pageCount > 0) {
      for (let pg = 1; pg <= pageCount; pg++) {
        try {
          const res = spawnSync('pdftotext', ['-f', String(pg), '-l', String(pg), pdfPath, '-'], { timeout: 10_000, stdio: 'pipe' });
          pageTexts.push(res.stdout?.toString() || '');
        } catch { pageTexts.push(''); }
      }
    }

    // Fallback: pdf-parse if pdftotext unavailable
    if (pageTexts.length === 0) {
      try {
        const dataBuffer = fs.readFileSync(pdfPath);
        const pdfParse = await import('pdf-parse');
        const syncTexts: string[] = [];
        await pdfParse.default(dataBuffer, {
          pagerender: (pageData: any) => {
            const render = pageData.getTextContent({ normalizeWhitespace: true });
            return render.then((content: any) => {
              const text = (content.items as any[]).map((it: any) => it.str).join(' ');
              syncTexts.push(text);
              return text;
            }).catch(() => { syncTexts.push(''); return ''; });
          },
        });
        pageTexts.push(...syncTexts);
      } catch { /* give up — return empty */ }
    }

    if (pageTexts.length === 0) return '';

    const BARCODE_RE = /\bC\d{13,20}\b/g;
    interface PI { pg: number; type: string; details: string[]; seqTotal: number }

    // Stateful first pass: track invoice numbers per provider so we can
    // distinguish "page 2 of Invoice A" (CONTINUATION) from "Invoice B from
    // the same provider" (NEW CLAIM SPLIT BOUNDARY).
    const classified: PI[] = [];
    const lastInvByProvider: Record<string, string> = {};

    for (let idx = 0; idx < pageTexts.length; idx++) {
      const text = pageTexts[idx];
      const pg = idx + 1;
      const stripped = text.replace(BARCODE_RE, '').replace(/\s+/g, ' ').trim();
      if (stripped.length < 25) {
        classified.push({ pg, type: 'SCANNED/IMAGE', details: ['visually inspect — treat as NEW claim if different provider from adjacent pages'], seqTotal: 0 });
        continue;
      }
      const t = stripped;
      const details: string[] = [];
      let type = 'OTHER', seqTotal = 0;
      const pageOfY = t.match(/Page\s+(\d+)\s+of\s+(\d+)/i);
      const pn = pageOfY ? parseInt(pageOfY[1]) : 0;
      const tot = pageOfY ? parseInt(pageOfY[2]) : 0;
      if (pageOfY) details.push(`[Page ${pn} of ${tot} — DO NOT SPLIT]`);

      if (pn > 1) {
        type = `INVOICE CONTINUATION (page ${pn} of ${tot})`;
      } else if (/Discharge\s+Summary|DS:\s*Diagnosis|DS:\s*Hospital/i.test(t)) {
        type = 'DISCHARGE SUMMARY (attach to nearest preceding invoice)';
        const mr = t.match(/MR#[:\s]+(\S+)/i);
        if (mr) details.push(`MR#: ${mr[1]}`);
      } else if (/PRIVATE\s+&\s+CONFIDENTIAL|ADMISSION\s+DATE|MEMBER\s+NO:/i.test(t)) {
        type = 'AUTHORIZATION LETTER (attach to nearest preceding invoice)';
        const m2 = t.match(/MEMBER\s+NO[:\s]+(\S+)/i);
        if (m2) details.push(`Member: ${m2[1]}`);
      } else if (/MEDICAL\s+CLAIM\s+FORM/i.test(t)) {
        // MCF is NOT a split boundary — it belongs with the preceding invoice
        type = 'MEDICAL CLAIM FORM (belongs with preceding invoice — same claim packet)';
        const m3 = t.match(/Membership\s+No[.:)]*\s*([A-Z0-9\-]{4,20})/i);
        if (m3) details.push(`Membership: ${m3[1]}`);
      } else if (/AGA\s+.{0,6}HAN\s+UNIVERSITY|UNIVERSITY\s+HOSPITAL.{0,30}NAIROBI|Invoice\s+[#*]\s*UH\d/i.test(t)) {
        // Extract AKH invoice number from "Invoice # UH..." OR "Account Number: UH..."
        // (the Account Number field is always clean even when the Invoice # line is garbled by OCR)
        const i2 = t.match(/Invoice\s+[#*]\s*(UH\S+)/i) || t.match(/Account\s+Number[:\s]+(UH[\w_]+)/i);
        const invNum = i2 ? i2[1].toUpperCase() : '';
        const prevInv = lastInvByProvider['akh'] || '';
        const isNewInv = !prevInv || !invNum || invNum !== prevInv;
        type = isNewInv
          ? 'INPATIENT INVOICE (Aga Khan) *** NEW CLAIM SPLIT BOUNDARY ***'
          : `INVOICE CONTINUATION (Aga Khan — same invoice ${invNum})`;
        if (invNum) { details.push(`Invoice: ${invNum}`); lastInvByProvider['akh'] = invNum; }
        if (pn === 1 && tot > 1) seqTotal = tot;
      } else if (/NOMAD\s+DENTAL|DENTAL\s+CENTRE/i.test(t)) {
        const i3 = t.match(/Invoice\s+No\.?\s*[:\s]?\s*([A-Z0-9\-\/]+)/i);
        const invNum = i3 ? i3[1] : '';
        const prevInv = lastInvByProvider['nomad'] || '';
        const isNewInv = !prevInv || !invNum || invNum !== prevInv;
        type = isNewInv
          ? 'OUTPATIENT INVOICE (Dental) *** NEW CLAIM SPLIT BOUNDARY ***'
          : `OUTPATIENT INVOICE CONTINUATION (Dental — same invoice ${invNum})`;
        if (i3) { details.push(`Invoice: ${i3[1]}`); lastInvByProvider['nomad'] = invNum; }
      } else if (/ZION\s+MEDICAL|ZION\s+CENTRE|DETAILED\s+INVOICE/i.test(t)) {
        const i4 = t.match(/Invoice\s+No[:\s]+([A-Z0-9\/]+)/i);
        const invNum = i4 ? i4[1] : '';
        const prevInv = lastInvByProvider['zion'] || '';
        const isNewInv = !prevInv || !invNum || invNum !== prevInv;
        type = isNewInv
          ? 'OUTPATIENT INVOICE (Zion) *** NEW CLAIM SPLIT BOUNDARY ***'
          : `OUTPATIENT INVOICE CONTINUATION (Zion — same invoice ${invNum})`;
        if (i4) { details.push(`Invoice: ${i4[1]}`); lastInvByProvider['zion'] = invNum; }
      } else if (/Laboratory\s+Tests|Lab\s+Results|WBC|Haemoglobin/i.test(t)) {
        type = 'LAB RESULTS (attach to nearest preceding invoice)';
      } else {
        // Generic invoice detection for providers not explicitly named above.
        // If the page has a fresh invoice header (invoice number + date), it is
        // a new claim boundary regardless of provider.
        const genInv = t.match(/Invoice\s*(?:No|Number|#|Ref\.?)\s*[:\-.\s#]?\s*([A-Z0-9][\w\-/.]{2,25})/i);
        const genDate = /Invoice\s*Date|Date\s*of\s*Service|Bill\s*Date/i.test(t);
        if (genInv && genDate) {
          const invNum = genInv[1];
          const prevInv = lastInvByProvider['generic'] || '';
          const isNewInv = !prevInv || invNum !== prevInv;
          type = isNewInv
            ? 'OUTPATIENT INVOICE (Generic) *** NEW CLAIM SPLIT BOUNDARY ***'
            : `OUTPATIENT INVOICE CONTINUATION (same invoice ${invNum})`;
          details.push(`Invoice: ${invNum}`);
          lastInvByProvider['generic'] = invNum;
        }
      }
      classified.push({ pg, type, details, seqTotal });
    }

    // Fill-forward: once "Page 1 of N" detected, force next N-1 pages as continuations
    let fillRem = 0, fillTotal = 0, fillIdx = 1;
    for (const info of classified) {
      if (fillRem > 0 && (info.type === 'OTHER' || info.type.startsWith('INVOICE CONTINUATION'))) {
        info.type = `INVOICE CONTINUATION (page ${fillIdx} of ${fillTotal} — DO NOT SPLIT) [inferred]`;
        info.details = []; fillRem--; fillIdx++;
      } else {
        const d = info.details.join(' ');
        const m = d.match(/\[Page 1 of (\d+)/);
        if (m || info.seqTotal) { fillTotal = m ? parseInt(m[1]) : info.seqTotal; fillRem = fillTotal - 1; fillIdx = 2; }
        else if (!info.type.includes('CONTINUATION')) fillRem = 0;
      }
    }

    // ── Post-process: OCR scanned pages adjacent to known invoice boundaries ──
    // A SCANNED page immediately before a NEW CLAIM invoice page cannot be a
    // supporting document for that invoice — it must be a separate claim.
    // Run quick Tesseract on those pages so we can name the provider explicitly.
    try {
      const { spawnSync } = await import('child_process');
      const { createWorker, OEM } = await import('tesseract.js');
      const tmpDir = require('path').join(process.cwd(), 'uploads', 'ocr-temp', `hints-${Date.now()}`);
      require('fs').mkdirSync(tmpDir, { recursive: true });
      const worker = await createWorker('eng', OEM.LSTM_ONLY);

      for (let i = 0; i < classified.length - 1; i++) {
        const curr = classified[i];
        const next = classified[i + 1];
        // Scanned page immediately before a multi-page invoice start
        if (curr.type === 'SCANNED/IMAGE' && next.type.includes('*** NEW CLAIM')) {
          try {
            const pgNum = curr.pg;
            const tmpPrefix = require('path').join(tmpDir, `scan-${String(pgNum).padStart(4, '0')}`);
            spawnSync('pdftoppm', ['-png', '-r', '200', '-f', String(pgNum), '-l', String(pgNum), pdfPath, tmpPrefix], { timeout: 30_000, stdio: 'pipe' });
            const files = require('fs').readdirSync(tmpDir).filter((f: string) => f.startsWith(require('path').basename(tmpPrefix)));
            if (files.length > 0) {
              const imgPath = require('path').join(tmpDir, files[0]);
              const { data } = await worker.recognize(imgPath);
              const ocrText = data.text.replace(/\s+/g, ' ').trim();
              require('fs').unlinkSync(imgPath);

              // Extract provider and invoice from OCR text
              const provMatch = ocrText.match(/(ZION\s+MEDICAL|NOMAD\s+DENTAL|NAIROBI\s+HOSPITAL|AGA\s+KHAN|MP\s+SHAH|MATER|KENYATTA)[^\n]*/i);
              const invMatch = ocrText.match(/Invoice\s+No[:\s]+([A-Z0-9\/]+)|Invoice\s+No\.?\s+(\S+)/i);
              const amtMatch = ocrText.match(/(?:Total|Balance\s+Due|Amount\s+Receivable)[:\s]+([\d,\.]+)/i);
              const provider = provMatch ? provMatch[0].trim().substring(0, 40) : 'Unknown provider (different from adjacent)';
              const invNo    = invMatch ? (invMatch[1] || invMatch[2]) : '';
              const amount   = amtMatch ? amtMatch[1] : '';

              curr.type = `SCANNED OUTPATIENT INVOICE *** SEPARATE CLAIM — DIFFERENT PROVIDER FROM PAGE ${next.pg} ***`;
              curr.details = [
                `Provider: ${provider}`,
                invNo ? `Invoice: ${invNo}` : '',
                amount ? `Amount: ${amount}` : '',
                `CRITICAL: Do NOT group this with the ${next.type.split('—')[0].trim()} on page ${next.pg}`,
              ].filter(Boolean);
            }
          } catch { /* non-fatal: hint stays as SCANNED/IMAGE */ }
        }
      }

      await worker.terminate();
      try { require('fs').rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    } catch { /* pdftoppm or tesseract unavailable — hints work without OCR */ }

    const lines = ['=== PAGE PRE-SCAN (authoritative split map — use as primary guidance) ==='];
    for (const info of classified) lines.push(`Page ${info.pg}: ${info.type}${info.details.length ? ' — ' + info.details.join(', ') : ''}`);
    lines.push('=== END PAGE PRE-SCAN ===');
    return lines.join('\n');
  } catch { return ''; }
}

const SYSTEM_INSTRUCTION = `You are a precise medical-invoice data extractor for CIC Insurance Group (Kenya). Extract exactly what appears on the document. Empty string or 0 if absent. Dates as YYYY-MM-DD. Kenyan Shillings is the default currency. Never invent values.

AGA KHAN INPATIENT DISCHARGE BILLS — structural traps (UH-prefix invoice numbers, 5+ pages):
• PATIENT NAME: the cover page uses a column layout. The word "Patient" sits alone on a line as a column header; the actual name is the ALL-CAPS line directly below it (often "SURNAME, GIVEN"). Do NOT return "Unknown Patient" — read the line under the "Patient" header.
• DIAGNOSIS: never return "Discharge Diagnosis", "Final Diagnosis", "Provisional Diagnosis", "Working Diagnosis", "Admission Diagnosis", "Primary Diagnosis", or "Differential Diagnosis" as the diagnosis value — those are SUB-HEADERS, not values. The real diagnosis is the next non-header line of free clinical text below them (e.g. "Cataract, bilateral senile" or an ICD-10 code like H28.1).
• AMOUNT: never return KES 0–100 on an IP bill — that's the patient co-pay, not the invoice total. Use, in priority order: (1) "Sponsor Amount Payable" / "Net Amount Payable to Hospital" / "Sponsor Settlement", (2) Sponsor Coverage section's actual payable figure (NOT the annual-limit cap that appears earlier in the same section), (3) "Grand Total" / "Bill Total".
• MULTI-PAGE: 9–13 page bills are normal. The grand total is on the last 1–2 pages, NOT page 1. Read the entire document before deciding the amount.`;

// ── Multi-claim schema for Gemini structured output ──────────────────────────
const MULTI_RESPONSE_SCHEMA: any = {
  type: SchemaType.OBJECT,
  properties: {
    claims: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          pageRange:        { type: SchemaType.STRING },
          patientName:      { type: SchemaType.STRING },
          patientId:        { type: SchemaType.STRING },
          membershipNumber: { type: SchemaType.STRING },
          providerName:     { type: SchemaType.STRING },
          invoiceNumber:    { type: SchemaType.STRING },
          invoiceDate:      { type: SchemaType.STRING },
          invoiceAmount:    { type: SchemaType.NUMBER },
          serviceDate:      { type: SchemaType.STRING },
          diagnosis:        { type: SchemaType.STRING },
          diagnosisCode:    { type: SchemaType.STRING },
          treatment:        { type: SchemaType.STRING },
          insuranceCompany: { type: SchemaType.STRING },
          accountName:      { type: SchemaType.STRING },
          confidence:       { type: SchemaType.NUMBER },
        },
        required: ['pageRange', 'patientName', 'providerName', 'invoiceAmount', 'confidence'],
      },
    },
  },
  required: ['claims'],
};

const RESPONSE_SCHEMA: any = {
  type: SchemaType.OBJECT,
  properties: {
    patientName:      { type: SchemaType.STRING },
    patientId:        { type: SchemaType.STRING },
    membershipNumber: { type: SchemaType.STRING },
    providerName:     { type: SchemaType.STRING },
    invoiceNumber:    { type: SchemaType.STRING },
    invoiceDate:      { type: SchemaType.STRING },
    invoiceAmount:    { type: SchemaType.NUMBER },
    serviceDate:      { type: SchemaType.STRING },
    diagnosis:        { type: SchemaType.STRING },
    diagnosisCode:    { type: SchemaType.STRING },
    procedureCode:    { type: SchemaType.STRING },
    treatment:        { type: SchemaType.STRING },
    insuranceCompany: { type: SchemaType.STRING },
    accountName:      { type: SchemaType.STRING },
    confidence:       { type: SchemaType.NUMBER },
  },
  required: ['patientName', 'providerName', 'invoiceAmount', 'confidence'],
};

const PROMPT = `Extract every field you can see from this medical claim document. Be exact — copy names, numbers, amounts, and codes as they appear. If a value isn't on the page, leave it empty; never guess. Rate your confidence 0.0-1.0.`;

const PROBE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const CALL_TIMEOUT_MS = 30_000;      // 30 s per Gemini API call

@Injectable()
export class GeminiVisionService {
  private readonly logger = new Logger(GeminiVisionService.name);
  private client: GoogleGenerativeAI | null = null;

  // Cached reachability so probe isn't repeated on every request
  private reachableCache: { value: boolean; at: number } | null = null;

  private getClient(): GoogleGenerativeAI | null {
    const key = process.env.GEMINI_API_KEY;
    if (!key) return null;
    if (!this.client) this.client = new GoogleGenerativeAI(key);
    return this.client;
  }

  isAvailable(): boolean {
    return !!process.env.GEMINI_API_KEY;
  }

  /** Probes actual network reachability; result cached for PROBE_TTL_MS. */
  async isReachable(): Promise<boolean> {
    if (!process.env.GEMINI_API_KEY) return false;
    const now = Date.now();
    if (this.reachableCache && now - this.reachableCache.at < PROBE_TTL_MS) {
      return this.reachableCache.value;
    }
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 5_000);
      await fetch('https://generativelanguage.googleapis.com/', { method: 'HEAD', signal: ctrl.signal });
      clearTimeout(tid);
      this.reachableCache = { value: true, at: now };
      return true;
    } catch {
      this.reachableCache = { value: false, at: now };
      this.logger.warn('Gemini endpoint unreachable — marking unavailable for 5 min');
      return false;
    }
  }

  /**
   * Extract ALL claim packets from a multi-claim PDF using Gemini.
   * Uses the same page pre-scan roadmap as Claude for consistent splitting.
   */
  async extractMulti(filePath: string, mimetype: string, modelOverride?: string): Promise<ParsedInvoice[]> {
    this.logger.log(`GeminiVisionService.extractMulti() called — filePath=${filePath}, model=${modelOverride || process.env.GEMINI_MODEL || 'gemini-2.5-pro'}`);
    const client = this.getClient();
    if (!client) throw new Error('GEMINI_API_KEY not set');

    const modelId = modelOverride || process.env.GEMINI_MODEL || 'gemini-2.5-pro';
    const isPdf = mimetype === 'application/pdf' || filePath.endsWith('.pdf');
    const effectiveMime = isPdf ? 'application/pdf' : (mimetype || 'image/png');
    const b64 = fs.readFileSync(filePath).toString('base64');

    // Build page-type roadmap from digital text layer (model-agnostic)
    const pageHints = isPdf ? await buildPageContextHints(filePath) : '';

    const MULTI_PROMPT = `${pageHints ? pageHints + '\n\n' : ''}This PDF is a merged batch of Kenyan insurance claim documents. Split it into individual claims using these rules:

RULE 1 — Never split "Page X of Y" sequences — all pages belong to the same invoice.
RULE 2 — Medical Claim Form (MCF) ALWAYS belongs with its invoice — NEVER a standalone claim:
  Invoice + MCF = ONE claim. Invoice + MCF + letter = ONE claim. Invoice + MCF + lab results = ONE claim.
  NEVER create a separate claim entry for an MCF. The fact that the MCF header shows "AAR Insurance" while the invoice shows a clinic name does NOT make them separate claims.
RULE 3 — Each distinct invoice number is its own claim. Two invoices with different invoice numbers from the SAME provider and/or the SAME patient are STILL two separate claims. Never merge invoices that have different invoice numbers.
RULE 3b — A SCANNED/IMAGE page before a "Page 1 of N" sequence: if it shows a different provider/invoice, it is a SEPARATE claim.
RULE 4 — Discharge summaries, lab results, auth letters, referral letters attach to the nearest preceding invoice — do NOT create separate claim entries for them.

For invoiceAmount: use the GROSS TOTAL charged by the hospital — the full bill BEFORE any insurance/NHIF/sponsor deduction. On Aga Khan inpatient bills this is "Grand Total", "Sponsor Amount Payable", or "Total Charges" (typically hundreds of thousands of KES). Do NOT use "Patient Balance", "Patient Co-pay", or "Amount Due from Patient" — those are residual amounts after coverage. Any value below KES 100 on a hospital bill is definitionally a co-pay, not an invoice total.
pageRange must be "start-end" (e.g. "1-2") or single page (e.g. "5"). Ranges must not overlap.
Return one entry per distinct claim.`;

    this.logger.log(`Gemini multi-claim extract with model=${modelId} (pageHints=${pageHints ? 'yes' : 'no'})`);

    const model = client.getGenerativeModel({
      model: modelId,
      systemInstruction: SYSTEM_INSTRUCTION,
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: MULTI_RESPONSE_SCHEMA,
        temperature: 0.1,
      },
    });

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Gemini multi-claim timed out after 180s')), 180_000)
    );
    const result = await Promise.race([
      model.generateContent([
        { inlineData: { mimeType: effectiveMime, data: b64 } },
        { text: MULTI_PROMPT },
      ]),
      timeout,
    ]);

    const text = result.response.text();
    let parsed: { claims: any[] } = { claims: [] };
    try { parsed = JSON.parse(text); } catch { throw new Error(`Gemini multi-claim non-JSON: ${text.slice(0, 200)}`); }

    const { claims } = parsed;
    if (!claims?.length) return [];
    this.logger.log(`Gemini identified ${claims.length} claim packet(s)`);

    const DIAGNOSIS_NOISE = /\b(DETAILED\s+)?INVOICE\b|\bDETAILED\b|\bMEDICAL CLAIM FORM\b/gi;
    return claims.map((c: any): ParsedInvoice => ({
      patientName:      c.patientName      || '',
      patientId:        c.patientId        || '',
      membershipNumber: c.membershipNumber || '',
      providerName:     c.providerName     || '',
      invoiceNumber:    c.invoiceNumber    || '',
      invoiceDate:      c.invoiceDate      || '',
      invoiceAmount:    Number(c.invoiceAmount) || 0,
      serviceDate:      c.serviceDate      || c.invoiceDate || '',
      diagnosis:        (c.diagnosis || '').replace(DIAGNOSIS_NOISE, '').replace(/\s{2,}/g, ' ').trim(),
      diagnosisCode:    c.diagnosisCode    || '',
      procedureCode:    '',
      cptCodes:         [],
      icd10Codes:       c.diagnosisCode ? [c.diagnosisCode] : [],
      hcpcsCodes:       [],
      allMedicalCodes:  [c.diagnosisCode].filter(Boolean),
      treatment:        c.treatment        || '',
      insuranceCompany: c.insuranceCompany || '',
      accountName:      c.accountName      || '',
      confidence:       Math.max(0, Math.min(1, Number(c.confidence) || 0.8)),
      rawText:          '',
      pageRange:        c.pageRange || '1',
      documentPages:    [],
    }));
  }

  async extract(filePath: string, mimetype: string, modelOverride?: string): Promise<ParsedInvoice> {
    const client = this.getClient();
    if (!client) throw new Error('GEMINI_API_KEY not set');

    const modelId = modelOverride || process.env.GEMINI_MODEL || 'gemini-2.5-pro';
    const isPdf = mimetype === 'application/pdf' || filePath.endsWith('.pdf');
    const effectiveMime = isPdf ? 'application/pdf' : (mimetype || 'image/png');
    const b64 = fs.readFileSync(filePath).toString('base64');

    this.logger.log(`Gemini extracting with model=${modelId} (${isPdf ? 'pdf' : 'image'})`);

    const model = client.getGenerativeModel({
      model: modelId,
      systemInstruction: SYSTEM_INSTRUCTION,
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
        temperature: 0.1,
      },
    });

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Gemini call timed out after ${CALL_TIMEOUT_MS / 1000}s`)), CALL_TIMEOUT_MS)
    );
    const result = await Promise.race([
      model.generateContent([
        { inlineData: { mimeType: effectiveMime, data: b64 } },
        { text: PROMPT },
      ]),
      timeout,
    ]);

    const text = result.response.text();
    let fields: Record<string, any> = {};
    try {
      fields = JSON.parse(text);
    } catch (err) {
      throw new Error(`Gemini returned non-JSON response: ${text.slice(0, 200)}`);
    }

    return {
      patientName:      fields.patientName      || '',
      patientId:        fields.patientId        || '',
      membershipNumber: fields.membershipNumber || '',
      providerName:     fields.providerName     || '',
      invoiceNumber:    fields.invoiceNumber    || '',
      invoiceDate:      fields.invoiceDate      || '',
      invoiceAmount:    Number(fields.invoiceAmount) || 0,
      serviceDate:      fields.serviceDate      || fields.invoiceDate || '',
      diagnosis:        fields.diagnosis        || '',
      diagnosisCode:    fields.diagnosisCode    || '',
      procedureCode:    fields.procedureCode    || '',
      cptCodes:         [],
      icd10Codes:       fields.diagnosisCode ? [fields.diagnosisCode] : [],
      hcpcsCodes:       [],
      allMedicalCodes:  [fields.diagnosisCode, fields.procedureCode].filter(Boolean),
      treatment:        fields.treatment        || '',
      insuranceCompany: fields.insuranceCompany || '',
      accountName:      fields.accountName      || '',
      confidence:       Math.max(0, Math.min(1, Number(fields.confidence) || 0.85)),
      rawText:          '',
      pageRange:        '1',
      documentPages:    [],
    };
  }
}
