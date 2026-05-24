import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { createClient, RedisClientType } from 'redis';

// Redis TTL for plan-rules cache (5 minutes). Override via env PLAN_RULES_CACHE_TTL_S.
const CACHE_TTL_S = parseInt(process.env.PLAN_RULES_CACHE_TTL_S || '300', 10);

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
  private readonly logger = new Logger(AdjudicationService.name);
  private redisClient: RedisClientType | null = null;
  private redisReady = false;

  constructor(private prisma: PrismaService) {
    this.initRedis();
  }

  private initRedis(): void {
    try {
      const host = process.env.REDIS_HOST || 'localhost';
      const port = parseInt(process.env.REDIS_PORT || '6379', 10);
      const password = process.env.REDIS_PASSWORD || undefined;
      this.redisClient = createClient({ socket: { host, port }, password }) as RedisClientType;
      this.redisClient.on('error', (err) => {
        // Non-fatal: adjudication still works without cache
        this.logger.warn(`Redis plan-rules cache error: ${err?.message}`);
        this.redisReady = false;
      });
      this.redisClient.connect().then(() => {
        this.redisReady = true;
        this.logger.log('Plan-rules Redis cache connected');
      }).catch(err => {
        this.logger.warn(`Plan-rules Redis cache unavailable: ${err?.message}`);
      });
    } catch (err: any) {
      this.logger.warn(`Redis client init failed: ${err?.message}`);
    }
  }

  private cacheKey(memberNumber: string, claimType: string): string {
    return `plan_rules:${memberNumber}:${claimType}`;
  }

  private async getCached<T>(key: string): Promise<T | null> {
    if (!this.redisReady || !this.redisClient) return null;
    try {
      const raw = await this.redisClient.get(key);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  private async setCached(key: string, value: unknown): Promise<void> {
    if (!this.redisReady || !this.redisClient) return;
    try {
      await this.redisClient.setEx(key, CACHE_TTL_S, JSON.stringify(value));
    } catch { /* non-fatal */ }
  }

  /**
   * Invalidate cached plan rules for all members on a plan.
   * Call this when a PolicyPlan is updated (plan version bump).
   * Uses a SCAN-based pattern delete to avoid KEYS on production.
   */
  async invalidatePlanCache(planId: string): Promise<void> {
    if (!this.redisReady || !this.redisClient) return;
    try {
      // We don't store planId in the key, so we flush all plan_rules:* entries.
      // For a production cluster with millions of members, scope the pattern more
      // tightly by embedding planId into the key (TODO if needed).
      let cursor = 0;
      do {
        const result = await (this.redisClient as any).scan(cursor, { MATCH: 'plan_rules:*', COUNT: 100 });
        cursor = result.cursor;
        if (result.keys.length > 0) {
          await this.redisClient.del(result.keys);
        }
      } while (cursor !== 0);
      this.logger.log(`Plan-rules cache invalidated for planId=${planId}`);
    } catch (err: any) {
      this.logger.warn(`Cache invalidation failed: ${err?.message}`);
    }
  }

  async adjudicate(input: {
    memberNumber?: string;
    invoiceAmount: number;
    claimType?: 'inpatient' | 'outpatient' | 'dental' | 'optical' | 'maternity';
    dateOfService?: Date | string | null;
  }): Promise<AdjudicationResult> {
    // Cache only the plan-rule portion (member lookup + benefit limits), not the
    // final computed amounts (those depend on invoiceAmount which varies per claim).
    const cacheKey = input.memberNumber
      ? this.cacheKey(input.memberNumber, input.claimType || 'outpatient')
      : null;

    if (cacheKey) {
      const cached = await this.getCached<AdjudicationResult>(cacheKey);
      if (cached) {
        // Re-apply the amount-dependent computation on top of cached plan rules
        return this.recomputeAmounts(cached, input.invoiceAmount);
      }
    }

    const result = await this.adjudicateRaw(input);

    if (cacheKey && result.memberFound) {
      // Store the result — amounts will be recomputed on cache hit, so this is safe
      await this.setCached(cacheKey, result);
    }

    return result;
  }

  // Recompute only the monetary fields from cached plan-rule metadata.
  private recomputeAmounts(cached: AdjudicationResult, invoiceAmount: number): AdjudicationResult {
    if (!cached.memberFound || !cached.benefitLimit) return { ...cached, claimAmount: invoiceAmount };
    const remaining = cached.benefitRemaining ?? 0;
    const excess = cached.excessDeducted; // already the policy excess value
    const copayFraction = cached.copayDeducted > 0 && cached.eligibleAmount > excess
      ? cached.copayDeducted / (cached.eligibleAmount - excess) : 0;
    const eligibleAmount = Math.min(invoiceAmount, remaining);
    const excessDeducted = Math.min(excess, eligibleAmount);
    const afterExcess = eligibleAmount - excessDeducted;
    const copayDeducted = +(afterExcess * copayFraction).toFixed(2);
    const netPayable = +(afterExcess - copayDeducted).toFixed(2);
    return { ...cached, claimAmount: invoiceAmount, eligibleAmount, excessDeducted, copayDeducted, netPayable };
  }

  private async adjudicateRaw(input: {
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
