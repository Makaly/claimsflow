import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { EmailService } from '../notifications/email.service';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private emailService: EmailService,
  ) {}

  async register(
    registerDto: RegisterDto,
    meta?: { ipAddress?: string; userAgent?: string },
  ) {
    const { email, password, name, role, policyVersion } = registerDto;

    // Check if user already exists
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      throw new UnauthorizedException('User already exists');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user and persist registration consent in the same transaction
    // so a half-created account can never exist without its consent record.
    const user = await this.prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
        role: role || 'user',
        consents: {
          create: [
            {
              purpose: 'terms_of_service',
              action: 'granted',
              version: policyVersion,
              source: 'registration',
              ipAddress: meta?.ipAddress,
              userAgent: meta?.userAgent,
            },
            {
              purpose: 'privacy_policy',
              action: 'granted',
              version: policyVersion,
              source: 'registration',
              ipAddress: meta?.ipAddress,
              userAgent: meta?.userAgent,
            },
          ],
        },
      },
    });

    const { password: _, ...result } = user;
    const access_token = this.generateToken(user.id, user.email);

    return {
      user: result,
      access_token,
    };
  }

  async login(loginDto: LoginDto) {
    const { email, password, rememberMe } = loginDto;

    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // GDPR Art. 17 — once a user has exercised right of erasure the account
    // row is kept for referential integrity only. Treat it as nonexistent.
    if (user.deletedAt) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Enforce account lockout — check before bcrypt to avoid wasting CPU
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const remaining = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
      throw new UnauthorizedException(
        `Account temporarily locked after repeated failed attempts. Try again in ${remaining} minute(s).`,
      );
    }

    // Check isActive before bcrypt so we don't reset the lockout counter for
    // inactive accounts or waste CPU on the hash comparison.
    if (!user.isActive) {
      throw new UnauthorizedException('Account is inactive');
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      const attempts = (user.failedLoginAttempts ?? 0) + 1;
      const LOCKOUT_THRESHOLD = 5;
      const LOCKOUT_MINUTES = 15;
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: attempts,
          ...(attempts >= LOCKOUT_THRESHOLD && {
            lockedUntil: new Date(Date.now() + LOCKOUT_MINUTES * 60_000),
          }),
        },
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    // Reset lockout state and record login time on success
    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null, lastLogin: new Date() },
    });

    const { password: _, ...result } = user;
    const access_token = this.generateToken(user.id, user.email);

    return {
      user: { ...result, failedLoginAttempts: 0, lockedUntil: null },
      access_token,
      rememberMe: !!rememberMe,
    };
  }

  async validateUser(email: string, password: string): Promise<any> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) return null;
    if (user.deletedAt) return null;
    if (!user.isActive) return null;
    if (user.lockedUntil && user.lockedUntil > new Date()) return null;

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      const attempts = (user.failedLoginAttempts ?? 0) + 1;
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: attempts,
          ...(attempts >= 5 && { lockedUntil: new Date(Date.now() + 15 * 60_000) }),
        },
      });
      return null;
    }

    const { password: _, ...result } = user;
    return result;
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const { password: _, ...result } = user;
    return result;
  }

  async updateProfile(
    userId: string,
    data: {
      name?: string;
      phone?: string;
      jobTitle?: string;
      title?: string;         // frontend field name for jobTitle
      department?: string;
      location?: string;
      timezone?: string;
      language?: string;
      bio?: string;
      avatarUrl?: string;
    },
  ) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.phone !== undefined && { phone: data.phone }),
        ...((data.jobTitle ?? data.title) !== undefined && {
          jobTitle: data.jobTitle ?? data.title,
        }),
        ...(data.department !== undefined && { department: data.department }),
        ...(data.location !== undefined && { location: data.location }),
        ...(data.timezone !== undefined && { timezone: data.timezone }),
        ...(data.language !== undefined && { language: data.language }),
        ...(data.bio !== undefined && { bio: data.bio }),
        ...(data.avatarUrl !== undefined && { avatarUrl: data.avatarUrl }),
      },
    });
    const { password: _, ...result } = user;
    return result;
  }

  async registerProvider(
    dto: {
      // Provider fields
      providerName: string; type: string; licenseNumber: string
      phone: string; email: string; physicalAddress: string
      contactPerson: string; city?: string; region?: string
      // Admin user fields
      adminName: string; adminEmail: string; adminPassword: string
      // GDPR / KDPA consent — required at registration.
      acceptTerms: boolean
      policyVersion?: string
    },
    meta?: { ipAddress?: string; userAgent?: string },
  ) {
    if (!dto.acceptTerms) {
      throw new BadRequestException('You must accept the Terms of Service and Privacy Policy to register.')
    }
    const existing = await this.prisma.user.findUnique({ where: { email: dto.adminEmail } })
    if (existing) throw new UnauthorizedException('A user with this email already exists')

    // Create provider (pending approval)
    const provider = await this.prisma.provider.create({
      data: {
        name: dto.providerName,
        type: dto.type,
        licenseNumber: dto.licenseNumber,
        phone: dto.phone,
        email: dto.email,
        physicalAddress: dto.physicalAddress,
        contactPerson: dto.contactPerson,
        city: dto.city,
        region: dto.region,
        status: 'pending',
        approvalStatus: 'pending_approval',
        alternatePhone: '',
      },
    })

    // Create admin user linked to provider, with the same audit-grade
    // consent rows the staff registration flow records.
    const hashed = await bcrypt.hash(dto.adminPassword, 10)
    const user = await this.prisma.user.create({
      data: {
        name: dto.adminName,
        email: dto.adminEmail,
        password: hashed,
        role: 'provider_admin',
        providerId: provider.id,
        consents: {
          create: [
            {
              purpose: 'terms_of_service',
              action: 'granted',
              version: dto.policyVersion,
              source: 'registration',
              ipAddress: meta?.ipAddress,
              userAgent: meta?.userAgent,
            },
            {
              purpose: 'privacy_policy',
              action: 'granted',
              version: dto.policyVersion,
              source: 'registration',
              ipAddress: meta?.ipAddress,
              userAgent: meta?.userAgent,
            },
          ],
        },
      },
    })

    const { password: _, ...userResult } = user

    // Send welcome email — fire-and-forget so a mail failure doesn't break registration
    this.emailService.sendProviderWelcomeEmail({
      adminEmail: dto.adminEmail,
      adminName: dto.adminName,
      providerName: dto.providerName,
      loginUrl: process.env.APP_URL || 'http://localhost:3000',
    }).catch(() => {});

    return {
      user: userResult,
      provider,
      access_token: this.generateToken(user.id, user.email),
      message: 'Provider account created. Awaiting approval.',
    }
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');

    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) throw new UnauthorizedException('Current password is incorrect');

    const hashed = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashed, requirePasswordChange: false },
    });
    return { message: 'Password updated successfully' };
  }

  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    // Always return success to prevent email enumeration
    if (!user || !user.isActive) return { message: 'If that email exists, a reset link has been sent.' };

    const token = crypto.randomBytes(32).toString('hex');
    const expiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordResetToken: token, passwordResetExpiry: expiry },
    });

    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    const resetUrl = `${appUrl}/reset-password?token=${token}`;

    await this.emailService.sendPasswordResetEmail({ email, name: user.name, resetUrl }).catch(() => {});

    return { message: 'If that email exists, a reset link has been sent.' };
  }

  async resetPassword(token: string, newPassword: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        passwordResetToken: token,
        passwordResetExpiry: { gt: new Date() },
      },
    });

    if (!user) throw new BadRequestException('Invalid or expired reset token.');

    if (newPassword.length < 8) throw new BadRequestException('Password must be at least 8 characters.');

    const hashed = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { password: hashed, passwordResetToken: null, passwordResetExpiry: null, requirePasswordChange: false },
    });

    return { message: 'Password reset successfully. You can now log in.' };
  }

  // E3: SSO — create or update a local user from an IdP profile.
  // Matching is always by email so a user who previously signed in with a
  // password can seamlessly transition to SSO without a new account.
  async findOrCreateSsoUser(profile: {
    email: string;
    name: string;
    provider: 'oidc' | 'saml' | 'mock';
    externalId: string;
  }) {
    const existing = await this.prisma.user.findUnique({ where: { email: profile.email } });
    if (existing) {
      if (!existing.isActive) throw new UnauthorizedException('Account is deactivated');
      await this.prisma.user.update({
        where: { id: existing.id },
        data: { lastLogin: new Date() },
      });
      return existing;
    }

    // Provision new user. SSO users get a random unusable password; they can
    // never log in via the local form — the IdP is the single source of truth.
    const dummyPassword = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
    return this.prisma.user.create({
      data: {
        email: profile.email,
        name: profile.name,
        password: dummyPassword,
        role: 'user',
        isActive: true,
        lastLogin: new Date(),
      },
    });
  }

  // E3: IdP leaver webhook — deactivate the local user when IdP fires the
  // off-boarding event (e.g. Azure AD "User deleted" lifecycle notification).
  async deactivateSsoUser(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) return { message: 'User not found — no action taken' };
    await this.prisma.user.update({
      where: { id: user.id },
      data: { isActive: false },
    });
    return { message: 'User deactivated', userId: user.id };
  }

  private generateToken(userId: string, email: string): string {
    const payload = { sub: userId, email };
    return this.jwtService.sign(payload);
  }
}
