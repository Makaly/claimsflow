import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { LicenseCryptoService, InstallationLeasePayload } from '../licensing/license-crypto.service';
import { PLANS, PlanId } from '../licensing/plans';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

interface ActivateInput {
  activationKey: string;
  installationId: string;
  hostname?: string;
  version?: string;
  label?: string;
  ip?: string;
}

interface HeartbeatInput {
  installationId: string;
  secret: string;
  version?: string;
  ip?: string;
}

export interface LeaseResponse {
  installationId: string;
  status: string;
  plan: string;
  features: string[];
  limits: Record<string, number>;
  expiresAt: string | null;
  leaseExpiresAt: string;
  lease: string;
  /** Returned ONCE, on activation only. */
  installSecret?: string;
}

/**
 * License-SERVER registry (E8). Runs on the central CIC node (the one holding
 * LICENSE_PRIVATE_KEY). Mints activation keys, activates installations, and
 * issues short-lived signed leases on every heartbeat so a deployment that goes
 * offline past its lease TTL can no longer prove it is licensed.
 */
@Injectable()
export class InstallationRegistryService {
  private readonly logger = new Logger(InstallationRegistryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: LicenseCryptoService,
  ) {}

  private sha(s: string): string {
    return createHash('sha256').update(s).digest('hex');
  }

  private planFeatures(plan: PlanId): string[] {
    return (PLANS[plan]?.features ?? PLANS.core.features) as string[];
  }

  private planLimits(plan: PlanId): Record<string, number> {
    return { ...(PLANS[plan]?.limits ?? PLANS.core.limits) } as Record<string, number>;
  }

  /** Build + sign a lease for an installation row. Returns null if no private key. */
  private issueLease(inst: {
    id: string;
    plan: string;
    status: string;
    featuresJsonb: unknown;
    limitsJsonb: unknown;
    leaseTtlHours: number;
    expiresAt: Date | null;
  }): { token: string; leaseExp: number } | null {
    const now = Math.floor(Date.now() / 1000);
    const leaseExp = now + inst.leaseTtlHours * 3600;
    const payload: InstallationLeasePayload = {
      typ: 'lease',
      installationId: inst.id,
      plan: inst.plan,
      features: Array.isArray(inst.featuresJsonb) ? (inst.featuresJsonb as string[]) : this.planFeatures(inst.plan as PlanId),
      limits: (inst.limitsJsonb && typeof inst.limitsJsonb === 'object' ? inst.limitsJsonb : this.planLimits(inst.plan as PlanId)) as Record<string, number>,
      status: (inst.status === 'ACTIVE' ? 'ACTIVE' : inst.status === 'SUSPENDED' ? 'SUSPENDED' : 'REVOKED'),
      iat: now,
      leaseExp,
      termExp: inst.expiresAt ? Math.floor(inst.expiresAt.getTime() / 1000) : null,
    };
    const token = this.crypto.signLease(payload);
    return token ? { token, leaseExp } : null;
  }

  // ── Admin: activation keys ────────────────────────────────────────────────

  async generateKeys(input: { plan?: PlanId; count?: number; termDays?: number; maxActivations?: number; issuedTo?: string; expiresAt?: string }, createdBy?: string) {
    const plan = (input.plan ?? 'core') as PlanId;
    if (!PLANS[plan]) throw new BadRequestException(`Unknown plan '${plan}'`);
    const count = Math.min(Math.max(1, input.count ?? 1), 100);
    const keys = [];
    for (let i = 0; i < count; i++) {
      const key = this.formatKey(plan);
      keys.push(
        await this.prisma.activationKey.create({
          data: {
            key,
            plan,
            termDays: input.termDays ?? 365,
            maxActivations: input.maxActivations ?? 1,
            issuedTo: input.issuedTo,
            expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
            createdBy,
          },
        }),
      );
    }
    this.logger.log(`Generated ${count} activation key(s) for plan=${plan}`);
    return keys;
  }

  private formatKey(plan: PlanId): string {
    const block = () => randomBytes(2).toString('hex').toUpperCase();
    return `CICX-${plan.toUpperCase()}-${block()}-${block()}-${block()}-${block()}`;
  }

