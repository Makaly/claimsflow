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
    limit?: number;
    offset?: number;
  }) {
    const where: any = {};
    if (filters.status) where.status = filters.status;
    if (filters.providerId) where.providerId = filters.providerId;
    if (filters.claimId) where.claimId = filters.claimId;

    const [appeals, total] = await Promise.all([
      this.prisma.appeal.findMany({
        where,
        include: {
          claim: { select: { claimNumber: true, invoiceAmount: true, status: true, workflowStage: true } },
          filer: { select: { name: true, email: true } },
          adjudicator: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: filters.limit ?? 50,
        skip: filters.offset ?? 0,
      }),
      this.prisma.appeal.count({ where }),
    ]);

    return { appeals, total };
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

    const msg = await this.prisma.appealMessage.create({
      data: { appealId, senderId, senderRole, message },
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
    this.notifyAppealParticipants(appeal, senderId, message, appeal.claim.claimNumber).catch(
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
