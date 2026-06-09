import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import { PrismaService } from '../prisma/prisma.service';
import { GeminiLlmAdapter } from '../assistant/gemini-llm.adapter';

const BATCH_SIZE = 10;
// Gemini inline-data requests must stay well under the ~20MB request cap.
const VISION_MAX_BYTES = 12 * 1024 * 1024;

type MatchStatus = 'match' | 'mismatch' | 'uncertain' | 'unchecked';

interface GeminiMatchResult {
  match: 'match' | 'mismatch' | 'uncertain';
  score: number;
  reason: string;
}

export interface BillingItemAssessment {
  name: string;
  match: 'match' | 'mismatch' | 'uncertain';
  score: number;
  reason: string;
  // Billed amount fields parsed from the invoice (Path B extraction). Optional —
  // present when the line could be read off the invoice charges table.
  quantity?: number | null;
  unitPrice?: number | null;
  amount?: number | null;
  // Standard procedure/billing code for the line (CPT/HCPCS/ICD). May be filled
  // in by the per-item enrichment pass when the original extraction lacked it.
  procedureCode?: string | null;
  // True once a targeted enrichment pass has filled in this line's gaps.
  enriched?: boolean;
}

export interface ClaimBillingAssessment {
  diagnosis: string;
  items: BillingItemAssessment[];
  overall: 'match' | 'partial' | 'mismatch' | 'uncertain';
  overallScore: number;
  summary: string;
  fromLineItems: boolean;
  cachedAt?: string;   // ISO — present when served from DB cache
}

@Injectable()
export class DiagnosisBillingService {
  private readonly logger = new Logger(DiagnosisBillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: GeminiLlmAdapter,
  ) {}

  /**
   * Primary entry point: works on first upload using claim-level diagnosis +
   * treatment data. Falls back to stored InvoiceLineItem records when available.
   */
  async assessFromClaimData(claimId: string, force = false, model?: string): Promise<ClaimBillingAssessment> {
    const claim = await this.prisma.claim.findUnique({
      where: { id: claimId },
      select: {
        diagnosis: true,
        treatment: true,
        procedureCodes: true,
        billingAuditStatus: true,
        billingAuditScore: true,
        billingAuditSummary: true,
        billingAuditItems: true,
        billingAuditAt: true,
        ocrData: {
          select: { diagnosis: true, procedureCodes: true, rawText: true },
        },
      },
    });

    if (!claim) {
      return this.unknownAssessment('Claim not found', '');
    }

    // Return DB-cached result if it exists and is less than 30 days old.
    // This prevents re-calling Gemini every time the billing tab is opened.
    // `force` (Refresh button) bypasses the cache and re-runs the extraction.
    if (
      !force &&
      claim.billingAuditAt &&
      claim.billingAuditStatus &&
      claim.billingAuditItems &&
      Date.now() - claim.billingAuditAt.getTime() < 30 * 24 * 60 * 60 * 1000
    ) {
      const items = claim.billingAuditItems as unknown as BillingItemAssessment[];
      return {
        diagnosis: claim.diagnosis || claim.ocrData?.diagnosis || '',
        items,
        overall: claim.billingAuditStatus as ClaimBillingAssessment['overall'],
        overallScore: claim.billingAuditScore ?? 0,
        summary: claim.billingAuditSummary ?? '',
        fromLineItems: false,
        cachedAt: claim.billingAuditAt.toISOString(),
      };
    }

    const diagnosis = claim.diagnosis || claim.ocrData?.diagnosis || '';
    // Use a generous window so the invoice charges table (often further down a
    // multi-page document) is included — line items are easy to miss with a small slice.
    const rawTextSnippet = claim.ocrData?.rawText
      ? claim.ocrData.rawText.slice(0, 16000)
      : '';

    if (!diagnosis && !rawTextSnippet && !claim.treatment) {
      return this.unknownAssessment('No clinical data found for this claim', '');
    }

    // Use persisted per-line scores if available (set by validateLineItems after OCR)
    const lineItems = await this.prisma.invoiceLineItem.findMany({
      where: { claimId },
      select: { description: true, procedureCode: true, diagnosisMatch: true, diagnosisMatchReason: true, diagnosisMatchScore: true },
    });

    let result: ClaimBillingAssessment | null = null;

    if (lineItems.length > 0 && lineItems.some(i => i.diagnosisMatch && i.diagnosisMatch !== 'unchecked')) {
      const items: BillingItemAssessment[] = lineItems.map(li => ({
        name: li.description,
        match: (li.diagnosisMatch ?? 'uncertain') as BillingItemAssessment['match'],
        score: li.diagnosisMatchScore ?? 0.5,
        reason: li.diagnosisMatchReason ?? '',
      }));
      result = this.buildAssessmentFromItems(diagnosis || 'See raw documents', items, true);
    } else {
      // No pre-extracted line items — ask Gemini to extract from raw OCR text
      const procedureCodes = [
        ...(claim.procedureCodes ?? []),
        ...(claim.ocrData?.procedureCodes ?? []),
      ].filter(Boolean);

      try {
        result = await this.runExtraction(diagnosis, claim.treatment, procedureCodes, rawTextSnippet, `claim ${claimId}`, model);

        // Vision fallback — when the OCR text yields no items (common with poor
        // scans), read the invoice document image directly.
        if (!result || result.items.length === 0) {
          const visionResult = await this.extractViaVision(claimId, diagnosis, claim.treatment, procedureCodes, model);
          if (visionResult && visionResult.items.length > 0) result = visionResult;
        }
      } catch (err: any) {
        if (err?.isQuota) return this.quotaAssessment(diagnosis);
        this.logger.warn(`Billing audit error for claim ${claimId}: ${err.message}`);
      }
    }

    if (!result) {
      return this.unknownAssessment('AI assessment unavailable — try again shortly', diagnosis);
    }

    // Persist to DB so subsequent requests are instant (no Gemini call needed)
    this.prisma.claim.update({
      where: { id: claimId },
      data: {
        billingAuditStatus:  result.overall,
        billingAuditScore:   result.overallScore,
        billingAuditSummary: result.summary,
        billingAuditItems:   result.items as any,
        billingAuditAt:      new Date(),
      },
    }).catch(err => this.logger.warn(`Failed to cache billing audit for ${claimId}: ${err.message}`));

    return result;
  }