  listKeys() {
    return this.prisma.activationKey.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async revokeKey(id: string) {
    return this.prisma.activationKey.update({ where: { id }, data: { status: 'REVOKED' } });
  }

  // ── Machine: activate ─────────────────────────────────────────────────────

  async activate(input: ActivateInput): Promise<LeaseResponse> {
    if (!input.activationKey || !input.installationId) {
      throw new BadRequestException('activationKey and installationId are required');
    }
    const key = await this.prisma.activationKey.findUnique({ where: { key: input.activationKey } });
    if (!key) throw new NotFoundException('Invalid activation key');
    if (key.status === 'REVOKED') throw new ForbiddenException('Activation key has been revoked');
    if (key.expiresAt && key.expiresAt.getTime() < Date.now()) throw new ForbiddenException('Activation key has expired');
    if (key.usedCount >= key.maxActivations && key.boundInstallationId !== input.installationId) {
      throw new ForbiddenException('Activation key has reached its activation limit');
    }

    const plan = key.plan as PlanId;
    const now = new Date();
    const termExp = key.termDays > 0 ? new Date(now.getTime() + key.termDays * DAY_MS) : null;
    const secret = randomBytes(24).toString('hex');

    const inst = await this.prisma.installation.upsert({
      where: { id: input.installationId },
      create: {
        id: input.installationId,
        label: input.label,
        hostname: input.hostname,
        version: input.version,
        plan,
        status: 'ACTIVE',
        featuresJsonb: this.planFeatures(plan),
        limitsJsonb: this.planLimits(plan),
        secretHash: this.sha(secret),
        activationKey: key.key,
        lastSeenAt: now,
        lastSeenIp: input.ip,
        expiresAt: termExp,
      },
      update: {
        plan,
        status: 'ACTIVE',
        featuresJsonb: this.planFeatures(plan),
        limitsJsonb: this.planLimits(plan),
        secretHash: this.sha(secret),
        activationKey: key.key,
        hostname: input.hostname,
        version: input.version,
        lastSeenAt: now,
        lastSeenIp: input.ip,
        expiresAt: termExp,
      },
    });

    await this.prisma.activationKey.update({
      where: { id: key.id },
      data: {
        status: 'USED',
        usedCount: key.boundInstallationId === input.installationId ? key.usedCount : key.usedCount + 1,
        boundInstallationId: input.installationId,
      },
    });

    const lease = this.issueLease(inst);
    if (!lease) throw new BadRequestException('License server is not configured to sign leases (missing private key)');

    this.logger.log(`Installation ${inst.id} activated on plan=${plan}`);
    return {
      installationId: inst.id,
      status: inst.status,
      plan,
      features: this.planFeatures(plan),
      limits: this.planLimits(plan),
      expiresAt: termExp ? termExp.toISOString() : null,
      leaseExpiresAt: new Date(lease.leaseExp * 1000).toISOString(),
      lease: lease.token,
      installSecret: secret,
    };
  }

  // ── Machine: heartbeat ────────────────────────────────────────────────────

  async heartbeat(input: HeartbeatInput): Promise<LeaseResponse> {
    const inst = await this.prisma.installation.findUnique({ where: { id: input.installationId } });
    if (!inst) throw new NotFoundException('Installation not registered');
    if (!inst.secretHash || this.sha(input.secret ?? '') !== inst.secretHash) {
      throw new UnauthorizedException('Invalid installation secret');
    }

    // Auto-expire the term.
    let status = inst.status;
    if (status === 'ACTIVE' && inst.expiresAt && inst.expiresAt.getTime() < Date.now()) {
      status = 'EXPIRED';
    }

    const updated = await this.prisma.installation.update({
      where: { id: inst.id },
      data: { lastSeenAt: new Date(), lastSeenIp: input.ip, version: input.version ?? inst.version, status },
    });

    const lease = this.issueLease(updated);
    if (!lease) throw new BadRequestException('License server cannot sign leases (missing private key)');

    return {
      installationId: updated.id,
      status: updated.status,
      plan: updated.plan,
      features: Array.isArray(updated.featuresJsonb) ? (updated.featuresJsonb as string[]) : [],
      limits: (updated.limitsJsonb as Record<string, number>) ?? {},
      expiresAt: updated.expiresAt ? updated.expiresAt.toISOString() : null,
      leaseExpiresAt: new Date(lease.leaseExp * 1000).toISOString(),
      lease: lease.token,
    };
  }

  // ── Admin: installations ──────────────────────────────────────────────────

  listInstallations() {
    return this.prisma.installation.findMany({ orderBy: { lastSeenAt: 'desc' } });
  }

  async getInstallation(id: string) {
    const inst = await this.prisma.installation.findUnique({ where: { id } });
    if (!inst) throw new NotFoundException('Installation not found');
    return inst;
  }

  async setStatus(id: string, status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED') {
    await this.getInstallation(id);
    const inst = await this.prisma.installation.update({ where: { id }, data: { status } });
    this.logger.log(`Installation ${id} status set to ${status}`);
    return inst;
  }

  /** Mark an installation offline if its last heartbeat is older than its lease TTL. */
  async dashboard() {
    const all = await this.prisma.installation.findMany();
    const now = Date.now();
    const byStatus: Record<string, number> = {};
    let online = 0;
    let stale = 0;
    for (const i of all) {
      byStatus[i.status] = (byStatus[i.status] ?? 0) + 1;
      const ageMs = i.lastSeenAt ? now - i.lastSeenAt.getTime() : Infinity;
      if (ageMs <= i.leaseTtlHours * HOUR_MS) online += 1;
      else stale += 1;
    }
    const keys = await this.prisma.activationKey.groupBy({ by: ['status'], _count: true }).catch(() => []);
    return { total: all.length, online, stale, byStatus, keys };
  }
}
