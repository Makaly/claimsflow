import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface AnomalyDetail {
  score: number; // 0-1, higher = more anomalous
  factors: Array<{ name: string; contribution: number; explanation: string }>;
  riskLevel: 'low' | 'medium' | 'high';
}

@Injectable()
export class AnomalyScoringService {
  private readonly logger = new Logger(AnomalyScoringService.name);

  constructor(private prisma: PrismaService) {}

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

    const factors: AnomalyDetail['factors'] = [];

    // Get the provider's recent claims for baseline stats
    const ninetyDaysAgo = new Date(Date.now() - 90 * 86_400_000);
    const peers = await this.prisma.claim.findMany({
      where: {
        providerId: claim.providerId,
        id: { not: claim.id },
        submittedAt: { gte: ninetyDaysAgo },
        invoiceAmount: { not: null, gt: 0 },
      },
      select: { invoiceAmount: true, memberNumber: true, dateOfService: true, submittedAt: true },
    });

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
            contribution: Math.min(0.3, Math.abs(z) / 10),
            explanation: `Claim amount KES ${claim.invoiceAmount.toLocaleString()} is ${z > 0 ? '+' : ''}${z.toFixed(1)} standard deviations from provider's 90-day average of KES ${Math.round(mean).toLocaleString()}`,
          });
        }
      }
    }

    // Factor 2: Submission velocity — many claims from same provider in short window
    const oneHourAgo = new Date(Date.now() - 3_600_000);
    const recentByProvider = await this.prisma.claim.count({
      where: { providerId: claim.providerId, submittedAt: { gte: oneHourAgo } },
    });
    if (recentByProvider > 20) {
      factors.push({
        name: 'high_submission_velocity',
        contribution: 0.15,
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
          contribution: Math.min(0.25, memberCount * 0.03),
          explanation: `Member "${claim.memberNumber}" has ${memberCount + 1} claims in the past 30 days`,
        });
      }
    }

    // Factor 4: OCR confidence weakness
    if (claim.ocrConfidence != null && claim.ocrConfidence < 0.6) {
      factors.push({
        name: 'low_ocr_confidence',
        contribution: 0.15,
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
        contribution: 0.05,
        explanation: `Submitted at ${weekend ? 'weekend' : 'unusual hours'} (${claim.submittedAt.toLocaleString()})`,
      });
    }

    // Factor 6: Existing fraud signals contribute
    const fraudSignals = Array.isArray(claim.fraudSignals) ? claim.fraudSignals as any[] : [];
    if (fraudSignals.length > 0) {
      const critical = fraudSignals.filter(s => s?.level === 'critical').length;
      const warnings = fraudSignals.length - critical;
      const contribution = Math.min(0.4, critical * 0.15 + warnings * 0.05);
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
        contribution: 0.1,
        explanation: `Round-amount claim (KES ${amt.toLocaleString()}) — statistically associated with estimated/inflated invoices`,
      });
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
    // Recompute fresh — cheap enough for single-claim lookup
    return this.scoreClaim(claimId);
  }
}
