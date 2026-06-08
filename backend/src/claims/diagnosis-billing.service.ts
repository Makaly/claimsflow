import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GeminiLlmAdapter } from '../assistant/gemini-llm.adapter';

const BATCH_SIZE = 10;

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
  async assessFromClaimData(claimId: string): Promise<ClaimBillingAssessment> {
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
    if (
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
    const rawTextSnippet = claim.ocrData?.rawText
      ? claim.ocrData.rawText.slice(0, 5000)
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

      const prompt =
        `You are a senior medical claims auditor reviewing an insurance claim.\n\n` +
        (diagnosis ? `Patient diagnosis: ${diagnosis}\n\n` : '') +
        (claim.treatment ? `Treatment notes: ${claim.treatment}\n\n` : '') +
        (procedureCodes.length ? `Procedure codes: ${procedureCodes.join(', ')}\n\n` : '') +
        (rawTextSnippet ? `Raw invoice / clinical document text:\n${rawTextSnippet}\n\n` : '') +
        `TASK: Extract every individual billed service or charge from the invoice text ` +
        `(do NOT include the diagnosis itself as a billed item — only actual charged services). ` +
        `Then assess each service's clinical appropriateness for the patient's diagnosis.\n` +
        `Respond ONLY with this JSON (no markdown):\n` +
        `{"diagnosis":"<text>","items":[{"name":"<service>","match":"match"|"mismatch"|"uncertain","score":0.0-1.0,"reason":"<brief>"}],"overall":"match"|"partial"|"mismatch"|"uncertain","overallScore":0.0-1.0,"summary":"<1-2 sentences>"}`;

      try {
        const raw = await this.llm.generate(
          'You are a senior medical claims auditor extracting and assessing billed services from invoice documents.',
          prompt,
        );
        this.logger.debug(`Billing audit (claim ${claimId}) raw (first 300): ${raw.slice(0, 300)}`);
        const stripped = raw.replace(/```json|```/g, '').trim();
        const s = stripped.indexOf('{');
        const e = stripped.lastIndexOf('}');
        if (s !== -1 && e !== -1) {
          const parsed: ClaimBillingAssessment = JSON.parse(stripped.slice(s, e + 1));
          if (parsed && Array.isArray(parsed.items) && parsed.items.length > 0) {
            result = { ...parsed, diagnosis: parsed.diagnosis || diagnosis, fromLineItems: false };
          }
        }
      } catch (err: any) {
        this.logger.warn(`Billing audit failed for claim ${claimId}: ${err.message}`);
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
  }): Promise<ClaimBillingAssessment> {
    const diagnosis = data.diagnosis || '';
    const rawTextSnippet = data.rawText ? data.rawText.slice(0, 5000) : '';

    if (!diagnosis && !rawTextSnippet && !data.treatment) {
      return this.unknownAssessment('No clinical data provided', '');
    }

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
    // Key instruction: items are the CHARGED SERVICES on the invoice, NOT the
    // diagnosis itself. Gemini must not return the diagnosis as a billed item.
    const prompt =
      `You are a senior medical claims auditor reviewing an insurance claim.\n\n` +
      (diagnosis ? `Patient diagnosis (their medical condition): ${diagnosis}\n\n` : '') +
      (data.treatment ? `Treatment notes: ${data.treatment}\n\n` : '') +
      (rawTextSnippet ? `Raw invoice text:\n${rawTextSnippet}\n\n` : '') +
      `TASK:\n` +
      `1. From the invoice text, extract EVERY individual billed service or product charged to the patient.\n` +
      `   - Do NOT include the diagnosis/condition itself as a billed item.\n` +
      `   - Include procedure fees, ward/bed charges, medication, lab tests, theatre charges, surgeon fees, etc.\n` +
      `   - Use the exact service name as it appears on the invoice.\n` +
      `2. For each extracted item, assess whether it is clinically appropriate for the patient's diagnosis.\n\n` +
      `Respond ONLY with this JSON (no markdown, no explanation outside JSON):\n` +
      `{"diagnosis":"<patient diagnosis>","items":[{"name":"<service name from invoice>","match":"match"|"mismatch"|"uncertain","score":0.0-1.0,"reason":"<one brief sentence>"}],"overall":"match"|"partial"|"mismatch"|"uncertain","overallScore":0.0-1.0,"summary":"<1-2 sentences>"}`;

    try {
      const raw = await this.llm.generate(
        'You are a senior medical claims auditor extracting and assessing billed services from invoice documents.',
        prompt,
      );
      this.logger.debug(`Billing assessment raw (first 300): ${raw.slice(0, 300)}`);
      const stripped = raw.replace(/```json|```/g, '').trim();
      const jsonStart = stripped.indexOf('{');
      const jsonEnd = stripped.lastIndexOf('}');
      if (jsonStart !== -1 && jsonEnd !== -1) {
        const parsed: ClaimBillingAssessment = JSON.parse(stripped.slice(jsonStart, jsonEnd + 1));
        if (parsed && Array.isArray(parsed.items) && parsed.items.length > 0) {
          return { ...parsed, diagnosis: parsed.diagnosis || diagnosis, fromLineItems: false };
        }
      }
    } catch (e: any) {
      this.logger.warn(`Inline billing assessment failed: ${e.message}`);
    }

    return this.unknownAssessment('AI could not extract billing items — try reprocessing the invoice', diagnosis);
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
        'You are a medical claims auditor. Assess clinical appropriateness of billed services.',
        prompt,
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
      this.logger.warn(`Gemini diagnosis-billing scoring failed: ${e.message}`);
    }

    return items.map(() => ({
      match: 'uncertain' as const,
      score: 0.5,
      reason: 'Could not assess — AI response unavailable',
    }));
  }
}
