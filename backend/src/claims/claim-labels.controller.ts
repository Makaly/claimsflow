import { Controller, Get, Post, Body, Param, Query, UseGuards, Request, Res } from '@nestjs/common';
import { Response } from 'express';
import { ClaimLabelsService } from './claim-labels.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('claim-labels')
@UseGuards(JwtAuthGuard)
export class ClaimLabelsController {
  constructor(private readonly labelsService: ClaimLabelsService) {}

  @Get()
  @UseGuards(RolesGuard)
  @Roles('admin', 'claims_officer', 'fraud_officer')
  list(
    @Query('label') label?: string,
    @Query('source') source?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.labelsService.listLabels({
      label, source,
      limit: limit ? parseInt(limit) : undefined,
      offset: offset ? parseInt(offset) : undefined,
    });
  }

  @Get('export')
  @UseGuards(RolesGuard)
  @Roles('admin', 'claims_officer')
  async exportDataset(@Res() res: Response) {
    const data = await this.labelsService.exportDataset();
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="claim-labels-${new Date().toISOString().slice(0,10)}.json"`);
    res.send(JSON.stringify(data, null, 2));
  }

  @Get(':claimId')
  get(@Param('claimId') claimId: string) {
    return this.labelsService.getLabel(claimId);
  }

  @Post(':claimId')
  @UseGuards(RolesGuard)
  @Roles('admin', 'claims_officer', 'fraud_officer')
  upsert(
    @Param('claimId') claimId: string,
    @Body() body: { label: 'legitimate' | 'suspicious' | 'fraud'; notes?: string },
    @Request() req,
  ) {
    return this.labelsService.upsertLabel(claimId, body.label, 'manual_review', req.user.userId, body.notes);
  }
}
