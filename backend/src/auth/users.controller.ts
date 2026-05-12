import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query,
  UseGuards, Request, ForbiddenException, NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { Roles } from './decorators/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'supervisor')
export class UsersController {
  constructor(private prisma: PrismaService) {}

  private readonly USER_SELECT = {
    id: true, email: true, name: true, role: true,
    isActive: true, createdAt: true, updatedAt: true,
    lastLogin: true, providerId: true, branchId: true,
    twoFactorEnabled: true, requirePasswordChange: true,
    provider: {
      select: { id: true, name: true, type: true, licenseNumber: true, status: true },
    },
  } as const;

  @Get()
  async findAll(
    @Query('search') search?: string,
    @Query('role') role?: string,
    @Query('isActive') isActive?: string,
    @Query('providerId') providerId?: string,
    @Query('limit') limit = '100',
    @Query('offset') offset = '0',
  ) {
    const where: any = {};
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (role) where.role = role;
    if (isActive !== undefined) where.isActive = isActive === 'true';
    if (providerId) where.providerId = providerId;

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip: parseInt(offset),
        take: parseInt(limit),
        select: this.USER_SELECT,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count({ where }),
    ]);

    // Attach branch names
    const branchIds = [...new Set(users.map(u => u.branchId).filter(Boolean))] as string[];
    let branchMap: Record<string, { name: string; code: string }> = {};
    if (branchIds.length > 0) {
      const branches = await this.prisma.branch.findMany({
        where: { id: { in: branchIds } },
        select: { id: true, name: true, code: true },
      });
      branchMap = Object.fromEntries(branches.map(b => [b.id, b]));
    }

    const enriched = users.map(u => ({
      ...u,
      branch: u.branchId ? branchMap[u.branchId] ?? null : null,
    }));

    return { users: enriched, total };
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: this.USER_SELECT,
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  @Post()
  async create(@Body() body: {
    email: string; name: string; role: string; password?: string;
    providerId?: string; branchId?: string;
  }) {
    const existing = await this.prisma.user.findUnique({ where: { email: body.email } });
    if (existing) throw new ForbiddenException('Email already in use');

    const tempPassword = body.password || Math.random().toString(36).slice(-10) + 'A1!';
    const hashed = await bcrypt.hash(tempPassword, 10);

    const user = await this.prisma.user.create({
      data: {
        email: body.email,
        name: body.name,
        role: body.role,
        password: hashed,
        providerId: body.providerId ?? null,
        branchId: body.branchId ?? null,
        requirePasswordChange: !body.password,
      },
      select: this.USER_SELECT,
    });
    return { ...user, tempPassword: body.password ? undefined : tempPassword };
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: {
    name?: string; role?: string; email?: string;
    providerId?: string | null; branchId?: string | null;
  }) {
    const user = await this.prisma.user.update({
      where: { id },
      data: {
        ...(body.name && { name: body.name }),
        ...(body.role && { role: body.role }),
        ...(body.email && { email: body.email }),
        ...(body.providerId !== undefined && { providerId: body.providerId || null }),
        ...(body.branchId !== undefined && { branchId: body.branchId || null }),
      },
      select: this.USER_SELECT,
    });
    return user;
  }

  @Post(':id/activate')
  async activate(@Param('id') id: string) {
    return this.prisma.user.update({
      where: { id },
      data: { isActive: true },
      select: { id: true, isActive: true },
    });
  }

  @Post(':id/deactivate')
  async deactivate(@Param('id') id: string, @Request() req: any) {
    if (req.user?.userId === id) throw new ForbiddenException('Cannot deactivate yourself');
    return this.prisma.user.update({
      where: { id },
      data: { isActive: false },
      select: { id: true, isActive: true },
    });
  }

  @Post(':id/reset-password')
  async resetPassword(@Param('id') id: string) {
    const tempPassword = Math.random().toString(36).slice(-10) + 'A1!';
    const hashed = await bcrypt.hash(tempPassword, 10);
    await this.prisma.user.update({
      where: { id },
      data: { password: hashed, requirePasswordChange: true },
    });
    return { tempPassword };
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Request() req: any) {
    if (req.user?.userId === id) throw new ForbiddenException('Cannot delete yourself');
    await this.prisma.user.delete({ where: { id } });
    return { deleted: true };
  }

  // ── Saved signatures ───────────────────────────────────────────────────────
  // Every authenticated user manages their own signatures, regardless of role.
  @Get(':id/signatures')
  @Roles('admin', 'supervisor', 'claims_officer', 'checker', 'fraud_officer', 'provider_admin', 'provider_user')
  async getSignatures(@Param('id') id: string, @Request() req: any) {
    if (req.user?.userId !== id && req.user?.role !== 'admin' && req.user?.role !== 'supervisor') {
      throw new ForbiddenException('Access denied');
    }
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { savedSignatures: true },
    });
    if (!user) throw new NotFoundException('User not found');
    return { signatures: user.savedSignatures ?? [] };
  }

  @Patch(':id/signatures')
  @Roles('admin', 'supervisor', 'claims_officer', 'checker', 'fraud_officer', 'provider_admin', 'provider_user')
  async saveSignatures(
    @Param('id') id: string,
    @Body() body: { signatures: any[] },
    @Request() req: any,
  ) {
    if (req.user?.userId !== id) throw new ForbiddenException('Cannot modify another user\'s signatures');
    const user = await this.prisma.user.update({
      where: { id },
      data: { savedSignatures: body.signatures as any },
      select: { id: true, savedSignatures: true },
    });
    return { signatures: user.savedSignatures };
  }
}
