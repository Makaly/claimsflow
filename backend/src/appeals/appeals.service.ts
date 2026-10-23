import { Injectable, NotFoundException, BadRequestException, ForbiddenException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../notifications/email.service';

@Injectable()
export class AppealsService {
  private readonly logger = new Logger(AppealsService.name);

  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
  ) {}

  async fileAppeal(dto: {
    claimId: string;
    reason: string;
    additionalNotes?: string;
    filedBy: string;
  }) {
    const claim = await this.prisma.claim.findUnique({
      where: { id: dto.claimId },
      include: { provider: true },
    });
    if (!claim) throw new NotFoundException('Claim not found');

    const appealableStatuses = ['rejected', 'fraud_confirmed'];
    if (!appealableStatuses.includes(claim.status)) {
      throw new BadRequestException('Only rejected or fraud-confirmed invoices can be appealed');
    }

    // For rejections: 30-day window. For fraud-confirmed: 60-day window.
    const windowDays = claim.status === 'fraud_confirmed' ? 60 : 30;
    const referenceDate = claim.rejectedAt || claim.fraudVerdictAt || claim.updatedAt;
    const daysSince = referenceDate
      ? (Date.now() - new Date(referenceDate).getTime()) / 86_400_000
      : 0;
    if (daysSince > windowDays) {
      throw new BadRequestException(`Appeals must be filed within ${windowDays} days of the decision`);
    }

    const existing = await this.prisma.appeal.findFirst({
      where: { claimId: dto.claimId, status: { in: ['pending', 'under_review'] } },
    });
    if (existing) throw new BadRequestException('An active appeal already exists for this claim');

    const appeal = await this.prisma.appeal.create({
      data: {
        claimId: dto.claimId,
        providerId: claim.providerId,
        filedBy: dto.filedBy,
        reason: dto.reason,
        additionalNotes: dto.additionalNotes,
        status: 'pending',
      },
    });

    // Notify provider
    if (claim.provider?.email) {
      this.emailService.sendAppealNotification({
        email: claim.provider.email,
        name: claim.provider.contactPerson,
        claimNumber: claim.claimNumber,
        action: 'filed',
      }).catch(() => {});
    }

    // Notify claims officers (they broker appeals under the new role layout).
    // Fraud officers are also notified so they're ready to join the thread if
    // the appeal concerns a fraud verdict.
    const reviewers = await this.prisma.user.findMany({
      where: { role: { in: ['admin', 'claims_officer', 'fraud_officer'] }, isActive: true },
      select: { email: true, name: true },
      take: 6,
    });
    for (const r of reviewers) {
      this.emailService.sendEmail(
        r.email,
        `New Appeal Filed — Claim ${claim.claimNumber}`,
        `An appeal has been filed for claim ${claim.claimNumber} by ${claim.provider?.name}. Please review in the Appeals queue.`,
      ).catch(() => {});
    }

    return appeal;
  }

  async getAppeals(filters: {
    status?: string;
    providerId?: string;
    claimId?: string;
    outcome?: string;
    search?: string;
    dateFrom?: string;
    dateTo?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    limit?: number;
    offset?: number;
  }) {
    const where: any = {};
    if (filters.status) where.status = filters.status;
    if (filters.providerId) where.providerId = filters.providerId;
    if (filters.claimId) where.claimId = filters.claimId;
    if (filters.outcome) where.outcome = filters.outcome;

    if (filters.dateFrom || filters.dateTo) {
      where.createdAt = {};
      if (filters.dateFrom) where.createdAt.gte = new Date(filters.dateFrom);
      if (filters.dateTo) where.createdAt.lte = new Date(filters.dateTo + 'T23:59:59');
    }

    if (filters.search) {
      const q = filters.search.trim();
      where.OR = [
        { reason: { contains: q, mode: 'insensitive' } },
        { additionalNotes: { contains: q, mode: 'insensitive' } },
        { claim: { claimNumber: { contains: q, mode: 'insensitive' } } },
        { filer: { name: { contains: q, mode: 'insensitive' } } },
      ];
    }

    // Whitelisted sort keys → Prisma orderBy (relation sorts handled explicitly).
    const order = filters.sortOrder === 'asc' ? 'asc' : 'desc';
    let orderBy: any;
    switch (filters.sortBy) {
      case 'amount':  orderBy = { claim: { invoiceAmount: order } }; break;
      case 'status':  orderBy = { status: order }; break;
      case 'outcome': orderBy = { outcome: order }; break;
      case 'updated': orderBy = { updatedAt: order }; break;
      case 'filed':
      default:        orderBy = { createdAt: order }; break;
    }

    const [appeals, total] = await Promise.all([
      this.prisma.appeal.findMany({
        where,
        include: {
          claim: { select: { claimNumber: true, invoiceAmount: true, status: true, workflowStage: true } },
          filer: { select: { name: true, email: true } },
          adjudicator: { select: { name: true } },
          messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true, senderId: true } },
          _count: { select: { messages: true } },
        },
        orderBy,
        take: filters.limit ?? 50,
        skip: filters.offset ?? 0,
      }),
      this.prisma.appeal.count({ where }),
    ]);

    // Flatten the latest-message fields for the client (unread badges).
    const shaped = appeals.map((a: any) => ({
      ...a,
      messageCount: a._count?.messages ?? 0,
      lastMessageAt: a.messages?.[0]?.createdAt ?? null,
      lastMessageBy: a.messages?.[0]?.senderId ?? null,
      messages: undefined,
      _count: undefined,
    }));

    return { appeals: shaped, total };
  }

  /**
   * Aggregate analytics for the appeals dashboard. Provider-scoped when a
   * providerId is supplied; otherwise spans every appeal (staff view).
   * Volumes are low enough to compute in-process rather than via raw SQL.
   */
  async getAnalytics(filters: { providerId?: string }) {
    const where: any = {};
    if (filters.providerId) where.providerId = filters.providerId;

    const rows = await this.prisma.appeal.findMany({
      where,
      select: {
        status: true,
        outcome: true,
        createdAt: true,
        adjudicatedAt: true,
        providerId: true,
      },
    });

    // Resolve provider names in a single batched lookup (no Appeal→Provider relation).
    const providerIds = [...new Set(rows.map((r) => r.providerId).filter(Boolean))];
    const providerRows = providerIds.length
      ? await this.prisma.provider.findMany({
          where: { id: { in: providerIds } },
          select: { id: true, name: true },
        })
      : [];
    const providerName = new Map(providerRows.map((p) => [p.id, p.name]));

    const SLA_DAYS = 14;
    const now = Date.now();
    const DAY = 86_400_000;

    const byStatus: Record<string, number> = { pending: 0, under_review: 0, finalised: 0 };
    const byOutcome = { upheld: 0, dismissed: 0 };
    let overdue = 0;
    let resolutionDaysSum = 0;
    let resolvedCount = 0;
    const monthly = new Map<string, { month: string; filed: number; upheld: number; dismissed: number }>();
    const providers = new Map<string, { provider: string; total: number; upheld: number }>();

    for (const r of rows) {
      byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
      if (r.outcome === 'upheld') byOutcome.upheld++;
      if (r.outcome === 'dismissed') byOutcome.dismissed++;

      if (r.status !== 'finalised') {
        const ageDays = (now - new Date(r.createdAt).getTime()) / DAY;
        if (ageDays > SLA_DAYS) overdue++;
      }

      if (r.status === 'finalised' && r.adjudicatedAt) {
        resolutionDaysSum += (new Date(r.adjudicatedAt).getTime() - new Date(r.createdAt).getTime()) / DAY;
        resolvedCount++;
      }

      const d = new Date(r.createdAt);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      const m = monthly.get(key) ?? { month: key, filed: 0, upheld: 0, dismissed: 0 };
      m.filed++;
      if (r.outcome === 'upheld') m.upheld++;
      if (r.outcome === 'dismissed') m.dismissed++;
      monthly.set(key, m);

      const pname = providerName.get(r.providerId) ?? 'Unknown';
      const p = providers.get(pname) ?? { provider: pname, total: 0, upheld: 0 };
      p.total++;
      if (r.outcome === 'upheld') p.upheld++;
      providers.set(pname, p);
    }

    const finalisedTotal = byOutcome.upheld + byOutcome.dismissed;

    return {
      total: rows.length,
      byStatus,
      byOutcome,
      upheldRate: finalisedTotal ? Math.round((byOutcome.upheld / finalisedTotal) * 100) : 0,
      avgResolutionDays: resolvedCount ? Math.round((resolutionDaysSum / resolvedCount) * 10) / 10 : 0,
      overdue,
      slaDays: SLA_DAYS,
      monthlyTrend: [...monthly.values()].sort((a, b) => a.month.localeCompare(b.month)).slice(-6),
      byProvider: [...providers.values()].sort((a, b) => b.total - a.total).slice(0, 8),
    };
  }

  async adjudicateAppeal(
    appealId: string,
    adjudicatorId: string,
    dto: { outcome: 'upheld' | 'dismissed'; outcomeNotes?: string },
  ) {
    const appeal = await this.prisma.appeal.findUnique({
      where: { id: appealId },
      include: { claim: { include: { provider: true } }, filer: true },
    });
    if (!appeal) throw new NotFoundException('Appeal not found');
    if (appeal.status !== 'pending' && appeal.status !== 'under_review') {
      throw new BadRequestException('Appeal is already finalised');
    }

    const updated = await this.prisma.appeal.update({
      where: { id: appealId },
      data: {
        status: 'finalised',
        adjudicatedBy: adjudicatorId,
        adjudicatedAt: new Date(),
        outcome: dto.outcome,
        outcomeNotes: dto.outcomeNotes,
      },
    });

    if (dto.outcome === 'upheld') {
      // Upheld appeal: clear fraud verdict (if any) and route to
      // claims_officer_review for fresh final approval — the claims officer
      // makes the payment decision.
      await this.prisma.claim.update({
        where: { id: appeal.claimId },
        data: {
          status: 'under_review',
          isRejected: false,
          workflowStage: 'claims_officer_review',
          rejectionReason: null,
          fraudVerdict: null,
          fraudVerdictAt: null,
          fraudVerdictBy: null,
          fraudVerdictNotes: null,
          resubmissionCount: { increment: 1 },
          assignedTo: null,
        },
      });
    }

    // Notify provider
    if (appeal.claim.provider?.email) {
      this.emailService.sendAppealNotification({
        email: appeal.claim.provider.email,
        name: appeal.claim.provider.contactPerson,
        claimNumber: appeal.claim.claimNumber,
        action: 'adjudicated',
        outcome: dto.outcome === 'upheld'
          ? 'Upheld — invoice returned to claims officer for final approval'
          : 'Dismissed — original decision stands',
      }).catch(() => {});
    }

    // Notify all appeal participants of the outcome
    const messages = await this.prisma.appealMessage.findMany({
      where: { appealId },
      select: { senderId: true },
      distinct: ['senderId'],
    });
    const participantIds = [...new Set(messages.map((m) => m.senderId))];
    const participants = await this.prisma.user.findMany({
      where: { id: { in: participantIds }, isActive: true },
      select: { email: true, name: true },
    });
    for (const p of participants) {
      this.emailService.sendEmail(
        p.email,
        `Appeal ${dto.outcome === 'upheld' ? 'Upheld' : 'Dismissed'} — ${appeal.claim.claimNumber}`,
        `The appeal for invoice ${appeal.claim.claimNumber} has been ${dto.outcome}.\n\n${dto.outcomeNotes || ''}`,
      ).catch(() => {});
    }

    return updated;
  }

  async updateAppealStatus(appealId: string, status: 'under_review' | 'pending') {
    return this.prisma.appeal.update({ where: { id: appealId }, data: { status } });
  }

  /**
   * Add a message to the three-party appeal thread.
   * Participants: provider (filer), claims_officer (broker), fraud_officer.
   */
  async addMessage(
    appealId: string,
    senderId: string,
    senderRole: string,
    message: string,
    attachments?: Array<{ name: string; url: string; size?: number; mime?: string }>,
  ) {
    const appeal = await this.prisma.appeal.findUnique({
      where: { id: appealId },
      include: { claim: { include: { provider: true } }, filer: true },
    });
    if (!appeal) throw new NotFoundException('Appeal not found');
    if (appeal.status === 'finalised') {
      throw new BadRequestException('Cannot add messages to a finalised appeal');
    }

    const allowedRoles = ['admin', 'claims_officer', 'fraud_officer', 'provider_admin', 'provider_user'];
    if (!allowedRoles.includes(senderRole)) {
      throw new ForbiddenException('Your role cannot participate in appeal discussions');
    }

    const cleanText = (message ?? '').trim();
    const atts = Array.isArray(attachments) ? attachments.slice(0, 10) : [];
    if (!cleanText && atts.length === 0) {
      throw new BadRequestException('A message or at least one attachment is required');
    }

    const msg = await this.prisma.appealMessage.create({
      data: { appealId, senderId, senderRole, message: cleanText, attachments: atts },
      include: { sender: { select: { name: true, role: true } } },
    });

    // Advance status to under_review on first message
    if (appeal.status === 'pending') {
      await this.prisma.appeal.update({
        where: { id: appealId },
        data: { status: 'under_review' },
      });
    }

    // Notify all other thread participants
    const notifyText = cleanText || `📎 ${atts.length} attachment(s)`;
    this.notifyAppealParticipants(appeal, senderId, notifyText, appeal.claim.claimNumber).catch(
      (err) => this.logger.warn(`Appeal notification failed: ${err?.message}`),
    );

    return msg;
  }

  async getMessages(appealId: string) {
    return this.prisma.appealMessage.findMany({
      where: { appealId },
      include: { sender: { select: { id: true, name: true, role: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  private async notifyAppealParticipants(
    appeal: any,
    senderId: string,
    message: string,
    claimNumber: string,
  ) {
    // Build recipient list: filer + all prior message senders + claims officers + fraud officers
    const [priorMessages, officers] = await Promise.all([
      this.prisma.appealMessage.findMany({
        where: { appealId: appeal.id },
        select: { senderId: true },
        distinct: ['senderId'],
      }),
      this.prisma.user.findMany({
        where: { role: { in: ['claims_officer', 'fraud_officer'] }, isActive: true },
        select: { id: true, email: true },
      }),
    ]);

    const recipientIds = new Set([
      appeal.filedBy,
      ...priorMessages.map((m: any) => m.senderId),
      ...officers.map((o: any) => o.id),
    ]);
    recipientIds.delete(senderId); // don't echo back to sender

    const recipients = await this.prisma.user.findMany({
      where: { id: { in: [...recipientIds] }, isActive: true },
      select: { email: true, name: true },
    });

    for (const r of recipients) {
      this.emailService.sendEmail(
        r.email,
        `New message on appeal — Invoice ${claimNumber}`,
        `A new message has been added to the appeal discussion for invoice ${claimNumber}.\n\n"${message.slice(0, 200)}${message.length > 200 ? '…' : ''}"\n\nLog in to view the full thread and respond.`,
      ).catch(() => {});
    }
  }
}
