import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';

/**
 * T2.3 — Signal-lift report: for each fraud signal, how much does flagging
 * that signal improve fraud-detection rate vs. the base rate?
 */
@Controller('fraud-thresholds/signal-lift')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SignalLiftController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @Roles('admin', 'fraud_officer')
  async getSignalLift(
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    const where: any = { isLabelled: true };
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(dateFrom);
      if (dateTo) where.createdAt.lte = new Date(dateTo);
    }

    const claims = await this.prisma.claim.findMany({
      where,
      select: {
        fraudSignals: true,
        labels: { select: { isFraud: true } },
      },
    });

    const totalFraud = claims.filter(c => c.labels.some(l => l.isFraud)).length;
    const baseRate = claims.length > 0 ? totalFraud / claims.length : 0;

    const signalMap: Record<string, { total: number; fraud: number }> = {};

    for (const claim of claims) {
      const signals: string[] = Array.isArray(claim.fraudSignals)
        ? (claim.fraudSignals as string[])
        : [];
      const isFraud = claim.labels.some(l => l.isFraud);
      for (const signal of signals) {
        if (!signalMap[signal]) signalMap[signal] = { total: 0, fraud: 0 };
        signalMap[signal].total++;
        if (isFraud) signalMap[signal].fraud++;
      }
    }

    const rows = Object.entries(signalMap).map(([signal, { total, fraud }]) => ({
      signal,
      total,
      fraud,
      fraudRate: total > 0 ? fraud / total : 0,
      lift: baseRate > 0 ? (total > 0 ? fraud / total : 0) / baseRate : null,
    }));

    rows.sort((a, b) => (b.lift ?? 0) - (a.lift ?? 0));

    return { baseRate, totalClaims: claims.length, totalFraud, signals: rows };
  }
}