  /** Assess from raw data sent directly — no DB lookup needed. */
  async assessFromRawData(data: {
    diagnosis?: string;
    treatment?: string;
    rawText?: string;
    lineItems?: { description: string; procedureCode?: string }[];
    model?: string;
  }): Promise<ClaimBillingAssessment> {
    const diagnosis = data.diagnosis || '';
    const rawTextSnippet = data.rawText ? data.rawText.slice(0, 16000) : '';

    if (!diagnosis && !rawTextSnippet && !data.treatment) {
      return this.unknownAssessment('No clinical data provided', '');
    }

    try {
      // Path A: structured line items provided — score each one directly.
      if (data.lineItems && data.lineItems.length > 0) {
        const context = [diagnosis, data.treatment].filter(Boolean).join('; ');
        const batchResults = await this.scoreBatch(
          context,
          data.lineItems.map((li, i) => ({
            id: String(i),
            description: li.description,
            procedureCode: li.procedureCode ?? null,
          })),
          data.model,
        );
        const items: BillingItemAssessment[] = data.lineItems.map((li, i) => ({
          name: li.description,
          match: batchResults[i].match,
          score: batchResults[i].score,
          reason: batchResults[i].reason,
        }));
        return this.buildAssessmentFromItems(diagnosis, items, false);
      }

      // Path B: no structured items — ask Gemini to EXTRACT billing items from the
      // raw invoice text, then assess each one against the diagnosis.
      const parsed = await this.runExtraction(diagnosis, data.treatment, [], rawTextSnippet, 'inline', data.model);
      if (parsed) return parsed;
    } catch (err: any) {
      if (err?.isQuota) return this.quotaAssessment(diagnosis);
      this.logger.warn(`Inline billing assessment error: ${err.message}`);
    }

    return this.unknownAssessment('AI could not extract billing items — try reprocessing the invoice', diagnosis);
  }

