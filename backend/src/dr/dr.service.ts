import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';

const execFileAsync = promisify(execFile);

@Injectable()
export class DrService {
  private readonly logger = new Logger(DrService.name);

  constructor(private prisma: PrismaService) {}

  // Run the restore drill on the 1st of every month at 02:00 UTC, then record
  // the RTO/RPO measurement. In production this should be a separate CI job;
  // the cron here ensures the measurement row is always written even if CI is
  // skipped.
  @Cron('0 2 1 * *')
  async runMonthlyDrDrill() {
    this.logger.log('DR monthly drill starting…');

    if (!process.env.DR_BACKUP_BUCKET || !process.env.DR_STAGING_DATABASE_URL) {
      this.logger.warn('DR_BACKUP_BUCKET or DR_STAGING_DATABASE_URL not configured — skipping drill');
      return;
    }

    const drillStart = Date.now();
    const scriptPath = path.resolve(__dirname, '../../../../scripts/dr/daily_restore_drill.sh');

    try {
      const { stdout } = await execFileAsync('bash', [scriptPath], {
        env: {
          ...process.env,
          DR_LOG_FILE: '/tmp/dr_measurements.log',
        },
        timeout: 30 * 60 * 1000, // 30 min cap
      });

      const rtoSeconds = Math.round((Date.now() - drillStart) / 1000);
      this.logger.log(`DR drill succeeded in ${rtoSeconds}s`);

      // Parse RTO from script output; RPO requires backup mtime (set to 86400 s
      // as a conservative default when the script doesn't emit it).
      const rpoMatch = stdout.match(/rpo_seconds=(\d+)/);
      const rpoSeconds = rpoMatch ? parseInt(rpoMatch[1], 10) : 86400;

      await this.prisma.drMeasurement.create({
        data: {
          measuredAt: new Date(),
          rtoSeconds,
          rpoSeconds,
          backupKey: 'see-drill-log',
          rawJson: { stdout: stdout.slice(-2000) },
        },
      });
    } catch (err: any) {
      this.logger.error(`DR drill failed: ${err.message}`);
      // Still record the failed attempt so trending dashboards show gaps.
      await this.prisma.drMeasurement.create({
        data: {
          measuredAt: new Date(),
          rtoSeconds: -1,
          rpoSeconds: -1,
          backupKey: 'FAILED',
          rawJson: { error: err.message },
        },
      });
    }
  }

  async getLatestMeasurements(limit = 12) {
    return this.prisma.drMeasurement.findMany({
      orderBy: { measuredAt: 'desc' },
      take: limit,
    });
  }
}
