import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';

@Controller('activity-logs')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'claims_officer', 'fraud_officer')
export class ActivityLogsController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async findAll(
    @Query('search') search?: string,
    @Query('action') action?: string,
    @Query('entity') entity?: string,
    @Query('status') status?: string,
    @Query('userId') userId?: string,
    @Query('limit') limit = '50',
    @Query('offset') offset = '0',
  ) {
    const where: any = {};
    if (search) {
      where.OR = [
        { action: { contains: search, mode: 'insensitive' } },
        { username: { contains: search, mode: 'insensitive' } },
        { entityId: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (action) where.action = { contains: action, mode: 'insensitive' };
    if (entity) where.entity = entity;
    if (status) where.status = status;
    if (userId) where.userId = userId;

    const [logs, total] = await Promise.all([
      this.prisma.activityLog.findMany({
        where,
        skip: parseInt(offset),
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { name: true, email: true, role: true } },
        },
      }),
      this.prisma.activityLog.count({ where }),
    ]);

    return { logs, total };
  }
}
