import { Controller, Post, Patch, Body, Get, UseGuards, Request, Response, HttpCode, Query } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('register')
  @UseGuards(ThrottlerGuard)
  @Throttle({ auth: { ttl: 60_000, limit: 5 } })
  async register(@Body() registerDto: RegisterDto, @Request() req: any) {
    return this.authService.register(registerDto, {
      ipAddress: req?.ip,
      userAgent: req?.headers?.['user-agent'],
    });
  }

  @Post('login')
  @UseGuards(ThrottlerGuard)
  @Throttle({ auth: { ttl: 60_000, limit: 10 } })
  async login(@Body() loginDto: LoginDto, @Response({ passthrough: true }) res: any) {
    const result = await this.authService.login(loginDto);
    const isProduction = process.env.NODE_ENV === 'production';
    // In production the frontend (claimsflow-frontend.onrender.com) calls the
    // backend (claimsflow-backend.onrender.com) cross-origin — Render's static
    // CDN does not proxy HTTP. SameSite=None;Secure is required so browsers
    // send the cookie on credentialed cross-origin requests. In dev the Vite
    // proxy makes requests same-origin, so Lax is fine (and Secure cannot be
    // set without HTTPS).
    res.cookie('access_token', result.access_token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      maxAge: 24 * 60 * 60 * 1000,
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

  @Post('register-provider')
  @HttpCode(201)
  @UseGuards(ThrottlerGuard)
  @Throttle({ auth: { ttl: 60_000, limit: 3 } })
  async registerProvider(
    @Body() body: {
      providerName: string; type: string; licenseNumber: string
      phone: string; email: string; physicalAddress: string
      contactPerson: string; city?: string; region?: string
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

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  async logout(@Request() req, @Response({ passthrough: true }) res: any) {
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
