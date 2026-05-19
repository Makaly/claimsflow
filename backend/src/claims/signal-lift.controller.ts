import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';

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
    const labelWhere: any = {};
    if (dateFrom || dateTo) {
      labelWhere.createdAt = {};
      if (dateFrom) labelWhere.createdAt.gte = new Date(dateFrom);
      if (dateTo) labelWhere.createdAt.lte = new Date(dateTo);
    }

    const labels = await this.prisma.claimLabel.findMany({
      where: labelWhere,
      select: { claimId: true, label: true },
    });
    if (labels.length === 0) {
      return { baseRate: 0, totalClaims: 0, totalFraud: 0, signals: [] };
    }

    const claimIds = labels.map(l => l.claimId);
    const claims = await this.prisma.claim.findMany({
      where: { id: { in: claimIds } },
      select: { id: true, fraudSignals: true },
    });
    const signalsByClaim = new Map<string, string[]>(
      claims.map(c => [c.id, extractSignalNames(c.fraudSignals)]),
    );

    const totalFraud = labels.filter(l => l.label === 'fraud').length;
    const baseRate = labels.length > 0 ? totalFraud / labels.length : 0;

    const signalMap: Record<string, { total: number; fraud: number }> = {};
    for (const l of labels) {
      const signals = signalsByClaim.get(l.claimId) ?? [];
      const isFraud = l.label === 'fraud';
      for (const signal of signals) {
        if (!signalMap[signal]) signalMap[signal] = { total: 0, fraud: 0 };
        signalMap[signal].total += 1;
        if (isFraud) signalMap[signal].fraud += 1;
      }
    }

    const rows = Object.entries(signalMap).map(([signal, { total, fraud }]) => ({
      signal,
      total,
      fraud,
      fraudRate: total > 0 ? fraud / total : 0,
      lift: baseRate > 0 && total > 0 ? fraud / total / baseRate : null,
    }));
    rows.sort((a, b) => (b.lift ?? 0) - (a.lift ?? 0));

    return { baseRate, totalClaims: labels.length, totalFraud, signals: rows };
  }
}

function extractSignalNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const names: string[] = [];
  for (const entry of raw) {
    if (typeof entry === 'string') names.push(entry);
    else if (entry && typeof entry === 'object' && typeof (entry as any).title === 'string') {
      names.push((entry as any).title);
    }
  }
  return names;
}
