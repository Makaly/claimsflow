import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type ClaimLabelType = 'legitimate' | 'suspicious' | 'fraud';
export type ClaimLabelSource = 'auto_approve' | 'auto_reject' | 'manual_review' | 'fraud_confirmed' | 'appeal_outcome';

@Injectable()
export class ClaimLabelsService {
  private readonly logger = new Logger(ClaimLabelsService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Upsert a label for a claim. Captures a feature snapshot so the dataset
   * reflects what the claim looked like at decision time, not at training time.
   */
  async upsertLabel(claimId: string, label: ClaimLabelType, source: ClaimLabelSource, labelledBy?: string, notes?: string) {
    const claim = await this.prisma.claim.findUnique({
      where: { id: claimId },
      include: { ocrData: true },
    });
    if (!claim) {
      this.logger.warn(`Cannot label non-existent claim ${claimId}`);
      return null;
    }

    const featuresSnapshot = {
      invoiceAmount: claim.invoiceAmount,
      ocrConfidence: claim.ocrConfidence,
      anomalyScore: claim.ocrData?.anomalyScore ?? null,
      fraudSignalCount: Array.isArray(claim.fraudSignals) ? (claim.fraudSignals as any[]).length : 0,
      fraudSignalCritical: Array.isArray(claim.fraudSignals)
        ? (claim.fraudSignals as any[]).filter((s: any) => s?.level === 'critical').length
        : 0,
      memberNumberPresent: !!claim.memberNumber,
      providerId: claim.providerId,
      resubmissionCount: claim.resubmissionCount,
      submittedAt: claim.submittedAt,
    };

    // Manual review overrides automatic decisions
    const existing = await this.prisma.claimLabel.findUnique({ where: { claimId } });
    if (existing && existing.source === 'manual_review' && source !== 'manual_review' && source !== 'fraud_confirmed') {
      // Don't overwrite a manual label with an automatic one
      return existing;
    }

    return this.prisma.claimLabel.upsert({
      where: { claimId },
      create: { claimId, label, source, labelledBy, notes, featuresSnapshot },
      update: { label, source, labelledBy: labelledBy ?? existing?.labelledBy, notes: notes ?? existing?.notes, featuresSnapshot },
    });
  }

  async getLabel(claimId: string) {
    return this.prisma.claimLabel.findUnique({ where: { claimId } });
  }

  async listLabels(filters: { label?: string; source?: string; limit?: number; offset?: number } = {}) {
    const where: any = {};
    if (filters.label) where.label = filters.label;
    if (filters.source) where.source = filters.source;
    const [items, total, counts] = await Promise.all([
      this.prisma.claimLabel.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: filters.limit ?? 100,
        skip: filters.offset ?? 0,
      }),
      this.prisma.claimLabel.count({ where }),
      this.prisma.claimLabel.groupBy({
        by: ['label'],
        _count: { label: true },
      }),
    ]);
    const distribution = counts.reduce((acc: any, c: any) => { acc[c.label] = c._count.label; return acc; }, {});
    return { items, total, distribution };
  }

  /**
   * Export all labels as a training dataset (JSON Lines format would be better
   * for very large sets, but for now we return a single JSON document).
   */
  async exportDataset() {
    const labels = await this.prisma.claimLabel.findMany({
      orderBy: { createdAt: 'asc' },
    });
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      totalRows: labels.length,
      schema: ['claimId', 'label', 'source', 'features'],
      data: labels.map(l => ({
        claimId: l.claimId,
        label: l.label,
        source: l.source,
        features: l.featuresSnapshot,
      })),
    };
  }
}
