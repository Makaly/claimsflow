import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  LicenseStatus,
  LicenseType,
  PLAN_LICENSE_DEFAULTS,
  PLANS,
  PlanId,
  planForLicenseType,
  TIER_MATRIX,
  UNLIMITED,
} from './plans';

const DAY_MS = 86_400_000;

/** The computed, UI-facing view of a tenant's current licence. */
export interface LicenseInfo {
  tenantId: string;
  tenantName: string;
  licenseKey: string | null;
  plan: PlanId;
  licenseType: LicenseType;
  licenseStartDate: Date;
  licenseExpiryDate: Date | null;
  licenseStatus: LicenseStatus;
  licensePausedAt: Date | null;
  daysRemaining: number | null;
  isExpired: boolean;
  isPaused: boolean;
  isReadOnly: boolean;
  maxSeats: number;
  maxClaimsPerMonth: number;
  maxExtractionsPerMonth: number;
  features: string[];
}

export interface ApplyLicenseInput {
  licenseType: LicenseType;
  /** Override the catalog term. 0 = perpetual. */
  durationDays?: number;
  /** Pre-issued key (e.g. from the mint CLI); generated if omitted. */
  licenseKey?: string;
  /** Explicit expiry (e.g. tied to an invoice period); wins over durationDays. */
  expiresAt?: Date | null;
  issuedTo?: string;
}

/**
 * Core licence lifecycle service — mirrors the helpdesk `licenseService`,
 * adapted to ClaimsFlow's multi-tenant NestJS/Prisma 7 stack. Owns key
 * generation, applying licences to tenants, status computation (with
 * auto-expiry), trial creation/extension, low-level pause/resume state
 * transitions, and the admin dashboard. Cryptographic token verification and
 * usage metering live in their sibling services.
 */
@Injectable()
export class LicenseService {
  private readonly logger = new Logger(LicenseService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** The public marketing/feature manifest (also served at GET /licenses/tiers). */
  tierMatrix() {
    return TIER_MATRIX;
  }

  /**
   * Cosmetic, human-quotable licence key:
   *   CIC-{TYPE}-{4hex}-{4hex}-{4hex}-{4hex}-{CHK}
   * The checksum is the first 4 chars of sha256(body), uppercased. This is a
   * display/lookup key — the cryptographic source of truth is the signed token
   * (see LicenseCryptoService); the tenant row is the live state.
   */
  generateLicenseKey(type: LicenseType): string {
    const block = () => randomBytes(2).toString('hex').toUpperCase();
    const body = `CIC-${type}-${block()}-${block()}-${block()}-${block()}`;
    const checksum = createHash('sha256').update(body).digest('hex').slice(0, 4).toUpperCase();
    return `${body}-${checksum}`;
  }

  /** Days remaining until expiry (null = perpetual, ≤0 clamps to 0). */
  private daysRemaining(expiry: Date | null): number | null {
    if (!expiry) return null;
    return Math.max(0, Math.ceil((expiry.getTime() - Date.now()) / DAY_MS));
  }

  /**
   * The central status resolver. Reads the tenant row, computes derived state,
   * and AUTO-FLIPS an ACTIVE licence to EXPIRED in the DB once its term has
   * passed (so a stale ACTIVE row can never grant write access). Read-only =
   * expired; paused (SUSPENDED) is surfaced separately.
   */
  async getLicenseInfo(tenantId: string): Promise<LicenseInfo> {
    const t = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!t) throw new NotFoundException('Tenant not found');

    const now = Date.now();
    const expiry = t.licenseExpiryDate ?? null;
    const termPassed = !!expiry && now > expiry.getTime();
    let status = t.licenseStatus as LicenseStatus;

    if (status === 'ACTIVE' && termPassed) {
      status = 'EXPIRED';
      await this.prisma.tenant
        .update({ where: { id: tenantId }, data: { licenseStatus: 'EXPIRED' } })
        .catch((e) => this.logger.warn(`Auto-expire flip failed for ${tenantId}: ${e.message}`));
    }

    const isExpired = status === 'EXPIRED' || (status === 'ACTIVE' && termPassed);
    const isPaused = status === 'SUSPENDED';

    return {
      tenantId: t.id,
      tenantName: t.name,
      licenseKey: t.licenseKey,
      plan: t.plan as PlanId,
      licenseType: t.licenseType as LicenseType,
      licenseStartDate: t.licenseStartDate,
      licenseExpiryDate: expiry,
      licenseStatus: status,
      licensePausedAt: t.licensePausedAt,
      daysRemaining: this.daysRemaining(expiry),
      isExpired,
      isPaused,
      isReadOnly: isExpired,
      maxSeats: t.maxSeats,
      maxClaimsPerMonth: t.maxClaimsPerMonth,
      maxExtractionsPerMonth: t.maxExtractionsPerMonth,
      features: Array.isArray(t.enabledFeaturesJsonb)
        ? (t.enabledFeaturesJsonb as string[])
        : PLANS[t.plan as PlanId].features,
    };
  }

