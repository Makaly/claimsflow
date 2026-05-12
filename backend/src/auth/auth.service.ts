import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
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

  async register(registerDto: RegisterDto) {
    const { email, password, name, role } = registerDto;

    // Check if user already exists
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      throw new UnauthorizedException('User already exists');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const user = await this.prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
        role: role || 'user',
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
    const { email, password } = loginDto;

    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Account is inactive');
    }

    const { password: _, ...result } = user;
    const access_token = this.generateToken(user.id, user.email);

    return {
      user: result,
      access_token,
    };
  }

  async validateUser(email: string, password: string): Promise<any> {
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (user && (await bcrypt.compare(password, user.password))) {
      const { password: _, ...result } = user;
      return result;
    }
    return null;
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

  async registerProvider(dto: {
    // Provider fields
    providerName: string; type: string; licenseNumber: string
    phone: string; email: string; physicalAddress: string
    contactPerson: string; city?: string; region?: string
    // Admin user fields
    adminName: string; adminEmail: string; adminPassword: string
  }) {
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

    // Create admin user linked to provider
    const hashed = await bcrypt.hash(dto.adminPassword, 10)
    const user = await this.prisma.user.create({
      data: {
        name: dto.adminName,
        email: dto.adminEmail,
        password: hashed,
        role: 'provider_admin',
        providerId: provider.id,
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

  private generateToken(userId: string, email: string): string {
    const payload = { sub: userId, email };
    return this.jwtService.sign(payload);
  }
}
