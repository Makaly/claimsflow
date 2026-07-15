import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InstallationService } from './installation.service';

/**
 * Drives the periodic phone-home. Every 6 hours (and once shortly after boot)
 * the installation refreshes its lease from the license server. As long as one
 * succeeds within the lease TTL (~7 days) the install stays active; a full week
 * of failures lets the cached lease expire → the InstallationGuard locks it.
 */
@Injectable()
export class InstallationHeartbeatService implements OnModuleInit {
  private readonly logger = new Logger(InstallationHeartbeatService.name);

  constructor(private readonly installation: InstallationService) {}

  async onModuleInit() {
    if (!this.installation.isManaged()) return;
    // Kick a check-in shortly after boot without blocking startup.
    setTimeout(() => {
      void this.installation.heartbeat().catch(() => undefined);
    }, 15_000);
  }

  @Cron(CronExpression.EVERY_6_HOURS)
  async scheduled() {
    if (!this.installation.isManaged()) return;
    const r = await this.installation.heartbeat();
    if (r.ok) this.logger.debug('Heartbeat OK — lease refreshed');
    else this.logger.warn(`Heartbeat failed: ${r.reason}`);
  }
}
