/**
 * T2.1 — Weekly automated retrain with drift detection and gated promotion.
 *
 * Cron fires every Sunday 01:00 UTC. Steps:
 *  1. Fetch the latest labelled claims from claim_labels.
 *  2. POST to the ML sidecar /train endpoint (sidecar internally holds an
 *     80/20 train/test split and returns AUC + precision@K).
 *  3. Fetch a sample of recent scoring distributions from OcrExtraction so
 *     the sidecar can compute Population Stability Index (PSI) between the
 *     training feature distribution and the live scoring distribution.
 *  4. Promote the new model to 'active' only when:
 *       - AUC is >= previous active model's AUC (non-degraded)
 *       - precision@K is >= previous active model's precisionAtK
 *       - PSI < 0.2 (feature distribution has not drifted too far from training)
 *  5. Write a model_versions row for every run (candidate → active | superseded).
 */

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { MlScoringService } from './ml-scoring.service';

// PSI bands follow the standard rule: < 0.1 stable, 0.1–0.2 monitor, > 0.2 retrain concern.
const PSI_PROMOTE_THRESHOLD = 0.2;
// How many recent scoring rows to sample for drift estimation.
const DRIFT_SAMPLE_SIZE = 500;

@Injectable()
export class RetrainService {
  private readonly logger = new Logger(RetrainService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mlScoringService: MlScoringService,
  ) {}