  /** Whether the tenant may perform write operations right now. Fails OPEN. */
  async canWrite(tenantId: string | null): Promise<boolean> {
    if (!tenantId) return true; // internal/single-tenant default
    try {
      const info = await this.getLicenseInfo(tenantId);
      return !info.isExpired && !info.isPaused;
    } catch (e) {
      this.logger.warn(`canWrite check failed for ${tenantId}; failing open: ${(e as Error).message}`);
      return true;
    }
  }

  /**
   * Apply (activate/renew) a licence on a tenant. Writes the live state columns,
   * snapshots the plan's feature list, and records a row in the `licenses`
   * history table. Enforces licence-key uniqueness across tenants.
   */
  async applyLicense(tenantId: string, input: ApplyLicenseInput): Promise<LicenseInfo> {
    const t = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!t) throw new NotFoundException('Tenant not found');

    const defaults = PLAN_LICENSE_DEFAULTS[input.licenseType];
    if (!defaults) throw new ConflictException(`Unknown licenseType '${input.licenseType}'`);
    const plan: PlanId = defaults.plan;

    const key = input.licenseKey ?? this.generateLicenseKey(input.licenseType);
    const keyHolder = await this.prisma.tenant.findFirst({
      where: { licenseKey: key, id: { not: tenantId } },
      select: { id: true },
    });
    if (keyHolder) throw new ConflictException('Licence key is already in use by another tenant');

    const now = new Date();
    let expiry: Date | null;
    if (input.expiresAt !== undefined) {
      expiry = input.expiresAt;
    } else {
      const days = input.durationDays ?? defaults.durationDays;
      expiry = days > 0 ? new Date(now.getTime() + days * DAY_MS) : null;
    }

    const features = PLANS[plan].features as string[];

    await this.prisma.$transaction([
      this.prisma.tenant.update({
        where: { id: tenantId },
        data: {
          plan,
          licenseKey: key,
          licenseType: input.licenseType,
          licenseStartDate: now,
          licenseExpiryDate: expiry,
          licenseStatus: 'ACTIVE',
          licensePausedAt: null,
          maxSeats: defaults.maxSeats,
          maxClaimsPerMonth: defaults.maxClaimsPerMonth,
          maxExtractionsPerMonth: defaults.maxExtractionsPerMonth,
          enabledFeaturesJsonb: features,
        },
      }),
      // Keep a history row in `licenses`. token left empty here — signed-token
      // installs go through MeteringService.installToken / the mint flow.
      this.prisma.license.create({
        data: {
          tenantId,
          plan,
          token: '',
          featuresJsonb: features,
          limitsJsonb: {
            claims: defaults.maxClaimsPerMonth,
            extractions: defaults.maxExtractionsPerMonth,
            seats: defaults.maxSeats,
          },
          enforcement: 'report',
          issuedAt: now,
          expiresAt: expiry,
          issuedTo: input.issuedTo ?? t.name,
          status: 'active',
          lastVerifiedAt: now,
        },
      }),
    ]);

