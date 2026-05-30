import { Injectable, UnauthorizedException, BadRequestException, ForbiddenException, ConflictException, Inject, forwardRef } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { EmailService } from '../notifications/email.service';
import { EventsGateway } from '../notifications/events.gateway';
import { EmailOtpService } from './email-otp.service';

/** Login refusal when the user's email has not been verified yet. We throw
 *  a 403 (not 401) so the frontend can distinguish "wrong password" from
 *  "verify your inbox first" and route to the OTP screen instead of showing
 *  an invalid-credentials error. */
export class EmailNotVerifiedException extends ForbiddenException {
  constructor(public readonly userEmail: string) {
    super({ statusCode: 403, message: 'Email not verified', code: 'email_not_verified', email: userEmail });
  }
}

/** PR2 — login refusal when a provider_user is awaiting approval from their
 *  provider's admin. Frontend shows a "waiting for approval" screen rather
 *  than the generic invalid-credentials error. */
export class PendingProviderApprovalException extends ForbiddenException {
  constructor(public readonly providerName: string | null) {
    super({ statusCode: 403, message: 'Awaiting provider approval', code: 'pending_provider_approval', providerName });
  }
}

/** PR2 — login refusal when a provider_user was rejected by their provider
 *  admin. Reason is included so the frontend can show it. */
