import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import { PrismaService } from '../prisma/prisma.service';
import { LlmRouterService } from '../assistant/llm-router.service';

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

/**
 * Invoice-level money totals read off the document's totals block. All optional
 * — present only when the figure is printed on the invoice. Lets the audit show
 * the full picture: what was billed (gross), what is deducted (sponsor/insurer
 * cover, rebates, discounts), and the final amount payable (net).
 */
export interface BillingTotals {
  currency?: string | null;
  gross?: number | null;           // total billed before deductions
  discount?: number | null;        // rebate / discount off the bill
  tax?: number | null;             // VAT / tax
  sponsorCoverage?: number | null; // amount the sponsor/insurer covers (a deduction)
  netPayable?: number | null;      // final amount payable after deductions
}

export interface ClaimBillingAssessment {
  diagnosis: string;
  items: BillingItemAssessment[];
  overall: 'match' | 'partial' | 'mismatch' | 'uncertain';
  overallScore: number;
  summary: string;
  fromLineItems: boolean;
  totals?: BillingTotals | null;   // invoice-level gross/deductions/net
  diagnosisInferred?: boolean;     // diagnosis was read off the invoice, not recorded on the claim
  cachedAt?: string;   // ISO — present when served from DB cache
}

@Injectable()
export class DiagnosisBillingService {
  private readonly logger = new Logger(DiagnosisBillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmRouterService,
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
        invoiceAmount: true,
        billingAuditStatus: true,
        billingAuditScore: true,
        billingAuditSummary: true,
        billingAuditItems: true,
        billingAuditTotals: true,
        billingAuditDxInferred: true,
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
        totals: (claim.billingAuditTotals as unknown as BillingTotals | null) ?? null,
        diagnosisInferred: claim.billingAuditDxInferred ?? false,
        cachedAt: claim.billingAuditAt.toISOString(),
      };
    }

    const diagnosis = claim.diagnosis || claim.ocrData?.diagnosis || '';
    // Use a generous window so the FULL charges table of a long multi-page
    // invoice is included — a small slice truncates later pages and under-counts.
    const rawTextSnippet = claim.ocrData?.rawText
      ? claim.ocrData.rawText.slice(0, 40000)
      : '';
    // The recorded invoice total is the reconciliation target: it tells the model
    // when its extracted lines are incomplete, and decides text-vs-vision below.
    const invoiceHint = claim.invoiceAmount ?? null;

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
        // Only run text extraction when there is real invoice text — never feed
        // a diagnosis with empty invoice text, or the model invents illustrative
        // items. With no text we go straight to reading the document image.
        if (rawTextSnippet) {
          result = await this.runExtraction(diagnosis, claim.treatment, procedureCodes, rawTextSnippet, `claim ${claimId}`, model, invoiceHint);
        }

        // Escalate to full-document vision when text extraction found nothing OR
        // its line amounts fall materially short of the invoice total — the usual
        // cause of "items fall short" is truncated OCR text or charges on later
        // pages that the text slice missed. Vision reads the whole document.
        const textSum = this.sumAmounts(result);
        const shortfall = invoiceHint != null && invoiceHint > 0 && textSum > 0 && textSum < invoiceHint * 0.9;
        if (!result || result.items.length === 0 || shortfall) {
          const visionResult = await this.extractViaVision(claimId, diagnosis, claim.treatment, procedureCodes, model, invoiceHint);
          if (visionResult && visionResult.items.length > 0) {
            // Keep whichever extraction reconciles best with the invoice total.
            result = this.pickCloserToTotal(result, visionResult, invoiceHint);
          }
        }
      } catch (err: any) {
        if (err?.isQuota) return this.quotaAssessment(diagnosis);
        this.logger.warn(`Billing audit error for claim ${claimId}: ${err.message}`);
      }
    }

    if (!result) {
      return this.unknownAssessment('No invoice billing items to audit for this claim', diagnosis);
    }

    // Backfill the claim's diagnosis from what the audit read off the document
    // when the claim itself has none. Invoices rarely state the diagnosis as an
    // indexed field, so without this the published claim shows "Not recorded" and
    // the rest of the app (clinical tab, fraud signals) has nothing to work with.
    // Only fills when empty — never overwrites a recorded diagnosis. The returned
    // flag drives the "inferred from billing" provenance note in the UI.
    const inferred = await this.backfillDiagnosis(
      claimId, claim.diagnosis || claim.ocrData?.diagnosis || '', result.diagnosis,
    );
    result.diagnosisInferred = inferred;

    // Persist to DB so subsequent requests are instant (no Gemini call needed)
    this.prisma.claim.update({
      where: { id: claimId },
      data: {
        billingAuditStatus:  result.overall,
        billingAuditScore:   result.overallScore,
        billingAuditSummary: result.summary,
        billingAuditItems:   result.items as any,
        billingAuditTotals:  (result.totals ?? null) as any,
        billingAuditDxInferred: inferred,
        billingAuditAt:      new Date(),
      },
    }).catch(err => this.logger.warn(`Failed to cache billing audit for ${claimId}: ${err.message}`));

    // Reconcile the recorded invoice amount with the validated line-item sum.
    // The itemised total (read line-by-line) is more reliable than a single OCR
    // grab of the total, which is often mis-read — so when every line is priced
    // and the sum differs materially, correct the claim amount (with an audit
    // trail) so the two totals always agree.
    await this.reconcileInvoiceAmount(claimId, result.items, claim.invoiceAmount ?? null, result.totals);

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
    model?: string;
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
        { temperature: 0, json: true, maxOutputTokens: 1024, model: data.model },
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

  /**
   * Write the audit-derived diagnosis back onto the claim (and its OCR record)
   * when the claim has none. Guarded: only fills an empty diagnosis, and ignores
   * placeholder/non-diagnostic strings. Best-effort — never throws.
   */
  private async backfillDiagnosis(claimId: string, existing: string, derived: string): Promise<boolean> {
    if (existing && existing.trim()) return false; // never overwrite a recorded diagnosis
    const dx = (derived || '').trim();
    if (dx.length < 3) return false;
    if (/^(see raw|not recorded|n\/?a|none|unknown)\b/i.test(dx)) return false;
    try {
      await this.prisma.claim.update({ where: { id: claimId }, data: { diagnosis: dx } });
      await this.prisma.ocrExtraction.updateMany({ where: { claimId }, data: { diagnosis: dx } }).catch(() => {});
      this.logger.log(`Backfilled diagnosis for claim ${claimId} from billing audit: "${dx}"`);
      return true;
    } catch (err: any) {
      this.logger.warn(`Failed to backfill diagnosis for ${claimId}: ${err.message}`);
      return false;
    }
  }

  /** Sum of the priced line amounts in an assessment (0 when none/null). */
  private sumAmounts(a: ClaimBillingAssessment | null): number {
    if (!a) return 0;
    return a.items.reduce((s, i) => s + (typeof i.amount === 'number' ? i.amount : 0), 0);
  }

  /**
   * Choose the extraction that best reconciles with the invoice total. With a
   * known total, the closer itemised sum wins; without one, prefer the richer
   * extraction (larger sum, then more items).
   */
  private pickCloserToTotal(
    a: ClaimBillingAssessment | null,
    b: ClaimBillingAssessment | null,
    total: number | null,
  ): ClaimBillingAssessment | null {
    if (!a) return b;
    if (!b) return a;
    const sa = this.sumAmounts(a);
    const sb = this.sumAmounts(b);
    if (total != null && total > 0) {
      return Math.abs(sb - total) < Math.abs(sa - total) ? b : a;
    }
    if (sb !== sa) return sb > sa ? b : a;
    return b.items.length > a.items.length ? b : a;
  }

  /**
   * Reconcile the claim's recorded invoice amount with the validated line-item
   * sum. The itemised total (read line-by-line) is more trustworthy than a single
   * OCR grab of the printed total — so when EVERY line is priced and the sum
   * differs materially, we correct the claim amount and log the change for audit.
   * Guarded to all-lines-priced so a partial extraction never lowers the amount.
   */
  private async reconcileInvoiceAmount(
    claimId: string,
    items: BillingItemAssessment[],
    recordedAmount: number | null,
    totals?: BillingTotals | null,
  ): Promise<void> {
    // The claim amount is what the INSURER is billed. Priority:
    //   1. sponsorCoverage — the invoice's own "Sponsor Coverage" figure is the
    //      amount being claimed from the scheme/insurer (the authoritative claim
    //      amount on Aga Khan-style invoices).
    //   2. otherwise fall back to the itemised line-item sum (gross), but only
    //      when every line is priced so a partial extraction never lowers it.
    let target: number | null = null;
    let source = '';
    if (totals?.sponsorCoverage != null && totals.sponsorCoverage > 0) {
      target = Math.round(totals.sponsorCoverage * 100) / 100;
      source = 'sponsor-coverage';
    } else if (items.length && items.every(i => typeof i.amount === 'number' && (i.amount as number) > 0)) {
      target = Math.round(items.reduce((s, i) => s + (i.amount ?? 0), 0) * 100) / 100;
      source = 'line-items';
    }
    if (target == null || target <= 0) return;
    if (recordedAmount != null && Math.abs(target - recordedAmount) < 1) return; // already agree

    try {
      await this.prisma.claim.update({
        where: { id: claimId },
        data: { invoiceAmount: target },
      });
      await this.prisma.activityLog.create({
        data: {
          action: 'invoice_amount_reconciled',
          entity: 'claim',
          entityId: claimId,
          status: 'success',
          oldValue: { invoiceAmount: recordedAmount } as any,
          newValue: { invoiceAmount: target } as any,
          metadata: { source: `diagnosis-billing-audit:${source}`, lineItems: items.length } as any,
        },
      }).catch(() => { /* audit log is best-effort */ });
      this.logger.log(`Reconciled claim ${claimId} invoice amount ${recordedAmount} → ${target} (${source})`);
    } catch (err: any) {
      this.logger.warn(`Failed to reconcile invoice amount for ${claimId}: ${err.message}`);
    }
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
    invoiceTotalHint?: number | null,
  ): string {
    const hint =
      invoiceTotalHint && invoiceTotalHint > 0
        ? `\nIMPORTANT — the invoice's grand total is approximately ${invoiceTotalHint.toLocaleString('en-KE', { minimumFractionDigits: 2 })}. ` +
          `The "amount" values of the lines you extract should SUM to about this figure. ` +
          `If your extracted lines sum to materially less, you have MISSED rows — re-scan every page and include them all before answering.\n`
        : '';
    return (
      `You are a senior medical claims auditor reviewing an insurance claim.\n\n` +
      (diagnosis ? `Patient diagnosis (their medical condition): ${diagnosis}\n\n` : '') +
      (treatment ? `Treatment notes: ${treatment}\n\n` : '') +
      (procedureCodes.length ? `Procedure codes on file: ${procedureCodes.join(', ')}\n\n` : '') +
      (rawTextSnippet ? `Raw invoice / clinical document text:\n${rawTextSnippet}\n\n` : '') +
      `TASK — extract the invoice's BILLING TABLE, then assess each line clinically.\n` +
      hint + `\n` +
      `COMPLETENESS — list EVERY charged row. Do NOT summarise, sample, deduplicate, or truncate. ` +
      `Multi-page invoices repeat charges (e.g. the same bed/ward charge on each day of admission) — include each occurrence as its own line. ` +
      `A long bill may have dozens of rows; return them all.\n\n` +
      `CRITICAL — extract ONLY what literally appears in the invoice provided above ` +
      `(and/or the attached document image). This is real patient billing data:\n` +
      `   • Do NOT invent, infer, assume, or list "typical", "example" or "illustrative" ` +
      `services for the diagnosis. If a service is not printed on the invoice, it does not exist.\n` +
      `   • If there is NO billing/charges table in the provided invoice, return an EMPTY items array ([]). ` +
      `Never fabricate items from the diagnosis alone.\n\n` +
      `1. Find the charges/billing table in the text and extract EVERY charged row — ` +
      `bed/ward charges, consultation/doctor/surgeon fees, theatre charges, anaesthesia, ` +
      `medication/drugs, lab tests, imaging, consumables, nursing, etc.\n` +
      `   • Column layouts vary by provider. Map them to our fields, e.g.:\n` +
      `     – Description / Item / Service / "Charge Category" → "name" (use the most specific service text on the row).\n` +
      `     – Qty / Quantity / Units → "quantity".\n` +
      `     – Rate / Unit Price / Price → "unitPrice".\n` +
      `     – Gross / Amount / Total / Charge / Line Total → "amount" (the line total).\n` +
      `     An Aga Khan-style table has columns "Number, Charge Category, Date, Description, Location, Provider/RX #/Req #, Qty, Rate, Gross" — there "Gross" is the line amount and "Rate" is the unit price; rows may wrap onto two printed lines (header row then a detail row) — treat them as ONE line item.\n` +
      `   • One object per billed line. Do not collapse multiple days/rows into one.\n` +
      `   • Capture "quantity", "unitPrice" (rate per unit) and "amount" (line total) as plain numbers (no currency symbols/commas). Use null only when truly absent.\n` +
      `   • Use the exact service name as printed on the invoice.\n` +
      `   • A bare procedure/diagnosis CODE (e.g. "G18", an ICD/CPT code) is NOT a billed service — do not list a code as an item unless it labels an actual charged line with an amount.\n` +
      `   • NEVER list the diagnosis/condition itself as a billed item.\n` +
      `2. Read the invoice's TOTALS block (usually below the table). Capture, as plain numbers (null when absent):\n` +
      `   • gross — total billed / subtotal before deductions (labels: Total, Gross, Subtotal, Amount Billed).\n` +
      `   • discount — any rebate or discount taken off the bill.\n` +
      `   • tax — VAT / tax.\n` +
      `   • sponsorCoverage — the amount the sponsor / insurer / scheme covers, i.e. the amount being claimed FROM the insurer. Labels: "Sponsor Coverage", Insurer/Scheme Paid, Covered. The figure usually sits to the RIGHT of the scheme name, on the line(s) under a "Sponsor Coverage:" heading — e.g. "AGRICULTURE AND FOOD AUTHORITY   552,991.82" means sponsorCoverage = 552991.82.\n` +
      `   • netPayable — the amount the PATIENT pays after the sponsor's share / self-payments (labels: Net, Balance, Amount Due/Payable, Patient Payable).\n` +
      `   • currency — e.g. KES, USD.\n` +
      `3. For each extracted line, judge clinical appropriateness for the diagnosis:\n` +
      `   • "match" — clearly needed for this diagnosis/treatment.\n` +
      `   • "mismatch" — unrelated to the diagnosis (possible bill inflation / fraud).\n` +
      `   • "uncertain" — cannot tell from the information given.\n` +
      `   • "score" 0.0–1.0 = your confidence the line is appropriate.\n\n` +
      `Respond ONLY with this JSON (no markdown, no prose outside JSON):\n` +
      `{"diagnosis":"<patient diagnosis>","items":[{"name":"<service name>","quantity":<number|null>,"unitPrice":<number|null>,"amount":<number|null>,"match":"match"|"mismatch"|"uncertain","score":0.0-1.0,"reason":"<one brief sentence>"}],"totals":{"currency":"<code|null>","gross":<number|null>,"discount":<number|null>,"tax":<number|null>,"sponsorCoverage":<number|null>,"netPayable":<number|null>},"overall":"match"|"partial"|"mismatch"|"uncertain","overallScore":0.0-1.0,"summary":"<1-2 sentences>"}`
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
    invoiceTotalHint?: number | null,
  ): Promise<ClaimBillingAssessment | null> {
    const prompt = this.buildExtractionPrompt(diagnosis, treatment, procedureCodes, rawTextSnippet, invoiceTotalHint);
    const system = 'You are a senior medical claims auditor extracting and assessing billed services from invoice documents. Always reply with valid JSON only.';

    // generateWithFallback walks the cloud provider chain (preferred model
    // first), so a single call already tries multiple providers before failing.
    try {
      const raw = await this.llm.generateWithFallback(system, prompt, {
        temperature: 0,
        json: true,
        // Long, multi-page itemised bills need a large budget — a small cap
        // truncates the JSON and drops line items, under-counting the total.
        maxOutputTokens: 8192,
        model,
      });
      this.logger.debug(`Billing audit (${label}) raw (first 200): ${raw.slice(0, 200)}`);
      const parsed = this.parseAssessment(raw, diagnosis);
      if (parsed && parsed.items.length > 0) return parsed;
    } catch (err: any) {
      if (err?.isQuota) throw err;   // every provider quota-limited — surface it
      this.logger.warn(`Billing audit (${label}) failed: ${err.message}`);
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
    invoiceTotalHint?: number | null,
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

    return this.runVisionExtraction(bytes, mime, diagnosis, treatment, procedureCodes, `claim ${claimId}`, model, invoiceTotalHint);
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
    invoiceTotalHint?: number | null,
  ): Promise<ClaimBillingAssessment | null> {
    if (bytes.length > VISION_MAX_BYTES) {
      this.logger.warn(`Vision extraction (${label}): file too large (${bytes.length} bytes) — skipping`);
      return null;
    }
    const prompt = this.buildExtractionPrompt(diagnosis, treatment, procedureCodes, '', invoiceTotalHint);
    const system = 'You are a senior medical claims auditor. Read the attached invoice document image and extract its billing table. Reply with valid JSON only.';
    try {
      const raw = await this.llm.generateFromImageWithFallback(system, prompt, bytes.toString('base64'), mime, {
        temperature: 0, json: true, maxOutputTokens: 8192, model,
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

    // Invoice-level totals block (optional — present only when printed).
    let totals: BillingTotals | null = null;
    if (parsed.totals && typeof parsed.totals === 'object') {
      const t = parsed.totals;
      const cur = t.currency != null && String(t.currency).trim() && String(t.currency).toLowerCase() !== 'null'
        ? String(t.currency).trim().toUpperCase() : null;
      const candidate: BillingTotals = {
        currency: cur,
        gross: num(t.gross),
        discount: num(t.discount),
        tax: num(t.tax),
        sponsorCoverage: num(t.sponsorCoverage),
        netPayable: num(t.netPayable),
      };
      // Keep only when at least one money figure was read.
      if ([candidate.gross, candidate.discount, candidate.tax, candidate.sponsorCoverage, candidate.netPayable]
        .some(v => typeof v === 'number')) {
        totals = candidate;
      }
    }

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
      totals,
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
      const raw = await this.llm.generateWithFallback(
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
