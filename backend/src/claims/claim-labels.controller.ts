import { Controller, Get, Post, Body, Param, Query, UseGuards, Request, Res } from '@nestjs/common';
import { Response } from 'express';
import { ClaimLabelsService } from './claim-labels.service';
import { AnomalyScoringService } from './anomaly-scoring.service';
import { MlScoringService } from './ml-scoring.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('claim-labels')
@UseGuards(JwtAuthGuard)
export class ClaimLabelsController {
  constructor(
    private readonly labelsService: ClaimLabelsService,
    private readonly anomalyService: AnomalyScoringService,
    private readonly mlService: MlScoringService,
  ) {}

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

  // ── Exports ────────────────────────────────────────────────────────────────

  @Get('export')
  @UseGuards(RolesGuard)
  @Roles('admin', 'claims_officer')
  async exportJson(@Res() res: Response) {
    const data = await this.labelsService.exportDataset();
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="claim-labels-${date}.json"`);
    res.send(JSON.stringify(data, null, 2));
  }

  @Get('export/csv')
  @UseGuards(RolesGuard)
  @Roles('admin', 'claims_officer', 'fraud_officer')
  async exportCsv(@Res() res: Response) {
    const csv = await this.labelsService.exportCsv();
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="claim-labels-${date}.csv"`);
    res.send('﻿' + csv); // BOM for Excel UTF-8 compatibility
  }

  @Get('export/excel')
  @UseGuards(RolesGuard)
  @Roles('admin', 'claims_officer', 'fraud_officer')
  async exportExcel(@Res() res: Response) {
    const buf = await this.labelsService.exportExcel();
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="claim-labels-${date}.xlsx"`);
    res.send(buf);
  }

  // ── Analysis ───────────────────────────────────────────────────────────────

  @Get('analysis/deep')
  @UseGuards(RolesGuard)
  @Roles('admin', 'claims_officer', 'fraud_officer')
  deepAnalysis() {
    return this.labelsService.getDeepAnalysis();
  }

  // ── ML admin ───────────────────────────────────────────────────────────────

  @Get('ml/factor-effectiveness')
  @UseGuards(RolesGuard)
  @Roles('admin', 'fraud_officer')
  factorEffectiveness() {
    return this.anomalyService.getFactorEffectiveness();
  }

  @Post('ml/calibrate-weights')
  @UseGuards(RolesGuard)
  @Roles('admin')
  calibrateWeights() {
    return this.anomalyService.calibrateWeights();
  }

  @Post('ml/train-sidecar')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async trainSidecar() {
    const dataset = await this.labelsService.exportDataset();
    const rows = dataset.data
      .filter(r => r.features && r.label)
      .map(r => ({
        label: r.label as string,
        features: {
          invoiceAmount: (r.features as any)?.invoiceAmount ?? 0,
          ocrConfidence: (r.features as any)?.ocrConfidence ?? 1,
          anomalyScore: (r.features as any)?.anomalyScore ?? 0,
          fraudSignalCount: (r.features as any)?.fraudSignalCount ?? 0,
          fraudSignalCritical: (r.features as any)?.fraudSignalCritical ?? 0,
          resubmissionCount: (r.features as any)?.resubmissionCount ?? 0,
          memberNumberPresent: (r.features as any)?.memberNumberPresent === false ? 0 : 1,
        },
      }));
    return this.mlService.train(rows);
  }

  @Get('ml/sidecar-weights')
  @UseGuards(RolesGuard)
  @Roles('admin', 'fraud_officer')
  sidecarWeights() {
    return this.mlService.getWeights();
  }

  // ── Per-claim ──────────────────────────────────────────────────────────────

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