  /**
   * Fill in the gaps for ONE line item whose information is incomplete (missing
   * amount, missing/invalid procedure code, or an unresolved appropriateness
   * verdict). Re-reads the invoice text for just that item and returns the
   * enriched line. When a claimId is supplied, the result is also merged back
   * into the persisted audit so the data sticks for next time.
   */
  async enrichItem(data: {
    claimId?: string;
    itemName: string;
    diagnosis?: string;
    treatment?: string;
    rawText?: string;
  }): Promise<BillingItemAssessment> {
    let diagnosis = data.diagnosis || '';
    let treatment = data.treatment || '';
    let rawText = data.rawText || '';

    if (data.claimId) {
      const claim = await this.prisma.claim.findUnique({
        where: { id: data.claimId },
        select: {
          diagnosis: true, treatment: true,
          ocrData: { select: { diagnosis: true, rawText: true } },
        },
      });
      diagnosis = diagnosis || claim?.diagnosis || claim?.ocrData?.diagnosis || '';
      treatment = treatment || claim?.treatment || '';
      rawText   = rawText   || claim?.ocrData?.rawText || '';
    }

    const itemName = (data.itemName || '').trim();
    if (!itemName) {
      return { name: data.itemName ?? '', match: 'uncertain', score: 0, reason: 'No item specified', enriched: true };
    }

    const snippet = rawText.slice(0, 16000);
    const prompt =
      `You are a senior medical claims auditor enriching ONE billing line.\n\n` +
      (diagnosis ? `Patient diagnosis: ${diagnosis}\n` : '') +
      (treatment ? `Treatment notes: ${treatment}\n` : '') +
      (snippet ? `\nInvoice / clinical document text:\n${snippet}\n` : '') +
      `\nLINE ITEM TO ENRICH: "${itemName}"\n\n` +
      `TASK:\n` +
      `1. Locate this exact line in the invoice text and read its billing figures: ` +
      `quantity, unit price (rate), and line amount (as plain numbers, no symbols/commas; null if genuinely absent).\n` +
      `2. Determine the correct STANDARD billing/procedure code (CPT, HCPCS, or ICD-10) that fits this service. ` +
      `If the invoice shows a non-standard or unrecognised code, supply the most likely correct standard code instead; ` +
      `if none can be reasonably determined, use null.\n` +
      `3. Give a definitive clinical-appropriateness verdict for the patient's diagnosis ` +
      `(prefer "match" or "mismatch"; only use "uncertain" if truly impossible to judge).\n\n` +
      `Respond ONLY with this JSON (no markdown):\n` +
      `{"name":"${itemName.replace(/"/g, "'")}","quantity":<number|null>,"unitPrice":<number|null>,"amount":<number|null>,"procedureCode":"<standard code or null>","match":"match"|"mismatch"|"uncertain","score":0.0-1.0,"reason":"<one sentence citing the invoice evidence>"}`;

    let enriched: BillingItemAssessment = {
      name: itemName, match: 'uncertain', score: 0.5,
      reason: 'Could not enrich — AI response unavailable', enriched: true,
    };

    try {
      const raw = await this.llm.generate(
        'You are a senior medical claims auditor. Enrich a single billing line from invoice text. Reply with valid JSON only.',
        prompt,
        { temperature: 0, json: true, maxOutputTokens: 1024 },
      );
      const stripped = raw.replace(/```json|```/g, '').trim();
      const s = stripped.indexOf('{');
      const e = stripped.lastIndexOf('}');
      if (s !== -1 && e !== -1) {
        const p = JSON.parse(stripped.slice(s, e + 1));
        const num = (v: any): number | null => {
          if (v == null) return null;
          const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
          return Number.isFinite(n) ? n : null;
        };
        const code = p.procedureCode != null && String(p.procedureCode).trim() && String(p.procedureCode).toLowerCase() !== 'null'
          ? String(p.procedureCode).trim() : null;
        enriched = {
          name: String(p.name ?? itemName).trim() || itemName,
          match: ['match', 'mismatch', 'uncertain'].includes(p.match) ? p.match : 'uncertain',
          score: Math.min(1, Math.max(0, num(p.score) ?? 0.5)),
          reason: String(p.reason ?? '').trim(),
          quantity: num(p.quantity),
          unitPrice: num(p.unitPrice),
          amount: num(p.amount),
          procedureCode: code,
          enriched: true,
        };
      }
    } catch (err: any) {
      this.logger.warn(`Item enrichment failed for "${itemName}": ${err.message}`);
    }

    // Merge back into the persisted audit so the filled-in data sticks.
    if (data.claimId) {
      await this.mergeEnrichedItem(data.claimId, enriched).catch(err =>
        this.logger.warn(`Failed to persist enriched item for ${data.claimId}: ${err.message}`),
      );
    }

    return enriched;
  }

