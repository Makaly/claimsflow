import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Centralises data subject rights and consent handling so the auth controller
 * does not grow GDPR-specific Prisma calls inline. All methods accept the
 * acting user's id; callers must enforce authentication first.
 */
@Injectable()
export class GdprService {
  constructor(private prisma: PrismaService) {}

  // ─── Consent management (Art. 6, 7) ─────────────────────────────────────────

  async recordConsent(params: {
    userId: string;
    purpose: string;
    action: 'granted' | 'withdrawn';
    version?: string;
    ipAddress?: string;
    userAgent?: string;
    source?: string;
  }) {
    return this.prisma.consentRecord.create({ data: { ...params } });
  }

  async listConsents(userId: string) {
    return this.prisma.consentRecord.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async currentConsents(userId: string): Promise<Record<string, boolean>> {
    const rows = await this.listConsents(userId);
    const state: Record<string, boolean> = {};
    // Records are newest first; the first sighting of a purpose wins.
    for (const r of rows) {
      if (state[r.purpose] === undefined) state[r.purpose] = r.action === 'granted';
    }
    return state;
  }

  async withdrawConsent(userId: string, purpose: string, meta: { ipAddress?: string; userAgent?: string }) {
    return this.recordConsent({
      userId,
      purpose,
      action: 'withdrawn',
      source: 'consent_page',
      ...meta,
    });
  }

  // ─── Right of Access + Portability (Art. 15, 20) ────────────────────────────

  /**
   * Returns every record in the database that is linked to the requesting
   * user. The payload is intentionally structured (not a flat dump) so the
   * subject can read it without joining tables themselves.
   */
  async exportPersonalData(userId: string, requestMeta: { ipAddress?: string; userAgent?: string }) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, email: true, name: true, role: true, phone: true,
        jobTitle: true, department: true, location: true, timezone: true,
        language: true, bio: true, avatarUrl: true, createdAt: true,
        lastLogin: true, providerId: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');

    const [consents, claimsCreated, claimsAssigned, activityLogs, notifications, exports] = await Promise.all([
      this.prisma.consentRecord.findMany({ where: { userId } }),
      this.prisma.claim.findMany({ where: { createdBy: userId } }),
      this.prisma.claim.findMany({ where: { assignedTo: userId } }),
      this.prisma.activityLog.findMany({ where: { userId }, take: 1000, orderBy: { createdAt: 'desc' } }),
      this.prisma.notification.findMany({ where: { recipientId: userId } }),
      this.prisma.dataExportRequest.findMany({ where: { userId } }),
    ]);

    const payload = {
      generatedAt: new Date().toISOString(),
      subject: user,
      consents,
      claimsCreated,
      claimsAssigned,
      notifications,
      previousExports: exports,
      activityLogs,
      notice:
        'This export is provided pursuant to GDPR Art. 15 (right of access) and Art. 20 ' +
        '(data portability), and the equivalent rights under Kenya Data Protection Act ' +
        '2019 ss. 26 and 38. Keep this file secure — it contains personal data about you.',
    };
    const bytes = Buffer.byteLength(JSON.stringify(payload));
    await this.prisma.dataExportRequest.create({
      data: { userId, status: 'completed', bytes, ipAddress: requestMeta.ipAddress, userAgent: requestMeta.userAgent },
    });
    return payload;
  }

  // ─── Right to Erasure (Art. 17) ─────────────────────────────────────────────

  /**
   * Anonymises a user account. Identifying fields are scrubbed so the row
   * cannot be tied to a natural person, but the database row itself is kept
   * to preserve referential integrity of claims that fall under the Insurance
   * Act 2017 (Kenya) s.83 — minimum 7-year retention. Audit logs are kept
   * intact for forensic and regulatory purposes per KDPA s.30(2)(c).
   */
  async eraseAccount(userId: string, confirmation: string) {
    if (confirmation !== 'DELETE MY ACCOUNT') {
      throw new BadRequestException('Confirmation phrase did not match.');
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.deletedAt) throw new BadRequestException('Account is already erased.');

    const anon = `anonymised+${crypto.randomBytes(8).toString('hex')}@deleted.local`;
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        email: anon,
        name: 'Anonymised User',
        phone: null,
        jobTitle: null,
        department: null,
        location: null,
        timezone: null,
        language: null,
        bio: null,
        avatarUrl: null,
        twoFactorSecret: null,
        twoFactorEnabled: false,
        savedSignatures: [],
        passwordResetToken: null,
        passwordResetExpiry: null,
        // Password reset to a value that can never be matched (32 random bytes,
        // not bcrypt-formatted, so bcrypt.compare returns false even if reused).
        password: crypto.randomBytes(32).toString('hex'),
        isActive: false,
        deletedAt: new Date(),
      },
    });
    return {
      message:
        'Your account has been erased. Claim records may be retained for the period required ' +
        'by the Insurance Act 2017 and tax law, but they no longer identify you as a person.',
    };
  }

  // ─── Right of Objection / Human review (Art. 22) ────────────────────────────

  async requestDecisionReview(params: {
    userId: string;
    claimId?: string;
    decisionType: string;
    reason: string;
  }) {
    if (!params.reason || params.reason.trim().length < 5) {
      throw new BadRequestException('Please describe why you are requesting a human review.');
    }
    return this.prisma.decisionReviewRequest.create({ data: params });
  }

  async listDecisionReviews(userId: string) {
    return this.prisma.decisionReviewRequest.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
