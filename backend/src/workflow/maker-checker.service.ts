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
        workflowStage: 'maker_review',
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
      newValue: { assignedTo: makerId, workflowStage: 'maker_review', status: 'under_review' },
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
    if (claim.workflowStage !== 'maker_review') throw new BadRequestException('Claim is not in maker review stage');
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
        workflowStage: 'checker_review',
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
      newValue: { workflowStage: 'checker_review', assignedTo: null },
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
    if (claim.workflowStage !== 'maker_review') throw new BadRequestException('Claim is not in maker review stage');
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
    if (claim.workflowStage !== 'checker_review') throw new BadRequestException('Claim is not in checker review stage');

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
    if (claim.workflowStage !== 'checker_review') throw new BadRequestException('Claim is not in checker review stage');
    if (claim.assignedTo !== null && claim.assignedTo !== checkerId) throw new ForbiddenException('You are not assigned to this claim');

    // Record checker approval
    await this.prisma.claimApproval.create({
      data: {
        claimId,
        level: 'maker_checker',
        approvalStage: 'second_approval',
        approvedBy: checkerId,
        decision: 'approved',
        comments,
      },
    });

    // Mark claim as approved
    const updatedClaim = await this.prisma.claim.update({
      where: { id: claimId },
      data: {
        workflowStage: 'final_approval',
        status: 'approved',
        approvedAt: new Date(),
        assignedTo: null,
      },
    });

    await this.prisma.claimStatusHistory.create({
      data: {
        claimId,
        fromStatus: claim.status,
        toStatus: 'approved',
        changedBy: checkerId,
        reason: 'Approved by checker',
      },
    });

    await this.audit.record({
      actor: { userId: checkerId },
      action: 'checker_approved',
      entity: 'claim',
      entityId: claimId,
      oldValue: { status: claim.status, workflowStage: claim.workflowStage },
      newValue: { status: 'approved', workflowStage: 'final_approval' },
      metadata: { claimNumber: claim.claimNumber, decision: 'approved', comments },
    });

    // ─── ML LABEL: auto-label approved claim as legitimate ────────
    // Non-blocking: a labelling failure must never abort the approval.
    await this.prisma.claimLabel
      .upsert({
        where: { claimId },
        create: {
          claimId,
          label: 'legitimate',
          source: 'auto_approve',
          labelledBy: checkerId,
          confidence: 0.7, // auto-labels less certain than manual reviews
          featuresSnapshot: {
            invoiceAmount: claim.invoiceAmount,
            ocrConfidence: claim.ocrConfidence,
            fraudSignalCount: Array.isArray(claim.fraudSignals)
              ? (claim.fraudSignals as any[]).length
              : 0,
          },
        },
        update: {
          label: 'legitimate',
          source: 'auto_approve',
          labelledBy: checkerId,
        },
      })
      .catch((err: any) =>
        this.logger.warn(`Failed to label approved claim ${claimId}: ${err?.message}`),
      );

    // ─── POST-APPROVAL PIPELINE (non-blocking) ───────────────────

    // 1. Auto-stamp approved PDFs with "APPROVED" watermark
    this.stampApprovedDocuments(claim.documents, claim.claimNumber).catch((err) =>
      this.logger.warn(`Auto-stamp failed for claim ${claimId}: ${err?.message}`),
    );

    // 2. Upload all documents to EDMS
    this.edmsService.uploadClaimDocuments(claimId).catch((err) =>
      this.logger.warn(`EDMS upload failed for claim ${claimId}: ${err?.message}`),
    );

    // 3. Transfer to eOxegen / Smart system
    this.eoxegenService.transferApprovedClaim(claimId).catch((err) =>
      this.logger.warn(`eOxegen transfer failed for claim ${claimId}: ${err?.message}`),
    );

    // ─────────────────────────────────────────────────────────────

    // ─── Notifications: provider + checker (actor) + original maker ──
    const checkerNotes = comments?.trim()
      ? `\n\nChecker's notes:\n${comments.trim()}`
      : '';
    await this.notificationsService.sendEmail({
      recipient: claim.provider.email,
      subject: `Claim Approved: ${claim.claimNumber}`,
      message: `Your claim ${claim.claimNumber} has been approved and will be processed for payment.${checkerNotes}`,
    });
    await this.emailUser(
      checkerId,
      `You approved claim ${claim.claimNumber}`,
      `You have given final approval to claim ${claim.claimNumber} (${claim.provider?.name ?? 'Unknown provider'}). The provider has been notified and the claim has moved into the payment pipeline.${checkerNotes}`,
    );
    const originalMakerId = await this.findOriginalMaker(claimId);
    if (originalMakerId) {
      await this.emailUser(
        originalMakerId,
        `Claim ${claim.claimNumber} has been approved`,
        `A claim you previously reviewed (${claim.claimNumber} — ${claim.provider?.name ?? 'Unknown provider'}) has been given final approval by the checker.${checkerNotes}`,
      );
    }

    return updatedClaim;
  }

  async checkerReject(claimId: string, checkerId: string, reason: string) {
    const claim = await this.prisma.claim.findUnique({
      where: { id: claimId },
      include: { provider: true },
    });

    if (!claim) throw new BadRequestException('Claim not found');
    if (claim.workflowStage !== 'checker_review') throw new BadRequestException('Claim is not in checker review stage');
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
        workflowStage: 'maker_review',
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
      newValue: { workflowStage: 'maker_review', assignedTo: null },
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
          workflowStage: 'maker_review',
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
        newValue: { status: 'under_review', workflowStage: 'maker_review', assignedTo: maker.id },
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
