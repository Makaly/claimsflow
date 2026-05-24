import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../notifications/email.service';

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
  ) {}

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
      where: {},
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

  // ── Provider Performance Scorecard ────────────────────────────
  async getProviderScorecard(providerId?: string, dateFrom?: string, dateTo?: string) {
    const where = this.buildDateFilter(dateFrom, dateTo);
    // Include all providers that have submitted at least one claim — isActive
    // defaults to false until admin-approved but providers with claims are real
    // participants. The total===0 guard below handles providers with no data.
    const providerFilter = providerId ? { id: providerId } : {};

    const providers = await this.prisma.provider.findMany({
      where: providerFilter,
      select: {
        id: true, name: true, type: true,
        claims: {
          where,
          select: {
            status: true, invoiceAmount: true, ocrConfidence: true,
            isComplete: true, resubmissionCount: true, requiresManualReview: true,
            fraudSignals: true, submittedAt: true, approvedAt: true,
          },
        },
      },
    });

    return providers.map((p) => {
      const claims = p.claims;
      const total = claims.length;
      if (total === 0) return null;
      const approved = claims.filter(c => c.status === 'approved' || c.status === 'paid').length;
      const rejected = claims.filter(c => c.status === 'rejected').length;
      const decided = approved + rejected;
      const incomplete = claims.filter(c => !c.isComplete).length;
      const resubmitted = claims.filter(c => c.resubmissionCount > 0).length;
      const withFraud = claims.filter(c => Array.isArray(c.fraudSignals) && (c.fraudSignals as any[]).length > 0).length;
      const totalAmount = claims.reduce((s, c) => s + (c.invoiceAmount || 0), 0);
      const approvalRate = decided > 0 ? +(approved / decided * 100).toFixed(1) : 0;
      const rejectionRate = decided > 0 ? +(rejected / decided * 100).toFixed(1) : 0;
      const fraudRate = total > 0 ? +(withFraud / total * 100).toFixed(1) : 0;
      const incompleteRate = total > 0 ? +(incomplete / total * 100).toFixed(1) : 0;
      const resubmissionRate = total > 0 ? +(resubmitted / total * 100).toFixed(1) : 0;

      // OCR re-key rate: claims that required manual review after OCR
      const ocrRekeyCount = claims.filter(c => c.requiresManualReview).length;
      const ocrRekeyRate = total > 0 ? +(ocrRekeyCount / total * 100).toFixed(1) : 0;

      // quality_score: penalise rejection, fraud, and OCR re-key (0–100)
      const quality_score = Math.max(0, Math.min(100, Math.round(
        100 - rejectionRate * 0.5 - fraudRate * 2 - ocrRekeyRate * 0.3,
      )));

      // volume_score: normalised claims count; capped at 500/month = 100
      // Providers with more claims and higher amounts score higher on volume.
      const volume_score = Math.min(100, Math.round((total / 500) * 100));

      // blended_score: backward-compatible composite (weighted 60% quality, 40% volume)
      const score = Math.round(quality_score * 0.6 + volume_score * 0.4);

      return {
        providerId: p.id, providerName: p.name, providerType: p.type,
        totalClaims: total, approved, rejected, approvalRate, rejectionRate,
        totalAmount: +totalAmount.toFixed(2),
        fraudRate, incompleteRate, resubmissionRate, ocrRekeyRate,
        // Split scores
        quality_score,
        volume_score,
        // Blended score preserved for backward compatibility
        score,
        riskLevel: fraudRate > 15 ? 'high' : fraudRate > 8 ? 'medium' : 'low',
      };
    }).filter(Boolean).sort((a, b) => b!.score - a!.score);
  }

  // ── Aging Report ───────────────────────────────────────────────
  async getAgingReport(stage?: string) {
    const now = new Date();
    const where: any = { status: { notIn: ['approved', 'paid', 'rejected'] } };
    if (stage) where.workflowStage = stage;

    const claims = await this.prisma.claim.findMany({
      where,
      include: {
        provider: { select: { name: true } },
        assignedUser: { select: { name: true } },
      },
      orderBy: { submittedAt: 'asc' },
    });

    const buckets: Record<string, number> = { '0-24h': 0, '1-2d': 0, '2-5d': 0, '5d+': 0 };
    const stageBreakdown: Record<string, { count: number; breached: number }> = {};

    const rows = claims.map((c) => {
      const hours = (now.getTime() - new Date(c.submittedAt).getTime()) / 3_600_000;
      const days = hours / 24;
      if (hours < 24) buckets['0-24h']++;
      else if (days < 2) buckets['1-2d']++;
      else if (days < 5) buckets['2-5d']++;
      else buckets['5d+']++;

      if (!stageBreakdown[c.workflowStage]) stageBreakdown[c.workflowStage] = { count: 0, breached: 0 };
      stageBreakdown[c.workflowStage].count++;
      if (c.slaBreached) stageBreakdown[c.workflowStage].breached++;

      return {
        claimId: c.id, claimNumber: c.claimNumber,
        providerName: c.provider?.name ?? 'Unknown',
        assignedTo: c.assignedUser?.name ?? 'Unassigned',
        workflowStage: c.workflowStage,
        hoursElapsed: Math.round(hours),
        daysElapsed: +days.toFixed(1),
        slaBreached: c.slaBreached,
        submittedAt: c.submittedAt,
        invoiceAmount: c.invoiceAmount,
      };
    });

    return { buckets, stageBreakdown, claims: rows, total: rows.length };
  }

  // ── Cross-Provider Duplicate Detection ────────────────────────
  async getCrossProviderDuplicates(dateFrom?: string, dateTo?: string) {
    const where = this.buildDateFilter(dateFrom, dateTo);
    const claims = await this.prisma.claim.findMany({
      where: { ...where, invoiceNumber: { not: null } },
      select: {
        id: true, claimNumber: true, invoiceNumber: true,
        memberNumber: true, invoiceAmount: true, dateOfService: true,
        providerId: true, provider: { select: { name: true } },
        status: true, submittedAt: true,
      },
    });

    const groups: Record<string, typeof claims> = {};
    for (const c of claims) {
      const key = `${c.invoiceNumber}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(c);
    }

    const duplicates = Object.values(groups)
      .filter(g => g.length > 1 && new Set(g.map(c => c.providerId)).size > 1)
      .map(g => ({
        invoiceNumber: g[0].invoiceNumber,
        count: g.length,
        providerCount: new Set(g.map(c => c.providerId)).size,
        totalAmount: g.reduce((s, c) => s + (c.invoiceAmount ?? 0), 0),
        claims: g,
      }));

    return { duplicates, total: duplicates.length };
  }

  // ── Data Retention Automation (G23/G24) ───────────────────────
  @Cron('0 2 * * *') // daily at 02:00
  async runRetentionCleanup() {
    // ── G23: Activity log purge ──────────────────────────────────
    const logRetentionCfg = await this.prisma.systemConfig.findUnique({ where: { key: 'log_retention_days' } });
    const logRetentionDays = logRetentionCfg ? parseInt(logRetentionCfg.value, 10) : 730;
    const logCutoff = new Date(Date.now() - logRetentionDays * 86_400_000);

    const { count: deletedLogs } = await this.prisma.activityLog.deleteMany({
      where: { createdAt: { lt: logCutoff } },
    });

    // ── G24: Claim purge-request flagging ────────────────────────
    const claimRetentionCfg = await this.prisma.systemConfig.findUnique({ where: { key: 'claim_retention_days' } });
    const claimRetentionDays = claimRetentionCfg ? parseInt(claimRetentionCfg.value, 10) : 2555; // 7 years
    const claimCutoff = new Date(Date.now() - claimRetentionDays * 86_400_000);

    const agingClaims = await this.prisma.claim.findMany({
      where: {
        createdAt: { lt: claimCutoff },
        status: { in: ['paid', 'rejected'] },
      },
      select: { id: true },
    });

    let purgeRequestsCreated = 0;
    for (const claim of agingClaims) {
      // Only create if no existing purge request for this claim
      const existing = await this.prisma.purgeRequest.findFirst({
        where: {
          sourceDocumentIds: { array_contains: claim.id },
        },
      });
      if (!existing) {
        await this.prisma.purgeRequest.create({
          data: {
            sourceDocumentIds: [claim.id],
            reason: `Automated: claim older than ${claimRetentionDays} days`,
            requestedBy: 'system',
            status: 'pending',
          },
        });
        purgeRequestsCreated++;
      }
    }

    this.logger.log(
      `Retention cleanup: deleted ${deletedLogs} activity log(s) older than ${logRetentionDays}d; created ${purgeRequestsCreated} purge request(s) for claims older than ${claimRetentionDays}d`,
    );
  }

  // ── Scheduled Report Delivery ──────────────────────────────────
  @Cron('0 6 * * *') // daily at 06:00
  async runScheduledReports() {
    const reports = await this.prisma.report.findMany({
      where: { isScheduled: true, isActive: true },
    });

    for (const report of reports) {
      try {
        const data = await this.executeReport(report.type, report.parameters as any);
        const execution = await this.prisma.reportExecution.create({
          data: { reportId: report.id, status: 'running', executedBy: 'system' },
        });
        await this.prisma.reportExecution.update({
          where: { id: execution.id },
          data: { status: 'completed', completedAt: new Date(), rowCount: Array.isArray(data) ? data.length : 0 },
        });
        await this.prisma.report.update({ where: { id: report.id }, data: { lastRunAt: new Date() } });

        // Email recipients
        for (const email of (report.recipients || [])) {
          this.emailService.sendEmail(
            email,
            `Scheduled Report: ${report.name}`,
            `Your scheduled report "${report.name}" has been generated. Summary:\n${JSON.stringify(data, null, 2).slice(0, 500)}...`,
          ).catch(() => {});
        }
      } catch (e: any) {
        this.logger.error(`Scheduled report ${report.id} failed: ${e.message}`);
        await this.prisma.reportExecution.create({
          data: { reportId: report.id, status: 'failed', completedAt: new Date(), error: e.message, executedBy: 'system' },
        });
      }
    }
  }

  private async executeReport(type: string, params?: any) {
    switch (type) {
      case 'claims_volume': return this.getClaimsVolume(params?.dateFrom, params?.dateTo);
      case 'approvals_rejections': return this.getApprovalsRejections(params?.dateFrom, params?.dateTo);
      case 'provider_performance': return this.getProviderPerformance(params?.dateFrom, params?.dateTo);
      case 'fraud_summary': return this.getFraudSummary(params?.dateFrom, params?.dateTo);
      case 'aging': return this.getAgingReport();
      default: return [];
    }
  }

  async getFraudSummary(dateFrom?: string, dateTo?: string) {
    const where: any = { status: { in: ['fraud_hold', 'fraud_confirmed'] } };
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(dateFrom);
      if (dateTo)   where.createdAt.lte = new Date(dateTo);
    }
    const [total, confirmed, onHold] = await Promise.all([
      this.prisma.claim.count({ where }),
      this.prisma.claim.count({ where: { ...where, status: 'fraud_confirmed' } }),
      this.prisma.claim.count({ where: { ...where, status: 'fraud_hold' } }),
    ]);
    return { total, confirmed, onHold };
  }

  async getProcessingTime(dateFrom?: string, dateTo?: string) {
    const where: any = { status: 'approved' };
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(dateFrom);
      if (dateTo)   where.createdAt.lte = new Date(dateTo);
    }
    const claims = await this.prisma.claim.findMany({
      where,
      select: { createdAt: true, updatedAt: true },
      take: 500,
    });
    const avgMs = claims.length
      ? claims.reduce((s, c) => s + (c.updatedAt.getTime() - c.createdAt.getTime()), 0) / claims.length
      : 0;
    return { averageDays: +(avgMs / 86_400_000).toFixed(1), sampleSize: claims.length };
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
