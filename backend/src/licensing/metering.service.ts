import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LicenseCryptoService } from './license-crypto.service';
import { FeatureKey, MetricKey, PLANS, PlanId } from './plans';

export interface ResolvedEntitlements {
  tenantId: string | null;
  plan: PlanId;
  enforcement: 'report' | 'enforce';
  features: Set<string>;
  limits: Partial<Record<MetricKey, number>>;
  status: 'active' | 'grace' | 'expired' | 'revoked' | 'unlicensed';
  expiresAt: Date | null;
}

export interface QuotaCheck {
  metric: MetricKey;
  used: number;
  limit: number | null; // null = unlimited
  remaining: number | null;
  exceeded: boolean;
  /** True only when over limit AND enforcement='enforce'. report mode never blocks. */
  block: boolean;
}

/**
 * Runtime entitlement-resolution + usage-metering core. Everything keys off
 * `tenantId` (req.user.tenantId, set by JwtStrategy). A null tenantId = the
 * internal / single-tenant default, which falls back to the configured DEFAULT
 * plan. The signed token in the License row is re-verified on every resolve so
 * a tampered DB row can't grant entitlements.
 *
 * This is the metering half of the licensing module; lifecycle/admin lives in
 * LicenseService.
 */
@Injectable()
export class MeteringService {
  private readonly logger = new Logger(MeteringService.name);
  /** Plan used when a tenant has no valid license (internal/dev/trial). */
  private readonly defaultPlan: PlanId = 'enterprise';
  private readonly defaultEnforcement: 'report' | 'enforce' = 'report';

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: LicenseCryptoService,
  ) {}

  /** Current monthly bucket, e.g. "2026-06". */
  private currentPeriod(d = new Date()): string {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  /**
   * Resolve effective entitlements for a tenant: active license → verified
   * snapshot → grace/expiry policy → per-tenant Entitlement overrides.
   */
  async resolve(tenantId: string | null): Promise<ResolvedEntitlements> {
    const license = await this.prisma.license.findFirst({
      where: { tenantId, status: { in: ['active', 'grace'] } },
      orderBy: { issuedAt: 'desc' },
    });

    let plan: PlanId = this.defaultPlan;
    let enforcement = this.defaultEnforcement;
    let features = new Set<string>(PLANS[this.defaultPlan].features);
    let limits: Partial<Record<MetricKey, number>> = { ...PLANS[this.defaultPlan].limits };
    let status: ResolvedEntitlements['status'] = 'unlicensed';
    let expiresAt: Date | null = null;

    if (license) {
      const v = this.crypto.verify(license.token);
      if (v.valid && v.payload && v.payload.tenantId === tenantId) {
        const p = v.payload;
        plan = p.plan;
        enforcement = p.enforcement;
        features = new Set<string>(p.features);
        limits = { ...p.limits };
        expiresAt = p.exp ? new Date(p.exp * 1000) : null;
        status = this.lifecycle(expiresAt, license.graceDays);
        // Expired-past-grace → strip feature grants (read-only), keep metering.
        if (status === 'expired') features = new Set();
      } else {
        this.logger.warn(
          `License ${license.id} for tenant ${tenantId} failed re-verification (${v.reason}); using default plan`,
        );
      }
    }

    // Layer per-tenant overrides: allowed=false removes, allowed=true adds.
    const overrides = await this.prisma.entitlement.findMany({ where: { tenantId } });
    for (const o of overrides) {
      if (o.allowed) features.add(o.feature);
      else features.delete(o.feature);
    }

    return { tenantId, plan, enforcement, features, limits, status, expiresAt };
  }

  private lifecycle(expiresAt: Date | null, graceDays: number): ResolvedEntitlements['status'] {
    if (!expiresAt) return 'active'; // perpetual
    const now = Date.now();
    if (now <= expiresAt.getTime()) return 'active';
    const graceEnd = expiresAt.getTime() + graceDays * 86_400_000;
    return now <= graceEnd ? 'grace' : 'expired';
  }

  async hasFeature(tenantId: string | null, feature: FeatureKey | string): Promise<boolean> {
    const ent = await this.resolve(tenantId);
    return ent.features.has(feature);
  }

  /** Read-only quota check for the current period. Does NOT increment. */
  async checkQuota(tenantId: string | null, metric: MetricKey, want = 1): Promise<QuotaCheck> {
    const ent = await this.resolve(tenantId);
    const limit = ent.limits[metric] ?? null;
    const counter = await this.prisma.usageCounter.findUnique({
      where: { tenantId_metric_period: { tenantId, metric, period: this.currentPeriod() } },
    });
    const used = counter?.used ?? 0;
    const exceeded = limit !== null && used + want > limit;
    return {
      metric,
      used,
      limit,
      remaining: limit === null ? null : Math.max(0, limit - used),
      exceeded,
      block: exceeded && ent.enforcement === 'enforce',
    };
  }

  /**
   * Atomically increment usage for the current period. Snapshots the limit on
   * first write of the period so a later plan change can't retroactively breach.
   * Call AFTER the metered action succeeds.
   */
  async recordUsage(tenantId: string | null, metric: MetricKey, by = 1): Promise<void> {
    const period = this.currentPeriod();
    const ent = await this.resolve(tenantId);
    const limit = ent.limits[metric] ?? null;
    await this.prisma.usageCounter.upsert({
      where: { tenantId_metric_period: { tenantId, metric, period } },
      create: { tenantId, metric, period, used: by, limit },
      update: { used: { increment: by } },
    });
  }

  /** Live usage vs limits for the current period (used by summaries/dashboards). */
  async usageSummary(tenantId: string | null) {
    const ent = await this.resolve(tenantId);
    const period = this.currentPeriod();
    const counters = await this.prisma.usageCounter.findMany({ where: { tenantId, period } });
    const usage = (['claims', 'extractions', 'seats'] as MetricKey[]).map((m) => {
      const c = counters.find((x) => x.metric === m);
      const limit = ent.limits[m] ?? null;
      return { metric: m, used: c?.used ?? 0, limit };
    });
    return { tenantId, plan: ent.plan, status: ent.status, enforcement: ent.enforcement, expiresAt: ent.expiresAt, features: [...ent.features], period, usage };
  }

  /**
   * Install/activate a signed token for a tenant. Verifies signature, then
   * inserts a new License row and retires any prior active row (history kept).
   */
  async installToken(token: string): Promise<{ ok: boolean; reason?: string; licenseId?: string }> {
    const v = this.crypto.verify(token);
    if (!v.valid || !v.payload) return { ok: false, reason: v.reason ?? 'invalid' };
    const p = v.payload;

    const created = await this.prisma.$transaction(async (tx) => {
      await tx.license.updateMany({
        where: { tenantId: p.tenantId, status: { in: ['active', 'grace'] } },
        data: { status: 'expired' },
      });
      return tx.license.create({
        data: {
          id: p.lic,
          tenantId: p.tenantId,
          plan: p.plan,
          token,
          featuresJsonb: p.features,
          limitsJsonb: p.limits,
          enforcement: p.enforcement,
          issuedAt: new Date(p.iat * 1000),
          expiresAt: p.exp ? new Date(p.exp * 1000) : null,
          graceDays: p.graceDays,
          issuedTo: p.issuedTo,
          status: 'active',
          lastVerifiedAt: new Date(),
        },
      });
    });

    // Mirror the verified snapshot onto the tenant's live licence columns so the
    // LicenseGuard/FeatureGate fast-path and the admin UI stay in lock-step.
    if (p.tenantId) {
      await this.prisma.tenant
        .update({
          where: { id: p.tenantId },
          data: {
            plan: p.plan,
            licenseKey: created.id,
            licenseType: p.licenseType ?? 'PRO',
            licenseStartDate: new Date(p.iat * 1000),
            licenseExpiryDate: p.exp ? new Date(p.exp * 1000) : null,
            licenseStatus: 'ACTIVE',
            licensePausedAt: null,
            maxClaimsPerMonth: p.limits.claims ?? 999_999,
            maxExtractionsPerMonth: p.limits.extractions ?? 999_999,
            maxSeats: p.limits.seats ?? 999_999,
            enabledFeaturesJsonb: p.features,
          },
        })
        .catch((e) => this.logger.warn(`Tenant licence sync after install failed: ${e.message}`));
    }

    this.logger.log(`License ${created.id} installed for tenant ${p.tenantId} (plan=${p.plan})`);
    return { ok: true, licenseId: created.id };
  }

  async revoke(licenseId: string): Promise<void> {
    await this.prisma.license.update({ where: { id: licenseId }, data: { status: 'revoked' } });
  }

  /** Admin: list license history rows (newest first), optionally per-tenant. */
  async listLicenses(tenantId?: string | null) {
    return this.prisma.license.findMany({
      where: tenantId === undefined ? undefined : { tenantId },
      orderBy: { issuedAt: 'desc' },
      select: {
        id: true,
        tenantId: true,
        plan: true,
        enforcement: true,
        status: true,
        issuedTo: true,
        issuedAt: true,
        expiresAt: true,
        graceDays: true,
        lastVerifiedAt: true,
      },
    });
  }
}
