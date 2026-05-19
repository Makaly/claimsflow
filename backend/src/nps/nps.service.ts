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

@Injectable()
export class NpsService {
  constructor(private readonly prisma: PrismaService) {}

  async submit(dto: SubmitNpsDto) {
    if (dto.score < 0 || dto.score > 10) {
      throw new Error('score must be 0-10');
    }
    return this.prisma.npsResponse.create({ data: { ...dto } });
  }

  /** Aggregate NPS segmented by claimType, providerId, rejectionReason. */
  async dashboard(filters: { from?: string; to?: string }) {
    const where: any = {};
    if (filters.from) where.createdAt = { ...where.createdAt, gte: new Date(filters.from) };
    if (filters.to) where.createdAt = { ...where.createdAt, lt: new Date(filters.to) };

    const rows = await this.prisma.npsResponse.findMany({ where });

    const total = rows.length;
    const avgScore = total > 0 ? rows.reduce((s, r) => s + r.score, 0) / total : 0;

    // NPS formula: (promoters% - detractors%)
    const promoters = rows.filter(r => r.score >= 9).length;
    const detractors = rows.filter(r => r.score <= 6).length;
    const npsScore = total > 0 ? Math.round(((promoters - detractors) / total) * 100) : 0;

    const byClaimType = this.group(rows, 'claimType');
    const byProvider = this.group(rows, 'providerId');
    const byRejectionReason = this.group(rows, 'rejectionReason');

    return { total, avgScore: Math.round(avgScore * 10) / 10, npsScore, byClaimType, byProvider, byRejectionReason };
  }

  private group(rows: any[], key: string) {
    const map = new Map<string, number[]>();
    for (const r of rows) {
      const k = r[key] ?? 'unknown';
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(r.score);
    }
    return Object.fromEntries(
      Array.from(map.entries()).map(([k, scores]) => [
        k,
        {
          count: scores.length,
          avg: Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10,
        },
      ]),
    );
  }
}
