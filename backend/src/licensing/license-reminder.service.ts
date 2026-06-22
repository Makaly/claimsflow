import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { LicenseService } from './license.service';
import { LicenseEmailService } from './license-email.service';
import { REMINDER_DAYS } from './plans';

/**
 * Daily licence-expiry reminder sweep. For each tenant whose days-remaining
 * lands exactly on a milestone (90/60/30/7/0), email the tenant's admin. Running
 * once a day makes each milestone fire once naturally — no idempotency table
 * needed. Also surfaces a manual trigger for tests/admin.
 */
@Injectable()
export class LicenseReminderService {
  private readonly logger = new Logger(LicenseReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly licenses: LicenseService,
    private readonly emails: LicenseEmailService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async dailySweep(): Promise<{ checked: number; sent: number }> {
    const milestones = new Set<number>(REMINDER_DAYS as readonly number[]);
    const all = await this.licenses.getAllLicenses().catch(() => []);
    let sent = 0;

    for (const info of all) {
      if (info.daysRemaining === null || info.isReadOnly) continue;
      if (!milestones.has(info.daysRemaining)) continue;

      const admin = await this.prisma.user.findFirst({
        where: { tenantId: info.tenantId, role: 'admin', isActive: true },
        select: { email: true },
      });
      if (!admin?.email) {
        this.logger.warn(`No admin email for tenant ${info.tenantId}; skipping ${info.daysRemaining}d reminder`);
        continue;
      }

      try {
        await this.emails.sendExpiryReminder(info, admin.email, info.daysRemaining);
        sent += 1;
      } catch (e) {
        this.logger.warn(`Reminder send failed for tenant ${info.tenantId}: ${(e as Error).message}`);
      }
    }

    if (sent) this.logger.log(`Licence reminder sweep: ${sent} email(s) sent across ${all.length} tenant(s)`);
    return { checked: all.length, sent };
  }
}
