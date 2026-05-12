import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface AdjudicationResult {
  memberFound: boolean;
  planName?: string;
  benefitCategory?: string;
  benefitLimit?: number;
  benefitUsed?: number;
  benefitRemaining?: number;
  claimAmount: number;
  excessDeducted: number;
  copayDeducted: number;
  eligibleAmount: number;
  netPayable: number;
  reasons: string[];
  warnings: string[];
}

@Injectable()
export class AdjudicationService {
  constructor(private prisma: PrismaService) {}

  async adjudicate(input: {
    memberNumber?: string;
    invoiceAmount: number;
    claimType?: 'inpatient' | 'outpatient' | 'dental' | 'optical' | 'maternity';
    dateOfService?: Date | string | null;
  }): Promise<AdjudicationResult> {
    const reasons: string[] = [];
    const warnings: string[] = [];
    const claimAmount = input.invoiceAmount || 0;
    const category = input.claimType || 'outpatient';

    if (!input.memberNumber) {
      return {
        memberFound: false,
        claimAmount,
        excessDeducted: 0,
        copayDeducted: 0,
        eligibleAmount: 0,
        netPayable: 0,
        reasons: ['No member number — cannot adjudicate'],
        warnings: [],
      };
    }

    const member = await this.prisma.memberPolicy.findUnique({
      where: { memberNumber: input.memberNumber.trim() },
      include: { plan: true },
    });

    if (!member) {
      return {
        memberFound: false,
        claimAmount,
        excessDeducted: 0,
        copayDeducted: 0,
        eligibleAmount: 0,
        netPayable: 0,
        reasons: [`Member "${input.memberNumber}" not found in policy register`],
        warnings: ['Manual verification required — claim cannot be auto-adjudicated'],
      };
    }

    // Policy validity check
    const svcDate = input.dateOfService ? new Date(input.dateOfService) : new Date();
    if (svcDate < member.policyStartDate || svcDate > member.policyEndDate) {
      reasons.push(
        `Service date ${svcDate.toDateString()} falls outside policy validity (${member.policyStartDate.toDateString()} – ${member.policyEndDate.toDateString()})`,
      );
      return {
        memberFound: true,
        planName: member.plan.planName,
        claimAmount,
        excessDeducted: 0,
        copayDeducted: 0,
        eligibleAmount: 0,
        netPayable: 0,
        reasons,
        warnings,
      };
    }

    if (!member.isActive) {
      reasons.push('Member policy is inactive');
      return {
        memberFound: true,
        planName: member.plan.planName,
        claimAmount,
        excessDeducted: 0,
        copayDeducted: 0,
        eligibleAmount: 0,
        netPayable: 0,
        reasons,
        warnings,
      };
    }

    // Look up benefit limit by category
    const limitField = `${category}Limit` as keyof typeof member.plan;
    const usedField = `${category}Used` as keyof typeof member;
    const limit = (member.plan[limitField] as number) ?? 0;
    const used = (member[usedField] as number) ?? 0;
    const remaining = Math.max(0, limit - used);

    if (limit === 0) {
      reasons.push(`Plan "${member.plan.planName}" has no ${category} cover`);
      return {
        memberFound: true,
        planName: member.plan.planName,
        benefitCategory: category,
        benefitLimit: 0,
        benefitUsed: used,
        benefitRemaining: 0,
        claimAmount,
        excessDeducted: 0,
        copayDeducted: 0,
        eligibleAmount: 0,
        netPayable: 0,
        reasons,
        warnings,
      };
    }

    if (remaining <= 0) {
      reasons.push(
        `${category} benefit exhausted (KES ${used.toLocaleString()} / ${limit.toLocaleString()} used)`,
      );
      return {
        memberFound: true,
        planName: member.plan.planName,
        benefitCategory: category,
        benefitLimit: limit,
        benefitUsed: used,
        benefitRemaining: 0,
        claimAmount,
        excessDeducted: 0,
        copayDeducted: 0,
        eligibleAmount: 0,
        netPayable: 0,
        reasons,
        warnings,
      };
    }

    // Compute deductions
    const excess = member.plan.excessAmount || 0;
    const copayPercent = member.plan.copayPercent || 0;

    let eligibleAmount = Math.min(claimAmount, remaining);
    if (eligibleAmount < claimAmount) {
      warnings.push(
        `Claim KES ${claimAmount.toLocaleString()} exceeds remaining ${category} benefit KES ${remaining.toLocaleString()}`,
      );
    }

    const excessDeducted = Math.min(excess, eligibleAmount);
    const afterExcess = eligibleAmount - excessDeducted;
    const copayDeducted = +(afterExcess * (copayPercent / 100)).toFixed(2);
    const netPayable = +(afterExcess - copayDeducted).toFixed(2);

    if (excess > 0) reasons.push(`Excess of KES ${excess.toLocaleString()} applied`);
    if (copayPercent > 0) reasons.push(`Co-pay of ${copayPercent}% applied`);

    return {
      memberFound: true,
      planName: member.plan.planName,
      benefitCategory: category,
      benefitLimit: limit,
      benefitUsed: used,
      benefitRemaining: remaining,
      claimAmount,
      excessDeducted,
      copayDeducted,
      eligibleAmount,
      netPayable,
      reasons,
      warnings,
    };
  }
}
