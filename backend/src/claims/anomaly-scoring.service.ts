import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface AnomalyDetail {
  score: number; // 0-1, higher = more anomalous
  factors: Array<{ name: string; contribution: number; explanation: string }>;
  riskLevel: 'low' | 'medium' | 'high';
}

// Default factor weights used when no calibrated model exists yet.
const DEFAULT_WEIGHTS: Record<string, number> = {
  amount_outlier: 0.30,
  high_submission_velocity: 0.15,
  high_member_velocity: 0.25,
  low_ocr_confidence: 0.15,
  off_hours_submission: 0.05,
  fraud_signals_present: 0.40,
  round_high_value: 0.10,
  provider_drift: 0.12,
};

@Injectable()
export class AnomalyScoringService {
  private readonly logger = new Logger(AnomalyScoringService.name);

  // In-memory weight cache: refreshed every hour or after calibration.
  private cachedWeights: Record<string, number> = DEFAULT_WEIGHTS;
  private weightsCachedAt = 0;
  private readonly CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

  constructor(private prisma: PrismaService) {}

  private async loadWeights(): Promise<Record<string, number>> {
    const now = Date.now();
    if (now - this.weightsCachedAt < this.CACHE_TTL_MS) return this.cachedWeights;

    try {
      const active = await this.prisma.fraudModelWeights.findFirst({
        where: { isActive: true },
        orderBy: { trainedAt: 'desc' },
      });
      if (active) {
        this.cachedWeights = { ...DEFAULT_WEIGHTS, ...(active.weights as Record<string, number>) };
        this.weightsCachedAt = now;
        this.logger.debug(`Loaded calibrated fraud weights (sample=${active.sampleSize})`);
      }
    } catch (e: any) {
      this.logger.warn(`Failed to load calibrated weights: ${e.message} — using defaults`);
    }

    return this.cachedWeights;
  }

  /**
   * Compute an anomaly score for a claim based on statistical deviation from
   * the provider's historical claim patterns. Returns 0–1 where higher = more anomalous.
   */
  async scoreClaim(claimId: string): Promise<AnomalyDetail> {
    const claim = await this.prisma.claim.findUnique({
      where: { id: claimId },
      include: { provider: true },
    });

    if (!claim) {
      return { score: 0, factors: [], riskLevel: 'low' };
    }

    const [weights] = await Promise.all([this.loadWeights()]);
    const factors: AnomalyDetail['factors'] = [];

    const ninetyDaysAgo = new Date(Date.now() - 90 * 86_400_000);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);
    const sixtyDaysAgo = new Date(Date.now() - 60 * 86_400_000);