export class ProviderApprovalRejectedException extends ForbiddenException {
  constructor(public readonly reason: string | null) {
    super({ statusCode: 403, message: 'Provider rejected your access', code: 'provider_rejected', reason });
  }
}

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private emailService: EmailService,
    @Inject(forwardRef(() => EmailOtpService))
    private emailOtpService: EmailOtpService,
    private eventsGateway: EventsGateway,
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
      // 409 Conflict, not 401: this is a duplicate-resource error and
      // returning 401 would trick the global axios interceptor into
      // logging the anonymous user out and bouncing them to /login.
      throw new ConflictException('A user with this email already exists');
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

    // PR1 — kick off the OTP email. We deliberately do NOT issue an access
    // token here; the caller must verify their email via /auth/verify-email-otp,
    // which mints the token. Returning a token now would let an attacker who
    // grabbed someone else's email proceed without proving ownership.
    await this.emailOtpService.sendOtp(user.id).catch(() => undefined);

    return {
      user: result,
      requiresEmailVerification: true,
      message: 'Account created. Check your email for the 6-digit verification code.',
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

    // PR1 — block login when the user's email has never been verified.
    // The 403 carries the email so the frontend can immediately send a
    // fresh OTP and route to the verification screen.
    if (!user.emailVerifiedAt) {
      // Trigger a fresh OTP send so the user doesn't have to click "resend".
      this.emailOtpService.sendOtp(user.id).catch(() => undefined);
      throw new EmailNotVerifiedException(user.email);
    }

    // PR2 — block login for provider users that haven't been approved by
    // their provider's admin yet. Internal staff have providerApprovalStatus
    // = null so they pass through.
    if (user.providerApprovalStatus === 'pending') {
      const providerName = user.providerId
        ? (await this.prisma.provider.findUnique({ where: { id: user.providerId }, select: { name: true } }))?.name ?? null
        : null;
      throw new PendingProviderApprovalException(providerName);
    }
    if (user.providerApprovalStatus === 'rejected') {
      throw new ProviderApprovalRejectedException(user.providerRejectionReason);
    }

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
      contactPerson: string; city?: string; region?: string; country?: string
      // PR1 — extra company-profile fields (procurement spec items a, b).
      // All optional at registration; the provider completes them in the
      // onboarding wizard before submitting for approval.
      companyStructure?: 'sole_proprietorship' | 'partnership' | 'registered_company'
      registrationNumber?: string
      kraPin?: string
      incorporationDate?: string
      numberOfPartners?: number
      ownerName?: string
      ownerIdNumber?: string
      yearsProvidingServices?: number
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
    if (existing) throw new ConflictException('A user with this email already exists')

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
        country: dto.country,
        status: 'pending',
        approvalStatus: 'pending_approval',
        alternatePhone: '',
        companyStructure: dto.companyStructure,
        registrationNumber: dto.registrationNumber,
        kraPin: dto.kraPin,
        incorporationDate: dto.incorporationDate ? new Date(dto.incorporationDate) : undefined,
        numberOfPartners: dto.numberOfPartners,
        ownerName: dto.ownerName,
        ownerIdNumber: dto.ownerIdNumber,
        yearsProvidingServices: dto.yearsProvidingServices,
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

    // Welcome email — fire-and-forget so a mail failure doesn't break registration
    this.emailService.sendProviderWelcomeEmail({
      adminEmail: dto.adminEmail,
      adminName: dto.adminName,
      providerName: dto.providerName,
      loginUrl: process.env.APP_URL || 'http://localhost:3000',
    }).catch(() => {});

    // PR1 — send the 6-digit OTP. The frontend immediately routes to the
    // verification screen and does not get a session token until the user
    // proves they own the inbox.
    this.emailOtpService.sendOtp(user.id).catch(() => undefined);

    // Notify every admin / claims_officer that a new provider is waiting.
    // Failure to deliver these alerts must not break the registration flow.
    this.notifyAdminsOfNewProvider({
      providerName: dto.providerName,
      providerType: dto.type,
      contactPerson: dto.contactPerson,
      contactEmail: dto.adminEmail,
    }).catch(() => undefined);
    // Real-time bell badge for any reviewer who is currently signed in.
    this.eventsGateway.emitProviderPending({
      providerId: provider.id,
      providerName: provider.name,
      providerType: provider.type,
    });

    return {
      user: userResult,
      provider,
      requiresEmailVerification: true,
      message: 'Provider account created. Check your email for a 6-digit code to verify your address.',
    }
  }

  /**
   * PR2 — register a normal user under an existing approved provider.
   * Creates the user in `pending` provider-approval state, sends an OTP for
   * email verification, and notifies the provider's admins. Login is blocked
   * until BOTH the email is verified AND a provider admin approves the user.
   */
  async registerUserUnderProvider(
    dto: {
      name: string;
      email: string;
      password: string;
      providerId: string;
      phone?: string;
      acceptTerms: boolean;
      policyVersion?: string;
    },
    meta?: { ipAddress?: string; userAgent?: string },
  ) {
    if (!dto.acceptTerms) {
      throw new BadRequestException('You must accept the Terms of Service and Privacy Policy to register.');
    }
    if (!dto.providerId) {
      throw new BadRequestException('Please select a provider to register under.');
    }
    if (dto.password.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters.');
    }

    // Verify the chosen provider is real and currently accepting new users.
    const provider = await this.prisma.provider.findUnique({
      where: { id: dto.providerId },
      select: { id: true, name: true, approvalStatus: true, isActive: true },
    });
    if (!provider || provider.approvalStatus !== 'approved' || !provider.isActive) {
      throw new BadRequestException('Provider is not available for new user registration.');
    }

    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('A user with this email already exists');

    const hashed = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: {
        name: dto.name,
        email: dto.email,
        password: hashed,
        phone: dto.phone,
        role: 'provider_user',
        providerId: provider.id,
        // Approval gate — provider_admin must approve before login is allowed.
        providerApprovalStatus: 'pending',
        consents: {
          create: [
            { purpose: 'terms_of_service', action: 'granted', version: dto.policyVersion, source: 'registration', ipAddress: meta?.ipAddress, userAgent: meta?.userAgent },
            { purpose: 'privacy_policy', action: 'granted', version: dto.policyVersion, source: 'registration', ipAddress: meta?.ipAddress, userAgent: meta?.userAgent },
          ],
        },
      },
    });
    const { password: _p, ...userResult } = user;

    // Email OTP — required to prove inbox ownership.
    await this.emailOtpService.sendOtp(user.id).catch(() => undefined);

    // Alert this provider's admins (provider_admin role attached to the same providerId)
    this.notifyProviderAdminsOfNewUser({
      providerId: provider.id,
      providerName: provider.name,
      userName: user.name,
      userEmail: user.email,
    }).catch(() => undefined);
    // Real-time bell badge for the provider's admins.
    this.prisma.user.findMany({
      where: {
        providerId: provider.id,
        role: 'provider_admin',
        isActive: true, deletedAt: null,
        providerApprovalStatus: 'approved',
      },
      select: { id: true },
    }).then((admins) => {
      this.eventsGateway.emitUserPending(
        admins.map((a) => a.id),
        { providerId: provider.id, providerName: provider.name, userId: user.id, userName: user.name, userEmail: user.email },
      );
    }).catch(() => undefined);

    return {
      user: userResult,
      provider: { id: provider.id, name: provider.name },
      requiresEmailVerification: true,
      requiresProviderApproval: true,
      message: 'Account created. Verify your email, then wait for your provider to approve access.',
    };
  }

  /** Email every provider_admin attached to this provider. */
  private async notifyProviderAdminsOfNewUser(meta: {
    providerId: string; providerName: string; userName: string; userEmail: string;
  }) {
    const admins = await this.prisma.user.findMany({
      where: {
        providerId: meta.providerId,
        role: 'provider_admin',
        isActive: true,
        deletedAt: null,
        // Don't email admins who themselves haven't been approved/verified.
        providerApprovalStatus: 'approved',
        emailVerifiedAt: { not: null },
      },
      select: { email: true, name: true },
    });
    if (!admins.length) return;
    const reviewUrl = `${process.env.APP_URL || 'http://localhost:3000'}/provider-users`;
    await Promise.allSettled(
      admins.map((a) =>
        this.emailService.sendProviderUserPendingAlert({
          adminEmail: a.email,
          adminName: a.name,
          providerName: meta.providerName,
          userName: meta.userName,
          userEmail: meta.userEmail,
          reviewUrl,
        }),
      ),
    );
  }

  /** Fan-out new-provider alert to every admin + claims_officer. Internal
   *  helper used by registerProvider. */
  private async notifyAdminsOfNewProvider(meta: {
    providerName: string; providerType: string; contactPerson: string; contactEmail: string;
  }) {
    const admins = await this.prisma.user.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        OR: [{ role: 'admin' }, { role: 'claims_officer' }],
      },
      select: { email: true, name: true },
    });
    if (!admins.length) return;
    const reviewUrl = `${process.env.APP_URL || 'http://localhost:3000'}/provider-approvals`;
    await Promise.allSettled(
      admins.map(a =>
        this.emailService.sendAdminNewProviderAlert({
          adminEmail: a.email,
          adminName: a.name,
          providerName: meta.providerName,
          providerType: meta.providerType,
          contactPerson: meta.contactPerson,
          contactEmail: meta.contactEmail,
          reviewUrl,
        }),
      ),
    );
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

  /** Public token-mint helper used by the OTP-verification endpoint to log
   *  the user in immediately after their email is confirmed. */
  issueToken(userId: string, email: string): string {
    return this.generateToken(userId, email);
  }
}
