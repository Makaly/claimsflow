import { Injectable } from '@nestjs/common';
import { extractIcd10Hints } from './icd10-hints';
import { extractDrugMentions } from './drug-list';
import { PrismaService } from '../prisma/prisma.service';
import { GeminiLlmAdapter } from '../assistant/gemini-llm.adapter';

const CPT_REGEX = /\b(9\d{4}|[0-8]\d{4}[A-Z]?)\b/g;

// Phrases that warrant clinical review
const RED_FLAG_PATTERNS = [
  /terminal\s+cancer/i,
  /end[\s-]stage/i,
  /intensive\s+care/i,
  /life[\s-]support/i,
  /do\s+not\s+resuscitate/i,
  /experimental\s+treatment/i,
  /off[\s-]label/i,
  /compassionate\s+use/i,
];

export interface ClinicalNlpResult {
  icd10Hints: { code: string; description: string }[];
  cptHints: string[];
  drugMentions: string[];
  redFlags: string[];
  discrepancies: string[];
  usedGeminiFallback: boolean;
}

@Injectable()
export class ClinicalNlpService {
  constructor(
    private prisma: PrismaService,
    private llm: GeminiLlmAdapter,
  ) {}

  async analyzeClaimText(
    claimId: string,
    noteText: string,
    billedProcedureCodes: string[],
  ): Promise<ClinicalNlpResult> {
    let usedGeminiFallback = false;
    let icd10Hints = extractIcd10Hints(noteText);

    // If no ICD-10 codes found via regex, fall back to Gemini for extraction
    if (icd10Hints.length === 0 && noteText.length > 20) {
      const prompt = `Extract any ICD-10 codes or diagnoses from the following clinical note.
Return a JSON array of objects with "code" and "description" keys only.
Note: ${noteText.slice(0, 2000)}`;
      const raw = await this.llm.generate('You are a clinical coding assistant.', prompt);
      usedGeminiFallback = true;
      try {
        const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
        if (Array.isArray(parsed)) icd10Hints = parsed;
      } catch {
        // Gemini response was not valid JSON — keep empty list
      }
    }

    // CPT extraction via 5-digit code regex
    const cptMatches = new Set<string>();
    let m: RegExpExecArray | null;
    const text = noteText.toUpperCase();
    CPT_REGEX.lastIndex = 0;
    while ((m = CPT_REGEX.exec(text)) !== null) {
      cptMatches.add(m[0]);
    }
    const cptHints = [...cptMatches];

    const drugMentions = extractDrugMentions(noteText);

    const redFlags = RED_FLAG_PATTERNS
      .filter((p) => p.test(noteText))
      .map((p) => p.source);

    // Discrepancy: billed procedure codes not mentioned anywhere in the note
    const discrepancies: string[] = [];
    for (const code of billedProcedureCodes) {
      const mentioned =
        noteText.toUpperCase().includes(code.toUpperCase()) ||
        cptHints.includes(code.toUpperCase());
      if (!mentioned) {
        discrepancies.push(`Billed code ${code} not found in clinical notes`);
      }
    }

    return { icd10Hints, cptHints, drugMentions, redFlags, discrepancies, usedGeminiFallback };
  }

  async analyzeClaimById(claimId: string): Promise<ClinicalNlpResult> {
    const claim = await this.prisma.claim.findUnique({
      where: { id: claimId },
      include: { ocrData: true },
    });
    if (!claim) throw new Error(`Claim ${claimId} not found`);
    const noteText = [claim.diagnosis, claim.notes, claim.ocrData?.rawText]
      .filter(Boolean)
      .join('\n');
    return this.analyzeClaimText(claimId, noteText, claim.procedureCodes ?? []);
  }
}
