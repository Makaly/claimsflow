import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';
import * as speakeasy from 'speakeasy';
import * as QRCode from 'qrcode';

@Injectable()
export class TwoFactorService {
  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {}

  async generateSecret(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');

    const secret = speakeasy.generateSecret({
      name: `CIC Claims (${user.email})`,
      issuer: 'CIC Insurance',
      length: 32,
    });

    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorSecret: secret.base32, twoFactorEnabled: false },
    });

    const qrCodeDataUrl = await QRCode.toDataURL(secret.otpauth_url);
    return { secret: secret.base32, qrCode: qrCodeDataUrl, manualEntryKey: secret.base32 };
  }

  async enable2FA(userId: string, token: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');
    if (!user.twoFactorSecret) throw new BadRequestException('2FA secret not generated');

    const isValid = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: 'base32',
      token,
      window: 2,
    });
    if (!isValid) throw new UnauthorizedException('Invalid verification code');

    const backupCodes = this.generateBackupCodes();
    const hashedCodes = await Promise.all(backupCodes.map((c) => bcrypt.hash(c, 10)));

    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: true, savedSignatures: hashedCodes as any },
    });

    return { enabled: true, backupCodes, message: 'Two-factor authentication enabled. Save your backup codes.' };
  }

  async disable2FA(userId: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) throw new UnauthorizedException('Invalid password');

    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: false, twoFactorSecret: null, savedSignatures: [] as any },
    });

    return { enabled: false, message: 'Two-factor authentication disabled' };
  }

  async verify2FAToken(userId: string, token: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.twoFactorSecret) return false;

    if (token.length === 8 && /^[A-Z0-9]{8}$/.test(token)) {
      return this.verifyBackupCode(userId, token, user);
    }

    return speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: 'base32',
      token,
      window: 2,
    });
  }

  async sendSmsCode(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.phone) throw new BadRequestException('Phone number not set for this account');
    return { message: 'SMS-based 2FA requires the SMS provider to be configured', phone: user.phone };
  }

  async verifySmsCode(userId: string, code: string): Promise<boolean> {
    return false;
  }

  async getRemainingBackupCodes(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { savedSignatures: true } });
    const codes: string[] = Array.isArray(user?.savedSignatures) ? user.savedSignatures as string[] : [];
    return { count: codes.length };
  }

  async regenerateBackupCodes(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.twoFactorEnabled) throw new BadRequestException('2FA not enabled');

    const backupCodes = this.generateBackupCodes();
    const hashedCodes = await Promise.all(backupCodes.map((c) => bcrypt.hash(c, 10)));
    await this.prisma.user.update({
      where: { id: userId },
      data: { savedSignatures: hashedCodes as any },
    });

    return { backupCodes, message: 'Backup codes regenerated. Save these codes.' };
  }

  async get2FAStatus(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { twoFactorEnabled: true, phone: true, savedSignatures: true },
    });
    if (!user) throw new BadRequestException('User not found');

    const codes: string[] = Array.isArray(user.savedSignatures) ? user.savedSignatures as string[] : [];
    return { enabled: user.twoFactorEnabled, hasPhoneNumber: !!user.phone, remainingBackupCodes: codes.length };
  }

  private generateBackupCodes(): string[] {
    return Array.from({ length: 10 }, () =>
      Math.random().toString(36).substring(2, 10).toUpperCase(),
    );
  }

  private async verifyBackupCode(userId: string, code: string, user: any): Promise<boolean> {
    const hashedCodes: string[] = Array.isArray(user.savedSignatures) ? user.savedSignatures : [];
    for (let i = 0; i < hashedCodes.length; i++) {
      if (await bcrypt.compare(code, hashedCodes[i])) {
        hashedCodes.splice(i, 1);
        await this.prisma.user.update({
          where: { id: userId },
          data: { savedSignatures: hashedCodes as any },
        });
        return true;
      }
    }
    return false;
  }
}
