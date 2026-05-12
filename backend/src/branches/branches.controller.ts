import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query, Request, UseGuards, ForbiddenException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';

@Controller('branches')
@UseGuards(JwtAuthGuard)
export class BranchesController {
  constructor(private prisma: PrismaService) {}

  /**
   * provider_admin callers are locked to their own provider regardless of what
   * they pass as ?providerId. Returns the effective providerId to use, or
   * null to indicate "no scope restriction" (CIC staff).
   */
  private resolveProviderScope(req: any, requestedProviderId?: string): string | null {
    const role = req?.user?.role;
    if (role === 'provider_admin' || role === 'provider_user') {
      const uid = req?.user?.providerId;
      if (!uid) throw new ForbiddenException('Access denied');
      return uid;
    }
    return requestedProviderId ?? null;
  }

  @Get()
  async findAll(
    @Request() req: any,
    @Query('search') search?: string,
    @Query('providerId') providerId?: string,
    @Query('region') region?: string,
    @Query('isActive') isActive?: string,
    @Query('isApproved') isApproved?: string,
    @Query('limit') limit = '100',
    @Query('offset') offset = '0',
  ) {
    const effectiveProviderId = this.resolveProviderScope(req, providerId);

    const where: any = {};
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
        { county: { contains: search, mode: 'insensitive' } },
        { contactPerson: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (effectiveProviderId) where.providerId = effectiveProviderId;
    if (region) where.region = region;
    if (isActive !== undefined) where.isActive = isActive === 'true';
    if (isApproved !== undefined) where.isApproved = isApproved === 'true';

    const [branches, total] = await Promise.all([
      this.prisma.branch.findMany({
        where,
        skip: parseInt(offset),
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
        include: {
          provider: { select: { id: true, name: true, licenseNumber: true } },
        },
      }),
      this.prisma.branch.count({ where }),
    ]);

    // Map to frontend shape
    const mapped = branches.map(b => ({
      id: b.id,
      code: b.code,
      name: b.name,
      providerId: b.providerId,
      providerName: b.provider.name,
      region: b.region ?? '',
      county: b.county ?? '',
      address: b.address ?? '',
      phone: b.phone ?? '',
      email: b.email ?? '',
      contactPerson: b.contactPerson ?? '',
      isActive: b.isActive,
      isApproved: b.isApproved,
      notes: b.notes ?? '',
      claimsCount: 0,
      pendingClaims: 0,
      approvalRate: 0,
      lastActivity: b.updatedAt.toISOString(),
      createdAt: b.createdAt.toISOString(),
    }));

    return { branches: mapped, total };
  }

  @Get('providers')
  async getProviders() {
    const providers = await this.prisma.provider.findMany({
      where: { status: 'approved' },
      select: {
        id: true, name: true, licenseNumber: true,
        _count: { select: { branches_rel: true } },
      },
      orderBy: { name: 'asc' },
    });
    return providers.map(p => ({
      id: p.id,
      name: p.name,
      code: p.licenseNumber,
      branches: p._count.branches_rel,
    }));
  }

  @Post()
  async create(@Request() req: any, @Body() body: {
    code: string; name: string; providerId: string;
    region?: string; county?: string; address?: string;
    phone?: string; email?: string; contactPerson?: string;
    isActive?: boolean; isApproved?: boolean; notes?: string;
  }) {
    const role = req.user?.role;
    // provider_admin can only create branches under their own provider.
    const providerId =
      role === 'provider_admin' || role === 'provider_user'
        ? (req.user?.providerId ?? null)
        : body.providerId;
    if (!providerId) throw new ForbiddenException('Access denied');
    if ((role === 'provider_admin' || role === 'provider_user') && body.providerId && body.providerId !== providerId) {
      throw new ForbiddenException('Access denied');
    }
    const branch = await this.prisma.branch.create({
      data: {
        code: body.code,
        name: body.name,
        providerId,
        region: body.region,
        county: body.county,
        address: body.address,
        phone: body.phone,
        email: body.email,
        contactPerson: body.contactPerson,
        isActive: body.isActive ?? true,
        isApproved: body.isApproved ?? false,
        notes: body.notes,
      },
      include: { provider: { select: { name: true } } },
    });
    return {
      ...branch,
      providerName: branch.provider.name,
      claimsCount: 0,
      pendingClaims: 0,
      approvalRate: 0,
      lastActivity: branch.updatedAt.toISOString(),
    };
  }

  @Patch(':id')
  async update(@Request() req: any, @Param('id') id: string, @Body() body: {
    code?: string; name?: string; providerId?: string;
    region?: string; county?: string; address?: string;
    phone?: string; email?: string; contactPerson?: string;
    isActive?: boolean; isApproved?: boolean; notes?: string;
  }) {
    const role = req.user?.role;
    if (role === 'provider_admin' || role === 'provider_user') {
      const existing = await this.prisma.branch.findUnique({ where: { id }, select: { providerId: true } });
      if (!existing || existing.providerId !== req.user?.providerId) {
        throw new ForbiddenException('Access denied');
      }
      // Prevent moving a branch to another provider.
      if (body.providerId && body.providerId !== req.user?.providerId) {
        throw new ForbiddenException('Access denied');
      }
    }
    const branch = await this.prisma.branch.update({
      where: { id },
      data: {
        ...(body.code !== undefined && { code: body.code }),
        ...(body.name !== undefined && { name: body.name }),
        ...(body.providerId !== undefined && { providerId: body.providerId }),
        ...(body.region !== undefined && { region: body.region }),
        ...(body.county !== undefined && { county: body.county }),
        ...(body.address !== undefined && { address: body.address }),
        ...(body.phone !== undefined && { phone: body.phone }),
        ...(body.email !== undefined && { email: body.email }),
        ...(body.contactPerson !== undefined && { contactPerson: body.contactPerson }),
        ...(body.isActive !== undefined && { isActive: body.isActive }),
        ...(body.isApproved !== undefined && { isApproved: body.isApproved }),
        ...(body.notes !== undefined && { notes: body.notes }),
      },
      include: { provider: { select: { name: true } } },
    });
    return { ...branch, providerName: branch.provider.name };
  }

  @Delete(':id')
  async remove(@Request() req: any, @Param('id') id: string) {
    const role = req.user?.role;
    if (role === 'provider_admin' || role === 'provider_user') {
      const existing = await this.prisma.branch.findUnique({ where: { id }, select: { providerId: true } });
      if (!existing || existing.providerId !== req.user?.providerId) {
        throw new ForbiddenException('Access denied');
      }
    }
    await this.prisma.branch.delete({ where: { id } });
    return { deleted: true };
  }
}
