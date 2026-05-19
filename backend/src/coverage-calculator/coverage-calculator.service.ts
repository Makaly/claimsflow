import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface InvoiceLineInput {
  description: string;
  category?: string; // "inpatient" | "outpatient" | "dental" | "optical" | "maternity" | other
  totalPrice: number;
}

export interface CoverageBreakdownLine {
  description: string;
  category: string;
  gross: number;
  subLimitCap: number;     // amount capped by sub-limit
  deductible: number;      // portion of excess applied to this line
  coPay: number;           // member's co-pay share
  netPayable: number;      // insurer pays this
  limitHit: boolean;
}

export interface CoverageResult {
  memberId: string;
  planCode: string;
  gross: number;
  subLimitCap: number;
  deductible: number;
  coPay: number;
  netPayable: number;
  limitHit: boolean;
  breakdownPerLine: CoverageBreakdownLine[];
}

// Category → MemberPolicy usage field mapping
const USAGE_FIELD: Record<string, keyof { inpatientUsed: number; outpatientUsed: number; dentalUsed: number; opticalUsed: number; maternityUsed: number }> = {
  inpatient:  'inpatientUsed',
  outpatient: 'outpatientUsed',
  dental:     'dentalUsed',
  optical:    'opticalUsed',
  maternity:  'maternityUsed',
};

const LIMIT_FIELD: Record<string, keyof { inpatientLimit: number; outpatientLimit: number; dentalLimit: number; opticalLimit: number; maternityLimit: number }> = {
  inpatient:  'inpatientLimit',
  outpatient: 'outpatientLimit',
  dental:     'dentalLimit',
  optical:    'opticalLimit',
  maternity:  'maternityLimit',
};

@Injectable()
export class CoverageCalculatorService {
  constructor(private readonly prisma: PrismaService) {}

  async calculate(memberId: string, lines: InvoiceLineInput[], _date?: Date): Promise<CoverageResult> {
    const memberPolicy = await this.prisma.memberPolicy.findUnique({
      where: { memberNumber: memberId },
      include: { plan: true },
    });
    if (!memberPolicy) throw new NotFoundException(`Member policy not found for member ${memberId}`);

    const plan = memberPolicy.plan;
    let remainingExcess = plan.excessAmount - 0; // excess applied once per claim

    let totalGross = 0;
    let totalCapped = 0;
    let totalDeductible = 0;
    let totalCoPay = 0;
    let totalNet = 0;
    let anyLimitHit = false;

    const breakdownPerLine: CoverageBreakdownLine[] = [];

    for (const line of lines) {
      const cat = (line.category ?? 'outpatient').toLowerCase();
      const usageKey = USAGE_FIELD[cat] ?? 'outpatientUsed';
      const limitKey = LIMIT_FIELD[cat] ?? 'outpatientLimit';

      const subLimit = plan[limitKey] as number;
      const used = memberPolicy[usageKey] as number;
      const remaining = Math.max(0, subLimit - used);

      const gross = line.totalPrice;
      const afterLimit = Math.min(gross, remaining);
      const subLimitCap = gross - afterLimit; // amount NOT covered due to limit
      const limitHit = subLimitCap > 0 || remaining <= 0;

      // Apply excess (deductible) once across all lines, in order
      const deductible = Math.min(afterLimit, remainingExcess);
      remainingExcess = Math.max(0, remainingExcess - deductible);
      const afterExcess = afterLimit - deductible;

      // Co-pay: percentage of what remains after excess
      const coPay = Math.round(afterExcess * (plan.copayPercent / 100) * 100) / 100;
      const netPayable = Math.round((afterExcess - coPay) * 100) / 100;

      breakdownPerLine.push({ description: line.description, category: cat, gross, subLimitCap, deductible, coPay, netPayable, limitHit });

      totalGross += gross;
      totalCapped += subLimitCap;
      totalDeductible += deductible;
      totalCoPay += coPay;
      totalNet += netPayable;
      if (limitHit) anyLimitHit = true;
    }

    return {
      memberId,
      planCode: plan.planCode,
      gross: Math.round(totalGross * 100) / 100,
      subLimitCap: Math.round(totalCapped * 100) / 100,
      deductible: Math.round(totalDeductible * 100) / 100,
      coPay: Math.round(totalCoPay * 100) / 100,
      netPayable: Math.round(totalNet * 100) / 100,
      limitHit: anyLimitHit,
      breakdownPerLine,
    };
  }
}
