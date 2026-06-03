import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Put,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { AssignmentResolverService, ReviewerRole } from './assignment-resolver.service';
import { UpsertProviderRuleDto } from './dto/upsert-provider-rule.dto';
import { SetStrategyDto } from './dto/set-strategy.dto';

const STRATEGY_KEY = 'assignment_default_strategy';

/**
 * Admin-only configuration for the auto-assignment mechanism:
 *  - per-provider dedicated reviewer pins (maker-checker / claims-officer)
 *  - the global default strategy used when a provider has no pin
 */
@Controller('assignment-rules')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AssignmentRulesController {
  constructor(
    private prisma: PrismaService,
    private resolver: AssignmentResolverService,
  ) {}

  /** Every provider with its current pins (null where unpinned). */
  @Get()
  async list() {
    const providers = await this.prisma.provider.findMany({
      select: {
        id: true,
        name: true,
        assignmentRule: {
          select: {
            makerCheckerId: true,
            claimsOfficerId: true,
            makerChecker: { select: { id: true, name: true, isOnLeave: true } },
            claimsOfficer: { select: { id: true, name: true, isOnLeave: true } },
            updatedAt: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });
    return { providers };
  }

  /** Active users of a role, for the admin dropdowns. */
  @Get('assignable')
  async assignable(@Query('role') role: string) {
    if (role !== 'maker_checker' && role !== 'claims_officer') {
      throw new BadRequestException('role must be maker_checker or claims_officer');
    }
    const users = await this.prisma.user.findMany({
      where: { role, isActive: true, deletedAt: null } as any,
      select: { id: true, name: true, email: true, isOnLeave: true },
      orderBy: { name: 'asc' },
    });
    return { users };
  }

  @Get('strategy')
  async getStrategy() {
    return { strategy: await this.resolver.getDefaultStrategy() };
  }

  @Put('strategy')
  async setStrategy(@Body() body: SetStrategyDto, @Request() req: any) {
    const updated = await this.prisma.systemConfig.upsert({
      where: { key: STRATEGY_KEY },
      create: {
        key: STRATEGY_KEY,
        value: body.strategy,
        category: 'workflow',
        description: 'Default reviewer picker when a provider has no pin: workload (least-loaded) or fifo (round-robin)',
        updatedBy: req?.user?.userId,
      },
      update: { value: body.strategy, updatedBy: req?.user?.userId },
    });
    return { strategy: updated.value };
  }

  @Put(':providerId')
  async upsert(
    @Param('providerId') providerId: string,
    @Body() body: UpsertProviderRuleDto,
    @Request() req: any,
  ) {
    const provider = await this.prisma.provider.findUnique({ where: { id: providerId }, select: { id: true } });
    if (!provider) throw new BadRequestException('Provider not found');

    if (body.makerCheckerId) await this.assertRole(body.makerCheckerId, 'maker_checker');
    if (body.claimsOfficerId) await this.assertRole(body.claimsOfficerId, 'claims_officer');

    // Build a patch that only touches the fields the caller actually sent.
    const patch: { makerCheckerId?: string | null; claimsOfficerId?: string | null } = {};
    if (body.makerCheckerId !== undefined) patch.makerCheckerId = body.makerCheckerId;
    if (body.claimsOfficerId !== undefined) patch.claimsOfficerId = body.claimsOfficerId;

    const rule = await this.prisma.providerAssignmentRule.upsert({
      where: { providerId },
      create: { providerId, ...patch, updatedBy: req?.user?.userId },
      update: { ...patch, updatedBy: req?.user?.userId },
    });
    return rule;
  }

  @Delete(':providerId')
  async clear(@Param('providerId') providerId: string) {
    await this.prisma.providerAssignmentRule
      .delete({ where: { providerId } })
      .catch(() => undefined); // idempotent — clearing an absent rule is a no-op
    return { cleared: true };
  }

  private async assertRole(userId: string, role: ReviewerRole) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, isActive: true },
    });
    if (!user || user.role !== role || !user.isActive) {
      throw new BadRequestException(`Selected user must be an active ${role}`);
    }
  }
}
