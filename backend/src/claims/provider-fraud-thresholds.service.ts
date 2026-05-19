import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

const GLOBAL_DEFAULT_HIGH = 0.6;
const FP_TOLERANCE = 0.05;
const FN_TOLERANCE = 0.05;

@Injectable()
export class ProviderFraudThresholdsService {
  private readonly logger = new Logger(ProviderFraudThresholdsService.name);
  private cache = new Map<string, { threshold: number; at: number }>();
  private readonly TTL_MS = 5 * 60 * 1000;

  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.providerFraudThreshold.findMany({
      include: { provider: { select: { id: true, name: true } } },
      orderBy: { computedAt: 'desc' },
    });
  }

  async findByProvider(providerId: string) {
    const row = await this.prisma.providerFraudThreshold.findUnique({
      where: { providerId },
      include: { provider: { select: { id: true, name: true } } },
    });
    if (!row) throw new NotFoundException(`No fraud threshold found for provider ${providerId}`);
    return row;
  }

  async upsert(providerId: string, threshold: number, overriddenBy: string) {
    this.cache.delete(providerId);
    return this.prisma.providerFraudThreshold.upsert({
      where: { providerId },
      create: {
        providerId,
        threshold,
        fpRate: 0,
        fnRate: 0,
        overriddenBy,
        overriddenAt: new Date(),
      },
      update: {
        threshold,
        overriddenBy,
        overriddenAt: new Date(),
      },
    });
  }

  async getThresholdForProvider(providerId: string | null | undefined): Promise<number> {
    if (!providerId) return GLOBAL_DEFAULT_HIGH;
    const hit = this.cache.get(providerId);
    const now = Date.now();
    if (hit && now - hit.at < this.TTL_MS) return hit.threshold;

    const row = await this.prisma.providerFraudThreshold.findUnique({ where: { providerId } });
    const value = row?.threshold ?? GLOBAL_DEFAULT_HIGH;
    this.cache.set(providerId, { threshold: value, at: now });
    return value;
  }

  /**
   * Sweep all providers with ≥30 labelled claims in the last 180 days. For
   * each, find the threshold that minimises FP+FN on the labelled set. Persist
   * the result so live scoring picks it up via getThresholdForProvider().
   *
   * Manual overrides (rows with overriddenAt set) are preserved.
   */
  @Cron(CronExpression.EVERY_1ST_DAY_OF_MONTH_AT_MIDNIGHT)
  async recomputeMonthly() {
    const since = new Date(Date.now() - 180 * 86_400_000);
    // Pre-built args silence Prisma's recursive WhereInput generics that trip
    // up `groupBy` type-checking in TS 5.x.
    const groupByArgs: any = {
      by: ['providerId'],
      where: { submittedAt: { gte: since }, fraudSignals: { not: null } },
      _count: { _all: true },
      having: { id: { _count: { gte: 30 } } },
    };
    const candidates = await (this.prisma.claim.groupBy as any)(groupByArgs)
      .catch(() => [] as Array<{ providerId: string }>);

    let updated = 0;
    for (const c of candidates as Array<{ providerId: string }>) {
      // ClaimLabel has no Prisma relation back to Claim (only a unique
      // claimId scalar), so fetch the relevant claim IDs first, then their
      // labels and fraudSignals separately.
      const claimsForProvider = await this.prisma.claim.findMany({
        where: { providerId: c.providerId, submittedAt: { gte: since } },
        select: { id: true, fraudSignals: true },
      }).catch(() => [] as Array<{ id: string; fraudSignals: any }>);

      if (claimsForProvider.length === 0) continue;

      const fraudSignalsByClaimId = new Map(
        claimsForProvider.map(cl => [cl.id, cl.fraudSignals] as const),
      );
      const labelRows = await this.prisma.claimLabel.findMany({
        where: { claimId: { in: claimsForProvider.map(cl => cl.id) } },
      }).catch(() => [] as Array<{ claimId: string; source: string; label: string }>);

      const labelled = labelRows.map(row => ({
        outcome: row.source,
        claim: { fraudSignals: fraudSignalsByClaimId.get(row.claimId) ?? null },
      }));

      if (labelled.length < 30) continue;

      const existing = await this.prisma.providerFraudThreshold.findUnique({
        where: { providerId: c.providerId },
      });
      if (existing?.overriddenAt) continue;

      const { threshold, fpRate, fnRate } = this.optimiseThreshold(labelled as any[]);
      await this.prisma.providerFraudThreshold.upsert({
        where: { providerId: c.providerId },
        create: { providerId: c.providerId, threshold, fpRate, fnRate },
        update: { threshold, fpRate, fnRate, computedAt: new Date() },
      });
      this.cache.delete(c.providerId);
      updated += 1;
    }
    this.logger.log(`Per-provider fraud thresholds recomputed: ${updated} providers updated.`);
    return { updated };
  }

  private optimiseThreshold(labelled: Array<{ outcome: string; claim: { fraudSignals: any } }>) {
    const points = labelled.map(l => {
      const signals = Array.isArray(l.claim?.fraudSignals) ? (l.claim.fraudSignals as any[]) : [];
      const score = Math.min(1, signals.length / 6);
      const isFraud = l.outcome === 'fraud_confirmed' || l.outcome === 'rejected';
      return { score, isFraud };
    });

    let best = { threshold: GLOBAL_DEFAULT_HIGH, fpRate: 1, fnRate: 1, cost: Number.POSITIVE_INFINITY };
    for (let t = 0.3; t <= 0.9; t += 0.05) {
      let fp = 0, fn = 0, tp = 0, tn = 0;
      for (const p of points) {
        const flagged = p.score >= t;
        if (flagged && !p.isFraud) fp += 1;
        else if (!flagged && p.isFraud) fn += 1;
        else if (flagged && p.isFraud) tp += 1;
        else tn += 1;
      }
      const fpRate = fp / Math.max(1, fp + tn);
      const fnRate = fn / Math.max(1, fn + tp);
      const cost = fpRate + 1.5 * fnRate;
      if (cost < best.cost && fpRate <= 0.3 + FP_TOLERANCE && fnRate <= 0.3 + FN_TOLERANCE) {
        best = { threshold: Number(t.toFixed(2)), fpRate, fnRate, cost };
      }
    }
    return { threshold: best.threshold, fpRate: best.fpRate, fnRate: best.fnRate };
  }

  invalidate(providerId?: string) {
    if (providerId) this.cache.delete(providerId);
    else this.cache.clear();
  }
}