    const [peers, recentByProvider, providerPrev30] = await Promise.all([
      // Factor 1 + 7 baseline: provider 90-day claim history
      this.prisma.claim.findMany({
        where: {
          providerId: claim.providerId,
          id: { not: claim.id },
          submittedAt: { gte: ninetyDaysAgo },
          invoiceAmount: { not: null, gt: 0 },
        },
        select: { invoiceAmount: true, memberNumber: true, dateOfService: true, submittedAt: true },
      }),
      // Factor 2: submission velocity in last hour
      this.prisma.claim.count({
        where: { providerId: claim.providerId, submittedAt: { gte: new Date(Date.now() - 3_600_000) } },
      }),
      // Factor 8: provider drift — prior 30-day window (day 60–30 ago)
      this.prisma.claim.findMany({
        where: {
          providerId: claim.providerId,
          submittedAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo },
          invoiceAmount: { not: null, gt: 0 },
        },
        select: { invoiceAmount: true },
      }),
    ]);

    // Factor 1: Amount z-score vs provider average
    if (peers.length >= 5 && claim.invoiceAmount) {
      const amounts = peers.map(p => p.invoiceAmount!).filter(a => a > 0);
      const mean = amounts.reduce((s, a) => s + a, 0) / amounts.length;
      const variance = amounts.reduce((s, a) => s + (a - mean) ** 2, 0) / amounts.length;
      const stdDev = Math.sqrt(variance);
      if (stdDev > 0) {
        const z = (claim.invoiceAmount - mean) / stdDev;
        if (Math.abs(z) > 2) {
          factors.push({
            name: 'amount_outlier',
            contribution: Math.min(weights.amount_outlier, Math.abs(z) / 10),
            explanation: `Claim amount KES ${claim.invoiceAmount.toLocaleString()} is ${z > 0 ? '+' : ''}${z.toFixed(1)} standard deviations from provider's 90-day average of KES ${Math.round(mean).toLocaleString()}`,
          });
        }
      }
    }

    // Factor 2: Submission velocity — many claims from same provider in short window
    if (recentByProvider > 20) {
      factors.push({
        name: 'high_submission_velocity',
        contribution: weights.high_submission_velocity,
        explanation: `Provider submitted ${recentByProvider} claims in the past hour — abnormally high volume`,
      });
    }

    // Factor 3: Member claim velocity — same member appears too often
    if (claim.memberNumber) {
      const memberCount = await this.prisma.claim.count({
        where: {
          memberNumber: claim.memberNumber,
          id: { not: claim.id },
          submittedAt: { gte: new Date(Date.now() - 30 * 86_400_000) },
        },
      });
      if (memberCount >= 5) {
        factors.push({
          name: 'high_member_velocity',
          contribution: Math.min(weights.high_member_velocity, memberCount * 0.03),
          explanation: `Member "${claim.memberNumber}" has ${memberCount + 1} claims in the past 30 days`,
        });
      }
    }

    // Factor 4: OCR confidence weakness
    if (claim.ocrConfidence != null && claim.ocrConfidence < 0.6) {
      factors.push({
        name: 'low_ocr_confidence',
        contribution: weights.low_ocr_confidence,
        explanation: `OCR extracted fields with only ${Math.round(claim.ocrConfidence * 100)}% confidence — increases risk of misread values`,
      });
    }

    // Factor 5: Weekend/after-hours submission
    const hr = claim.submittedAt.getHours();
    const dow = claim.submittedAt.getDay();
    const offHours = hr < 6 || hr > 22;
    const weekend = dow === 0 || dow === 6;
    if (offHours || weekend) {
      factors.push({
        name: 'off_hours_submission',
        contribution: weights.off_hours_submission,
        explanation: `Submitted at ${weekend ? 'weekend' : 'unusual hours'} (${claim.submittedAt.toLocaleString()})`,
      });
    }

    // Factor 6: Existing fraud signals contribute
    const fraudSignals = Array.isArray(claim.fraudSignals) ? claim.fraudSignals as any[] : [];
    if (fraudSignals.length > 0) {
      const critical = fraudSignals.filter(s => s?.level === 'critical').length;
      const warnings = fraudSignals.length - critical;
      const contribution = Math.min(weights.fraud_signals_present, critical * 0.15 + warnings * 0.05);
      factors.push({
        name: 'fraud_signals_present',
        contribution,
        explanation: `${critical} critical + ${warnings} warning fraud signal(s) already detected`,
      });
    }

    // Factor 7: Round-amount + high-value combined
    const amt = claim.invoiceAmount || 0;
    if (amt >= 50_000 && amt % 1000 === 0) {
      factors.push({
        name: 'round_high_value',
        contribution: weights.round_high_value,
        explanation: `Round-amount claim (KES ${amt.toLocaleString()}) — statistically associated with estimated/inflated invoices`,
      });
    }

    // Factor 8: Provider behavioral drift — last-30-day avg vs prior-30-day avg
    if (peers.length >= 5 && providerPrev30.length >= 5 && claim.invoiceAmount) {
      const last30 = peers
        .filter(p => p.submittedAt && p.submittedAt >= thirtyDaysAgo)
        .map(p => p.invoiceAmount!);
      if (last30.length >= 3 && providerPrev30.length >= 3) {
        const avgLast30 = last30.reduce((s, a) => s + a, 0) / last30.length;
        const avgPrev30 = providerPrev30.map(p => p.invoiceAmount!).reduce((s, a) => s + a, 0) / providerPrev30.length;
        const driftRatio = avgPrev30 > 0 ? Math.abs(avgLast30 - avgPrev30) / avgPrev30 : 0;
        if (driftRatio > 0.2) {
          factors.push({
            name: 'provider_drift',
            contribution: Math.min(weights.provider_drift, driftRatio * 0.3),
            explanation: `Provider's 30-day average claim amount has shifted ${(driftRatio * 100).toFixed(0)}% vs prior 30 days (KES ${Math.round(avgPrev30).toLocaleString()} → KES ${Math.round(avgLast30).toLocaleString()})`,
          });
        }
      }
    }

    // Sum contributions, cap at 1.0
    const rawScore = factors.reduce((s, f) => s + f.contribution, 0);
    const score = Math.min(1, Math.max(0, rawScore));
    const riskLevel: 'low' | 'medium' | 'high' = score >= 0.6 ? 'high' : score >= 0.3 ? 'medium' : 'low';

    // Persist on OcrExtraction if it exists, otherwise create
    try {
      await this.prisma.ocrExtraction.upsert({
        where: { claimId },
        update: { anomalyScore: score, anomalyReasons: factors.map(f => f.name) },
        create: {
          claimId,
          anomalyScore: score,
          anomalyReasons: factors.map(f => f.name),
          status: 'completed',
        },
      });
    } catch (e: any) {
      this.logger.warn(`Failed to persist anomaly score for claim ${claimId}: ${e.message}`);
    }

    return { score, factors, riskLevel };
  }

  async getAnomalyDetail(claimId: string): Promise<AnomalyDetail> {
    return this.scoreClaim(claimId);
  }

  /**
   * Compute weighted statistics by joining anomaly factors with labelled outcomes.
   * Returns per-factor "predictive power" — how often each factor correlates with
   * fraud labels vs legitimate labels. This is the input for tuning factor weights.
   */
  async getFactorEffectiveness() {
    const labels = await this.prisma.claimLabel.findMany({
      where: { label: { in: ['fraud', 'suspicious', 'legitimate'] } },
      take: 1000,
    });

    if (labels.length < 20) {
      return {
        sampleSize: labels.length,
        message: 'Insufficient labelled data to compute factor effectiveness. Collect more labels first.',
        factors: [],
      };
    }

    const fraudLabels = labels.filter(l => l.label === 'fraud' || l.label === 'suspicious');
    const goodLabels = labels.filter(l => l.label === 'legitimate');

    const computeMean = (items: any[], key: string) => {
      const vals = items.map(i => (i.featuresSnapshot as any)?.[key]).filter(v => typeof v === 'number');
      return vals.length === 0 ? 0 : vals.reduce((s, v) => s + v, 0) / vals.length;
    };

    const factors = [
      { name: 'invoiceAmount', fraudAvg: computeMean(fraudLabels, 'invoiceAmount'), goodAvg: computeMean(goodLabels, 'invoiceAmount') },
      { name: 'ocrConfidence', fraudAvg: computeMean(fraudLabels, 'ocrConfidence'), goodAvg: computeMean(goodLabels, 'ocrConfidence') },
      { name: 'anomalyScore', fraudAvg: computeMean(fraudLabels, 'anomalyScore'), goodAvg: computeMean(goodLabels, 'anomalyScore') },
      { name: 'fraudSignalCount', fraudAvg: computeMean(fraudLabels, 'fraudSignalCount'), goodAvg: computeMean(goodLabels, 'fraudSignalCount') },
      { name: 'fraudSignalCritical', fraudAvg: computeMean(fraudLabels, 'fraudSignalCritical'), goodAvg: computeMean(goodLabels, 'fraudSignalCritical') },
      { name: 'resubmissionCount', fraudAvg: computeMean(fraudLabels, 'resubmissionCount'), goodAvg: computeMean(goodLabels, 'resubmissionCount') },
    ].map(f => ({
      ...f,
      separation: Math.abs(f.fraudAvg - f.goodAvg) / Math.max(1, Math.abs(f.fraudAvg + f.goodAvg) / 2),
    }));

    return {
      sampleSize: labels.length,
      fraudLabels: fraudLabels.length,
      legitimateLabels: goodLabels.length,
      factors: factors.sort((a, b) => b.separation - a.separation),
    };
  }

  /**
   * Calibrate factor weights from labelled claim data using a Platt-style
   * separation score. Deactivates all previous weight rows, then writes and
   * activates a new FraudModelWeights row.
   *
   * Should be called when >= 50 labelled claims are available. The updated
   * weights are picked up by scoreClaim() within one cache TTL (1 hour) or
   * immediately after the next process restart.
   */
  async calibrateWeights(): Promise<{ success: boolean; message: string; weights?: Record<string, number> }> {
    const labels = await this.prisma.claimLabel.findMany({
      where: {
        label: { in: ['fraud', 'suspicious', 'legitimate'] },
        featuresSnapshot: { not: null },
      },
      take: 2000,
      orderBy: { createdAt: 'desc' },
    });

    const fraudRows = labels.filter(l => l.label === 'fraud' || l.label === 'suspicious');
    const legitRows = labels.filter(l => l.label === 'legitimate');

    if (fraudRows.length < 10 || legitRows.length < 10) {
      return {
        success: false,
        message: `Insufficient labelled data: ${fraudRows.length} fraud + ${legitRows.length} legitimate labels. Need at least 10 of each.`,
      };
    }

    const featureKeys = [
      'anomalyScore', 'fraudSignalCount', 'fraudSignalCritical',
      'invoiceAmount', 'ocrConfidence', 'resubmissionCount',
    ];

    // Map feature keys to anomaly factor names for weight injection
    const featureToFactor: Record<string, string> = {
      anomalyScore: 'fraud_signals_present',
      fraudSignalCount: 'fraud_signals_present',
      fraudSignalCritical: 'fraud_signals_present',
      invoiceAmount: 'amount_outlier',
      ocrConfidence: 'low_ocr_confidence',
      resubmissionCount: 'high_member_velocity',
    };

    const getFeature = (row: any, key: string): number => {
      const snap = row.featuresSnapshot as Record<string, any> | null;
      const v = snap?.[key];
      return typeof v === 'number' ? v : 0;
    };

    // Compute separation score per feature: |fraud_mean - legit_mean| / pooled_mean
    const separations: Record<string, number> = {};
    for (const key of featureKeys) {
      const fraudMean = fraudRows.map(r => getFeature(r, key)).reduce((s, v) => s + v, 0) / fraudRows.length;
      const legitMean = legitRows.map(r => getFeature(r, key)).reduce((s, v) => s + v, 0) / legitRows.length;
      const pooled = Math.max(0.001, Math.abs(fraudMean + legitMean) / 2);
      separations[key] = Math.abs(fraudMean - legitMean) / pooled;
    }

    // Aggregate separations by factor name (take max separation for shared factors)
    const factorSeparations: Record<string, number> = {};
    for (const [feat, factor] of Object.entries(featureToFactor)) {
      factorSeparations[factor] = Math.max(factorSeparations[factor] ?? 0, separations[feat] ?? 0);
    }

    // Normalise to a 0.05–0.45 range so no single factor dominates
    const maxSep = Math.max(...Object.values(factorSeparations), 0.001);
    const calibrated: Record<string, number> = { ...DEFAULT_WEIGHTS };
    for (const [factor, sep] of Object.entries(factorSeparations)) {
      const normalised = sep / maxSep;
      calibrated[factor] = parseFloat((0.05 + normalised * 0.40).toFixed(3));
    }

    // Deactivate previous active weights, then persist new row
    await this.prisma.fraudModelWeights.updateMany({ where: { isActive: true }, data: { isActive: false } });
    await this.prisma.fraudModelWeights.create({
      data: {
        weights: calibrated,
        sampleSize: labels.length,
        fraudCount: fraudRows.length,
        legitimateCount: legitRows.length,
        isActive: true,
      },
    });

    // Invalidate in-memory cache so next scoreClaim() call picks up new weights
    this.weightsCachedAt = 0;
    this.cachedWeights = { ...DEFAULT_WEIGHTS, ...calibrated };

    this.logger.log(`Weights calibrated from ${labels.length} labels (${fraudRows.length} fraud, ${legitRows.length} legit)`);
    return {
      success: true,
      message: `Calibrated from ${labels.length} labels (${fraudRows.length} fraud + ${legitRows.length} legitimate).`,
      weights: calibrated,
    };
  }
}
