import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

// TODO(prod): implement real SAP/Oracle/Sage HTTP adapters
// ERP_TARGET=csv|sap|oracle|sage
// ERP_API_URL=https://your-erp-host/api
// ERP_API_TOKEN=your_api_token

@Injectable()
export class ErpService {
  private readonly logger = new Logger(ErpService.name);
  private readonly target: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.target = config.get<string>('ERP_TARGET', 'csv');
  }

  // ── Chart-of-accounts CRUD ────────────────────────────────────────────

  async getCoaMappings() {
    return this.prisma.glAccountMapping.findMany({ orderBy: { claimType: 'asc' } });
  }

  async upsertCoa(claimType: string, accountCode: string, accountName: string, updatedBy?: string) {
    return this.prisma.glAccountMapping.upsert({
      where: { claimType },
      create: { claimType, accountCode, accountName, updatedBy },
      update: { accountCode, accountName, updatedBy },
    });
  }

  // ── Daily posting feed (cron: every day at 01:00) ─────────────────────

  @Cron('0 1 * * *')
  async runDailyPosting() {
    const today = new Date().toISOString().slice(0, 10);
    await this.postForDate(today);
  }

  /** Run or replay posting for a given ISO date (replay-safe via batchKey upsert). */
  async postForDate(date: string) {
    const existing = await this.prisma.glPostingLog.findUnique({ where: { batchKey: date } });
    if (existing?.status === 'success') {
      this.logger.log(`GL posting for ${date} already succeeded — skipping`);
      return existing;
    }

    const from = new Date(date);
    const to = new Date(new Date(date).getTime() + 86400000);

    const paidClaims = await this.prisma.claim.findMany({
      where: { status: 'paid', paidAt: { gte: from, lt: to } },
      select: { id: true, claimNumber: true, invoiceAmount: true, providerId: true },
    });

    const total = paidClaims.reduce((s, c) => s + (c.invoiceAmount ?? 0), 0);
    const csv = this.buildCsv(paidClaims);

    // TODO(prod): dispatch to ERP_TARGET via adapter
    this.logger.log(`GL posting ${date}: ${paidClaims.length} claims, total=${total}, target=${this.target}`);
    this.logger.debug(csv.slice(0, 200));

    return this.prisma.glPostingLog.upsert({
      where: { batchKey: date },
      create: { batchKey: date, claimCount: paidClaims.length, totalAmount: total, target: this.target, status: 'success' },
      update: { claimCount: paidClaims.length, totalAmount: total, target: this.target, status: 'success', errorMsg: null },
    });
  }

  getPostingLogs(take = 30) {
    return this.prisma.glPostingLog.findMany({ orderBy: { postedAt: 'desc' }, take });
  }

  private buildCsv(claims: { claimNumber: string; invoiceAmount: number | null; providerId: string }[]): string {
    const header = 'ClaimNumber,ProviderId,Amount\n';
    return header + claims.map(c => `${c.claimNumber},${c.providerId},${c.invoiceAmount ?? 0}`).join('\n');
  }
}
