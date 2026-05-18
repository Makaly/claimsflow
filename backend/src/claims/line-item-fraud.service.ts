import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ExtractedLineItem } from '../ocr/ocr.service';

export interface ScoredLineItem extends ExtractedLineItem {
  fraudRisk: 'low' | 'medium' | 'high';
  fraudRiskScore: number;
  fraudFlags: string[];
  arithmeticValid: boolean;
  overallConfidence: number;
}

export interface LineItemAnalysisResult {
  invoiceId: string;
  vendor: string;
  lineItems: ScoredLineItem[];
  invoiceTotal: number;
  calculatedTotal: number;
  discrepancyFlag: boolean;
  discrepancyAmount: number;
  overallFraudRisk: 'low' | 'medium' | 'high';
  invoiceLevelFlags: string[];
}

// Tolerance for floating-point arithmetic comparisons (0.5 KES).
const ARITHMETIC_TOLERANCE = 0.5;

// Maximum acceptable unit price for common outpatient services (KES).
const PRICE_CEILING: Record<string, number> = {
  consultation:    15_000,
  laboratory:      50_000,
  pharmacy:        50_000,
  procedure:       200_000,
  ward:            50_000,
  theatre:         500_000,
  radiology:       100_000,
  physiotherapy:   20_000,
  dental:          100_000,
  default:         500_000,
};

