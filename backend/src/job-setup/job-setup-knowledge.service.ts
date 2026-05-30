import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

function normVal(v: any): string {
  return String(v ?? '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Per-job-setup learning store. Every query and write is scoped by jobSetupId,
 * which is what guarantees ISOLATION: the values, frequencies and co-occurrence
 * context learned under one setup (e.g. "Invoice") are never read while a user
 * is indexing under a different setup. There is no shared/global knowledge pool.
 */
@Injectable()
export class JobSetupKnowledgeService {
  constructor(private prisma: PrismaService) {}

  /** Record confirmed field values for a setup, accumulating frequency. */
  async record(jobSetupId: string, values: Record<string, any>) {
    const setup = await this.prisma.jobSetup.findUnique({ where: { id: jobSetupId } });
    if (!setup || !setup.learningEnabled) return { recorded: 0 };

    const entries = Object.entries(values || {}).filter(
      ([, v]) => v !== null && v !== undefined && String(v).trim() !== '',
    );
    // Co-occurring values give later suggestions context (e.g. which provider
    // tends to go with which scheme) — still strictly within this setup.
    const context: Record<string, any> = {};
    for (const [k, v] of entries) context[k] = v;

    let recorded = 0;
    for (const [fieldKey, value] of entries) {
      const valueNorm = normVal(value);
      if (!valueNorm) continue;
      // eslint-disable-next-line no-await-in-loop
      await this.prisma.jobSetupKnowledge.upsert({
        where: { jobSetupId_fieldKey_valueNorm: { jobSetupId, fieldKey, valueNorm } },
        create: {
          jobSetupId,
          fieldKey,
          valueNorm,
          valueDisplay: String(value).trim(),
          context,
          frequency: 1,
        },
        update: {
          frequency: { increment: 1 },
          lastSeenAt: new Date(),
          valueDisplay: String(value).trim(),
          context,
        },
      });
      recorded++;
    }
    return { recorded };
  }

  /** Type-ahead suggestions for a field, scoped to this setup, ranked by use. */
  async suggest(jobSetupId: string, fieldKey: string, prefix = '', limit = 8) {
    const p = normVal(prefix);
    const rows = await this.prisma.jobSetupKnowledge.findMany({
      where: {
        jobSetupId,
        fieldKey,
        ...(p ? { valueNorm: { contains: p } } : {}),
      },
      orderBy: [{ frequency: 'desc' }, { lastSeenAt: 'desc' }],
      take: limit,
    });
    return rows.map((r) => ({ value: r.valueDisplay, frequency: r.frequency }));
  }

  /** Highest-frequency learned value for a field (used to auto-fill on entry). */
  async topValue(jobSetupId: string, fieldKey: string): Promise<string | null> {
    const row = await this.prisma.jobSetupKnowledge.findFirst({
      where: { jobSetupId, fieldKey },
      orderBy: [{ frequency: 'desc' }, { lastSeenAt: 'desc' }],
    });
    return row?.valueDisplay ?? null;
  }

  /** Summary of what a setup has learned, per field — for the admin UI. */
  async stats(jobSetupId: string) {
    const rows = await this.prisma.jobSetupKnowledge.groupBy({
      by: ['fieldKey'],
      where: { jobSetupId },
      _count: { _all: true },
      _sum: { frequency: true },
    });
    return rows.map((r) => ({
      fieldKey: r.fieldKey,
      distinctValues: r._count._all,
      totalObservations: r._sum.frequency ?? 0,
    }));
  }

  async reset(jobSetupId: string) {
    const { count } = await this.prisma.jobSetupKnowledge.deleteMany({ where: { jobSetupId } });
    return { cleared: count };
  }
}
