import { Controller, Post, Patch, Body, Get, UseGuards, Request, HttpCode } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('register')
  async register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Post('login')
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
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
  async registerProvider(@Body() body: {
    providerName: string; type: string; licenseNumber: string
    phone: string; email: string; physicalAddress: string
    contactPerson: string; city?: string; region?: string
    adminName: string; adminEmail: string; adminPassword: string
  }) {
    return this.authService.registerProvider(body);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  async logout() {
    return { message: 'Logged out successfully' };
  }
}