    this.logger.log(`Licence ${input.licenseType} (${plan}) applied to tenant ${tenantId}, expires ${expiry?.toISOString() ?? 'never'}`);
    return this.getLicenseInfo(tenantId);
  }

  /**
   * Apply a licence whose term matches a paid invoice period (expiry = periodTo)
   * so the licence timeline lines up with what the customer paid for.
   */
  async applyLicenseFromInvoice(
    tenantId: string,
    licenseType: LicenseType,
    _periodFrom: Date,
    periodTo: Date,
    issuedTo?: string,
  ): Promise<LicenseInfo> {
    return this.applyLicense(tenantId, { licenseType, expiresAt: periodTo, issuedTo });
  }

  /** Create a 14-day TRIAL licence (called at tenant registration). */
  async createTrialLicense(tenantId: string): Promise<LicenseInfo> {
    return this.applyLicense(tenantId, { licenseType: 'TRIAL' });
  }

  /**
   * Extend a TRIAL by N days (max 365). Resumes from max(now, current expiry)
   * so an already-lapsed trial doesn't lose the full extension.
   */
  async extendTrial(tenantId: string, days: number): Promise<LicenseInfo> {
    const info = await this.getLicenseInfo(tenantId);
    if (info.licenseType !== 'TRIAL') throw new ConflictException('Only TRIAL licences can be extended this way');
    const add = Math.min(Math.max(1, Math.floor(days)), 365);
    const base = info.licenseExpiryDate && info.licenseExpiryDate.getTime() > Date.now()
      ? info.licenseExpiryDate.getTime()
      : Date.now();
    const expiry = new Date(base + add * DAY_MS);
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { licenseExpiryDate: expiry, licenseStatus: 'ACTIVE' },
    });
    this.logger.log(`Trial for tenant ${tenantId} extended ${add}d → ${expiry.toISOString()}`);
    return this.getLicenseInfo(tenantId);
  }

  /** Low-level pause: flip ACTIVE → SUSPENDED and stamp licensePausedAt. */
  async pauseLicense(tenantId: string): Promise<LicenseInfo> {
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { licenseStatus: 'SUSPENDED', licensePausedAt: new Date() },
    });
    return this.getLicenseInfo(tenantId);
  }

  /**
   * Low-level resume: flip SUSPENDED → ACTIVE and credit the paused days back
   * onto the expiry so paid time isn't lost. Returns the days credited.
   */
  async resumeLicense(tenantId: string): Promise<{ info: LicenseInfo; daysPaused: number }> {
    const t = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!t) throw new NotFoundException('Tenant not found');
    let daysPaused = 0;
    let newExpiry = t.licenseExpiryDate;
    if (t.licensePausedAt && t.licenseExpiryDate) {
      daysPaused = Math.ceil((Date.now() - t.licensePausedAt.getTime()) / DAY_MS);
      newExpiry = new Date(t.licenseExpiryDate.getTime() + daysPaused * DAY_MS);
    }
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { licenseStatus: 'ACTIVE', licensePausedAt: null, licenseExpiryDate: newExpiry },
    });
    this.logger.log(`Licence resumed for tenant ${tenantId}; credited ${daysPaused} paused day(s)`);
    return { info: await this.getLicenseInfo(tenantId), daysPaused };
  }

  /** Revoke a tenant's licence (hard stop). */
  async revokeLicense(tenantId: string): Promise<LicenseInfo> {
    await this.prisma.tenant.update({ where: { id: tenantId }, data: { licenseStatus: 'REVOKED' } });
    return this.getLicenseInfo(tenantId);
  }

  /** Every tenant's licence state (admin/overview). */
  async getAllLicenses(): Promise<LicenseInfo[]> {
    const tenants = await this.prisma.tenant.findMany({ orderBy: { name: 'asc' } });
    return Promise.all(tenants.map((t) => this.getLicenseInfo(t.id)));
  }

  /** Aggregate licence analytics for the admin dashboard. */
  async dashboard() {
    const all = await this.getAllLicenses();
    const byStatus = { ACTIVE: 0, EXPIRED: 0, SUSPENDED: 0, REVOKED: 0 } as Record<LicenseStatus, number>;
    const byPlan: Record<string, number> = { core: 0, pro: 0, enterprise: 0 };
    let trial = 0;
    let paid = 0;
    const expiringSoon7: LicenseInfo[] = [];
    const expiringSoon14: LicenseInfo[] = [];

    for (const l of all) {
      byStatus[l.licenseStatus] = (byStatus[l.licenseStatus] ?? 0) + 1;
      byPlan[l.plan] = (byPlan[l.plan] ?? 0) + 1;
      if (l.licenseType === 'TRIAL') trial += 1;
      else paid += 1;
      if (l.daysRemaining !== null && !l.isExpired) {
        if (l.daysRemaining <= 7) expiringSoon7.push(l);
        if (l.daysRemaining <= 14) expiringSoon14.push(l);
      }
    }

    const [pendingPauseRequests, draftInvoices] = await Promise.all([
      this.prisma.licensePauseRequest.count({ where: { status: 'PENDING' } }),
      this.prisma.licenseBillingInvoice.count({ where: { status: { in: ['DRAFT', 'SENT'] } } }),
    ]);

    return {
      total: all.length,
      byStatus,
      byPlan,
      trial,
      paid,
      expiringSoon7: expiringSoon7.map((l) => ({ tenantId: l.tenantId, tenantName: l.tenantName, daysRemaining: l.daysRemaining, plan: l.plan })),
      expiringSoon14Count: expiringSoon14.length,
      pendingPauseRequests,
      draftInvoices,
      unlimited: UNLIMITED,
    };
  }
}
