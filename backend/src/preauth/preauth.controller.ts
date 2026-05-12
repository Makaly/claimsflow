import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { PreAuthService } from './preauth.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('pre-auth')
@UseGuards(JwtAuthGuard)
export class PreAuthController {
  constructor(private readonly preAuthService: PreAuthService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles('provider_admin', 'provider_user', 'admin', 'supervisor', 'claims_officer')
  create(@Body() body: any, @Request() req: any) {
    return this.preAuthService.create({ ...body, requestedBy: req.user.userId });
  }

  @Get()
  @UseGuards(RolesGuard)
  @Roles('admin', 'supervisor', 'claims_officer', 'checker', 'provider_admin', 'provider_user')
  getAll(
    @Request() req: any,
    @Query('status') status?: string,
    @Query('memberNumber') memberNumber?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const isProvider = ['provider_admin', 'provider_user'].includes(req.user.role);
    return this.preAuthService.getAll({
      status,
      memberNumber,
      providerId: isProvider ? req.user.providerId : undefined,
      limit: limit ? parseInt(limit) : undefined,
      offset: offset ? parseInt(offset) : undefined,
    });
  }

  @Patch(':id/review')
  @UseGuards(RolesGuard)
  @Roles('admin', 'supervisor')
  review(@Param('id') id: string, @Body() body: any, @Request() req: any) {
    return this.preAuthService.review(id, req.user.userId, body);
  }

  @Patch(':id/link-claim')
  @UseGuards(RolesGuard)
  @Roles('admin', 'supervisor', 'claims_officer')
  linkClaim(@Param('id') id: string, @Body() body: { claimId: string }) {
    return this.preAuthService.linkToClaim(id, body.claimId);
  }
}