  /** Replace the matching line in the cached audit with its enriched version. */
  private async mergeEnrichedItem(claimId: string, enriched: BillingItemAssessment): Promise<void> {
    const claim = await this.prisma.claim.findUnique({
      where: { id: claimId },
      select: { billingAuditItems: true, diagnosis: true },
    });
    const items = (claim?.billingAuditItems as unknown as BillingItemAssessment[] | null) ?? [];
    if (!items.length) return;

    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
    const idx = items.findIndex(i => norm(i.name) === norm(enriched.name));
    const next = [...items];
    if (idx >= 0) next[idx] = { ...items[idx], ...enriched };
    else next.push(enriched);

    const rolled = this.buildAssessmentFromItems(claim?.diagnosis ?? '', next, false);
    await this.prisma.claim.update({
      where: { id: claimId },
      data: {
        billingAuditItems:   next as any,
        billingAuditStatus:  rolled.overall,
        billingAuditScore:   rolled.overallScore,
        billingAuditSummary: rolled.summary,
        billingAuditAt:      new Date(),
      },
    });
  }

  private buildAssessmentFromItems(
    diagnosis: string,
    items: BillingItemAssessment[],
    fromLineItems: boolean,
  ): ClaimBillingAssessment {
    const matchCount = items.filter(i => i.match === 'match').length;
    const mismatchCount = items.filter(i => i.match === 'mismatch').length;
    let overall: ClaimBillingAssessment['overall'];
    if (mismatchCount === 0) overall = 'match';
    else if (mismatchCount === items.length) overall = 'mismatch';
    else overall = 'partial';
    const overallScore = items.reduce((s, i) => s + i.score, 0) / items.length;
    return {
      diagnosis,
      items,
      overall,
      overallScore,
      summary: `${matchCount} of ${items.length} billed item${items.length !== 1 ? 's' : ''} are clinically appropriate for the diagnosis.`,
      fromLineItems,
    };
  }

  private unknownAssessment(summary: string, diagnosis = ''): ClaimBillingAssessment {
    return { diagnosis, items: [], overall: 'uncertain', overallScore: 0, summary, fromLineItems: false };
  }

  /** Distinct from unknownAssessment so the UI can show a quota-specific notice
   *  (not a misleading "low-quality scan" message). Not persisted/cached. */
  private quotaAssessment(diagnosis = ''): ClaimBillingAssessment {
    return {
      diagnosis,
      items: [],
      overall: 'uncertain',
      overallScore: 0,
      summary: 'AI_QUOTA_EXCEEDED',
      fromLineItems: false,
    };
  }

