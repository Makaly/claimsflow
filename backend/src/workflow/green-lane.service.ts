import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

interface GreenLaneCheckResult {
  approved: boolean;
  ruleId?: string;
  ruleName?: string;
  reason?: string;
}

@Injectable()
export class GreenLaneService {
  private readonly logger = new Logger(GreenLaneService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Evaluate a claim against all active green-lane rules.
   * Rules are short-circuited: first match wins.
   * Audit entry "AUTO_APPROVED_GREENLANE" is written on approval.
   */
  async evaluateClaim(claimId: string): Promise<GreenLaneCheckResult> {
    const claim = await this.prisma.claim.findUnique({
      where: { id: claimId },
      include: { ocrData: true },
    });
    if (!claim) return { approved: false, reason: 'claim not found' };

    // Check global disable flag from system_config
    const globalDisable = await this.prisma.systemConfig.findUnique({
      where: { key: 'green_lane_enabled' },
    });
    if (globalDisable?.value === 'false') {
      return { approved: false, reason: 'green-lane disabled globally' };
    }

    const rules = await this.prisma.greenLaneRule.findMany({
      where: {
        isActive: true,
        OR: [{ providerId: null }, { providerId: claim.providerId }],
      },
      orderBy: { createdAt: 'asc' },
    });

    const fraudSignals: any[] = Array.isArray(claim.fraudSignals)
      ? (claim.fraudSignals as any[])
      : [];
    const ocrConfidence = claim.ocrData?.overallConfidence ?? null;
    const fraudScore = claim.ocrData?.anomalyScore ?? 0;
    const invoiceAmount = claim.invoiceAmount ?? 0;

    for (const rule of rules) {
      if (rule.minValue !== null && invoiceAmount < (rule.minValue ?? 0)) continue;
      if (rule.maxValue !== null && invoiceAmount > (rule.maxValue ?? Infinity)) continue;
      if (rule.minOcrConfidence !== null && ocrConfidence !== null && ocrConfidence < (rule.minOcrConfidence ?? 0)) continue;
      if (rule.maxFraudScore !== null && fraudScore > (rule.maxFraudScore ?? 1)) continue;
      if (rule.requireNoSignals && fraudSignals.length > 0) continue;
      // All criteria passed — auto-approve
      await this.autoApprove(claim.id, rule.id, rule.name);
      return { approved: true, ruleId: rule.id, ruleName: rule.name };
    }

    return { approved: false, reason: 'no green-lane rule matched' };
  }

  private async autoApprove(claimId: string, ruleId: string, ruleName: string) {
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.claim.update({
        where: { id: claimId },
        data: {
          status: 'approved',
          workflowStage: 'payment_pending',
          approvedAt: now,
        },
      }),
      this.prisma.claimStatusHistory.create({
        data: {
          claimId,
          fromStatus: 'submitted',
          toStatus: 'approved',
          changedBy: 'system',
          reason: `AUTO_APPROVED_GREENLANE rule=${ruleId} (${ruleName})`,
        },
      }),
    ]);
    this.logger.log(`Claim ${claimId} auto-approved via green-lane rule "${ruleName}"`);
  }

  async createRule(dto: {
    name: string;
    minValue?: number;
    maxValue?: number;
    minOcrConfidence?: number;
    maxFraudScore?: number;
    requireNoSignals?: boolean;
    providerId?: string;
  }) {
    return this.prisma.greenLaneRule.create({ data: dto });
  }

  async listRules() {
    return this.prisma.greenLaneRule.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async updateRule(id: string, data: Partial<{
    name: string; isActive: boolean; maxValue: number; minOcrConfidence: number;
  }>) {
    return this.prisma.greenLaneRule.update({ where: { id }, data });
  }

  async deleteRule(id: string) {
    return this.prisma.greenLaneRule.delete({ where: { id } });
  }

  async setGlobalEnabled(enabled: boolean) {
    return this.prisma.systemConfig.upsert({
      where: { key: 'green_lane_enabled' },
      update: { value: String(enabled) },
      create: {
        key: 'green_lane_enabled',
        value: String(enabled),
        dataType: 'boolean',
        description: 'Master switch for green-lane auto-approval',
        category: 'workflow',
      },
    });
  }

  /** Daily summary: how many claims were auto-approved in the last 24 h */
  async dailySummary(date?: Date) {
    const from = date ?? new Date(Date.now() - 86_400_000);
    const entries = await this.prisma.claimStatusHistory.findMany({
      where: {
        reason: { startsWith: 'AUTO_APPROVED_GREENLANE' },
        createdAt: { gte: from },
      },
    });
    const byRule: Record<string, number> = {};
    for (const e of entries) {
      const match = e.reason?.match(/rule=(\S+)/);
      const key = match ? match[1] : 'unknown';
      byRule[key] = (byRule[key] ?? 0) + 1;
    }
    return { total: entries.length, byRule, from };
  }

  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async runDailySummaryLog() {
    const summary = await this.dailySummary();
    this.logger.log(`Green-lane daily summary: ${JSON.stringify(summary)}`);
  }
}
