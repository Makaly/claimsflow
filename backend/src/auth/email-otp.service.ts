import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../notifications/email.service';

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60 * 1000; // 1 minute between sends per user

@Injectable()
export class EmailOtpService {
  private readonly logger = new Logger(EmailOtpService.name);

  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
  ) {}

  /**
   * Generates a fresh 6-digit code, stores its bcrypt hash, and emails the
   * plaintext to the user. Any unconsumed tokens for the same user are
   * invalidated (set consumedAt=now) so only the newest code is valid.
   */
  async sendOtp(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.emailVerifiedAt) {
      // Idempotent — no-op if already verified.
      return { sent: false, alreadyVerified: true };
    }

    // Rate-limit resends: refuse if the latest unconsumed token is younger
    // than the cooldown window.
    const recent = await this.prisma.emailVerificationToken.findFirst({
      where: { userId, purpose: 'email_verification', consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (recent && recent.createdAt.getTime() > Date.now() - RESEND_COOLDOWN_MS) {
      const secondsLeft = Math.ceil(
        (recent.createdAt.getTime() + RESEND_COOLDOWN_MS - Date.now()) / 1000,
      );
      throw new BadRequestException(
        `Please wait ${secondsLeft}s before requesting another code.`,
      );
    }

    // Invalidate older outstanding tokens so only the new one can succeed.
    await this.prisma.emailVerificationToken.updateMany({
      where: { userId, purpose: 'email_verification', consumedAt: null },
      data: { consumedAt: new Date() },
    });

    const code = this.generateCode();
    const codeHash = await bcrypt.hash(code, 10);
    await this.prisma.emailVerificationToken.create({
      data: {
        userId,
        email: user.email,
        codeHash,
        purpose: 'email_verification',
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
      },
    });

    // Fire-and-forget — a transient SMTP failure shouldn't block the API call.
    // The user can retry via the resend endpoint.
    this.emailService
      .sendEmailVerificationOtp({ email: user.email, name: user.name, code })
      .catch((err) => this.logger.warn(`OTP email send failed: ${err?.message ?? err}`));

    return { sent: true, expiresInSeconds: OTP_TTL_MS / 1000 };
  }

  /**
   * Verifies a code against the newest outstanding token for this user.
   * On success, marks the user's email as verified. On failure, increments
   * the attempts counter and burns the token after MAX_ATTEMPTS.
   */
  async verifyOtp(userId: string, code: string) {
    if (!/^\d{6}$/.test(code)) {
      throw new BadRequestException('Code must be 6 digits.');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.emailVerifiedAt) {
      return { verified: true, alreadyVerified: true };
    }

    const token = await this.prisma.emailVerificationToken.findFirst({
      where: { userId, purpose: 'email_verification', consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!token) {
      throw new BadRequestException('No active verification code. Request a new one.');
    }
    if (token.expiresAt < new Date()) {
      await this.prisma.emailVerificationToken.update({
        where: { id: token.id },
        data: { consumedAt: new Date() },
      });
      throw new BadRequestException('Code has expired. Request a new one.');
    }
    if (token.attempts >= MAX_ATTEMPTS) {
      await this.prisma.emailVerificationToken.update({
        where: { id: token.id },
        data: { consumedAt: new Date() },
      });
      throw new BadRequestException('Too many attempts. Request a new code.');
    }

    const ok = await bcrypt.compare(code, token.codeHash);
    if (!ok) {
      await this.prisma.emailVerificationToken.update({
        where: { id: token.id },
        data: { attempts: token.attempts + 1 },
      });
      const remaining = MAX_ATTEMPTS - (token.attempts + 1);
      throw new BadRequestException(
        remaining > 0
          ? `Incorrect code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`
          : 'Incorrect code. No attempts remaining — request a new code.',
      );
    }

    // Success — burn the token and stamp the user.
    await this.prisma.$transaction([
      this.prisma.emailVerificationToken.update({
        where: { id: token.id },
        data: { consumedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: { emailVerifiedAt: new Date() },
      }),
    ]);

    return { verified: true };
  }

  /**
   * Sends a one-time code for an *action* OTP flow — login 2FA on a new device,
   * or confirming a password change. Unlike [sendOtp] this neither requires nor
   * touches `emailVerifiedAt`: it's for already-verified users proving they
   * still control the inbox. Codes are scoped by [purpose] so the three OTP
   * flows can't consume each other's tokens.
   */
  async sendActionOtp(userId: string, purpose: 'login' | 'password_change') {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const recent = await this.prisma.emailVerificationToken.findFirst({
      where: { userId, purpose, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (recent && recent.createdAt.getTime() > Date.now() - RESEND_COOLDOWN_MS) {
      const secondsLeft = Math.ceil(
        (recent.createdAt.getTime() + RESEND_COOLDOWN_MS - Date.now()) / 1000,
      );
      throw new BadRequestException(
        `Please wait ${secondsLeft}s before requesting another code.`,
      );
    }

    await this.prisma.emailVerificationToken.updateMany({
      where: { userId, purpose, consumedAt: null },
      data: { consumedAt: new Date() },
    });

    const code = this.generateCode();
    const codeHash = await bcrypt.hash(code, 10);
    await this.prisma.emailVerificationToken.create({
      data: {
        userId,
        email: user.email,
        codeHash,
        purpose,
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
      },
    });

    this.emailService
      .sendSecurityCode({
        email: user.email,
        name: user.name,
        code,
        reason: purpose === 'login' ? 'login' : 'password change',
      })
      .catch((err) => this.logger.warn(`Action OTP email send failed: ${err?.message ?? err}`));

    return { sent: true, expiresInSeconds: OTP_TTL_MS / 1000 };
  }

  /**
   * Verifies an action OTP ([purpose] = login / password_change). Mirrors
   * [verifyOtp]'s expiry/attempt/burn logic but is scoped by purpose and never
   * stamps `emailVerifiedAt`. Throws [BadRequestException] on any failure;
   * consumes the token on success.
   */
  async verifyActionOtp(userId: string, code: string, purpose: 'login' | 'password_change') {
    if (!/^\d{6}$/.test(code)) {
      throw new BadRequestException('Code must be 6 digits.');
    }

    const token = await this.prisma.emailVerificationToken.findFirst({
      where: { userId, purpose, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!token) {
      throw new BadRequestException('No active code. Request a new one.');
    }
    if (token.expiresAt < new Date()) {
      await this.prisma.emailVerificationToken.update({
        where: { id: token.id },
        data: { consumedAt: new Date() },
      });
      throw new BadRequestException('Code has expired. Request a new one.');
    }
    if (token.attempts >= MAX_ATTEMPTS) {
      await this.prisma.emailVerificationToken.update({
        where: { id: token.id },
        data: { consumedAt: new Date() },
      });
      throw new BadRequestException('Too many attempts. Request a new code.');
    }

    const ok = await bcrypt.compare(code, token.codeHash);
    if (!ok) {
      await this.prisma.emailVerificationToken.update({
        where: { id: token.id },
        data: { attempts: token.attempts + 1 },
      });
      const remaining = MAX_ATTEMPTS - (token.attempts + 1);
      throw new BadRequestException(
        remaining > 0
          ? `Incorrect code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`
          : 'Incorrect code. No attempts remaining — request a new code.',
      );
    }

    await this.prisma.emailVerificationToken.update({
      where: { id: token.id },
      data: { consumedAt: new Date() },
    });
    return { verified: true };
  }

  private generateCode(): string {
    // crypto.randomInt gives a cryptographically strong 0..999999 sample.
    const n = crypto.randomInt(0, 1_000_000);
    return n.toString().padStart(6, '0');
  }
}