  /**
   * Shared extraction+assessment prompt. Emphasises capturing EVERY billed line
   * from the invoice charges table together with its amount/qty/rate, and being
   * explicit that procedure/diagnosis codes are NOT themselves billed services.
   */
  private buildExtractionPrompt(
    diagnosis: string,
    treatment: string | null | undefined,
    procedureCodes: string[],
    rawTextSnippet: string,
  ): string {
    return (
      `You are a senior medical claims auditor reviewing an insurance claim.\n\n` +
      (diagnosis ? `Patient diagnosis (their medical condition): ${diagnosis}\n\n` : '') +
      (treatment ? `Treatment notes: ${treatment}\n\n` : '') +
      (procedureCodes.length ? `Procedure codes on file: ${procedureCodes.join(', ')}\n\n` : '') +
      (rawTextSnippet ? `Raw invoice / clinical document text:\n${rawTextSnippet}\n\n` : '') +
      `TASK — extract the invoice's BILLING TABLE, then assess each line clinically.\n\n` +
      `1. Find the charges/billing table in the text (columns are usually something like ` +
      `Description, Qty, Rate/Unit Price, Amount/Gross). Extract EVERY charged row — ` +
      `bed/ward charges, consultation/doctor/surgeon fees, theatre charges, anaesthesia, ` +
      `medication/drugs, lab tests, imaging, consumables, nursing, etc.\n` +
      `   • One object per billed line. Do not collapse multiple days/rows into one.\n` +
      `   • Capture the amount: "quantity", "unitPrice" (rate per unit) and "amount" (line total) as plain numbers (no currency symbols/commas). Use null only when truly absent.\n` +
      `   • Use the exact service name as printed on the invoice.\n` +
      `   • A bare procedure/diagnosis CODE (e.g. "G18", an ICD/CPT code) is NOT a billed service — do not list a code as an item unless it labels an actual charged line with an amount.\n` +
      `   • NEVER list the diagnosis/condition itself as a billed item.\n` +
      `2. For each extracted line, judge clinical appropriateness for the diagnosis:\n` +
      `   • "match" — clearly needed for this diagnosis/treatment.\n` +
      `   • "mismatch" — unrelated to the diagnosis (possible bill inflation / fraud).\n` +
      `   • "uncertain" — cannot tell from the information given.\n` +
      `   • "score" 0.0–1.0 = your confidence the line is appropriate.\n\n` +
      `Respond ONLY with this JSON (no markdown, no prose outside JSON):\n` +
      `{"diagnosis":"<patient diagnosis>","items":[{"name":"<service name>","quantity":<number|null>,"unitPrice":<number|null>,"amount":<number|null>,"match":"match"|"mismatch"|"uncertain","score":0.0-1.0,"reason":"<one brief sentence>"}],"overall":"match"|"partial"|"mismatch"|"uncertain","overallScore":0.0-1.0,"summary":"<1-2 sentences>"}`
    );
  }