  /** Called by the weekly cron; also callable from an admin endpoint for ad-hoc runs. */
  async runRetrain(): Promise<{ success: boolean; message: string; versionId?: string }> {
    this.logger.log('Weekly fraud model retrain started');

    // ── 1. Fetch labelled data ──────────────────────────────────────────────
    const labels = await this.prisma.claimLabel.findMany({
      where: {
        label: { in: ['fraud', 'suspicious', 'legitimate'] },
        featuresSnapshot: { not: null },
      },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    });

    const fraudRows  = labels.filter(l => l.label === 'fraud' || l.label === 'suspicious');
    const legitRows  = labels.filter(l => l.label === 'legitimate');

    if (fraudRows.length < 10 || legitRows.length < 10) {
      const msg = `Retrain skipped — insufficient labels: ${fraudRows.length} fraud, ${legitRows.length} legitimate`;
      this.logger.warn(msg);
      return { success: false, message: msg };
    }

    const trainingData = labels.map(l => ({
      label: l.label,
      features: this.snapshotToFeatures(l.featuresSnapshot as Record<string, any>),
    }));

    // ── 2. Train on the sidecar ─────────────────────────────────────────────
    let trainResult: any;
    try {
      trainResult = await this.mlScoringService.train(trainingData);
    } catch (err: any) {
      this.logger.error(`ML sidecar /train failed: ${err.message}`);
      return { success: false, message: `Sidecar training error: ${err.message}` };
    }

    // ── 3. Compute PSI from recent scoring distribution ─────────────────────
    const recentScores = await this.prisma.ocrExtraction.findMany({
      where: { anomalyScore: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: DRIFT_SAMPLE_SIZE,
      select: { anomalyScore: true },
    });

    const psi = this.computeAnomalyScorePsi(
      labels.map(l => (l.featuresSnapshot as any)?.anomalyScore ?? 0),
      recentScores.map(r => r.anomalyScore ?? 0),
    );

    // ── 4. Fetch previous active model metrics for comparison ───────────────
    const previousActive = await this.prisma.modelVersion.findFirst({
      where: { status: 'active' },
      orderBy: { promotedAt: 'desc' },
    });

    const prevAuc          = (previousActive?.metricsJson as any)?.aucRoc        ?? 0;
    const prevPrecisionAtK = (previousActive?.metricsJson as any)?.precisionAtK  ?? 0;

    const newAuc          = trainResult.aucRoc        ?? 0;
    const newPrecisionAtK = trainResult.precisionAtK  ?? 0;

    const shouldPromote =
      newAuc          >= prevAuc          &&
      newPrecisionAtK >= prevPrecisionAtK &&
      psi             <  PSI_PROMOTE_THRESHOLD;

    const metricsJson = {
      aucRoc:        newAuc,
      precisionAtK:  newPrecisionAtK,
      psi,
      sampleSize:    trainingData.length,
      fraudCount:    fraudRows.length,
      legitimateCount: legitRows.length,
      featureImportances: trainResult.featureImportances ?? {},
    };

    // ── 5. Persist the model_versions row ──────────────────────────────────
    const status = shouldPromote ? 'active' : 'candidate';

    if (shouldPromote && previousActive) {
      await this.prisma.modelVersion.update({
        where: { id: previousActive.id },
        data: { status: 'superseded', supersededAt: new Date() },
      });
    }

    const version = await this.prisma.modelVersion.create({
      data: {
        sampleSize:      trainingData.length,
        fraudCount:      fraudRows.length,
        legitimateCount: legitRows.length,
        metricsJson,
        status,
        promotedAt:      shouldPromote ? new Date() : null,
        notes: shouldPromote
          ? `Promoted: AUC ${newAuc.toFixed(3)} >= ${prevAuc.toFixed(3)}, PSI ${psi.toFixed(3)} < ${PSI_PROMOTE_THRESHOLD}`
          : `Candidate: AUC ${newAuc.toFixed(3)} vs ${prevAuc.toFixed(3)}, PSI ${psi.toFixed(3)} — not promoted`,
      },
    });

    const msg = shouldPromote
      ? `Model promoted to active (version ${version.id}, AUC=${newAuc.toFixed(3)}, PSI=${psi.toFixed(3)})`
      : `New model is a candidate (AUC=${newAuc.toFixed(3)} vs prev=${prevAuc.toFixed(3)}, PSI=${psi.toFixed(3)}) — not promoted`;

    this.logger.log(msg);
    return { success: true, message: msg, versionId: version.id };
  }

  /** Weekly Sunday 01:00 UTC cron trigger. */
  @Cron('0 1 * * 0')
  async handleWeeklyCron() {
    await this.runRetrain().catch(err =>
      this.logger.error(`Weekly retrain cron failed: ${err.message}`, err.stack),
    );
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private snapshotToFeatures(snap: Record<string, any>) {
    return {
      invoiceAmount:        snap?.invoiceAmount       ?? 0,
      ocrConfidence:        snap?.ocrConfidence       ?? 1,
      anomalyScore:         snap?.anomalyScore        ?? 0,
      fraudSignalCount:     snap?.fraudSignalCount    ?? 0,
      fraudSignalCritical:  snap?.fraudSignalCritical ?? 0,
      resubmissionCount:    snap?.resubmissionCount   ?? 0,
      memberNumberPresent:  snap?.memberNumberPresent ? 1 : 0,
    };
  }

  /**
   * Population Stability Index between a training distribution and a scoring
   * distribution, both expressed as arrays of anomalyScore (0–1).
   * Bins the values into 10 equal-width buckets and applies the PSI formula:
   *   PSI = sum((actual% - expected%) * ln(actual% / expected%))
   */
  private computeAnomalyScorePsi(training: number[], scoring: number[]): number {
    if (training.length < 10 || scoring.length < 10) return 0;

    const BINS = 10;
    const binWidth = 1.0 / BINS;
    const eps = 1e-4; // avoid ln(0)

    const trainBins = new Array(BINS).fill(0);
    const scoreBins = new Array(BINS).fill(0);

    for (const v of training) {
      const bin = Math.min(BINS - 1, Math.floor(v / binWidth));
      trainBins[bin]++;
    }
    for (const v of scoring) {
      const bin = Math.min(BINS - 1, Math.floor(v / binWidth));
      scoreBins[bin]++;
    }

    let psi = 0;
    for (let i = 0; i < BINS; i++) {
      const expected = (trainBins[i] + eps) / training.length;
      const actual   = (scoreBins[i] + eps) / scoring.length;
      psi += (actual - expected) * Math.log(actual / expected);
    }
    return Math.max(0, psi);
  }
}
