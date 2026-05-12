import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { AppealsService } from './appeals.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('appeals')
@UseGuards(JwtAuthGuard)
export class AppealsController {
  constructor(private readonly appealsService: AppealsService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles('provider_admin', 'provider_user', 'admin', 'supervisor')
  fileAppeal(
    @Body() body: { claimId: string; reason: string; additionalNotes?: string },
    @Request() req,
  ) {
    return this.appealsService.fileAppeal({ ...body, filedBy: req.user.userId });
  }

  @Get()
  @UseGuards(RolesGuard)
  @Roles('admin', 'supervisor', 'claims_officer', 'checker', 'provider_admin', 'provider_user')
  getAppeals(
    @Request() req,
    @Query('status') status?: string,
    @Query('claimId') claimId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const isProvider = req.user.role === 'provider_admin' || req.user.role === 'provider_user';
    return this.appealsService.getAppeals({
      status,
      claimId,
      providerId: isProvider ? req.user.providerId : undefined,
      limit: limit ? parseInt(limit) : undefined,
      offset: offset ? parseInt(offset) : undefined,
    });
  }

  @Patch(':id/adjudicate')
  @UseGuards(RolesGuard)
  @Roles('admin', 'supervisor')
  adjudicate(
    @Param('id') id: string,
    @Body() body: { outcome: 'upheld' | 'dismissed'; outcomeNotes?: string },
    @Request() req,
  ) {
    return this.appealsService.adjudicateAppeal(id, req.user.userId, body);
  }

  @Patch(':id/status')
  @UseGuards(RolesGuard)
  @Roles('admin', 'supervisor')
  updateStatus(
    @Param('id') id: string,
    @Body() body: { status: 'under_review' | 'pending' },
  ) {
    return this.appealsService.updateAppealStatus(id, body.status);
  }
}
