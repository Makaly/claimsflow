import { Injectable, ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MpesaB2CAdapter } from './mpesa-b2c.adapter';
import { AirtelMoneyAdapter } from './airtel-money.adapter';
import { PayoutCarrier } from './payout-adapter.interface';

@Injectable()
export class PayoutsService {
  private readonly logger = new Logger(PayoutsService.name);

  constructor(
    private prisma: PrismaService,
    private mpesa: MpesaB2CAdapter,
    private airtel: AirtelMoneyAdapter,
  ) {}

  async initiatePayout(dto: {
    adviceId: string;
    carrier: PayoutCarrier;
    msisdn: string;
    amount: number;
    remarks?: string;
  }) {
    // Idempotency: one payout per advice (pending/success)
    const existing = await this.prisma.payoutTransaction.findFirst({
      where: { adviceId: dto.adviceId, status: { in: ['pending', 'success'] } },
    });
    if (existing) {
      throw new ConflictException(`Payout already initiated for advice ${dto.adviceId} (status: ${existing.status})`);
    }

    const reference = `PA-${dto.adviceId}-${Date.now()}`;

    const tx = await this.prisma.payoutTransaction.create({
      data: {
        adviceId: dto.adviceId,
        carrier: dto.carrier,
        msisdn: dto.msisdn,
        amount: dto.amount,
        status: 'pending',
        originatorConversationId: reference,
        attempts: 0,
      },
    });

    const adapter = dto.carrier === 'mpesa' ? this.mpesa : this.airtel;

    try {
      const result = await adapter.initiate({
        adviceId: dto.adviceId,
        msisdn: dto.msisdn,
        amount: dto.amount,
        reference,
        remarks: dto.remarks,
      });

      if (result.success) {
        await this.prisma.payoutTransaction.update({
          where: { id: tx.id },
          data: { status: 'success', carrierRef: result.carrierRef, attempts: 1 },
        });
      } else {
        await this.prisma.payoutTransaction.update({
          where: { id: tx.id },
          data: { status: 'failed', lastError: result.error, attempts: 1 },
        });
      }

      return { transactionId: tx.id, ...result };
    } catch (err: any) {
      await this.prisma.payoutTransaction.update({
        where: { id: tx.id },
        data: { status: 'failed', lastError: err?.message ?? 'Unknown error', attempts: 1 },
      });
      throw err;
    }
  }

  async handleCallback(carrier: PayoutCarrier, body: unknown) {
    // TODO (B1): parse carrier-specific callback body and update status
    // M-Pesa: body.Result.ResultCode === 0 → success; extract TransactionID
    // Airtel:  body.data.transaction.status === 'TS' → success; extract id
    this.logger.log(`Callback received from ${carrier}: ${JSON.stringify(body)}`);
    return { received: true };
  }

  async getTransactions(filters: { adviceId?: string; status?: string }) {
    const where: any = {};
    if (filters.adviceId) where.adviceId = filters.adviceId;
    if (filters.status) where.status = filters.status;
    return this.prisma.payoutTransaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async reconcile(): Promise<{ initiated: number; confirmed: number; failed: number }> {
    const [initiated, confirmed, failed] = await Promise.all([
      this.prisma.payoutTransaction.count({ where: { status: 'pending' } }),
      this.prisma.payoutTransaction.count({ where: { status: 'success' } }),
      this.prisma.payoutTransaction.count({ where: { status: 'failed' } }),
    ]);

    const report = { initiated, confirmed, failed, generatedAt: new Date().toISOString() };
    this.logger.log(`Daily reconciliation report: ${JSON.stringify(report)}`);
    // TODO (B1): persist report to a reconciliation_reports table or email to finance team
    return report;
  }
}
