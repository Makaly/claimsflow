import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sign as edSign, verify as edVerify } from 'crypto';
import { FeatureKey, LicenseType, MetricKey, PlanId } from './plans';

/**
 * The payload signed into a license token. This is the contract between the
 * issuer (the mint CLI, run by CIC) and every deployment — cloud or on-prem.
 * Verified offline against the embedded public key, so no deployment ever has
 * to phone home.
 */
export interface LicensePayload {
  /** License id (uuid) — lets us revoke by id later. */
  lic: string;
  /** Tenant this license is bound to. null = global/internal default. */
  tenantId: string | null;
  /** Human-readable licensee, e.g. "CIC Insurance Group PLC". */
  issuedTo: string;
  plan: PlanId;
  licenseType: LicenseType;
  features: FeatureKey[];
  limits: Partial<Record<MetricKey, number>>;
  enforcement: 'report' | 'enforce';
  /** Unix seconds. */
  iat: number;
  /** Unix seconds; null = perpetual (discouraged — prefer a term). */
  exp: number | null;
  /** Days past exp before hard lock; the system stays usable (read-only) in grace. */
  graceDays: number;
}

export interface VerifiedLicense {
  valid: boolean;
  reason?: string;
  payload?: LicensePayload;
}

/**
 * Short-lived installation LEASE (E8 phone-home model). The central license
 * server signs one on every activation/heartbeat; the installation caches it
 * and verifies offline against the public key. `leaseExp` is the hard cutoff —
 * if the install can't obtain a fresh lease before it passes (≈7 days with no
 * internet), it can no longer prove it is licensed and locks itself.
 */
export interface InstallationLeasePayload {
  typ: 'lease';
  installationId: string;
  plan: string;
  features: string[];
  limits: Record<string, number>;
  status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED';
  /** Unix seconds, issued-at. */
  iat: number;
  /** Unix seconds — lease expiry (the offline cutoff, default now + 7 days). */
  leaseExp: number;
  /** Unix seconds — licence term end, or null for perpetual. */
  termExp: number | null;
}

export interface VerifiedLease {
  valid: boolean;
  reason?: string;
  payload?: InstallationLeasePayload;
}

/**
 * Ed25519 license signing/verification.
 *
 * - The PUBLIC key (LICENSE_PUBLIC_KEY, PEM) ships with every deployment and is
 *   used to VERIFY tokens at runtime. Safe to commit/bundle.
 * - The PRIVATE key (LICENSE_PRIVATE_KEY, PEM) lives ONLY on the issuer machine
 *   / a secret store and is used by the mint CLI to SIGN. Never deploy it.
 *
 * Token wire format:  base64url(JSON payload) + "." + base64url(signature)
 */
@Injectable()
export class LicenseCryptoService {
  private readonly logger = new Logger(LicenseCryptoService.name);
  private readonly publicKey?: string;

  constructor(private readonly config: ConfigService) {
    // Support escaped newlines in env (Render/K8s secrets are single-line).
    this.publicKey = config.get<string>('LICENSE_PUBLIC_KEY')?.replace(/\\n/g, '\n');
    if (!this.publicKey) {
      this.logger.warn(
        'LICENSE_PUBLIC_KEY not set — license tokens cannot be verified. ' +
          'Runtime will fall back to the default/internal plan.',
      );
    }
  }

  /** Verify a token signature + decode its payload. Pure crypto — no DB, no clock policy. */
  verify(token: string): VerifiedLicense {
    if (!this.publicKey) return { valid: false, reason: 'no_public_key' };
    try {
      const [payloadB64, sigB64] = token.split('.');
      if (!payloadB64 || !sigB64) return { valid: false, reason: 'malformed' };

      const payloadJson = Buffer.from(payloadB64, 'base64url');
      const signature = Buffer.from(sigB64, 'base64url');

      // Ed25519: pass null algorithm to crypto.verify.
      const ok = edVerify(null, payloadJson, this.publicKey, signature);
      if (!ok) return { valid: false, reason: 'bad_signature' };

      const payload = JSON.parse(payloadJson.toString('utf8')) as LicensePayload;
      return { valid: true, payload };
    } catch (err) {
      this.logger.warn(`License verify failed: ${(err as Error).message}`);
      return { valid: false, reason: 'verify_error' };
    }
  }

  /**
   * Sign a payload into a token. Used by the mint CLI, NOT at runtime.
   * `privateKeyPem` is passed in by the CLI so the server image never needs it.
   */
  static sign(payload: LicensePayload, privateKeyPem: string): string {
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = edSign(null, Buffer.from(payloadB64, 'base64url'), privateKeyPem);
    return `${payloadB64}.${signature.toString('base64url')}`;
  }

  // ── Installation lease (E8) ───────────────────────────────────────────────

  /**
   * Sign an installation lease. Runs ONLY on the central license server (it
   * holds LICENSE_PRIVATE_KEY). Same wire format as licence tokens.
   */
  signLease(payload: InstallationLeasePayload): string | null {
    const privateKey = this.config.get<string>('LICENSE_PRIVATE_KEY')?.replace(/\\n/g, '\n');
    if (!privateKey) {
      this.logger.error('LICENSE_PRIVATE_KEY not set — cannot sign installation leases on this node.');
      return null;
    }
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = edSign(null, Buffer.from(payloadB64, 'base64url'), privateKey);
    return `${payloadB64}.${signature.toString('base64url')}`;
  }

  /** Verify a lease signature + decode it. Pure crypto — no clock policy here. */
  verifyLease(token: string): VerifiedLease {
    if (!this.publicKey) return { valid: false, reason: 'no_public_key' };
    try {
      const [payloadB64, sigB64] = token.split('.');
      if (!payloadB64 || !sigB64) return { valid: false, reason: 'malformed' };
      const payloadJson = Buffer.from(payloadB64, 'base64url');
      const signature = Buffer.from(sigB64, 'base64url');
      if (!edVerify(null, payloadJson, this.publicKey, signature)) {
        return { valid: false, reason: 'bad_signature' };
      }
      const payload = JSON.parse(payloadJson.toString('utf8')) as InstallationLeasePayload;
      if (payload.typ !== 'lease') return { valid: false, reason: 'wrong_type' };
      return { valid: true, payload };
    } catch (err) {
      this.logger.warn(`Lease verify failed: ${(err as Error).message}`);
      return { valid: false, reason: 'verify_error' };
    }
  }
}
