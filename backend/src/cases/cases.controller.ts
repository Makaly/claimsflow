import {
  Controller, Get, Post, Patch, Param, Body, Query, UseGuards, Request,
} from '@nestjs/common';
import { CasesService } from './cases.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('cases')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'claims_officer', 'maker_checker', 'fraud_officer')
export class CasesController {
  constructor(private svc: CasesService) {}

  @Get()
  list(
    @Query('status') status?: string,
    @Query('ownerId') ownerId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.svc.list({
      status,
      ownerId,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @Get(':id')
  getById(@Param('id') id: string) { return this.svc.getById(id); }

  @Get(':id/timeline')
  timeline(@Param('id') id: string) { return this.svc.getTimeline(id); }

  @Post('convert')
  convert(
    @Body() body: { claimId: string; ownerId?: string; slaDueAt?: string },
    @Request() req: any,
  ) {
    return this.svc.convertFromClaim(
      body.claimId,
      body.ownerId ?? req.user.userId,
      body.slaDueAt ? new Date(body.slaDueAt) : undefined,
    );
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body() body: { status: string },
    @Request() req: any,
  ) {
    return this.svc.updateStatus(id, body.status, req.user.userId);
  }

  @Post(':id/comments')
  addComment(
    @Param('id') id: string,
    @Body() body: { body: string },
    @Request() req: any,
  ) {
    return this.svc.addComment(id, req.user.userId, body.body);
  }

  @Post(':id/links')
  addLink(
    @Param('id') id: string,
    @Body() body: { type: string; targetId: string },
  ) {
    return this.svc.addLink(id, body.type, body.targetId);
  }
}
