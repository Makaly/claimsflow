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
  async register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Post('login')
  @UseGuards(ThrottlerGuard)
  @Throttle({ auth: { ttl: 60_000, limit: 10 } })
  async login(@Body() loginDto: LoginDto, @Response({ passthrough: true }) res: any) {
    const result = await this.authService.login(loginDto);
    const isProduction = process.env.NODE_ENV === 'production';
    // Frontend and backend live on different subdomains in production
    // (claimsflow-frontend.onrender.com → claimsflow-backend.onrender.com),
    // so cookies must be SameSite=None;Secure for the browser to attach
    // them to cross-site XHRs. In dev we still proxy through Vite, so
    // SameSite=Strict is correct and tighter.
    res.cookie('access_token', result.access_token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'strict',
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
  async registerProvider(@Body() body: {
    providerName: string; type: string; licenseNumber: string
    phone: string; email: string; physicalAddress: string
    contactPerson: string; city?: string; region?: string
    adminName: string; adminEmail: string; adminPassword: string
  }) {
    return this.authService.registerProvider(body);
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
      sameSite: isProduction ? 'none' : 'strict',
      path: '/',
    });
    return { message: 'Logged out successfully.' };
  }
}
