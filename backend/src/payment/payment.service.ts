import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../notifications/email.service';

@Injectable()
export class PaymentService {
  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
  ) {}

  async getPendingPayment(providerId?: string) {
    const where: any = {
      status: { in: ['approved', 'paid'] },
      NOT: { id: { in: await this.getClaimsInAdvice() } },
    };
    if (providerId) where.providerId = providerId;

    const claims = await this.prisma.claim.findMany({
      where,
      include: { provider: { select: { id: true, name: true, email: true, contactPerson: true } } },
      orderBy: { approvedAt: 'asc' },
    });

    const byProvider: Record<string, any> = {};
    for (const c of claims) {
      const pid = c.providerId;
      if (!byProvider[pid]) byProvider[pid] = { provider: c.provider, claims: [], totalAmount: 0 };
      byProvider[pid].claims.push(c);
      byProvider[pid].totalAmount += c.invoiceAmount ?? 0;
    }

    return { providers: Object.values(byProvider), totalClaims: claims.length };
  }

  async generatePaymentAdvice(dto: {
    providerId: string;
    claimIds: string[];
    generatedBy: string;
    notes?: string;
  }) {
    const claims = await this.prisma.claim.findMany({
      where: { id: { in: dto.claimIds }, providerId: dto.providerId },
      include: { provider: true },
    });

    if (claims.length !== dto.claimIds.length) {
      throw new BadRequestException('Some claims not found or do not belong to this provider');
    }

    const totalAmount = claims.reduce((s, c) => s + (c.invoiceAmount ?? 0), 0);
    const adviceNumber = `PA-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`;

    const advice = await this.prisma.paymentAdvice.create({
      data: {
        adviceNumber,
        providerId: dto.providerId,
        claimIds: dto.claimIds,
        totalAmount,
        generatedBy: dto.generatedBy,
        notes: dto.notes,
        status: 'pending',
      },
    });

    return advice;
  }

  async confirmPayment(
    adviceId: string,
    confirmedBy: string,
    dto: { paymentReference: string; paymentDate?: string },
  ) {
    const advice = await this.prisma.paymentAdvice.findUnique({
      where: { id: adviceId },
    });
    if (!advice) throw new NotFoundException('Payment advice not found');

    const updated = await this.prisma.paymentAdvice.update({
      where: { id: adviceId },
      data: {
        status: 'paid',
        confirmedBy,
        confirmedAt: new Date(),
        paymentReference: dto.paymentReference,
        paymentDate: dto.paymentDate ? new Date(dto.paymentDate) : new Date(),
      },
    });

    // Update all included claims to paid
    const claimIds = advice.claimIds as string[];
    await this.prisma.claim.updateMany({
      where: { id: { in: claimIds } },
      data: { status: 'paid', paidAt: new Date() },
    });

    // Notify provider
    const provider = await this.prisma.provider.findUnique({ where: { id: advice.providerId } });
    if (provider?.email) {
      this.emailService.sendEmail(
        provider.email,
        `Payment Processed — ${advice.adviceNumber}`,
        `Dear ${provider.contactPerson},\n\nPayment of KES ${advice.totalAmount.toLocaleString()} for ${claimIds.length} claim(s) has been processed.\n\nPayment Reference: ${dto.paymentReference}\nDate: ${dto.paymentDate || new Date().toDateString()}\n\nCIC Insurance Group`,
      ).catch(() => {});
    }

    return updated;
  }

  async getPaymentAdvices(filters: { status?: string; providerId?: string; limit?: number; offset?: number }) {
    const where: any = {};
    if (filters.status) where.status = filters.status;
    if (filters.providerId) where.providerId = filters.providerId;

    const [advices, total] = await Promise.all([
      this.prisma.paymentAdvice.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: filters.limit ?? 50,
        skip: filters.offset ?? 0,
      }),
      this.prisma.paymentAdvice.count({ where }),
    ]);

    return { advices, total };
  }

  async exportPaymentFile(adviceId: string): Promise<string> {
    const advice = await this.prisma.paymentAdvice.findUnique({ where: { id: adviceId } });
    if (!advice) throw new NotFoundException('Payment advice not found');

    const claimIds = advice.claimIds as string[];
    const claims = await this.prisma.claim.findMany({
      where: { id: { in: claimIds } },
      include: { provider: true },
    });

    const rows = claims.map(c => [
      advice.adviceNumber,
      c.claimNumber,
      c.provider.name,
      c.memberName ?? '',
      c.invoiceNumber ?? '',
      (c.invoiceAmount ?? 0).toFixed(2),
      c.approvedAt?.toISOString().slice(0, 10) ?? '',
    ].join(','));

    const header = 'AdviceNumber,ClaimNumber,ProviderName,MemberName,InvoiceNumber,Amount,ApprovedDate';
    return [header, ...rows].join('\n');
  }

  private async getClaimsInAdvice(): Promise<string[]> {
    const advices = await this.prisma.paymentAdvice.findMany({
      where: { status: { in: ['pending', 'paid'] } },
      select: { claimIds: true },
    });
    return advices.flatMap(a => a.claimIds as string[]);
  }
}
