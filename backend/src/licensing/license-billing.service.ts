import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { LicenseService } from './license.service';
import { LicenseType, PlanId } from './plans';

interface CreateInvoiceInput {
  plan: PlanId;
  seats: number;
  unitPrice: number;
  vatRate?: number; // e.g. 0.16 for 16% VAT
  periodFrom: string | Date;
  periodTo: string | Date;
  currency?: string;
  issuedTo?: string;
  notes?: string;
}

interface RecordPaymentInput {
  amount: number;
  method?: string;
  reference?: string;
}

const PLAN_TO_LICENSE_TYPE: Record<PlanId, LicenseType> = {
  core: 'CORE',
  pro: 'PRO',
  enterprise: 'ENTERPRISE',
};

/**
 * Subscription billing for licences (mirrors helpdesk's billing invoices).
 * Per-seat priced, VAT-inclusive, settled in one or more payments. When fully
 * paid, the licence is applied with expiry = invoice periodTo (via
 * LicenseService.applyLicenseFromInvoice) so the term matches what was paid for.
 */
@Injectable()
export class LicenseBillingService {
  private readonly logger = new Logger(LicenseBillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly licenses: LicenseService,
  ) {}

  private invoiceNumber(): string {
    const yr = new Date().getUTCFullYear();
    return `CIC-INV-${yr}-${randomBytes(3).toString('hex').toUpperCase()}`;
  }

  private round2(n: number): number {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  async createInvoice(tenantId: string, input: CreateInvoiceInput, createdBy?: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, name: true } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    if (!PLAN_TO_LICENSE_TYPE[input.plan]) throw new BadRequestException(`Unknown plan '${input.plan}'`);
    if (input.seats <= 0 || input.unitPrice < 0) throw new BadRequestException('seats must be > 0 and unitPrice ≥ 0');

    const vatRate = input.vatRate ?? 0;
    const subtotal = this.round2(input.seats * input.unitPrice);
    const vatAmount = this.round2(subtotal * vatRate);
    const total = this.round2(subtotal + vatAmount);
    const number = this.invoiceNumber();
    const integrityHash = createHash('sha256')
      .update(`${number}|${tenantId}|${input.plan}|${input.seats}|${total}`)
      .digest('hex')
      .slice(0, 32);

    return this.prisma.licenseBillingInvoice.create({
      data: {
        tenantId,
        invoiceNumber: number,
        plan: input.plan,
        seats: input.seats,
        unitPrice: input.unitPrice,
        subtotal,
        vatRate,
        vatAmount,
        total,
        amountPaid: 0,
        currency: input.currency ?? 'KES',
        periodFrom: new Date(input.periodFrom),
        periodTo: new Date(input.periodTo),
        status: 'DRAFT',
        integrityHash,
        issuedTo: input.issuedTo ?? tenant.name,
        notes: input.notes,
        createdBy,
      },
    });
  }

  async list(tenantId?: string) {
    return this.prisma.licenseBillingInvoice.findMany({
      where: tenantId ? { tenantId } : undefined,
      orderBy: { createdAt: 'desc' },
      include: { payments: { orderBy: { paidAt: 'desc' } }, tenant: { select: { name: true } } },
    });
  }

  async getPayments(invoiceId: string) {
    return this.prisma.licenseBillingPayment.findMany({ where: { invoiceId }, orderBy: { paidAt: 'desc' } });
  }

  /** Mark an invoice as SENT (issued to the customer). */
  async markSent(invoiceId: string) {
    const inv = await this.prisma.licenseBillingInvoice.findUnique({ where: { id: invoiceId } });
    if (!inv) throw new NotFoundException('Invoice not found');
    return this.prisma.licenseBillingInvoice.update({ where: { id: invoiceId }, data: { status: inv.status === 'DRAFT' ? 'SENT' : inv.status } });
  }

  /**
   * Record a (full or partial) payment. When the cumulative amount paid covers
   * the total, mark PAID and apply the licence for the invoice period. Returns
   * the invoice plus any overpayment credit.
   */
  async recordPayment(invoiceId: string, input: RecordPaymentInput, recordedBy?: string) {
    if (input.amount <= 0) throw new BadRequestException('amount must be > 0');
    const inv = await this.prisma.licenseBillingInvoice.findUnique({ where: { id: invoiceId } });
    if (!inv) throw new NotFoundException('Invoice not found');
    if (inv.status === 'VOID') throw new BadRequestException('Cannot pay a void invoice');

    await this.prisma.licenseBillingPayment.create({
      data: { invoiceId, amount: input.amount, method: input.method ?? 'BANK_TRANSFER', reference: input.reference, recordedBy },
    });

    const total = Number(inv.total);
    const newPaid = this.round2(Number(inv.amountPaid) + input.amount);
    const fullyPaid = newPaid >= total;
    const overpaymentCredit = fullyPaid ? this.round2(newPaid - total) : 0;

    let licenseInfo = null;
    if (fullyPaid && !inv.licenseApplied) {
      licenseInfo = await this.licenses.applyLicenseFromInvoice(
        inv.tenantId,
        PLAN_TO_LICENSE_TYPE[inv.plan as PlanId],
        inv.periodFrom,
        inv.periodTo,
        inv.issuedTo ?? undefined,
      );
    }

    const updated = await this.prisma.licenseBillingInvoice.update({
      where: { id: invoiceId },
      data: {
        amountPaid: newPaid,
        status: fullyPaid ? 'PAID' : inv.status === 'DRAFT' ? 'SENT' : inv.status,
        licenseApplied: fullyPaid ? true : inv.licenseApplied,
      },
      include: { payments: { orderBy: { paidAt: 'desc' } } },
    });

    this.logger.log(`Payment ${input.amount} on invoice ${inv.invoiceNumber}; paid=${newPaid}/${total}${fullyPaid ? ' (PAID → licence applied)' : ''}`);
    return { invoice: updated, fullyPaid, overpaymentCredit, licenseInfo };
  }

  async voidInvoice(invoiceId: string) {
    const inv = await this.prisma.licenseBillingInvoice.findUnique({ where: { id: invoiceId } });
    if (!inv) throw new NotFoundException('Invoice not found');
    if (inv.status === 'PAID') throw new BadRequestException('Cannot void a paid invoice');
    return this.prisma.licenseBillingInvoice.update({ where: { id: invoiceId }, data: { status: 'VOID' } });
  }
}
