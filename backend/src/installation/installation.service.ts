import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { LicenseCryptoService } from '../licensing/license-crypto.service';

const DAY_MS = 86_400_000;

export interface InstallationStatus {
  mode: 'standalone' | 'managed';
  installationId: string;
  status: 'UNLICENSED' | 'ACTIVE' | 'LOCKED' | 'SUSPENDED' | 'REVOKED';
  locked: boolean;
  plan: string | null;
  leaseExpiresAt: string | null;
  lastValidatedAt: string | null;
  daysSinceValidation: number | null;
  lastError: string | null;
  reason?: string;
}

/**
 * Installation CLIENT (E8). Every deployed instance has a singleton local
 * identity (SystemInstallation). It activates with an online key, then phones
 * home to the license server (LICENSE_SERVER_URL) to refresh a short-lived
 * signed lease. Effective licence state is computed by verifying the cached
 * lease OFFLINE — so the 7-day "no internet → inactive" rule is simply the
 * lease expiring before a heartbeat could refresh it.
 *
 * When LICENSE_SERVER_URL is unset the node is in 'standalone' mode (dev / the
 * central server itself) and is never locked.
 */
@Injectable()
export class InstallationService {
  private readonly logger = new Logger(InstallationService.name);
  private readonly serverUrl?: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: LicenseCryptoService,
    private readonly config: ConfigService,
  ) {
    this.serverUrl = config.get<string>('LICENSE_SERVER_URL')?.replace(/\/+$/, '') || undefined;
  }

  isManaged(): boolean {
    return !!this.serverUrl;
  }

  /** Get the singleton local identity row, creating it (with a fresh id) on first call. */
  async identity() {
    const existing = await this.prisma.systemInstallation.findFirst({ where: { singleton: true } });
    if (existing) return existing;
    return this.prisma.systemInstallation.create({
      data: { id: randomUUID(), singleton: true, status: 'UNLICENSED' },
    });
  }

  /** Compute the live status from the cached lease (offline). */
  async status(): Promise<InstallationStatus> {
    const id = await this.identity();
    const base: InstallationStatus = {
      mode: this.isManaged() ? 'managed' : 'standalone',
      installationId: id.id,
      status: id.status as InstallationStatus['status'],
      locked: false,
      plan: id.plan,
      leaseExpiresAt: id.leaseExpiresAt?.toISOString() ?? null,
      lastValidatedAt: id.lastValidatedAt?.toISOString() ?? null,
      daysSinceValidation: id.lastValidatedAt ? Math.floor((Date.now() - id.lastValidatedAt.getTime()) / DAY_MS) : null,
      lastError: id.lastError,
    };

    // Standalone deployments (no server configured) never lock.
    if (!this.isManaged()) return { ...base, status: 'ACTIVE', locked: false, reason: 'standalone' };

    if (!id.leaseToken) return { ...base, status: 'UNLICENSED', locked: true, reason: 'not_activated' };

    const v = this.crypto.verifyLease(id.leaseToken);
    if (!v.valid || !v.payload) return { ...base, status: 'LOCKED', locked: true, reason: v.reason ?? 'invalid_lease' };
    if (v.payload.installationId !== id.id) return { ...base, status: 'LOCKED', locked: true, reason: 'lease_mismatch' };
    if (v.payload.status === 'REVOKED') return { ...base, status: 'REVOKED', locked: true, reason: 'revoked' };
    if (v.payload.status === 'SUSPENDED') return { ...base, status: 'SUSPENDED', locked: true, reason: 'suspended' };

    const now = Math.floor(Date.now() / 1000);
    if (v.payload.leaseExp < now) {
      return { ...base, status: 'LOCKED', locked: true, reason: 'lease_expired_offline' };
    }
    if (v.payload.termExp && v.payload.termExp < now) {
      return { ...base, status: 'LOCKED', locked: true, reason: 'term_expired' };
    }
    return { ...base, status: 'ACTIVE', locked: false, plan: v.payload.plan, leaseExpiresAt: new Date(v.payload.leaseExp * 1000).toISOString() };
  }

  async isLocked(): Promise<boolean> {
    try {
      return (await this.status()).locked;
    } catch (e) {
      // Fail OPEN on unexpected errors — never hard-lock the app over a bug.
      this.logger.warn(`Installation lock check failed; allowing: ${(e as Error).message}`);
      return false;
    }
  }

  /** Persist a lease response from the server onto the local identity row. */
  private async storeLease(idRow: { id: string }, data: { lease: string; leaseExpiresAt: string; plan: string; status: string; installSecret?: string; activationKey?: string }) {
    await this.prisma.systemInstallation.update({
      where: { id: idRow.id },
      data: {
        leaseToken: data.lease,
        leaseExpiresAt: new Date(data.leaseExpiresAt),
        plan: data.plan,
        status: data.status === 'ACTIVE' ? 'ACTIVE' : data.status,
        lastValidatedAt: new Date(),
        lastError: null,
        ...(data.installSecret ? { installSecret: data.installSecret } : {}),
        ...(data.activationKey ? { activationKey: data.activationKey } : {}),
      },
    });
  }

  /** Activate this installation with an online key against the license server. */
  async activate(activationKey: string, label?: string): Promise<InstallationStatus> {
    if (!this.isManaged()) throw new BadRequestException('LICENSE_SERVER_URL is not configured — node is standalone');
    if (!activationKey?.trim()) throw new BadRequestException('activationKey is required');
    const id = await this.identity();

    const res = await this.post('/license-server/activate', {
      activationKey: activationKey.trim(),
      installationId: id.id,
      hostname: process.env.HOSTNAME || undefined,
      version: process.env.APP_VERSION || undefined,
      label,
    });

    await this.storeLease(id, {
      lease: res.lease,
      leaseExpiresAt: res.leaseExpiresAt,
      plan: res.plan,
      status: res.status,
      installSecret: res.installSecret,
      activationKey: activationKey.trim(),
    });
    this.logger.log(`Installation ${id.id} activated (plan=${res.plan})`);
    return this.status();
  }

  /** Refresh the lease. Best-effort: a network failure leaves the cached lease in place. */
  async heartbeat(): Promise<{ ok: boolean; reason?: string }> {
    if (!this.isManaged()) return { ok: true, reason: 'standalone' };
    const id = await this.identity();
    if (!id.installSecret) return { ok: false, reason: 'not_activated' };

    try {
      const res = await this.post('/license-server/heartbeat', { installationId: id.id, version: process.env.APP_VERSION || undefined }, id.installSecret);
      await this.storeLease(id, { lease: res.lease, leaseExpiresAt: res.leaseExpiresAt, plan: res.plan, status: res.status });
      return { ok: true };
    } catch (e) {
      const msg = (e as Error).message;
      await this.prisma.systemInstallation.update({ where: { id: id.id }, data: { lastError: msg.slice(0, 250) } }).catch(() => undefined);
      this.logger.warn(`Heartbeat failed (lease stands until expiry): ${msg}`);
      return { ok: false, reason: msg };
    }
  }

  private async post(path: string, body: unknown, secret?: string): Promise<any> {
    const url = `${this.serverUrl}${path}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10_000);
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(secret ? { 'x-installation-secret': secret } : {}) },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      const text = await resp.text();
      const json = text ? JSON.parse(text) : {};
      if (!resp.ok) throw new Error(json?.message || `License server ${resp.status}`);
      return json;
    } finally {
      clearTimeout(t);
    }
  }
}