@Injectable()
export class LineItemFraudService {
  private readonly logger = new Logger(LineItemFraudService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Analyse all line items for a claim, score each item, and persist results.
   */
  async analyseAndPersist(
    claimId: string,
    vendorName: string,
    lineItems: ExtractedLineItem[],
    invoiceTotal: number,
  ): Promise<LineItemAnalysisResult> {
    const scored = await this.scoreItems(claimId, vendorName, lineItems, invoiceTotal);

    // Persist to DB — replace any previous extraction for this claim
    await this.prisma.invoiceLineItem.deleteMany({ where: { claimId } });
    if (scored.lineItems.length > 0) {
      await this.prisma.invoiceLineItem.createMany({
        data: scored.lineItems.map(item => ({
          claimId,
          lineNumber:         item.lineNumber ?? null,
          description:        item.description,
          itemName:           item.itemName ?? null,
          category:           item.category ?? null,
          quantity:           item.quantity ?? null,
          unitPrice:          item.unitPrice ?? null,
          totalPrice:         item.totalPrice ?? null,
          taxAmount:          item.taxAmount ?? null,
          discount:           item.discount ?? null,
          currency:           item.currency || 'KES',
          serviceDate:        item.serviceDate ?? null,
          procedureCode:      item.procedureCode ?? null,
          ocrConfidence:      item.ocrConfidence ?? null,
          overallConfidence:  item.overallConfidence ?? null,
          fraudRisk:          item.fraudRisk,
          fraudRiskScore:     item.fraudRiskScore,
          fraudFlags:         item.fraudFlags,
          arithmeticValid:    item.arithmeticValid,
          rawText:            item.rawText ?? null,
        })),
      });
    }

    return scored;
  }

  /**
   * Pure scoring — no DB writes. Used for real-time analysis without persistence.
   */
  async scoreItems(
    claimId: string,
    vendorName: string,
    lineItems: ExtractedLineItem[],
    invoiceTotal: number,
  ): Promise<LineItemAnalysisResult> {
    // Load vendor pricing history for statistical comparison
    const priceBaseline = await this.loadVendorPriceBaseline(vendorName);

    const scored: ScoredLineItem[] = lineItems.map((item, idx) =>
      this.scoreItem(item, idx, lineItems, priceBaseline),
    );

    const calculatedTotal = scored.reduce((s, i) => s + (i.totalPrice ?? 0), 0);
    const discrepancyAmount = Math.abs(invoiceTotal - calculatedTotal);
    const discrepancyFlag   = discrepancyAmount > ARITHMETIC_TOLERANCE && invoiceTotal > 0;

    const invoiceLevelFlags: string[] = [];

    if (discrepancyFlag) {
      const pct = invoiceTotal > 0 ? (discrepancyAmount / invoiceTotal) * 100 : 0;
      invoiceLevelFlags.push(
        `Invoice total KES ${invoiceTotal.toLocaleString()} differs from sum of line items KES ${calculatedTotal.toFixed(2)} by KES ${discrepancyAmount.toFixed(2)} (${pct.toFixed(1)}%)`,
      );
    }

    // Detect suspicious rounding of grand total
    if (invoiceTotal >= 10_000 && invoiceTotal % 1000 === 0 && !discrepancyFlag) {
      invoiceLevelFlags.push('Invoice grand total is a perfect round number — uncommon for genuine itemised billing');
    }

    // Detect copy-paste template reuse: identical item lists in recent claims from same vendor
    const templateReuseFlag = await this.detectTemplateReuse(claimId, vendorName, lineItems);
    if (templateReuseFlag) invoiceLevelFlags.push(templateReuseFlag);

    const highRiskCount   = scored.filter(i => i.fraudRisk === 'high').length;
    const mediumRiskCount = scored.filter(i => i.fraudRisk === 'medium').length;

    const overallFraudRisk: 'low' | 'medium' | 'high' =
      highRiskCount > 0 || invoiceLevelFlags.length >= 2 ? 'high' :
      mediumRiskCount >= 2 || invoiceLevelFlags.length === 1 ? 'medium' : 'low';

    return {
      invoiceId:        claimId,
      vendor:           vendorName,
      lineItems:        scored,
      invoiceTotal,
      calculatedTotal:  parseFloat(calculatedTotal.toFixed(2)),
      discrepancyFlag,
      discrepancyAmount: parseFloat(discrepancyAmount.toFixed(2)),
      overallFraudRisk,
      invoiceLevelFlags,
    };
  }

  private scoreItem(
    item: ExtractedLineItem,
    idx: number,
    allItems: ExtractedLineItem[],
    priceBaseline: Map<string, { mean: number; stdDev: number; count: number }>,
  ): ScoredLineItem {
    const flags: string[] = [];
    let riskScore = 0;

    // 1. Arithmetic validation: quantity × unitPrice ≈ totalPrice
    let arithmeticValid = true;
    if (item.quantity != null && item.unitPrice != null && item.totalPrice != null) {
      const expected = item.quantity * item.unitPrice;
      const diff = Math.abs(expected - item.totalPrice);
      if (diff > ARITHMETIC_TOLERANCE && item.totalPrice > 0) {
        arithmeticValid = false;
        flags.push(`Arithmetic mismatch: ${item.quantity} × KES ${item.unitPrice} = KES ${expected.toFixed(2)}, billed KES ${item.totalPrice}`);
        riskScore += 0.30;
      }
    }

    // 2. Duplicate item detection within the same invoice
    const descNorm = item.description.toLowerCase().replace(/\s+/g, ' ').trim();
    const dupCount = allItems.filter((other, j) =>
      j !== idx &&
      other.description.toLowerCase().replace(/\s+/g, ' ').trim() === descNorm
    ).length;
    if (dupCount > 0) {
      flags.push(`Duplicate billing: "${item.description}" appears ${dupCount + 1} times on same invoice`);
      riskScore += dupCount >= 2 ? 0.40 : 0.25;
    }

    // 3. Price ceiling check
    const category = this.categoriseItem(item.description);
    const ceiling  = PRICE_CEILING[category] ?? PRICE_CEILING.default;
    const price    = item.unitPrice ?? item.totalPrice ?? 0;
    if (price > ceiling) {
      flags.push(`Unit price KES ${price.toLocaleString()} exceeds category ceiling of KES ${ceiling.toLocaleString()} for "${category}"`);
      riskScore += 0.35;
    }

    // 4. Statistical anomaly vs vendor history
    const baseline = priceBaseline.get(descNorm);
    if (baseline && baseline.count >= 3 && item.unitPrice != null) {
      const z = baseline.stdDev > 0
        ? (item.unitPrice - baseline.mean) / baseline.stdDev
        : 0;
      if (z > 2.5) {
        flags.push(`Unit price KES ${item.unitPrice} is ${z.toFixed(1)}σ above vendor's historical average of KES ${baseline.mean.toFixed(0)} for this service`);
        riskScore += Math.min(0.40, z * 0.08);
      }
    }

    // 5. Suspicious zero quantities / prices
    if (item.quantity === 0 || item.unitPrice === 0) {
      flags.push('Zero quantity or zero unit price — possible phantom service entry');
      riskScore += 0.20;
    }

    // 6. Round-number unit price (common in inflated invoices)
    if (price >= 5_000 && price % 1000 === 0) {
      flags.push(`Unit price KES ${price.toLocaleString()} is a perfect round number`);
      riskScore += 0.08;
    }

    // 7. Inconsistent tax calculation
    if (item.taxAmount != null && item.totalPrice != null && item.totalPrice > 0) {
      const impliedTaxRate = item.taxAmount / item.totalPrice;
      // Kenyan VAT is 16%; allow small rounding tolerance
      if (impliedTaxRate > 0 && Math.abs(impliedTaxRate - 0.16) > 0.03) {
        flags.push(`Unusual tax rate: ${(impliedTaxRate * 100).toFixed(1)}% (Kenyan VAT is 16%)`);
        riskScore += 0.15;
      }
    }

    // 8. Very short or vague description
    if (item.description.trim().length < 4) {
      flags.push('Line item description is too short to verify the service');
      riskScore += 0.10;
    }

    const clampedScore = Math.min(1, Math.max(0, riskScore));
    const fraudRisk: 'low' | 'medium' | 'high' =
      clampedScore >= 0.55 ? 'high' :
      clampedScore >= 0.25 ? 'medium' : 'low';

    const ocrConf      = item.ocrConfidence ?? 0.85;
    const overallConf  = flags.length > 0 ? Math.max(0.1, ocrConf - clampedScore * 0.3) : ocrConf;

    return {
      ...item,
      category,
      fraudRisk,
      fraudRiskScore:    parseFloat(clampedScore.toFixed(3)),
      fraudFlags:        flags,
      arithmeticValid,
      overallConfidence: parseFloat(overallConf.toFixed(3)),
    };
  }

  /** Map item description to a broad service category. */
  private categoriseItem(description: string): string {
    const d = description.toLowerCase();
    if (/consult|visit|outpatient|gp|doctor|physician/.test(d)) return 'consultation';
    if (/lab|test|blood|urine|culture|specimen|haematol|biochem|serology/.test(d)) return 'laboratory';
    if (/drug|tablet|capsule|syrup|injection|vial|iv|ml|mg|medication|medicine|pharmacy/.test(d)) return 'pharmacy';
    if (/x.?ray|scan|ct|mri|ultrasound|echo|radiolog|imaging/.test(d)) return 'radiology';
    if (/theatre|surgery|operation|anaes|procedure/.test(d)) return 'theatre';
    if (/ward|bed|inpatient|room|accommodation|nursing/.test(d)) return 'ward';
    if (/physio|therapy|rehab/.test(d)) return 'physiotherapy';
    if (/dental|tooth|teeth|extraction|filling|crown/.test(d)) return 'dental';
    return 'procedure';
  }

  /**
   * Load vendor-specific price baselines from past invoices.
   * Returns a map of normalised description → { mean, stdDev, count }.
   */
  private async loadVendorPriceBaseline(
    vendorName: string,
  ): Promise<Map<string, { mean: number; stdDev: number; count: number }>> {
    const result = new Map<string, { mean: number; stdDev: number; count: number }>();
    try {
      // Fetch recent line items for this vendor (last 6 months, max 2000 rows)
      const sixMonthsAgo = new Date(Date.now() - 180 * 86_400_000);
      const claims = await this.prisma.claim.findMany({
        where: {
          provider: { name: { contains: vendorName, mode: 'insensitive' } },
          submittedAt: { gte: sixMonthsAgo },
        },
        select: { id: true },
        take: 200,
      });

      if (claims.length === 0) return result;

      const claimIds = claims.map(c => c.id);
      const items = await this.prisma.invoiceLineItem.findMany({
        where: { claimId: { in: claimIds }, unitPrice: { gt: 0 } },
        select: { description: true, unitPrice: true },
        take: 2000,
      });

      // Group by normalised description
      const groups = new Map<string, number[]>();
      for (const item of items) {
        if (!item.unitPrice) continue;
        const key = item.description.toLowerCase().replace(/\s+/g, ' ').trim();
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(item.unitPrice);
      }

      for (const [desc, prices] of groups) {
        if (prices.length < 2) continue;
        const mean    = prices.reduce((s, v) => s + v, 0) / prices.length;
        const variance = prices.reduce((s, v) => s + (v - mean) ** 2, 0) / prices.length;
        result.set(desc, { mean, stdDev: Math.sqrt(variance), count: prices.length });
      }
    } catch (err: any) {
      this.logger.warn(`Price baseline load failed for "${vendorName}": ${err.message}`);
    }
    return result;
  }

  /**
   * Detect template reuse: same set of item descriptions appearing on a recent
   * claim from the same vendor (copy-paste fraud pattern).
   */
  private async detectTemplateReuse(
    claimId: string,
    vendorName: string,
    lineItems: ExtractedLineItem[],
  ): Promise<string | null> {
    if (lineItems.length < 3) return null;
    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);
      const recentClaims = await this.prisma.claim.findMany({
        where: {
          provider: { name: { contains: vendorName, mode: 'insensitive' } },
          submittedAt: { gte: thirtyDaysAgo },
          id: { not: claimId },
        },
        select: { id: true, claimNumber: true },
        take: 20,
      });

      if (recentClaims.length === 0) return null;

      const currentDescriptions = new Set(
        lineItems.map(i => i.description.toLowerCase().replace(/\s+/g, ' ').trim()),
      );

      for (const recent of recentClaims) {
        const recentItems = await this.prisma.invoiceLineItem.findMany({
          where: { claimId: recent.id },
          select: { description: true },
        });
        if (recentItems.length < 3) continue;

        const recentDescriptions = new Set(
          recentItems.map(i => i.description.toLowerCase().replace(/\s+/g, ' ').trim()),
        );
        const overlap = [...currentDescriptions].filter(d => recentDescriptions.has(d));
        const overlapRatio = overlap.length / Math.max(currentDescriptions.size, recentDescriptions.size);

        if (overlapRatio >= 0.85) {
          return `Invoice line items are ${Math.round(overlapRatio * 100)}% identical to claim ${recent.claimNumber} — possible template reuse / copy-paste fraud`;
        }
      }
    } catch (err: any) {
      this.logger.warn(`Template reuse check failed: ${err.message}`);
    }
    return null;
  }
}
