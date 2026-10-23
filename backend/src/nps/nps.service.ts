import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface SubmitNpsDto {
  claimId?: string;
  memberId?: string;
  score: number;
  comment?: string;
  channel?: string;
  claimType?: string;
  providerId?: string;
  rejectionReason?: string;
}

interface DashboardFilters {
  from?: string;
  to?: string;
}

const bucket = (score: number): 'promoter' | 'passive' | 'detractor' =>
  score >= 9 ? 'promoter' : score >= 7 ? 'passive' : 'detractor';

@Injectable()
export class NpsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Records (or updates) an NPS response. When a claimId is supplied we enrich
   * the row from the claim itself — the in-app prompt only knows the claimId,
   * so this is what makes the dashboard's provider / rejection-reason
   * segmentation populate. One response per (claim, member): re-rating updates
   * the existing row instead of double-counting.
   */
  async submit(dto: SubmitNpsDto) {
    if (dto.score == null || dto.score < 0 || dto.score > 10) {
      throw new Error('score must be 0-10');
    }

    const data: SubmitNpsDto = { ...dto };

    if (dto.claimId) {
      const claim = await this.prisma.claim.findUnique({
        where: { id: dto.claimId },
        select: {
          providerId: true,
          rejectionReason: true,
          memberNumber: true,
          status: true,
          provider: { select: { type: true } },
        },
      });
      if (claim) {
        data.providerId = data.providerId ?? claim.providerId ?? undefined;
        data.rejectionReason = data.rejectionReason ?? claim.rejectionReason ?? undefined;
        data.memberId = data.memberId ?? claim.memberNumber ?? undefined;
        // No first-class "claim type" on the claim; fall back to the provider
        // facility type (hospital / clinic / pharmacy …) so the segment is useful.
        data.claimType = data.claimType ?? claim.provider?.type ?? undefined;
      }

      const existing = await this.prisma.npsResponse.findFirst({
        where: { claimId: dto.claimId, ...(data.memberId ? { memberId: data.memberId } : {}) },
        orderBy: { createdAt: 'desc' },
      });
      if (existing) {
        return this.prisma.npsResponse.update({
          where: { id: existing.id },
          data: {
            score: data.score,
            comment: data.comment,
            channel: data.channel ?? existing.channel,
            claimType: data.claimType,
            providerId: data.providerId,
            rejectionReason: data.rejectionReason,
          },
        });
      }
    }

    return this.prisma.npsResponse.create({ data });
  }

  /** Whether a response already exists for a claim (so the prompt shows once). */
  async hasResponded(claimId: string, memberId?: string): Promise<boolean> {
    const found = await this.prisma.npsResponse.findFirst({
      where: { claimId, ...(memberId ? { memberId } : {}) },
      select: { id: true },
    });
    return !!found;
  }

  private rangeWhere(filters: DashboardFilters) {
    const where: any = {};
    if (filters.from) where.createdAt = { ...where.createdAt, gte: new Date(filters.from) };
    if (filters.to) where.createdAt = { ...where.createdAt, lt: new Date(filters.to) };
    return where;
  }

  /** Aggregate NPS with promoter/passive/detractor split, distribution, trend,
   *  segment breakdowns and recent verbatims. */
  async dashboard(filters: DashboardFilters) {
    const rows = await this.prisma.npsResponse.findMany({
      where: this.rangeWhere(filters),
      orderBy: { createdAt: 'desc' },
    });

    const total = rows.length;
    const avgScore = total > 0 ? rows.reduce((s, r) => s + r.score, 0) / total : 0;

    const promoters = rows.filter((r) => r.score >= 9).length;
    const passives = rows.filter((r) => r.score >= 7 && r.score <= 8).length;
    const detractors = rows.filter((r) => r.score <= 6).length;
    const npsScore = total > 0 ? Math.round(((promoters - detractors) / total) * 100) : 0;

    const pct = (n: number) => (total > 0 ? Math.round((n / total) * 1000) / 10 : 0);
    const breakdown = {
      promoters: { count: promoters, pct: pct(promoters) },
      passives: { count: passives, pct: pct(passives) },
      detractors: { count: detractors, pct: pct(detractors) },
    };

    // Score distribution 0..10.
    const distribution = Array.from({ length: 11 }, (_, score) => ({
      score,
      count: rows.filter((r) => r.score === score).length,
    }));

    // Trend grouped by calendar day, oldest → newest, with rolling NPS per day.
    const byDay = new Map<string, number[]>();
    for (const r of rows) {
      const day = r.createdAt.toISOString().slice(0, 10);
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day)!.push(r.score);
    }
    const trend = Array.from(byDay.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, scores]) => {
        const p = scores.filter((s) => s >= 9).length;
        const d = scores.filter((s) => s <= 6).length;
        return {
          date,
          count: scores.length,
          nps: Math.round(((p - d) / scores.length) * 100),
          avg: Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10,
        };
      });

    const byClaimType = this.group(rows, 'claimType');
    const byProvider = await this.groupProviders(rows);
    const byRejectionReason = this.group(rows, 'rejectionReason');

    const recentComments = rows
      .filter((r) => r.comment && r.comment.trim())
      .slice(0, 12)
      .map((r) => ({
        id: r.id,
        score: r.score,
        comment: r.comment,
        bucket: bucket(r.score),
        channel: r.channel,
        createdAt: r.createdAt,
      }));

    return {
      total,
      avgScore: Math.round(avgScore * 10) / 10,
      npsScore,
      breakdown,
      distribution,
      trend,
      byClaimType,
      byProvider,
      byRejectionReason,
      recentComments,
    };
  }

  /** Flat CSV of every response in range — for finance/ops offline analysis. */
  async exportCsv(filters: DashboardFilters): Promise<string> {
    const rows = await this.prisma.npsResponse.findMany({
      where: this.rangeWhere(filters),
      orderBy: { createdAt: 'desc' },
    });
    const esc = (v: unknown) => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = [
      'createdAt', 'score', 'bucket', 'channel', 'claimId', 'memberId',
      'providerId', 'claimType', 'rejectionReason', 'comment',
    ];
    const lines = rows.map((r) => [
      r.createdAt.toISOString(), r.score, bucket(r.score), r.channel, r.claimId ?? '',
      r.memberId ?? '', r.providerId ?? '', r.claimType ?? '', r.rejectionReason ?? '', r.comment ?? '',
    ].map(esc).join(','));
    return [header.join(','), ...lines].join('\n');
  }

  private group(rows: any[], key: string) {
    const map = new Map<string, number[]>();
    for (const r of rows) {
      const k = r[key] ?? 'unknown';
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(r.score);
    }
    return Object.fromEntries(
      Array.from(map.entries()).map(([k, scores]) => [k, this.segmentStats(scores)]),
    );
  }

  /** Same as group() for providerId, but resolves UUIDs to provider names. */
  private async groupProviders(rows: any[]) {
    const ids = Array.from(new Set(rows.map((r) => r.providerId).filter(Boolean))) as string[];
    const providers = ids.length
      ? await this.prisma.provider.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
      : [];
    const nameById = new Map(providers.map((p) => [p.id, p.name]));
    const map = new Map<string, number[]>();
    for (const r of rows) {
      const k = r.providerId ? nameById.get(r.providerId) ?? r.providerId : 'unknown';
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(r.score);
    }
    return Object.fromEntries(
      Array.from(map.entries()).map(([k, scores]) => [k, this.segmentStats(scores)]),
    );
  }

  private segmentStats(scores: number[]) {
    const count = scores.length;
    const p = scores.filter((s) => s >= 9).length;
    const d = scores.filter((s) => s <= 6).length;
    return {
      count,
      avg: count ? Math.round((scores.reduce((a, b) => a + b, 0) / count) * 10) / 10 : 0,
      nps: count ? Math.round(((p - d) / count) * 100) : 0,
    };
  }
}
