import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../notifications/email.service';

// Default SLA hours per workflow stage — overridable via SystemConfig
const DEFAULT_SLA: Record<string, number> = {
  initial_review:        4,
  maker_checker_review:  24,
  claims_officer_review: 8,
  fraud_review:          48,
};

@Injectable()
export class SlaService {
  private readonly logger = new Logger(SlaService.name);

  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
  ) {}

  @Cron('0 */30 * * * *') // every 30 minutes
  async checkSlaBreach() {
    const slaHours = await this.loadSlaConfig();
    const now = new Date();

    const activeClaims = await this.prisma.claim.findMany({
      where: {
        status: { notIn: ['approved', 'paid', 'rejected'] },
        slaBreached: false,
      },
      include: {
        assignedUser: { select: { id: true, name: true, email: true } },
      },
    });

    let breached = 0;
    for (const claim of activeClaims) {
      const threshold = slaHours[claim.workflowStage] ?? DEFAULT_SLA[claim.workflowStage] ?? 48;
      const elapsed = (now.getTime() - new Date(claim.submittedAt).getTime()) / 3_600_000;

      if (elapsed > threshold) {
        await this.prisma.claim.update({
          where: { id: claim.id },
          data: { slaBreached: true, slaBreachedAt: now },
        });
        breached++;

        if (claim.assignedUser?.email) {
          this.emailService.sendSlaBreachAlert({
            email: claim.assignedUser.email,
            name: claim.assignedUser.name,
            claimNumber: claim.claimNumber,
            stage: claim.workflowStage,
            hoursElapsed: Math.round(elapsed),
          }).catch(() => {});
        }

        // Also notify claims officers — they own SLA visibility under the
        // new role layout (supervisor role removed in the maker-checker refactor).
        const escalation = await this.prisma.user.findMany({
          where: { role: { in: ['admin', 'claims_officer'] }, isActive: true },
          select: { email: true, name: true },
          take: 5,
        });
        for (const e of escalation) {
          this.emailService.sendSlaBreachAlert({
            email: e.email,
            name: e.name,
            claimNumber: claim.claimNumber,
            stage: claim.workflowStage,
            hoursElapsed: Math.round(elapsed),
          }).catch(() => {});
        }
      }
    }

    if (breached > 0) this.logger.warn(`SLA breach detected on ${breached} claim(s)`);
  }

  async getSlaSummary() {
    const slaHours = await this.loadSlaConfig();
    const now = new Date();

    const [total, breached, atRisk] = await Promise.all([
      this.prisma.claim.count({ where: { status: { notIn: ['approved', 'paid', 'rejected'] } } }),
      this.prisma.claim.count({ where: { slaBreached: true, status: { notIn: ['approved', 'paid', 'rejected'] } } }),
      this.prisma.claim.count({
        where: {
          slaBreached: false,
          status: { notIn: ['approved', 'paid', 'rejected'] },
          submittedAt: { lt: new Date(now.getTime() - 36 * 3_600_000) },
        },
      }),
    ]);

    return { total, breached, atRisk, onTrack: total - breached - atRisk, slaHours };
  }

  async getAgingReport() {
    const now = new Date();
    const claims = await this.prisma.claim.findMany({
      where: { status: { notIn: ['approved', 'paid', 'rejected'] } },
      include: { provider: { select: { name: true } }, assignedUser: { select: { name: true } } },
      orderBy: { submittedAt: 'asc' },
    });

    const buckets = { '0-24h': 0, '1-2d': 0, '2-5d': 0, '5d+': 0 };
    const rows = claims.map((c) => {
      const hours = (now.getTime() - new Date(c.submittedAt).getTime()) / 3_600_000;
      const days = hours / 24;
      if (hours < 24) buckets['0-24h']++;
      else if (days < 2) buckets['1-2d']++;
      else if (days < 5) buckets['2-5d']++;
      else buckets['5d+']++;

      return {
        claimId: c.id,
        claimNumber: c.claimNumber,
        providerName: c.provider?.name ?? 'Unknown',
        assignedTo: c.assignedUser?.name ?? 'Unassigned',
        workflowStage: c.workflowStage,
        hoursElapsed: Math.round(hours),
        daysElapsed: +(days).toFixed(1),
        slaBreached: c.slaBreached,
        submittedAt: c.submittedAt,
      };
    });

    return { buckets, claims: rows, total: rows.length };
  }

  private async loadSlaConfig(): Promise<Record<string, number>> {
    const configs = await this.prisma.systemConfig.findMany({
      where: { key: { startsWith: 'sla_hours_' } },
    });
    const result: Record<string, number> = { ...DEFAULT_SLA };
    for (const c of configs) {
      const stage = c.key.replace('sla_hours_', '');
      result[stage] = parseInt(c.value) || DEFAULT_SLA[stage] || 48;
    }
    return result;
  }
}
