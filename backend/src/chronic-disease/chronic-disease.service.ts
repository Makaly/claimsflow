import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

interface QualifyingRule {
  icd10Prefixes: string[];
  minEncounters: number;
  withinDays: number;
}

interface CareGapFlag {
  memberNumber: string;
  conditionCode: string;
  conditionName: string;
  gapDescription: string;
}

@Injectable()
export class ChronicDiseaseService {
  private readonly logger = new Logger(ChronicDiseaseService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Daily worker: scan recent claims for ICD-10 codes that qualify a member
   * for a chronic condition cohort, then upsert member_chronic_statuses.
   * Runs at 01:00 UTC to avoid peak load.
   */
  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async runDailyCohortScan() {
    this.logger.log('Chronic-disease cohort scan started');
    const conditions = await this.prisma.chronicCondition.findMany();
    let qualified = 0;

    for (const condition of conditions) {
      const rule = condition.qualifyingRule as unknown as QualifyingRule;
      const since = new Date(Date.now() - rule.withinDays * 86_400_000);

      // Fetch all claims with diagnosis matching any ICD-10 prefix for this condition
      const claims = await this.prisma.claim.findMany({
        where: {
          submittedAt: { gte: since },
          diagnosis: {
            // Rough prefix match — for small datasets this is fine; add a GIN index on diagnosis for scale
            in: rule.icd10Prefixes.flatMap((p) =>
              // We can't do LIKE in Prisma without $queryRaw, so we fetch all and filter in-memory
              [] as string[]
            ),
          },
        },
        select: { memberNumber: true, diagnosis: true, submittedAt: true },
      });

      // Pull all claims since cutoff; filter in-memory by ICD-10 prefix
      const allRecent = await this.prisma.$queryRawUnsafe<
        { memberNumber: string; diagnosis: string }[]
      >(
        `SELECT "memberNumber", diagnosis
         FROM claims
         WHERE "submittedAt" >= $1 AND "memberNumber" IS NOT NULL AND diagnosis IS NOT NULL`,
        since,
      );

      // Count matches per member for this condition
      const counts: Record<string, number> = {};
      for (const row of allRecent) {
        const matches = rule.icd10Prefixes.some((prefix) =>
          row.diagnosis.toUpperCase().startsWith(prefix),
        );
        if (matches) {
          counts[row.memberNumber] = (counts[row.memberNumber] ?? 0) + 1;
        }
      }

      for (const [memberNumber, count] of Object.entries(counts)) {
        if (count >= rule.minEncounters) {
          await this.prisma.memberChronicStatus.upsert({
            where: {
              memberNumber_conditionCode: { memberNumber, conditionCode: condition.code },
            },
            update: { lastObservedAt: new Date(), status: 'active' },
            create: {
              memberNumber,
              conditionCode: condition.code,
              confidence: Math.min(count / rule.minEncounters, 1.0),
              status: 'active',
            },
          });
          qualified++;
        }
      }
    }
    this.logger.log(`Cohort scan complete: ${qualified} member-condition pairs upserted`);
  }

  async getCohort(conditionCode?: string, status?: string) {
    return this.prisma.memberChronicStatus.findMany({
      where: {
        ...(conditionCode ? { conditionCode } : {}),
        ...(status ? { status } : {}),
      },
      include: { condition: true },
      orderBy: { lastObservedAt: 'desc' },
    });
  }

  async getConditions() {
    return this.prisma.chronicCondition.findMany({ orderBy: { code: 'asc' } });
  }

  async getMemberStatus(memberNumber: string) {
    return this.prisma.memberChronicStatus.findMany({
      where: { memberNumber },
      include: { condition: true },
    });
  }

  /**
   * Care-gap rules engine: flag members in a cohort who haven't had a
   * qualifying encounter in the expected interval.
   * Simple rule: if lastObservedAt > 180 days ago → flag.
   */
  async detectCareGaps(conditionCode?: string): Promise<CareGapFlag[]> {
    const cutoff = new Date(Date.now() - 180 * 86_400_000);
    const statuses = await this.prisma.memberChronicStatus.findMany({
      where: {
        status: 'active',
        lastObservedAt: { lt: cutoff },
        ...(conditionCode ? { conditionCode } : {}),
      },
      include: { condition: true },
    });

    return statuses.map((s) => ({
      memberNumber: s.memberNumber,
      conditionCode: s.conditionCode,
      conditionName: s.condition.name,
      gapDescription: `No qualifying encounter in the past 180 days (last: ${s.lastObservedAt.toISOString().slice(0, 10)})`,
    }));
  }

  async getSummary() {
    const totals = await this.prisma.memberChronicStatus.groupBy({
      by: ['conditionCode', 'status'],
      _count: true,
    });
    return totals;
  }
}
