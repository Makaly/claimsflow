import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  // ── Claims Volume ──────────────────────────────────────────────
  async getClaimsVolume(dateFrom?: string, dateTo?: string, groupBy: string = 'day') {
    const where = this.buildDateFilter(dateFrom, dateTo);

    const claims = await this.prisma.claim.findMany({
      where,
      select: { createdAt: true, status: true },
      orderBy: { createdAt: 'asc' },
    });

    const grouped: Record<string, { total: number; byStatus: Record<string, number> }> = {};

    for (const claim of claims) {
      const key = this.formatDateKey(claim.createdAt, groupBy);
      if (!grouped[key]) grouped[key] = { total: 0, byStatus: {} };
      grouped[key].total++;
      grouped[key].byStatus[claim.status] = (grouped[key].byStatus[claim.status] || 0) + 1;
    }

    const data = Object.entries(grouped).map(([period, stats]) => ({
      period,
      total: stats.total,
      byStatus: stats.byStatus,
    }));

    return { data, totalClaims: claims.length, groupBy };
  }

  // ── Uploads Summary ────────────────────────────────────────────
  async getUploadsSummary(dateFrom?: string, dateTo?: string) {
    const where = this.buildDateFilter(dateFrom, dateTo, 'createdAt');

    const batches = await this.prisma.batchSubmission.findMany({
      where,
      select: {
        submissionMethod: true,
        totalClaims: true,
        processedClaims: true,
        failedClaims: true,
        status: true,
      },
    });

    const byMethod: Record<string, { batches: number; totalClaims: number; processed: number; failed: number }> = {};

    for (const batch of batches) {
      const method = batch.submissionMethod || 'unknown';
      if (!byMethod[method]) byMethod[method] = { batches: 0, totalClaims: 0, processed: 0, failed: 0 };
      byMethod[method].batches++;
      byMethod[method].totalClaims += batch.totalClaims;
      byMethod[method].processed += batch.processedClaims;
      byMethod[method].failed += batch.failedClaims;
    }

    return {
      totalBatches: batches.length,
      byMethod,
    };
  }

  // ── Approvals & Rejections ─────────────────────────────────────
  async getApprovalsRejections(dateFrom?: string, dateTo?: string) {
    const where = this.buildDateFilter(dateFrom, dateTo);

    const [total, approved, rejected, paid] = await Promise.all([
      this.prisma.claim.count({ where }),
      this.prisma.claim.count({ where: { ...where, status: 'approved' } }),
      this.prisma.claim.count({ where: { ...where, status: 'rejected' } }),
      this.prisma.claim.count({ where: { ...where, status: 'paid' } }),
    ]);

    const decided = approved + rejected;

    return {
      total,
      approved,
      rejected,
      paid,
      approvalRate: decided > 0 ? +(approved / decided * 100).toFixed(2) : 0,
      rejectionRate: decided > 0 ? +(rejected / decided * 100).toFixed(2) : 0,
      pending: total - decided - paid,
    };
  }

  // ── Audit Trail ────────────────────────────────────────────────
  async getAuditTrail(params: {
    dateFrom?: string;
    dateTo?: string;
    action?: string;
    entity?: string;
    userId?: string;
    limit?: number;
    offset?: number;
  }) {
    const where: any = {};

    if (params.dateFrom || params.dateTo) {
      where.createdAt = {};
      if (params.dateFrom) where.createdAt.gte = new Date(params.dateFrom);
      if (params.dateTo) where.createdAt.lte = new Date(params.dateTo + 'T23:59:59');
    }
    if (params.action) where.action = { contains: params.action, mode: 'insensitive' };
    if (params.entity) where.entity = params.entity;
    if (params.userId) where.userId = params.userId;

    const [logs, total] = await Promise.all([
      this.prisma.activityLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: params.limit || 50,
        skip: params.offset || 0,
        include: {
          user: { select: { name: true, email: true, role: true } },
        },
      }),
      this.prisma.activityLog.count({ where }),
    ]);

    return { logs, total };
  }

  // ── Error & Omission Rates ─────────────────────────────────────
  async getErrorOmissionRates(dateFrom?: string, dateTo?: string) {
    const where = this.buildDateFilter(dateFrom, dateTo);

    const [total, incomplete, ocrFailed, requiresManualReview] = await Promise.all([
      this.prisma.claim.count({ where }),
      this.prisma.claim.count({ where: { ...where, status: 'incomplete' } }),
      this.prisma.claim.count({ where: { ...where, ocrStatus: 'failed' } }),
      this.prisma.claim.count({ where: { ...where, requiresManualReview: true } }),
    ]);

    // Claims with missing documents
    const withMissingDocs = await this.prisma.claim.count({
      where: {
        ...where,
        isComplete: false,
        NOT: { missingDocuments: { isEmpty: true } },
      },
    });

    return {
      total,
      incomplete,
      ocrFailed,
      requiresManualReview,
      withMissingDocuments: withMissingDocs,
      incompleteRate: total > 0 ? +(incomplete / total * 100).toFixed(2) : 0,
      ocrFailureRate: total > 0 ? +(ocrFailed / total * 100).toFixed(2) : 0,
      manualReviewRate: total > 0 ? +(requiresManualReview / total * 100).toFixed(2) : 0,
    };
  }

  // ── Provider Performance ───────────────────────────────────────
  async getProviderPerformance(dateFrom?: string, dateTo?: string) {
    const where = this.buildDateFilter(dateFrom, dateTo);

    const providers = await this.prisma.provider.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        type: true,
        claims: {
          where,
          select: {
            status: true,
            invoiceAmount: true,
            ocrConfidence: true,
            isComplete: true,
          },
        },
      },
    });

    const data = providers.map((provider) => {
      const claims = provider.claims;
      const total = claims.length;
      const approved = claims.filter((c) => c.status === 'approved' || c.status === 'paid').length;
      const rejected = claims.filter((c) => c.status === 'rejected').length;
      const incomplete = claims.filter((c) => c.status === 'incomplete').length;
      const totalAmount = claims.reduce((sum, c) => sum + (c.invoiceAmount || 0), 0);
      const avgConfidence =
        claims.length > 0
          ? claims.reduce((sum, c) => sum + (c.ocrConfidence || 0), 0) / claims.length
          : 0;
      const decided = approved + rejected;

      return {
        providerId: provider.id,
        providerName: provider.name,
        providerType: provider.type,
        totalClaims: total,
        approved,
        rejected,
        incomplete,
        approvalRate: decided > 0 ? +(approved / decided * 100).toFixed(2) : 0,
        totalAmount: +totalAmount.toFixed(2),
        avgOcrConfidence: +avgConfidence.toFixed(2),
      };
    });

    // Sort by total claims descending, exclude providers with zero claims
    return {
      data: data.filter((d) => d.totalClaims > 0).sort((a, b) => b.totalClaims - a.totalClaims),
    };
  }

  // ── Helpers ────────────────────────────────────────────────────

  private buildDateFilter(dateFrom?: string, dateTo?: string, field: string = 'createdAt') {
    const where: any = {};
    if (dateFrom || dateTo) {
      where[field] = {};
      if (dateFrom) where[field].gte = new Date(dateFrom);
      if (dateTo) where[field].lte = new Date(dateTo + 'T23:59:59');
    }
    return where;
  }

  private formatDateKey(date: Date, groupBy: string): string {
    const d = new Date(date);
    switch (groupBy) {
      case 'week': {
        // ISO week: use the Monday of the week
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1);
        const monday = new Date(d);
        monday.setDate(diff);
        return monday.toISOString().slice(0, 10);
      }
      case 'month':
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      case 'day':
      default:
        return d.toISOString().slice(0, 10);
    }
  }
}
