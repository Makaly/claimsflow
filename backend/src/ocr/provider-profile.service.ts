import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ParsedInvoice } from './ocr.service';

export interface TokenUsage {
  modelName: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  processingMs: number;
}

// Require at least this many extractions before trusting the profile enough
// to inject its hints into the model prompt.
const MIN_EXTRACTIONS_FOR_HINTS = 3;

@Injectable()
export class ProviderProfileService {
  private readonly logger = new Logger(ProviderProfileService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Normalize a raw provider name to a stable slug for DB keying. */
  static detectSlug(providerName: string): string {
    return providerName
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  /**
   * Try to extract a provider name from the first 600 chars of a page-hints
   * string (the result of buildPageContextHints). Returns an empty string
   * when no recognisable medical facility name is found.
   */
  static slugFromPageHints(pageHints: string): string {
    if (!pageHints) return '';
    const excerpt = pageHints.slice(0, 600);
    // Match patterns like "Aga Khan University Hospital", "Nairobi Hospital", etc.
    const m = excerpt.match(
      /(?:Hospital|Clinic|Medical\s+Centr[eo]|Healthcare|Dispensary|Health\s+Centre)[^\n,]*|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:Hospital|Clinic)/,
    );
    if (m) return ProviderProfileService.detectSlug(m[0].trim());

    // Fall back: look for capitalised multi-word name on one of the first few lines
    const lines = excerpt.split('\n').slice(0, 6);
    for (const line of lines) {
      const clean = line.replace(/^Page\s+\d+:/i, '').trim();
      if (/^[A-Z][A-Za-z ]{4,50}$/.test(clean) && !/SCANNED|DIGITAL|BOUNDARY|CONTINUATION/.test(clean)) {
        return ProviderProfileService.detectSlug(clean);
      }
    }
    return '';
  }

  /**
   * Return a compact provider-context string to inject into the model's user
   * message. Returns null when the profile doesn't exist yet or has fewer than
   * MIN_EXTRACTIONS_FOR_HINTS data points (not enough to trust).
   */
  async getHints(providerSlug: string): Promise<string | null> {
    if (!providerSlug) return null;
    try {
      const profile = await this.prisma.providerExtractionProfile.findUnique({
        where: { providerSlug },
      });
      if (!profile || profile.extractionCount < MIN_EXTRACTIONS_FOR_HINTS) return null;

      const hints = profile.invoiceHints as Record<string, any>;
      const lines: string[] = [
        `PROVIDER CONTEXT (${profile.displayName} — ${profile.extractionCount} prior extractions, avg confidence ${(profile.avgConfidence * 100).toFixed(0)}%):`,
      ];

      if (hints.membershipPrefix) lines.push(`• Membership numbers start with "${hints.membershipPrefix}"`);
      if (hints.invoiceNumberFormat) lines.push(`• Invoice number format: ${hints.invoiceNumberFormat}`);
      if (hints.currencySymbol) lines.push(`• Currency written as "${hints.currencySymbol}"`);
      if (Array.isArray(hints.reliableFields) && hints.reliableFields.length > 0) {
        lines.push(`• Reliably extracted fields: ${hints.reliableFields.join(', ')}`);
      }
      if (Array.isArray(hints.unreliableFields) && hints.unreliableFields.length > 0) {
        lines.push(`• Fields that often need manual review: ${hints.unreliableFields.join(', ')}`);
      }
      if (Array.isArray(hints.structureNotes) && hints.structureNotes.length > 0) {
        lines.push(...hints.structureNotes.map((n: string) => `• ${n}`));
      }

      return lines.join('\n');
    } catch (err: any) {
      this.logger.warn(`getHints(${providerSlug}) failed: ${err?.message}`);
      return null;
    }
  }

  /** Return all provider profiles ordered by extraction count descending. */
  async listProfiles() {
    return this.prisma.providerExtractionProfile.findMany({
      orderBy: { extractionCount: 'desc' },
      select: {
        id: true,
        providerSlug: true,
        displayName: true,
        extractionCount: true,
        avgConfidence: true,
        avgInputTokens: true,
        avgOutputTokens: true,
        avgCacheHitPct: true,
        preferredModel: true,
        invoiceHints: true,
        lastSeenAt: true,
      },
    });
  }

  /**
   * Update the provider profile after a successful extraction.
   * Called fire-and-forget — errors are logged but never thrown.
   */
  async upsertAfterExtraction(
    providerSlug: string,
    displayName: string,
    result: ParsedInvoice,
    tokenUsage: TokenUsage | null,
    tenantId?: string | null,
  ): Promise<void> {
    if (!providerSlug || !displayName) return;
    try {
      const existing = await this.prisma.providerExtractionProfile.findUnique({
        where: { providerSlug },
      });

      const n = (existing?.extractionCount ?? 0);
      const conf = result.confidence ?? 0;

      // Rolling averages
      const newCount = n + 1;
      const newAvgConf = rollingAvg(existing?.avgConfidence ?? 0, n, conf);
      const newAvgInput = tokenUsage
        ? Math.round(rollingAvg(existing?.avgInputTokens ?? 0, n, tokenUsage.inputTokens))
        : (existing?.avgInputTokens ?? 0);
      const newAvgOutput = tokenUsage
        ? Math.round(rollingAvg(existing?.avgOutputTokens ?? 0, n, tokenUsage.outputTokens))
        : (existing?.avgOutputTokens ?? 0);
      const cacheHitPct = tokenUsage && tokenUsage.inputTokens > 0
        ? tokenUsage.cacheReadTokens / tokenUsage.inputTokens
        : 0;
      const newAvgCachePct = rollingAvg(existing?.avgCacheHitPct ?? 0, n, cacheHitPct);

      // Update preferred model if current model has higher confidence
      let preferredModel = existing?.preferredModel ?? null;
      if (tokenUsage?.modelName) {
        if (!preferredModel || conf > (existing?.avgConfidence ?? 0)) {
          preferredModel = tokenUsage.modelName;
        }
      }

      // Learn structural hints from this extraction
      const prevHints = (existing?.invoiceHints ?? {}) as Record<string, any>;
      const newHints = learnHints(prevHints, result);

      const data = {
        displayName,
        extractionCount: newCount,
        avgConfidence:   newAvgConf,
        avgInputTokens:  newAvgInput,
        avgOutputTokens: newAvgOutput,
        avgCacheHitPct:  newAvgCachePct,
        preferredModel,
        invoiceHints:    newHints,
        tenantId:        tenantId ?? undefined,
      };

      await this.prisma.providerExtractionProfile.upsert({
        where:  { providerSlug },
        create: { providerSlug, ...data },
        update: data,
      });
    } catch (err: any) {
      this.logger.warn(`upsertAfterExtraction(${providerSlug}) failed: ${err?.message}`);
    }
  }
}

function rollingAvg(prev: number, n: number, newVal: number): number {
  return (prev * n + newVal) / (n + 1);
}

/** Infer structural hints from a single extraction result and merge with prior hints. */
function learnHints(
  prev: Record<string, any>,
  result: ParsedInvoice,
): Record<string, any> {
  const hints = { ...prev };

  // Membership prefix (first 2 alpha chars of the membership number)
  if (result.membershipNumber && /^[A-Z]{2}/i.test(result.membershipNumber)) {
    const prefix = result.membershipNumber.slice(0, 2).toUpperCase();
    if (!hints.membershipPrefix) hints.membershipPrefix = prefix;
  }

  // Invoice number format (detect patterns like Nyr/XXXXX, INV-XXXXX, UH-prefix)
  if (result.invoiceNumber && !hints.invoiceNumberFormat) {
    const inv = result.invoiceNumber;
    if (/^Nyr\//i.test(inv))      hints.invoiceNumberFormat = 'Nyr/XXXXX';
    else if (/^INV-/i.test(inv))  hints.invoiceNumberFormat = 'INV-XXXXX';
    else if (/^UH\d/i.test(inv))  hints.invoiceNumberFormat = 'UHXXXXXX (Aga Khan inpatient)';
    else if (/^REC-/i.test(inv))  hints.invoiceNumberFormat = 'REC-XXXXX';
    else if (/^\d{6,}$/.test(inv)) hints.invoiceNumberFormat = 'numeric';
    else if (/\//.test(inv))      hints.invoiceNumberFormat = inv.replace(/\d+/g, 'X');
  }

  // Update reliable/unreliable fields from per-field confidences
  const fc = result.fieldConfidences as Record<string, number> | undefined;
  if (fc && Object.keys(fc).length > 0) {
    const reliable: string[]   = hints.reliableFields   ?? [];
    const unreliable: string[] = hints.unreliableFields ?? [];

    for (const [field, conf] of Object.entries(fc)) {
      if (conf >= 0.85 && !reliable.includes(field)) {
        reliable.push(field);
      } else if (conf < 0.50 && !unreliable.includes(field)) {
        unreliable.push(field);
      }
      // Remove from unreliable if it now looks reliable (model improved)
      const idx = unreliable.indexOf(field);
      if (conf >= 0.85 && idx >= 0) unreliable.splice(idx, 1);
    }

    hints.reliableFields   = reliable.slice(0, 12);
    hints.unreliableFields = unreliable.slice(0, 8);
  }

  return hints;
}
