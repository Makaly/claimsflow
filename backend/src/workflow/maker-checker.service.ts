import { Injectable, BadRequestException, ForbiddenException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EdmsIntegrationService } from '../common/services/edms-integration.service';
import { EoxegenIntegrationService } from '../common/services/eoxegen-integration.service';
import { PdfWatermarkService } from '../common/services/pdf-watermark.service';
import { AuditService } from '../common/services/audit.service';
import { redactEmail } from '../common/services/pii-redaction';

@Injectable()
export class MakerCheckerService {
  private readonly logger = new Logger(MakerCheckerService.name);

  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
    private edmsService: EdmsIntegrationService,
    private eoxegenService: EoxegenIntegrationService,
    private pdfWatermarkService: PdfWatermarkService,
    private audit: AuditService,
  ) {}

  // ─────────────────────────────────────────────────────────────
  // MAKER operations
  // ─────────────────────────────────────────────────────────────

  async assignToMaker(claimId: string, makerId: string, assignedBy: string) {
    const claim = await this.prisma.claim.findUnique({ where: { id: claimId } });
    if (!claim) throw new BadRequestException('Claim not found');

    if (claim.workflowStage !== 'initial_review') {
      throw new BadRequestException('Claim is not in initial review stage');
    }

    const updatedClaim = await this.prisma.claim.update({
      where: { id: claimId },
      data: {
        assignedTo: makerId,
        workflowStage: 'maker_checker_review',
        status: 'under_review',
      },
    });

    await this.prisma.claimStatusHistory.create({
      data: {
        claimId,
        fromStatus: claim.status,
        toStatus: 'under_review',
        changedBy: assignedBy,
        reason: 'Assigned to maker for review',
      },
    });

    await this.audit.record({
      actor: { userId: assignedBy },
      action: 'maker_assigned',
      entity: 'claim',
      entityId: claimId,
      oldValue: { assignedTo: claim.assignedTo, workflowStage: claim.workflowStage, status: claim.status },
      newValue: { assignedTo: makerId, workflowStage: 'maker_checker_review', status: 'under_review' },
      metadata: { claimNumber: claim.claimNumber },
    });

    await this.emailUser(
      makerId,
      `New claim assigned: ${claim.claimNumber}`,
      `You have been assigned claim ${claim.claimNumber} for first-level review. Please open the Maker Queue to proceed.`,
    );

    return updatedClaim;
  }

  async makerApprove(claimId: string, makerId: string, comments?: string) {
    const claim = await this.prisma.claim.findUnique({
      where: { id: claimId },
      include: { provider: true },
    });

    if (!claim) throw new BadRequestException('Claim not found');
    if (claim.workflowStage !== 'maker_checker_review') throw new BadRequestException('Claim is not in maker-checker review stage');
    if (claim.assignedTo !== makerId) throw new ForbiddenException('You are not assigned to this claim');

    await this.prisma.claimApproval.create({
      data: {
        claimId,
        level: 'maker',
        approvalStage: 'first_approval',
        approvedBy: makerId,
        decision: 'approved',
        comments,
      },
    });

    const updatedClaim = await this.prisma.claim.update({
      where: { id: claimId },
      data: {
        workflowStage: 'maker_checker_review',
        assignedTo: null,
        reviewedAt: new Date(),
      },
    });

    await this.prisma.claimStatusHistory.create({
      data: {
        claimId,
        fromStatus: claim.status,
        toStatus: 'under_review',
        changedBy: makerId,
        reason: 'Approved by maker, pending checker review',
      },
    });

    await this.audit.record({
      actor: { userId: makerId },
      action: 'maker_approved',
      entity: 'claim',
      entityId: claimId,
      oldValue: { workflowStage: claim.workflowStage, assignedTo: claim.assignedTo },
      newValue: { workflowStage: 'maker_checker_review', assignedTo: null },
      metadata: { claimNumber: claim.claimNumber, decision: 'approved', comments },
    });

    // ─── Notifications: recipient (checkers) + actor (maker) ──────────
    const commentBlock = comments?.trim()
      ? `\n\nMaker's notes:\n${comments.trim()}`
      : '';
    const checkerIds = await this.findCheckers();
    await this.emailUsers(
      checkerIds,
      `New claim awaiting checker review: ${claim.claimNumber}`,
      `Claim ${claim.claimNumber} (${claim.provider?.name ?? 'Unknown provider'}) has been approved by the maker and is now in the Checker Queue.${commentBlock}`,
    );
    await this.emailUser(
      makerId,
      `You approved claim ${claim.claimNumber}`,
      `You have approved claim ${claim.claimNumber} and forwarded it to the Checker Queue. The checker team has been notified.${commentBlock}`,
    );

    return updatedClaim;
  }

  async makerReject(claimId: string, makerId: string, reason: string) {
    const claim = await this.prisma.claim.findUnique({
      where: { id: claimId },
      include: { provider: true },
    });

    if (!claim) throw new BadRequestException('Claim not found');
    if (claim.workflowStage !== 'maker_checker_review') throw new BadRequestException('Claim is not in maker-checker review stage');
    if (claim.assignedTo !== makerId) throw new ForbiddenException('You are not assigned to this claim');

    await this.prisma.claimApproval.create({
      data: {
        claimId,
        level: 'maker',
        approvalStage: 'first_approval',
        approvedBy: makerId,
        decision: 'rejected',
        comments: reason,
      },
    });

    const updatedClaim = await this.prisma.claim.update({
      where: { id: claimId },
      data: {
        status: 'rejected',
        isRejected: true,
        rejectionReason: reason,
        rejectedBy: makerId,
        rejectedAt: new Date(),
        workflowStage: 'completed',
        assignedTo: null,
      },
    });

    await this.prisma.claimStatusHistory.create({
      data: {
        claimId,
        fromStatus: claim.status,
        toStatus: 'rejected',
        changedBy: makerId,
        reason,
      },
    });

    await this.audit.record({
      actor: { userId: makerId },
      action: 'maker_rejected',
      entity: 'claim',
      entityId: claimId,
      oldValue: { status: claim.status, workflowStage: claim.workflowStage },
      newValue: { status: 'rejected', workflowStage: 'completed', rejectionReason: reason },
      metadata: { claimNumber: claim.claimNumber, decision: 'rejected', reason },
    });

    // Notify provider (branch) + confirmation to the actor (maker)
    await this.notificationsService.sendEmail({
      recipient: claim.provider.email,
      subject: `Claim Rejected: ${claim.claimNumber}`,
      message: `Your claim ${claim.claimNumber} has been rejected at first-level review.\n\nReason: ${reason}\n\nContact your branch for next steps.`,
    });
    await this.emailUser(
      makerId,
      `You rejected claim ${claim.claimNumber}`,
      `You have rejected claim ${claim.claimNumber} (${claim.provider?.name ?? 'Unknown provider'}). The provider has been notified.\n\nReason recorded: ${reason}`,
    );

    return updatedClaim;
  }

  // ─────────────────────────────────────────────────────────────
  // CHECKER operations
  // ─────────────────────────────────────────────────────────────

  async assignToChecker(claimId: string, checkerId: string, assignedBy: string) {
    const claim = await this.prisma.claim.findUnique({ where: { id: claimId } });
    if (!claim) throw new BadRequestException('Claim not found');
    if (claim.workflowStage !== 'maker_checker_review') throw new BadRequestException('Claim is not in maker-checker review stage');

    const updatedClaim = await this.prisma.claim.update({
      where: { id: claimId },
      data: { assignedTo: checkerId },
    });

    await this.audit.record({
      actor: { userId: assignedBy },
      action: 'checker_assigned',
      entity: 'claim',
      entityId: claimId,
      oldValue: { assignedTo: claim.assignedTo },
      newValue: { assignedTo: checkerId },
      metadata: { claimNumber: claim.claimNumber },
    });

    await this.emailUser(
      checkerId,
      `Claim ready for checker review: ${claim.claimNumber}`,
      `Claim ${claim.claimNumber} has passed maker review and awaits your second-level approval. Please open the Checker Queue to proceed.`,
    );

    return updatedClaim;
  }

  async checkerApprove(claimId: string, checkerId: string, comments?: string) {
    const claim = await this.prisma.claim.findUnique({
      where: { id: claimId },
      include: { provider: true, documents: true },
    });

    if (!claim) throw new BadRequestException('Claim not found');
    if (claim.workflowStage !== 'maker_checker_review') {
      throw new BadRequestException('Claim is not in maker-checker review stage');
    }
    if (claim.assignedTo !== null && claim.assignedTo !== checkerId) {
      throw new ForbiddenException('You are not assigned to this claim');
    }

    await this.prisma.claimApproval.create({
      data: {
        claimId,
        level: 'maker_checker',
        approvalStage: 'maker_checker_approval',
        approvedBy: checkerId,
        decision: 'approved',
        comments,
      },
    });

    // Route to claims_officer_review — final approval gate is the claims officer.
    const updatedClaim = await this.prisma.claim.update({
      where: { id: claimId },
      data: {
        workflowStage: 'claims_officer_review',
        status: 'under_review',
        reviewedAt: new Date(),
        assignedTo: null,
      },
    });

    await this.prisma.claimStatusHistory.create({
      data: {
        claimId,
        fromStatus: claim.status,
        toStatus: 'under_review',
        changedBy: checkerId,
        reason: 'Maker-checker verified — awaiting claims officer approval',
      },
    });

    await this.audit.record({
      actor: { userId: checkerId },
      action: 'maker_checker_approved',
      entity: 'claim',
      entityId: claimId,
      oldValue: { status: claim.status, workflowStage: claim.workflowStage },
      newValue: { status: 'under_review', workflowStage: 'claims_officer_review' },
      metadata: { claimNumber: claim.claimNumber, decision: 'approved', comments },
    });

    const notes = comments?.trim() ? `\n\nNotes:\n${comments.trim()}` : '';
    const officerIds = await this.findClaimsOfficers();
    await this.emailUsers(
      officerIds,
      `Invoice ready for final approval: ${claim.claimNumber}`,
      `Claim ${claim.claimNumber} (${claim.provider?.name ?? 'Unknown provider'}) has passed maker-checker verification and is awaiting your final approval in the Claims Officer Queue.${notes}`,
    );
    await this.emailUser(
      checkerId,
      `You verified claim ${claim.claimNumber}`,
      `You have approved claim ${claim.claimNumber} at the maker-checker stage. It has been forwarded to the claims officer for final approval.${notes}`,
    );

    return updatedClaim;
  }

  // ─────────────────────────────────────────────────────────────
  // CLAIMS OFFICER operations (final approval gate)
  // ─────────────────────────────────────────────────────────────

  async claimsOfficerApprove(claimId: string, officerId: string, comments?: string) {
    const claim = await this.prisma.claim.findUnique({
      where: { id: claimId },
      include: { provider: true, documents: true },
    });

    if (!claim) throw new BadRequestException('Claim not found');
    if (claim.workflowStage !== 'claims_officer_review') {
      throw new BadRequestException('Claim is not in claims officer review stage');
    }

    await this.prisma.claimApproval.create({
      data: {
        claimId,
        level: 'claims_officer',
        approvalStage: 'final_approval',
        approvedBy: officerId,
        decision: 'approved',
        comments,
      },
    });

    const updatedClaim = await this.prisma.claim.update({
      where: { id: claimId },
      data: {
        workflowStage: 'payment_pending',
        status: 'approved',
        approvedAt: new Date(),
        assignedTo: null,
        claimsOfficerApprovedAt: new Date(),
        claimsOfficerApprovedBy: officerId,
      },
    });

    await this.prisma.claimStatusHistory.create({
      data: {
        claimId,
        fromStatus: claim.status,
        toStatus: 'approved',
        changedBy: officerId,
        reason: 'Approved by claims officer — proceeding to payment',
      },
    });

    await this.audit.record({
      actor: { userId: officerId },
      action: 'claims_officer_approved',
      entity: 'claim',
      entityId: claimId,
      oldValue: { status: claim.status, workflowStage: claim.workflowStage },
      newValue: { status: 'approved', workflowStage: 'payment_pending' },
      metadata: { claimNumber: claim.claimNumber, decision: 'approved', comments },
    });

    // ─── ML label ─────────────────────────────────────────────────────────
    await this.prisma.claimLabel
      .upsert({
        where: { claimId },
        create: {
          claimId,
          label: 'legitimate',
          source: 'auto_approve',
          labelledBy: officerId,
          confidence: 0.85,
          featuresSnapshot: {
            invoiceAmount: claim.invoiceAmount,
            ocrConfidence: claim.ocrConfidence,
            fraudSignalCount: Array.isArray(claim.fraudSignals)
              ? (claim.fraudSignals as any[]).length : 0,
          },
        },
        update: { label: 'legitimate', source: 'auto_approve', labelledBy: officerId },
      })
      .catch((err: any) =>
        this.logger.warn(`ML label failed for claim ${claimId}: ${err?.message}`),
      );

    // ─── Post-approval pipeline ────────────────────────────────────────────
    this.stampApprovedDocuments(claim.documents, claim.claimNumber).catch((err) =>
      this.logger.warn(`Auto-stamp failed for claim ${claimId}: ${err?.message}`),
    );
    this.edmsService.uploadClaimDocuments(claimId).catch((err) =>
      this.logger.warn(`EDMS upload failed for claim ${claimId}: ${err?.message}`),
    );
    this.eoxegenService.transferApprovedClaim(claimId).catch((err) =>
      this.logger.warn(`eOxegen transfer failed for claim ${claimId}: ${err?.message}`),
    );

    const notes = comments?.trim() ? `\n\nNotes:\n${comments.trim()}` : '';
    await this.notificationsService.sendEmail({
      recipient: claim.provider.email,
      subject: `Invoice Approved — Payment Processing: ${claim.claimNumber}`,
      message: `Your invoice ${claim.claimNumber} has been approved by the claims officer and is now queued for payment.${notes}`,
    });
    await this.emailUser(
      officerId,
      `You approved invoice ${claim.claimNumber}`,
      `You approved invoice ${claim.claimNumber} (${claim.provider?.name ?? 'Unknown provider'}). The provider has been notified and it is now in the payment queue.${notes}`,
    );

    return updatedClaim;
  }

  async claimsOfficerReject(claimId: string, officerId: string, reason: string) {
    const claim = await this.prisma.claim.findUnique({
      where: { id: claimId },
      include: { provider: true },
    });

    if (!claim) throw new BadRequestException('Claim not found');
    if (claim.workflowStage !== 'claims_officer_review') {
      throw new BadRequestException('Claim is not in claims officer review stage');
    }

    await this.prisma.claimApproval.create({
      data: {
        claimId,
        level: 'claims_officer',
        approvalStage: 'final_approval',
        approvedBy: officerId,
        decision: 'rejected',
        comments: reason,
      },
    });

    const updatedClaim = await this.prisma.claim.update({
      where: { id: claimId },
      data: {
        status: 'rejected',
        isRejected: true,
        rejectionReason: reason,
        rejectedBy: officerId,
        rejectedAt: new Date(),
        workflowStage: 'completed',
        assignedTo: null,
      },
    });

    await this.prisma.claimStatusHistory.create({
      data: {
        claimId,
        fromStatus: claim.status,
        toStatus: 'rejected',
        changedBy: officerId,
        reason,
      },
    });

    await this.audit.record({
      actor: { userId: officerId },
      action: 'claims_officer_rejected',
      entity: 'claim',
      entityId: claimId,
      oldValue: { status: claim.status, workflowStage: claim.workflowStage },
      newValue: { status: 'rejected', workflowStage: 'completed', rejectionReason: reason },
      metadata: { claimNumber: claim.claimNumber, decision: 'rejected', reason },
    });

    await this.prisma.claimLabel
      .upsert({
        where: { claimId },
        create: {
          claimId,
          label: 'suspicious',
          source: 'auto_reject',
          labelledBy: officerId,
          confidence: 0.75,
          notes: reason,
          featuresSnapshot: { invoiceAmount: claim.invoiceAmount },
        },
        update: { label: 'suspicious', source: 'auto_reject', labelledBy: officerId, notes: reason },
      })
      .catch((err: any) =>
        this.logger.warn(`ML label failed for rejected claim ${claimId}: ${err?.message}`),
      );

    await this.notificationsService.sendEmail({
      recipient: claim.provider.email,
      subject: `Invoice Rejected: ${claim.claimNumber}`,
      message: `Your invoice ${claim.claimNumber} has been rejected by the claims officer.\n\nReason: ${reason}\n\nYou may file an appeal within 30 days if you believe this decision is incorrect.`,
    });
    await this.emailUser(
      officerId,
      `You rejected invoice ${claim.claimNumber}`,
      `You rejected invoice ${claim.claimNumber} (${claim.provider?.name ?? 'Unknown provider'}). The provider has been notified.\n\nReason: ${reason}`,
    );

    return updatedClaim;
  }

  async claimsOfficerReturnToMakerChecker(claimId: string, officerId: string, reason: string) {
    const claim = await this.prisma.claim.findUnique({
      where: { id: claimId },
      include: { provider: true },
    });
    if (!claim) throw new BadRequestException('Claim not found');
    if (claim.workflowStage !== 'claims_officer_review') {
      throw new BadRequestException('Claim is not in claims officer review stage');
    }

    await this.prisma.claimApproval.create({
      data: {
        claimId,
        level: 'claims_officer',
        approvalStage: 'final_approval',
        approvedBy: officerId,
        decision: 'returned',
        comments: reason,
      },
    });

    const updatedClaim = await this.prisma.claim.update({
      where: { id: claimId },
      data: {
        workflowStage: 'maker_checker_review',
        status: 'under_review',
        assignedTo: null,
      },
    });

    await this.prisma.claimStatusHistory.create({
      data: {
        claimId,
        fromStatus: claim.status,
        toStatus: 'under_review',
        changedBy: officerId,
        reason: `Returned to maker-checker: ${reason}`,
      },
    });

    await this.audit.record({
      actor: { userId: officerId },
      action: 'returned_to_maker_checker',
      entity: 'claim',
      entityId: claimId,
      oldValue: { workflowStage: claim.workflowStage },
      newValue: { workflowStage: 'maker_checker_review' },
      metadata: { claimNumber: claim.claimNumber, reason },
    });

    const makerCheckerIds = await this.findCheckers();
    await this.emailUsers(
      makerCheckerIds,
      `Invoice returned for re-verification: ${claim.claimNumber}`,
      `Invoice ${claim.claimNumber} has been returned by the claims officer for additional verification.\n\nReason: ${reason}`,
    );
    await this.emailUser(
      officerId,
      `You returned invoice ${claim.claimNumber} to maker-checker`,
      `You returned invoice ${claim.claimNumber} (${claim.provider?.name ?? 'Unknown provider'}) to the maker-checker team.\n\nReason: ${reason}`,
    );

    return updatedClaim;
  }

  async claimsOfficerReturnToProvider(
    claimId: string,
    officerId: string,
    reason: string,
    missingDocuments: string[] = [],
  ) {
    const claim = await this.prisma.claim.findUnique({
      where: { id: claimId },
      include: { provider: true },
    });
    if (!claim) throw new BadRequestException('Claim not found');

    await this.prisma.claimApproval.create({
      data: {
        claimId,
        level: 'claims_officer',
        approvalStage: 'final_approval',
        approvedBy: officerId,
        decision: 'returned',
        comments: `Returned to provider: ${reason}`,
      },
    });

    const updatedClaim = await this.prisma.claim.update({
      where: { id: claimId },
      data: {
        status: 'incomplete',
        workflowStage: 'initial_review',
        assignedTo: null,
        isComplete: false,
        missingDocuments,
        rejectionReason: reason,
      },
    });

    await this.prisma.claimStatusHistory.create({
      data: {
        claimId,
        fromStatus: claim.status,
        toStatus: 'incomplete',
        changedBy: officerId,
        reason: `Returned to provider by claims officer: ${reason}`,
      },
    });

    await this.audit.record({
      actor: { userId: officerId },
      action: 'claims_officer_returned_to_provider',
      entity: 'claim',
      entityId: claimId,
      oldValue: { status: claim.status, workflowStage: claim.workflowStage },
      newValue: { status: 'incomplete', workflowStage: 'initial_review', missingDocuments },
      metadata: { claimNumber: claim.claimNumber, reason },
    });

    const missingList = missingDocuments.length
      ? `\n\nItems required:\n${missingDocuments.map((d) => `• ${d}`).join('\n')}`
      : '';

    await this.notificationsService.sendEmail({
      recipient: claim.provider.email,
      subject: `Invoice Returned — Action Required: ${claim.claimNumber}`,
      message: `Your invoice ${claim.claimNumber} has been returned by the claims officer and requires additional information.\n\nReason: ${reason}${missingList}\n\nPlease log in to the provider portal to resubmit.`,
    });
    await this.emailUser(
      officerId,
      `You returned invoice ${claim.claimNumber} to provider`,
      `You returned invoice ${claim.claimNumber} (${claim.provider?.name ?? 'Unknown provider'}) to the provider for additional information.\n\nReason: ${reason}${missingList}`,
    );

    return updatedClaim;
  }

  async claimsOfficerEscalateToFraud(claimId: string, officerId: string, reason: string) {
    const claim = await this.prisma.claim.findUnique({
      where: { id: claimId },
      include: { provider: true },
    });
    if (!claim) throw new BadRequestException('Claim not found');
    if (claim.workflowStage !== 'claims_officer_review') {
      throw new BadRequestException('Claim is not in claims officer review stage');
    }

    const existingSignals = (claim.fraudSignals as any[]) || [];
    const signal = {
      level: 'critical',
      title: 'Escalated by Claims Officer',
      detail: `Escalated to fraud team by claims officer: ${reason.trim()}`,
      detectedAt: new Date().toISOString(),
    };

    const updatedClaim = await this.prisma.claim.update({
      where: { id: claimId },
      data: {
        status: 'fraud_hold',
        workflowStage: 'fraud_review',
        fraudSignals: [signal, ...existingSignals],
        assignedTo: null,
      },
    });

    await this.prisma.claimStatusHistory.create({
      data: {
        claimId,
        fromStatus: claim.status,
        toStatus: 'fraud_hold',
        changedBy: officerId,
        reason: `Escalated to fraud: ${reason}`,
      },
    });

    await this.audit.record({
      actor: { userId: officerId },
      action: 'claims_officer_escalated_to_fraud',
      entity: 'claim',
      entityId: claimId,
      oldValue: { status: claim.status, workflowStage: claim.workflowStage },
      newValue: { status: 'fraud_hold', workflowStage: 'fraud_review' },
      metadata: { claimNumber: claim.claimNumber, reason },
    });

    const fraudOfficers = await this.prisma.user.findMany({
      where: { isActive: true, role: 'fraud_officer' },
      select: { id: true },
    });
    await this.emailUsers(
      fraudOfficers.map((u) => u.id),
      `Fraud escalation from claims officer: ${claim.claimNumber}`,
      `Invoice ${claim.claimNumber} (${claim.provider?.name ?? 'Unknown provider'}) has been escalated to the fraud team by a claims officer.\n\nReason: ${reason}\n\nPlease review in the Fraud Queue.`,
    );
    await this.emailUser(
      officerId,
      `You escalated invoice ${claim.claimNumber} to fraud`,
      `Invoice ${claim.claimNumber} has been escalated to the fraud team. They will review and notify you of their verdict.`,
    );

    return updatedClaim;
  }

  async checkerReject(claimId: string, checkerId: string, reason: string) {
    const claim = await this.prisma.claim.findUnique({
      where: { id: claimId },
      include: { provider: true },
    });

    if (!claim) throw new BadRequestException('Claim not found');
    if (claim.workflowStage !== 'maker_checker_review') throw new BadRequestException('Claim is not in maker-checker review stage');
    if (claim.assignedTo !== null && claim.assignedTo !== checkerId) throw new ForbiddenException('You are not assigned to this claim');

    await this.prisma.claimApproval.create({
      data: {
        claimId,
        level: 'maker_checker',
        approvalStage: 'second_approval',
        approvedBy: checkerId,
        decision: 'rejected',
        comments: reason,
      },
    });

    const updatedClaim = await this.prisma.claim.update({
      where: { id: claimId },
      data: {
        status: 'rejected',
        isRejected: true,
        rejectionReason: reason,
        rejectedBy: checkerId,
        rejectedAt: new Date(),
        workflowStage: 'completed',
        assignedTo: null,
      },
    });

    await this.prisma.claimStatusHistory.create({
      data: {
        claimId,
        fromStatus: claim.status,
        toStatus: 'rejected',
        changedBy: checkerId,
        reason,
      },
    });

    await this.audit.record({
      actor: { userId: checkerId },
      action: 'checker_rejected',
      entity: 'claim',
      entityId: claimId,
      oldValue: { status: claim.status, workflowStage: claim.workflowStage },
      newValue: { status: 'rejected', workflowStage: 'completed', rejectionReason: reason },
      metadata: { claimNumber: claim.claimNumber, decision: 'rejected', reason },
    });

    // ─── ML LABEL: auto-label rejected claim as suspicious ────────
    // Non-blocking: a labelling failure must never abort the rejection.
    await this.prisma.claimLabel
      .upsert({
        where: { claimId },
        create: {
          claimId,
          label: 'suspicious',
          source: 'auto_reject',
          labelledBy: checkerId,
          confidence: 0.7,
          notes: reason,
          featuresSnapshot: {
            invoiceAmount: claim.invoiceAmount,
            ocrConfidence: claim.ocrConfidence,
            fraudSignalCount: Array.isArray(claim.fraudSignals)
              ? (claim.fraudSignals as any[]).length
              : 0,
          },
        },
        update: {
          label: 'suspicious',
          source: 'auto_reject',
          labelledBy: checkerId,
          notes: reason,
        },
      })
      .catch((err: any) =>
        this.logger.warn(`Failed to label rejected claim ${claimId}: ${err?.message}`),
      );

    // ─── Notifications: provider + checker (actor) + original maker ──
    await this.notificationsService.sendEmail({
      recipient: claim.provider.email,
      subject: `Claim Rejected: ${claim.claimNumber}`,
      message: `Your claim ${claim.claimNumber} has been rejected at second-level review.\n\nReason: ${reason}\n\nContact your branch for next steps.`,
    });
    await this.emailUser(
      checkerId,
      `You rejected claim ${claim.claimNumber}`,
      `You have rejected claim ${claim.claimNumber} (${claim.provider?.name ?? 'Unknown provider'}) at second-level review. The provider has been notified.\n\nReason recorded: ${reason}`,
    );
    const originalMakerId = await this.findOriginalMaker(claimId);
    if (originalMakerId) {
      await this.emailUser(
        originalMakerId,
        `Claim ${claim.claimNumber} was rejected by the checker`,
        `A claim you previously reviewed (${claim.claimNumber} — ${claim.provider?.name ?? 'Unknown provider'}) has been rejected at second-level review.\n\nReason: ${reason}`,
      );
    }

    return updatedClaim;
  }

  /**
   * Return claim to provider as incomplete.
   * Provider will receive a notification and can resubmit.
   */
  async returnToProvider(claimId: string, checkerId: string, reason: string, missingDocuments: string[]) {
    const claim = await this.prisma.claim.findUnique({
      where: { id: claimId },
      include: { provider: true },
    });

    if (!claim) throw new BadRequestException('Claim not found');

    await this.prisma.claimApproval.create({
      data: {
        claimId,
        level: 'maker_checker',
        approvalStage: 'second_approval',
        approvedBy: checkerId,
        decision: 'returned',
        comments: `Returned to provider: ${reason}`,
      },
    });

    const updatedClaim = await this.prisma.claim.update({
      where: { id: claimId },
      data: {
        status: 'incomplete',
        workflowStage: 'initial_review',
        assignedTo: null,
        isComplete: false,
        missingDocuments,
        rejectionReason: reason,
      },
    });

    await this.prisma.claimStatusHistory.create({
      data: {
        claimId,
        fromStatus: claim.status,
        toStatus: 'incomplete',
        changedBy: checkerId,
        reason: `Returned to provider: ${reason}`,
      },
    });

    await this.audit.record({
      actor: { userId: checkerId },
      action: 'returned_to_provider',
      entity: 'claim',
      entityId: claimId,
      oldValue: { status: claim.status, workflowStage: claim.workflowStage },
      newValue: { status: 'incomplete', workflowStage: 'initial_review', missingDocuments },
      metadata: { claimNumber: claim.claimNumber, reason },
    });

    // Notify provider with list of missing documents
    const missingList = missingDocuments.length > 0
      ? `\n\nMissing documents:\n${missingDocuments.map((d) => `• ${d}`).join('\n')}`
      : '';

    // ─── Notifications: provider/branch (receiver) + checker (actor) ──
    await this.notificationsService.sendEmail({
      recipient: claim.provider.email,
      subject: `Claim Returned - Action Required: ${claim.claimNumber}`,
      message: `Your claim ${claim.claimNumber} has been returned and requires additional information.\n\nReason: ${reason}${missingList}\n\nPlease log in to the provider portal to resubmit the claim with the required documents.`,
    });
    await this.emailUser(
      checkerId,
      `You returned claim ${claim.claimNumber} to the provider`,
      `You have returned claim ${claim.claimNumber} (${claim.provider?.name ?? 'Unknown provider'}) to the provider for additional information.\n\nReason: ${reason}${missingList}`,
    );

    return updatedClaim;
  }

  /**
   * Return claim from checker to maker for corrections.
   */
  async returnToMaker(claimId: string, checkerId: string, reason: string) {
    const claim = await this.prisma.claim.findUnique({
      where: { id: claimId },
      include: { provider: true },
    });
    if (!claim) throw new BadRequestException('Claim not found');

    await this.prisma.claimApproval.create({
      data: {
        claimId,
        level: 'maker_checker',
        approvalStage: 'second_approval',
        approvedBy: checkerId,
        decision: 'returned',
        comments: reason,
      },
    });

    const updatedClaim = await this.prisma.claim.update({
      where: { id: claimId },
      data: {
        workflowStage: 'maker_checker_review',
        status: 'under_review',
        assignedTo: null,
      },
    });

    await this.prisma.claimStatusHistory.create({
      data: {
        claimId,
        fromStatus: claim.status,
        toStatus: 'under_review',
        changedBy: checkerId,
        reason: `Returned to maker: ${reason}`,
      },
    });

    await this.audit.record({
      actor: { userId: checkerId },
      action: 'returned_to_maker',
      entity: 'claim',
      entityId: claimId,
      oldValue: { workflowStage: claim.workflowStage, assignedTo: claim.assignedTo },
      newValue: { workflowStage: 'maker_checker_review', assignedTo: null },
      metadata: { claimNumber: claim.claimNumber, reason },
    });

    // ─── Notifications: maker(s) receiving it back + checker (actor) ──
    const originalMakerId = await this.findOriginalMaker(claimId);
    const makerRecipients = originalMakerId ? [originalMakerId] : await this.findMakers();
    await this.emailUsers(
      makerRecipients,
      `Claim returned for your review: ${claim.claimNumber}`,
      `Claim ${claim.claimNumber} (${claim.provider?.name ?? 'Unknown provider'}) has been returned by the checker for corrections.\n\nReason: ${reason}\n\nPlease open the Maker Queue to address the issues and re-submit.`,
    );
    await this.emailUser(
      checkerId,
      `You returned claim ${claim.claimNumber} to the maker`,
      `You have returned claim ${claim.claimNumber} (${claim.provider?.name ?? 'Unknown provider'}) to the maker for corrections.\n\nReason: ${reason}`,
    );

    return updatedClaim;
  }

  // ─────────────────────────────────────────────────────────────
  // Provider resubmission
  // ─────────────────────────────────────────────────────────────

  /**
   * Provider resubmits an incomplete claim with additional documents.
   */
  async providerResubmit(claimId: string, providerId: string, notes?: string) {
    const claim = await this.prisma.claim.findUnique({
      where: { id: claimId },
      include: { provider: true },
    });
    if (!claim) throw new BadRequestException('Claim not found');

    if (claim.status !== 'incomplete') {
      throw new BadRequestException('Only incomplete claims can be resubmitted');
    }

    const updatedClaim = await this.prisma.claim.update({
      where: { id: claimId },
      data: {
        status: 'resubmitted',
        workflowStage: 'initial_review',
        resubmissionCount: { increment: 1 },
        missingDocuments: [],
        notes: notes || claim.notes,
      },
    });

    await this.prisma.claimStatusHistory.create({
      data: {
        claimId,
        fromStatus: 'incomplete',
        toStatus: 'resubmitted',
        changedBy: providerId,
        reason: notes || 'Resubmitted by provider',
      },
    });

    await this.audit.record({
      actor: { userId: providerId },
      action: 'provider_resubmitted',
      entity: 'claim',
      entityId: claimId,
      oldValue: { status: claim.status, resubmissionCount: claim.resubmissionCount },
      newValue: {
        status: 'resubmitted',
        resubmissionCount: (claim.resubmissionCount || 0) + 1,
      },
      metadata: { claimNumber: claim.claimNumber, notes },
    });

    // ─── Notifications: maker queue (receiver) + provider (actor) ──────
    const notesBlock = notes?.trim() ? `\n\nProvider notes:\n${notes.trim()}` : '';
    const makerIds = await this.findMakers();
    await this.emailUsers(
      makerIds,
      `Claim resubmitted: ${claim.claimNumber}`,
      `Claim ${claim.claimNumber} (${claim.provider?.name ?? 'Unknown provider'}) has been resubmitted by the provider with additional documents and is ready for review.${notesBlock}`,
    );
    if (claim.provider?.email) {
      await this.notificationsService.sendEmail({
        recipient: claim.provider.email,
        subject: `Resubmission received: ${claim.claimNumber}`,
        message: `We have received your resubmission of claim ${claim.claimNumber}. It is back in the review queue and our team has been notified.${notesBlock}`,
      });
    }

    return updatedClaim;
  }

  // ─────────────────────────────────────────────────────────────
  // Approval history
  // ─────────────────────────────────────────────────────────────

  /**
   * Sweep any orphaned claims — submitted/resubmitted and unassigned —
   * and auto-route them to the least-loaded active claims_officer so they
   * appear in the Maker Queue. Returns the list of claims that were routed.
   */
  async rerouteOrphans(actorId?: string) {
    const orphans = await this.prisma.claim.findMany({
      where: {
        assignedTo: null,
        workflowStage: 'initial_review',
        status: { in: ['submitted', 'resubmitted'] },
      },
      select: { id: true, claimNumber: true, status: true, workflowStage: true },
    });

    if (orphans.length === 0) return { routed: 0, claims: [] };

    const officers = await this.prisma.user.findMany({
      where: { role: 'claims_officer', isActive: true },
      select: {
        id: true,
        name: true,
        _count: {
          select: {
            claimsAssigned: {
              where: { status: { in: ['submitted', 'under_review', 'resubmitted'] } },
            },
          },
        },
      },
    });
    if (officers.length === 0) return { routed: 0, claims: [] };

    // Sort ascending by open work so the least-loaded officer gets picked first.
    officers.sort((a, b) => a._count.claimsAssigned - b._count.claimsAssigned);

    const routed: Array<{ claimNumber: string; makerName: string }> = [];
    let cursor = 0;

    for (const claim of orphans) {
      const maker = officers[cursor % officers.length];
      cursor += 1;

      await this.prisma.claim.update({
        where: { id: claim.id },
        data: {
          assignedTo: maker.id,
          workflowStage: 'maker_checker_review',
          status: 'under_review',
        },
      });

      await this.prisma.claimStatusHistory.create({
        data: {
          claimId: claim.id,
          fromStatus: claim.status,
          toStatus: 'under_review',
          changedBy: actorId ?? null,
          reason: `Reroute sweep — auto-assigned to ${maker.name}`,
        },
      });

      await this.audit.record({
        actor: actorId ? { userId: actorId } : undefined,
        action: 'maker_auto_assigned',
        entity: 'claim',
        entityId: claim.id,
        oldValue: { status: claim.status, workflowStage: claim.workflowStage, assignedTo: null },
        newValue: { status: 'under_review', workflowStage: 'maker_checker_review', assignedTo: maker.id },
        metadata: { claimNumber: claim.claimNumber, makerName: maker.name, reason: 'reroute sweep' },
      });

      routed.push({ claimNumber: claim.claimNumber, makerName: maker.name });
    }

    return { routed: routed.length, claims: routed };
  }

  async getApprovalHistory(claimId: string) {
    return this.prisma.claimApproval.findMany({
      where: { claimId },
      include: {
        approver: {
          select: { id: true, name: true, email: true, role: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────

  // ─── Email recipient helpers ──────────────────────────────────────
  // Every workflow action emails both the receiving party and the actor.
  // The previous implementation passed user UUIDs to recipient fields —
  // these helpers look up the real email address first.

  private async emailUser(userId: string, subject: string, message: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, isActive: true },
    });
    if (!user?.email || !user.isActive) return;
    try {
      await this.notificationsService.sendEmail({
        recipient: user.email,
        subject,
        message,
      });
    } catch (err: any) {
      this.logger.warn(`Email to user ${userId} failed: ${err?.message}`);
    }
  }

  private async emailUsers(userIds: string[], subject: string, message: string) {
    if (!userIds.length) return;
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds }, isActive: true, email: { not: '' } },
      select: { email: true },
    });
    await Promise.all(
      users.map((u) =>
        this.notificationsService
          .sendEmail({ recipient: u.email, subject, message })
          .catch((err: any) =>
            this.logger.warn(`Fan-out email to ${redactEmail(u.email)} failed: ${err?.message}`),
          ),
      ),
    );
  }

  private async findCheckers(): Promise<string[]> {
    const checkers = await this.prisma.user.findMany({
      where: { isActive: true, role: 'maker_checker' },
      select: { id: true },
    });
    return checkers.map((u) => u.id);
  }

  private async findMakers(): Promise<string[]> {
    const makers = await this.prisma.user.findMany({
      where: { isActive: true, role: 'maker_checker' },
      select: { id: true },
    });
    return makers.map((u) => u.id);
  }

  private async findClaimsOfficers(): Promise<string[]> {
    const officers = await this.prisma.user.findMany({
      where: { isActive: true, role: 'claims_officer' },
      select: { id: true },
    });
    return officers.map((u) => u.id);
  }

  private async findOriginalMakerChecker(claimId: string): Promise<string | null> {
    const firstApproval = await this.prisma.claimApproval.findFirst({
      where: { claimId, level: { in: ['maker', 'maker_checker'] } },
      orderBy: { createdAt: 'asc' },
      select: { approvedBy: true },
    });
    return firstApproval?.approvedBy ?? null;
  }

  /** @deprecated Use findOriginalMakerChecker */
  private async findOriginalMaker(claimId: string): Promise<string | null> {
    return this.findOriginalMakerChecker(claimId);
  }

  private async stampApprovedDocuments(documents: any[], claimNumber: string) {
    for (const doc of documents) {
      if (doc.path && doc.mimetype === 'application/pdf') {
        try {
          await this.pdfWatermarkService.addApprovalStamp(doc.path, claimNumber);
          await this.prisma.document.update({
            where: { id: doc.id },
            data: { hasAnnotations: true },
          });
        } catch (err: any) {
          this.logger.warn(`Failed to stamp document ${doc.id}: ${err?.message}`);
        }
      }
    }
  }
}
