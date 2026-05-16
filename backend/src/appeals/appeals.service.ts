import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../notifications/email.service';

@Injectable()
export class AppealsService {
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
    if (claim.status !== 'rejected') throw new BadRequestException('Only rejected claims can be appealed');

    const daysSinceRejection = claim.rejectedAt
      ? (Date.now() - new Date(claim.rejectedAt).getTime()) / 86_400_000
      : 0;
    if (daysSinceRejection > 30) throw new BadRequestException('Appeals must be filed within 30 days of rejection');

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

    // If upheld, reinstate the claim
    if (dto.outcome === 'upheld') {
      await this.prisma.claim.update({
        where: { id: appeal.claimId },
        data: {
          status: 'submitted',
          isRejected: false,
          workflowStage: 'initial_review',
          rejectionReason: null,
          resubmissionCount: { increment: 1 },
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
        outcome: dto.outcome === 'upheld' ? 'Upheld — claim re-entered workflow' : 'Dismissed',
      }).catch(() => {});
    }

    return updated;
  }

  async updateAppealStatus(appealId: string, status: 'under_review' | 'pending') {
    return this.prisma.appeal.update({ where: { id: appealId }, data: { status } });
  }
}
