import { Controller, Post, Patch, Body, Get, UseGuards, Request, Response, HttpCode, Query, BadRequestException, NotFoundException } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { EmailOtpService } from './email-otp.service';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private emailOtpService: EmailOtpService,
    private prisma: PrismaService,
  ) {}

  @Post('register')
  @UseGuards(ThrottlerGuard)
  @Throttle({ auth: { ttl: 60_000, limit: 5 } })
  async register(@Body() registerDto: RegisterDto, @Request() req: any) {
    return this.authService.register(registerDto, {
      ipAddress: req?.ip,
      userAgent: req?.headers?.['user-agent'],
    });
  }

  /**
   * Mobile member portal login — distinct from the provider/staff `login`
   * below because members authenticate with `memberNumber + pin` (4-digit)
   * rather than email/password. Returns a JWT scoped to `scope: "member"`
   * with the `memberNumber` claim. Stub: validates input shape only;
   * AuthService.memberLogin should look up the Member table and verify the
   * hashed PIN.
   */
  @Post('member/login')
  @UseGuards(ThrottlerGuard)
  @Throttle({ auth: { ttl: 60_000, limit: 10 } })
  async memberLogin(
    @Body() body: { memberNumber: string; pin: string },
    @Response({ passthrough: true }) res: any,
  ) {
    if (!body?.memberNumber || !/^\d{4,}$/.test(body?.pin ?? '')) {
      throw new BadRequestException('memberNumber and 4-digit pin required');
    }
    // TODO: hand off to AuthService.memberLogin once it exists; this stub
    // simply echoes the inputs so the mobile DTO contract can be wired
    // against a 200. The cookie path mirrors the provider login for parity.
    const stubToken = `STUB.${Buffer.from(body.memberNumber).toString('base64')}.MEMBER`;
    const isProduction = process.env.NODE_ENV === 'production';
    res.cookie('access_token', stubToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      maxAge: 24 * 60 * 60 * 1000,
      path: '/',
    });
    return {
      memberNumber: body.memberNumber,
      memberName: 'Demo Member',
      accessToken: stubToken,
      scope: 'member',
    };
  }

  @Post('login')
  @UseGuards(ThrottlerGuard)
  @Throttle({ auth: { ttl: 60_000, limit: 10 } })
  async login(@Body() loginDto: LoginDto, @Response({ passthrough: true }) res: any) {
    const result = await this.authService.login(loginDto);
    const isProduction = process.env.NODE_ENV === 'production';
    // In production the frontend (claimsflow-frontend.onrender.com) calls the
    // backend (claimsflow-backend.onrender.com) cross-origin — SameSite=None;Secure
    // is required so browsers send the cookie on credentialed cross-origin requests.
    // In dev the Vite proxy makes requests same-origin, so Lax is fine.
    // rememberMe extends the cookie from 1 day to 30 days.
    const maxAge = result.rememberMe
      ? 30 * 24 * 60 * 60 * 1000   // 30 days
      : 24 * 60 * 60 * 1000;        // 1 day (default)
    res.cookie('access_token', result.access_token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      maxAge,
      path: '/',
    });
    return result;
  }

  @Get('profile')
  @UseGuards(JwtAuthGuard)
  async getProfile(@Request() req) {
    return this.authService.getProfile(req.user.userId);
  }

  @Patch('profile')
  @UseGuards(JwtAuthGuard)
  async updateProfile(
    @Request() req,
    @Body() body: {
      name?: string;
      phone?: string;
      jobTitle?: string;
      title?: string;
      department?: string;
      location?: string;
      timezone?: string;
      language?: string;
      bio?: string;
      avatarUrl?: string;
    },
  ) {
    return this.authService.updateProfile(req.user.userId, body);
  }

  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  async changePassword(
    @Request() req,
    @Body() body: { currentPassword: string; newPassword: string },
  ) {
    return this.authService.changePassword(req.user.userId, body.currentPassword, body.newPassword);
  }

  @Post('register-user-under-provider')
  @HttpCode(201)
  @UseGuards(ThrottlerGuard)
  @Throttle({ auth: { ttl: 60_000, limit: 5 } })
  async registerUserUnderProvider(
    @Body() body: {
      name: string; email: string; password: string;
      providerId: string; phone?: string;
      acceptTerms: boolean; policyVersion?: string;
    },
    @Request() req: any,
  ) {
    return this.authService.registerUserUnderProvider(body, {
      ipAddress: req?.ip,
      userAgent: req?.headers?.['user-agent'],
    });
  }

  @Post('register-provider')
  @HttpCode(201)
  @UseGuards(ThrottlerGuard)
  @Throttle({ auth: { ttl: 60_000, limit: 3 } })
  async registerProvider(
    @Body() body: {
      providerName: string; type: string; licenseNumber: string
      phone: string; email: string; physicalAddress: string
      contactPerson: string; city?: string; region?: string; country?: string
      // Procurement-spec company-profile fields (all optional at registration;
      // the wizard finalises them before "Submit for approval").
      companyStructure?: 'sole_proprietorship' | 'partnership' | 'registered_company'
      registrationNumber?: string; kraPin?: string; incorporationDate?: string
      numberOfPartners?: number; ownerName?: string; ownerIdNumber?: string
      yearsProvidingServices?: number
      adminName: string; adminEmail: string; adminPassword: string
      acceptTerms: boolean; policyVersion?: string
    },
    @Request() req: any,
  ) {
    return this.authService.registerProvider(body, {
      ipAddress: req?.ip,
      userAgent: req?.headers?.['user-agent'],
    });
  }

  @Post('forgot-password')
  @UseGuards(ThrottlerGuard)
  @Throttle({ auth: { ttl: 60_000, limit: 3 } })
  @HttpCode(200)
  async forgotPassword(@Body() body: { email: string }) {
    return this.authService.forgotPassword(body.email);
  }

  @Post('reset-password')
  @UseGuards(ThrottlerGuard)
  @Throttle({ auth: { ttl: 60_000, limit: 5 } })
  @HttpCode(200)
  async resetPassword(@Body() body: { token: string; password: string }) {
    return this.authService.resetPassword(body.token, body.password);
  }

  // ── PR2: Public approved-provider list (for user-under-provider registration)
  // Returns ONLY non-PII fields so anyone can pick a provider during signup
  // without leaking contact details. Throttled to prevent scraping.
  @Get('providers/approved')
  @UseGuards(ThrottlerGuard)
  @Throttle({ auth: { ttl: 60_000, limit: 30 } })
  async listApprovedProviders(@Query('search') search?: string) {
    const providers = await this.prisma.provider.findMany({
      where: {
        approvalStatus: 'approved',
        isActive: true,
        ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
      },
      select: { id: true, name: true, type: true, city: true, region: true },
      orderBy: { name: 'asc' },
      take: 200,
    });
    return providers;
  }

  // ── PR1: Email OTP verification ─────────────────────────────────────────
  // Unauthenticated by design — the user can't log in until they verify, so
  // we look up by email. Always returns success regardless of whether the
  // email exists to prevent enumeration; rate-limited per IP via the throttler.
  @Post('send-email-otp')
  @UseGuards(ThrottlerGuard)
  @Throttle({ auth: { ttl: 60_000, limit: 3 } })
  @HttpCode(200)
  async sendEmailOtp(@Body() body: { email: string }) {
    if (!body?.email) throw new BadRequestException('email is required');
    const user = await this.prisma.user.findUnique({ where: { email: body.email } });
    if (user && !user.emailVerifiedAt) {
      await this.emailOtpService.sendOtp(user.id).catch(() => undefined);
    }
    return { message: 'If that email matches an unverified account, a code has been sent.' };
  }

  @Post('verify-email-otp')
  @UseGuards(ThrottlerGuard)
  @Throttle({ auth: { ttl: 60_000, limit: 10 } })
  @HttpCode(200)
  async verifyEmailOtp(
    @Body() body: { email: string; code: string },
    @Response({ passthrough: true }) res: any,
  ) {
    if (!body?.email || !body?.code) throw new BadRequestException('email and code are required');
    const user = await this.prisma.user.findUnique({ where: { email: body.email } });
    if (!user) throw new NotFoundException('No account with that email');
    const result = await this.emailOtpService.verifyOtp(user.id, body.code);

    // Issue a session cookie on successful verification so the user lands on
    // the dashboard without a second password prompt.
    const refreshed = await this.prisma.user.findUnique({ where: { id: user.id } });
    const access_token = this.authService.issueToken(user.id, user.email);
    const isProduction = process.env.NODE_ENV === 'production';
    res.cookie('access_token', access_token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      maxAge: 24 * 60 * 60 * 1000,
      path: '/',
    });
    const { password: _p, ...userResult } = refreshed as any;
    return { ...result, user: userResult, access_token };
  }

  @Post('logout')
  @HttpCode(200)
  // No JwtAuthGuard — cookie must be clearable even when the token has already
  // expired. Clearing a cookie on an unauthenticated request is always safe.
  async logout(@Response({ passthrough: true }) res: any) {
    const isProduction = process.env.NODE_ENV === 'production';
    res.clearCookie('access_token', {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      path: '/',
    });
    return { message: 'Logged out successfully.' };
  }
}