  /**
   * Run the extraction+assessment with deterministic settings (temperature 0,
   * JSON response mode) and ONE retry if the first attempt yields no items.
   * This is what makes the output consistent across repeated runs of the same
   * invoice instead of occasionally returning "could not extract".
   */
  private async runExtraction(
    diagnosis: string,
    treatment: string | null | undefined,
    procedureCodes: string[],
    rawTextSnippet: string,
    label: string,
    model?: string,
  ): Promise<ClaimBillingAssessment | null> {
    const prompt = this.buildExtractionPrompt(diagnosis, treatment, procedureCodes, rawTextSnippet);
    const system = 'You are a senior medical claims auditor extracting and assessing billed services from invoice documents. Always reply with valid JSON only.';

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const raw = await this.llm.generate(system, prompt, {
          temperature: 0,
          json: true,
          maxOutputTokens: 4096,
          model,
        });
        this.logger.debug(`Billing audit (${label}) attempt ${attempt} raw (first 200): ${raw.slice(0, 200)}`);
        const parsed = this.parseAssessment(raw, diagnosis);
        if (parsed && parsed.items.length > 0) return parsed;
      } catch (err: any) {
        if (err?.isQuota) throw err;   // quota: stop and let the caller surface it
        this.logger.warn(`Billing audit (${label}) attempt ${attempt} failed: ${err.message}`);
      }
    }
    return null;
  }

  /**
   * Vision fallback: read the invoice DOCUMENT IMAGE directly with Gemini when
   * the OCR text yields no line items. Scanned invoices often produce garbled
   * Tesseract text, but the model reads the page itself reliably.
   */
  private async extractViaVision(
    claimId: string,
    diagnosis: string,
    treatment: string | null | undefined,
    procedureCodes: string[],
    model?: string,
  ): Promise<ClaimBillingAssessment | null> {
    // Prefer the invoice document; fall back to any image/PDF attached to the claim.
    const docs = await this.prisma.document.findMany({
      where: { claimId },
      select: { path: true, mimetype: true, documentType: true, originalName: true },
    });
    if (!docs.length) return null;

    const isReadable = (m: string, name: string) =>
      m === 'application/pdf' || m?.startsWith('image/') ||
      /\.(pdf|png|jpe?g|webp|tiff?)$/i.test(name ?? '');
    const invoice = docs.find(d => d.documentType === 'invoice' && isReadable(d.mimetype, d.originalName))
      ?? docs.find(d => isReadable(d.mimetype, d.originalName));
    if (!invoice?.path) return null;

    let bytes: Buffer;
    try {
      bytes = fs.readFileSync(invoice.path);
    } catch (err: any) {
      this.logger.warn(`Vision fallback: cannot read ${invoice.path}: ${err.message}`);
      return null;
    }
    if (bytes.length > VISION_MAX_BYTES) {
      this.logger.warn(`Vision fallback: ${invoice.path} too large (${bytes.length} bytes) — skipping`);
      return null;
    }

    const mime = invoice.mimetype?.startsWith('image/') || invoice.mimetype === 'application/pdf'
      ? invoice.mimetype
      : /\.pdf$/i.test(invoice.originalName ?? '') ? 'application/pdf' : 'image/png';

    return this.runVisionExtraction(bytes, mime, diagnosis, treatment, procedureCodes, `claim ${claimId}`, model);
  }

  /** Core vision extraction — read a document buffer and parse its billing table. */
  private async runVisionExtraction(
    bytes: Buffer,
    mime: string,
    diagnosis: string,
    treatment: string | null | undefined,
    procedureCodes: string[],
    label: string,
    model?: string,
  ): Promise<ClaimBillingAssessment | null> {
    if (bytes.length > VISION_MAX_BYTES) {
      this.logger.warn(`Vision extraction (${label}): file too large (${bytes.length} bytes) — skipping`);
      return null;
    }
    const prompt = this.buildExtractionPrompt(diagnosis, treatment, procedureCodes, '');
    const system = 'You are a senior medical claims auditor. Read the attached invoice document image and extract its billing table. Reply with valid JSON only.';
    try {
      const raw = await this.llm.generateFromImage(system, prompt, bytes.toString('base64'), mime, {
        temperature: 0, json: true, maxOutputTokens: 4096, model,
      });
      this.logger.debug(`Billing audit (${label}) vision raw (first 200): ${raw.slice(0, 200)}`);
      const parsed = this.parseAssessment(raw, diagnosis);
      if (parsed && parsed.items.length > 0) {
        this.logger.log(`Billing audit: vision extracted ${parsed.items.length} item(s) (${label})`);
        return parsed;
      }
    } catch (err: any) {
      if (err?.isQuota) throw err;
      this.logger.warn(`Vision extraction failed (${label}): ${err.message}`);
    }
    return null;
  }

  /**
   * Public vision assessment — upload-stage path. Reads an invoice file buffer
   * (sent from the browser) and returns the billing audit. Used when the
   * text-based inline assessment found no items.
   */
  async assessFromImageBuffer(
    buffer: Buffer,
    mimetype: string,
    diagnosis?: string,
    treatment?: string,
    model?: string,
  ): Promise<ClaimBillingAssessment> {
    const dx = diagnosis || '';
    try {
      const result = await this.runVisionExtraction(buffer, mimetype || 'image/png', dx, treatment, [], 'inline-vision', model);
      return result ?? this.unknownAssessment('Could not read billing items from the document image', dx);
    } catch (err: any) {
      if (err?.isQuota) return this.quotaAssessment(dx);
      this.logger.warn(`Vision assessment error: ${err.message}`);
      return this.unknownAssessment('Could not read billing items from the document image', dx);
    }
  }

  /** Parse + sanitise an LLM assessment response. Returns null if unusable. */
  private parseAssessment(raw: string, fallbackDiagnosis: string): ClaimBillingAssessment | null {
    const stripped = raw.replace(/```json|```/g, '').trim();
    const s = stripped.indexOf('{');
    const e = stripped.lastIndexOf('}');
    if (s === -1 || e === -1) return null;
    let parsed: any;
    try {
      parsed = JSON.parse(stripped.slice(s, e + 1));
    } catch {
      return null;
    }
    if (!parsed || !Array.isArray(parsed.items) || parsed.items.length === 0) return null;

    const num = (v: any): number | null => {
      if (v == null) return null;
      const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
      return Number.isFinite(n) ? n : null;
    };

    const items: BillingItemAssessment[] = parsed.items
      .filter((it: any) => it && it.name)
      .map((it: any) => ({
        name: String(it.name).trim(),
        match: ['match', 'mismatch', 'uncertain'].includes(it.match) ? it.match : 'uncertain',
        score: Math.min(1, Math.max(0, num(it.score) ?? 0.5)),
        reason: String(it.reason ?? '').trim(),
        quantity: num(it.quantity),
        unitPrice: num(it.unitPrice),
        amount: num(it.amount),
      }));

    if (items.length === 0) return null;

    const overall = ['match', 'partial', 'mismatch', 'uncertain'].includes(parsed.overall)
      ? parsed.overall
      : undefined;
    // Trust our own roll-up over the model's when verdicts are present.
    const rolled = this.buildAssessmentFromItems(parsed.diagnosis || fallbackDiagnosis, items, false);
    return {
      ...rolled,
      overall: overall ?? rolled.overall,
      overallScore: num(parsed.overallScore) ?? rolled.overallScore,
      summary: String(parsed.summary ?? '').trim() || rolled.summary,
    };
  }

  async validateLineItems(claimId: string): Promise<void> {
    const claim = await this.prisma.claim.findUnique({
      where: { id: claimId },
      select: {
        diagnosis: true,
        treatment: true,
        procedureCodes: true,
        ocrData: { select: { diagnosis: true } },
      },
    });

    if (!claim) return;

    const diagnosisParts = [
      claim.diagnosis,
      claim.ocrData?.diagnosis,
      claim.treatment,
    ].filter(Boolean);

    const diagnosisContext = diagnosisParts.join('; ');

    const lineItems = await this.prisma.invoiceLineItem.findMany({
      where: { claimId },
      select: { id: true, description: true, procedureCode: true },
    });

    if (lineItems.length === 0) return;

    if (!diagnosisContext) {
      await this.prisma.invoiceLineItem.updateMany({
        where: { claimId },
        data: { diagnosisMatch: 'unchecked' },
      });
      return;
    }

    for (let i = 0; i < lineItems.length; i += BATCH_SIZE) {
      const batch = lineItems.slice(i, i + BATCH_SIZE);
      const results = await this.scoreBatch(diagnosisContext, batch);

      await Promise.all(
        batch.map((item, idx) =>
          this.prisma.invoiceLineItem.update({
            where: { id: item.id },
            data: {
              diagnosisMatch: results[idx].match as MatchStatus,
              diagnosisMatchScore: results[idx].score,
              diagnosisMatchReason: results[idx].reason,
            },
          }),
        ),
      );
    }

    this.logger.log(`Diagnosis-billing validation complete for claim ${claimId} (${lineItems.length} items)`);
  }

  private async scoreBatch(
    diagnosisContext: string,
    items: { id: string; description: string; procedureCode: string | null }[],
    model?: string,
  ): Promise<GeminiMatchResult[]> {
    const lineList = items
      .map((it, idx) => {
        const code = it.procedureCode ? ` (code: ${it.procedureCode})` : '';
        return `${idx + 1}. ${it.description}${code}`;
      })
      .join('\n');

    const prompt =
      `Patient diagnosis: ${diagnosisContext}\n\n` +
      `Line items:\n${lineList}\n\n` +
      `For each line item, decide if the service is clinically appropriate for the stated diagnosis.\n` +
      `Respond with ONLY a JSON array of ${items.length} objects in input order:\n` +
      `[{"match":"match"|"mismatch"|"uncertain","score":0.0-1.0,"reason":"brief explanation"}]`;

    try {
      const raw = await this.llm.generate(
        'You are a medical claims auditor. Assess clinical appropriateness of billed services. Reply with valid JSON only.',
        prompt,
        { temperature: 0, json: true, maxOutputTokens: 2048, model },
      );
      const stripped = raw.replace(/```json|```/g, '').trim();
      const arrStart = stripped.indexOf('[');
      const arrEnd = stripped.lastIndexOf(']');
      if (arrStart !== -1 && arrEnd !== -1) {
        const parsed: GeminiMatchResult[] = JSON.parse(stripped.slice(arrStart, arrEnd + 1));
        if (Array.isArray(parsed) && parsed.length === items.length) {
          return parsed;
        }
      }
    } catch (e: any) {
      if (e?.isQuota) throw e;
      this.logger.warn(`Gemini diagnosis-billing scoring failed: ${e.message}`);
    }

    return items.map(() => ({
      match: 'uncertain' as const,
      score: 0.5,
      reason: 'Could not assess — AI response unavailable',
    }));
  }
}
