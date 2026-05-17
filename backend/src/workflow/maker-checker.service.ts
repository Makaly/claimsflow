import { Injectable, BadRequestException, ForbiddenException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailService, WorkflowEmailDto } from '../notifications/email.service';
import { EdmsIntegrationService } from '../common/services/edms-integration.service';
import { EoxegenIntegrationService } from '../common/services/eoxegen-integration.service';
import { PdfWatermarkService } from '../common/services/pdf-watermark.service';
import { AuditService } from '../common/services/audit.service';
import { redactEmail } from '../common/services/pii-redaction';

@Injectable()
export class MakerCheckerService {
  private readonly logger = new Logger(MakerCheckerService.name);

  private readonly appUrl = process.env.APP_URL || 'http://localhost:3000';

  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
    private emailService: EmailService,
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

    await this.emailUserHtml(makerId, {
      subject: `New claim assigned to you: ${claim.claimNumber}`,
      badgeText: 'Assigned', badgeStyle: 'blue',
      title: 'Claim Assigned to You',
      subtitle: `First-level (maker) review required`,
      claimNumber: claim.claimNumber,
      providerName: '',
      bodyLines: [
        `You have been assigned claim <strong style="color:#e4e4e7">${claim.claimNumber}</strong> for first-level (maker) review.`,
        'Please open the Maker Queue to begin your review and verify all documentation before forwarding for second-level check.',
      ],
      ctaText: 'Open Maker Queue', ctaUrl: `${this.appUrl}/workflow`,
    });

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
    const checkerIds = await this.findCheckers();
    const makerNotes = comments?.trim() ?? '';
    await this.emailUsersHtml(checkerIds, {
      subject: `Invoice awaiting second-level review: ${claim.claimNumber}`,
      badgeText: 'Review Required', badgeStyle: 'blue',
      title: 'Invoice in Checker Queue',
      subtitle: `Passed first-level review · awaiting your verification`,
      claimNumber: claim.claimNumber,
      providerName: claim.provider?.name ?? 'Unknown provider',
      invoiceAmount: claim.invoiceAmount ?? undefined,
      bodyLines: [
        `Invoice <strong style="color:#e4e4e7">${claim.claimNumber}</strong> has been approved at first-level (maker) review and is now awaiting your second-level verification.`,
        'Please review the submission in the Checker Queue and either approve or return it for corrections.',
      ],
      ...(makerNotes ? { reasonLabel: "Maker's notes", reasonText: makerNotes } : {}),
      ctaText: 'Open Checker Queue', ctaUrl: `${this.appUrl}/workflow`,
    });
    await this.emailUserHtml(makerId, {
      subject: `You approved claim ${claim.claimNumber}`,
      badgeText: 'Submitted', badgeStyle: 'green',
      title: 'Claim Forwarded to Checker',
      claimNumber: claim.claimNumber,
      providerName: claim.provider?.name ?? 'Unknown provider',
      bodyLines: [
        `You approved claim <strong style="color:#e4e4e7">${claim.claimNumber}</strong> and forwarded it to the Checker Queue.`,
        'The checker team has been notified and will complete second-level verification.',
      ],
      ...(makerNotes ? { reasonLabel: "Your notes", reasonText: makerNotes } : {}),
    });

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

    await this.emailAddressHtml(claim.provider.email, {
      subject: `Claim Rejected at First Review: ${claim.claimNumber}`,
      badgeText: 'Rejected', badgeStyle: 'red',
      title: 'Invoice Rejected',
      subtitle: 'First-level review decision',
      claimNumber: claim.claimNumber,
      providerName: claim.provider?.name ?? 'Unknown provider',
      invoiceAmount: claim.invoiceAmount ?? undefined,
      bodyLines: [
        `Your invoice <strong style="color:#e4e4e7">${claim.claimNumber}</strong> has been rejected at first-level (maker) review.`,
        'Please contact your branch for guidance on next steps. You may be able to resubmit with corrected documentation.',
      ],
      reasonLabel: 'Reason for rejection', reasonText: reason,
      ctaText: 'View in Provider Portal', ctaUrl: `${this.appUrl}/claims`,
    });
    await this.emailUserHtml(makerId, {
      subject: `You rejected claim ${claim.claimNumber}`,
      badgeText: 'Rejected', badgeStyle: 'red',
      title: 'Claim Rejected',
      claimNumber: claim.claimNumber,
      providerName: claim.provider?.name ?? 'Unknown provider',
      bodyLines: [
        `You rejected claim <strong style="color:#e4e4e7">${claim.claimNumber}</strong> (${claim.provider?.name ?? 'Unknown provider'}).`,
        'The provider has been notified of the rejection and the reason recorded.',
      ],
      reasonLabel: 'Reason recorded', reasonText: reason,
    });

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

    await this.emailUserHtml(checkerId, {
      subject: `Invoice assigned for checker review: ${claim.claimNumber}`,
      badgeText: 'Assigned', badgeStyle: 'blue',
      title: 'Invoice Awaits Your Review',
      subtitle: 'Second-level (checker) verification required',
      claimNumber: claim.claimNumber,
      providerName: '',
      bodyLines: [
        `Invoice <strong style="color:#e4e4e7">${claim.claimNumber}</strong> has passed first-level maker review and awaits your second-level approval.`,
        'Please open the Checker Queue to proceed with your verification.',
      ],
      ctaText: 'Open Checker Queue', ctaUrl: `${this.appUrl}/workflow`,
    });

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

    const checkerNotes = comments?.trim() ?? '';
    const officerIds = await this.findClaimsOfficers();
    await this.emailUsersHtml(officerIds, {
      subject: `Invoice ready for final approval: ${claim.claimNumber}`,
      badgeText: 'Action Required', badgeStyle: 'blue',
      title: 'Invoice Ready for Final Approval',
      subtitle: 'Maker-checker verification complete · awaiting your decision',
      claimNumber: claim.claimNumber,
      providerName: claim.provider?.name ?? 'Unknown provider',
      invoiceAmount: claim.invoiceAmount ?? undefined,
      bodyLines: [
        `Invoice <strong style="color:#e4e4e7">${claim.claimNumber}</strong> has successfully passed maker-checker verification and is now in the Claims Officer Queue awaiting your final approval.`,
        'Please review the claim details and either approve it for payment processing, return it for re-verification, or escalate if required.',
      ],
      ...(checkerNotes ? { reasonLabel: "Checker's notes", reasonText: checkerNotes } : {}),
      ctaText: 'Open Claims Queue', ctaUrl: `${this.appUrl}/workflow`,
    });
    await this.emailUserHtml(checkerId, {
      subject: `You verified claim ${claim.claimNumber}`,
      badgeText: 'Verified', badgeStyle: 'green',
      title: 'Invoice Verified',
      claimNumber: claim.claimNumber,
      providerName: claim.provider?.name ?? 'Unknown provider',
      bodyLines: [
        `You approved invoice <strong style="color:#e4e4e7">${claim.claimNumber}</strong> at the maker-checker stage.`,
        'It has been forwarded to the claims officer queue for final approval.',
      ],
      ...(checkerNotes ? { reasonLabel: 'Your notes', reasonText: checkerNotes } : {}),
    });

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
        approvalStage: 'claims_officer_review',
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

    const officerNotes = comments?.trim() ?? '';
    await this.emailAddressHtml(claim.provider.email, {
      subject: `Invoice Approved — Payment Processing: ${claim.claimNumber}`,
      badgeText: 'Approved', badgeStyle: 'green',
      title: 'Invoice Approved for Payment',
      subtitle: 'Final approval granted · payment queued',
      claimNumber: claim.claimNumber,
      providerName: claim.provider?.name ?? 'Unknown provider',
      invoiceAmount: claim.invoiceAmount ?? undefined,
      bodyLines: [
        `Congratulations — invoice <strong style="color:#e4e4e7">${claim.claimNumber}</strong> has been approved by the claims officer and is now queued for payment processing.`,
        'Settlement will be processed within the agreed Service Level Agreement (SLA). You will receive confirmation once payment has been released.',
      ],
      ...(officerNotes ? { reasonLabel: "Officer's notes", reasonText: officerNotes } : {}),
      ctaText: 'View Invoice Status', ctaUrl: `${this.appUrl}/claims`,
      nextNote: 'For queries, quote the invoice reference above when contacting the Claims Department at claims@cic.co.ke or +254 703 099 000.',
    });
    await this.emailUserHtml(officerId, {
      subject: `You approved invoice ${claim.claimNumber}`,
      badgeText: 'Approved', badgeStyle: 'green',
      title: 'Invoice Approved',
      claimNumber: claim.claimNumber,
      providerName: claim.provider?.name ?? 'Unknown provider',
      invoiceAmount: claim.invoiceAmount ?? undefined,
      bodyLines: [
        `You approved invoice <strong style="color:#e4e4e7">${claim.claimNumber}</strong> (${claim.provider?.name ?? 'Unknown provider'}).`,
        'The provider has been notified and the invoice is now in the payment processing queue.',
      ],
      ...(officerNotes ? { reasonLabel: 'Your notes', reasonText: officerNotes } : {}),
    });

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
        approvalStage: 'claims_officer_review',
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

    await this.emailAddressHtml(claim.provider.email, {
      subject: `Invoice Rejected: ${claim.claimNumber}`,
      badgeText: 'Rejected', badgeStyle: 'red',
      title: 'Invoice Rejected',
      subtitle: 'Final decision by claims officer',
      claimNumber: claim.claimNumber,
      providerName: claim.provider?.name ?? 'Unknown provider',
      invoiceAmount: claim.invoiceAmount ?? undefined,
      bodyLines: [
        `Invoice <strong style="color:#e4e4e7">${claim.claimNumber}</strong> has been rejected by the claims officer.`,
        'If you believe this decision is incorrect, you may file a formal appeal within 30 days of this notification.',
      ],
      reasonLabel: 'Reason for rejection', reasonText: reason,
      ctaText: 'View in Portal', ctaUrl: `${this.appUrl}/claims`,
      nextNote: 'To file an appeal or for assistance, contact the Claims Department at claims@cic.co.ke or +254 703 099 000.',
    });
    await this.emailUserHtml(officerId, {
      subject: `You rejected invoice ${claim.claimNumber}`,
      badgeText: 'Rejected', badgeStyle: 'red',
      title: 'Invoice Rejected',
      claimNumber: claim.claimNumber,
      providerName: claim.provider?.name ?? 'Unknown provider',
      bodyLines: [
        `You rejected invoice <strong style="color:#e4e4e7">${claim.claimNumber}</strong> (${claim.provider?.name ?? 'Unknown provider'}).`,
        'The provider has been notified of the rejection decision.',
      ],
      reasonLabel: 'Reason recorded', reasonText: reason,
    });

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
        approvalStage: 'claims_officer_review',
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
    await this.emailUsersHtml(makerCheckerIds, {
      subject: `Invoice returned for re-verification: ${claim.claimNumber}`,
      badgeText: 'Returned', badgeStyle: 'amber',
      title: 'Invoice Returned for Re-verification',
      subtitle: 'Returned by claims officer · additional review needed',
      claimNumber: claim.claimNumber,
      providerName: claim.provider?.name ?? 'Unknown provider',
      invoiceAmount: claim.invoiceAmount ?? undefined,
      bodyLines: [
        `Invoice <strong style="color:#e4e4e7">${claim.claimNumber}</strong> has been returned by the claims officer for additional verification.`,
        'Please open the Maker Queue to review the outstanding issues and re-submit for approval.',
      ],
      reasonLabel: 'Reason for return', reasonText: reason,
      ctaText: 'Open Maker Queue', ctaUrl: `${this.appUrl}/workflow`,
    });
    await this.emailUserHtml(officerId, {
      subject: `You returned invoice ${claim.claimNumber} to maker-checker`,
      badgeText: 'Returned', badgeStyle: 'amber',
      title: 'Invoice Returned to Maker-Checker',
      claimNumber: claim.claimNumber,
      providerName: claim.provider?.name ?? 'Unknown provider',
      bodyLines: [
        `You returned invoice <strong style="color:#e4e4e7">${claim.claimNumber}</strong> to the maker-checker team for re-verification.`,
        'The team has been notified and will address the outstanding issues.',
      ],
      reasonLabel: 'Reason', reasonText: reason,
    });

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
        approvalStage: 'claims_officer_review',
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

    await this.emailAddressHtml(claim.provider.email, {
      subject: `Invoice Returned — Action Required: ${claim.claimNumber}`,
      badgeText: 'Action Required', badgeStyle: 'amber',
      title: 'Invoice Returned — Additional Information Needed',
      subtitle: 'Returned by claims officer',
      claimNumber: claim.claimNumber,
      providerName: claim.provider?.name ?? 'Unknown provider',
      invoiceAmount: claim.invoiceAmount ?? undefined,
      bodyLines: [
        `Invoice <strong style="color:#e4e4e7">${claim.claimNumber}</strong> has been returned by the claims officer and requires additional information before it can proceed.`,
        'Please log in to the provider portal, address the items listed below, and resubmit the claim with the required documentation.',
      ],
      reasonLabel: 'Reason for return', reasonText: reason,
      ...(missingDocuments.length ? { missingDocuments } : {}),
      ctaText: 'Resubmit in Portal', ctaUrl: `${this.appUrl}/claims`,
    });
    await this.emailUserHtml(officerId, {
      subject: `You returned invoice ${claim.claimNumber} to provider`,
      badgeText: 'Returned', badgeStyle: 'amber',
      title: 'Invoice Returned to Provider',
      claimNumber: claim.claimNumber,
      providerName: claim.provider?.name ?? 'Unknown provider',
      bodyLines: [
        `You returned invoice <strong style="color:#e4e4e7">${claim.claimNumber}</strong> to the provider for additional information.`,
        'The provider has been notified and will resubmit once they have addressed the outstanding requirements.',
      ],
      reasonLabel: 'Reason', reasonText: reason,
      ...(missingDocuments.length ? { missingDocuments } : {}),
    });

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
    await this.emailUsersHtml(fraudOfficers.map((u) => u.id), {
      subject: `Fraud escalation — action required: ${claim.claimNumber}`,
      badgeText: 'Fraud Escalation', badgeStyle: 'red',
      title: 'Invoice Escalated for Fraud Review',
      subtitle: 'Escalated by claims officer · immediate review required',
      claimNumber: claim.claimNumber,
      providerName: claim.provider?.name ?? 'Unknown provider',
      invoiceAmount: claim.invoiceAmount ?? undefined,
      bodyLines: [
        `Invoice <strong style="color:#e4e4e7">${claim.claimNumber}</strong> has been escalated to the Fraud Team by a claims officer and requires your immediate attention.`,
        'Please open the Fraud Queue to review the claim, examine any attached fraud signals, and record your verdict.',
      ],
      reasonLabel: 'Escalation reason', reasonText: reason,
      ctaText: 'Open Fraud Queue', ctaUrl: `${this.appUrl}/workflow`,
    });
    await this.emailUserHtml(officerId, {
      subject: `You escalated invoice ${claim.claimNumber} to fraud`,
      badgeText: 'Escalated', badgeStyle: 'red',
      title: 'Invoice Escalated to Fraud Team',
      claimNumber: claim.claimNumber,
      providerName: claim.provider?.name ?? 'Unknown provider',
      bodyLines: [
        `Invoice <strong style="color:#e4e4e7">${claim.claimNumber}</strong> has been escalated to the Fraud Team for investigation.`,
        'The fraud officers have been notified. You will be informed once they have completed their review and recorded their verdict.',
      ],
      reasonLabel: 'Escalation reason', reasonText: reason,
    });

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

    await this.emailAddressHtml(claim.provider.email, {
      subject: `Claim Rejected: ${claim.claimNumber}`,
      badgeText: 'Rejected', badgeStyle: 'red',
      title: 'Claim Rejected at Second-Level Review',
      subtitle: 'Checker decision',
      claimNumber: claim.claimNumber,
      providerName: claim.provider?.name ?? 'Unknown provider',
      invoiceAmount: claim.invoiceAmount ?? undefined,
      bodyLines: [
        `Claim <strong style="color:#e4e4e7">${claim.claimNumber}</strong> has been rejected at second-level (checker) review.`,
        'Please contact your branch for guidance. An appeal may be filed within 30 days if you believe this decision is incorrect.',
      ],
      reasonLabel: 'Reason for rejection', reasonText: reason,
      ctaText: 'View in Portal', ctaUrl: `${this.appUrl}/claims`,
    });
    await this.emailUserHtml(checkerId, {
      subject: `You rejected claim ${claim.claimNumber}`,
      badgeText: 'Rejected', badgeStyle: 'red',
      title: 'Claim Rejected',
      claimNumber: claim.claimNumber,
      providerName: claim.provider?.name ?? 'Unknown provider',
      bodyLines: [
        `You rejected claim <strong style="color:#e4e4e7">${claim.claimNumber}</strong> at second-level review.`,
        'The provider has been notified of the rejection decision.',
      ],
      reasonLabel: 'Reason recorded', reasonText: reason,
    });
    const originalMakerId = await this.findOriginalMaker(claimId);
    if (originalMakerId) {
      await this.emailUserHtml(originalMakerId, {
        subject: `Claim ${claim.claimNumber} rejected by checker`,
        badgeText: 'Rejected', badgeStyle: 'red',
        title: 'Claim Rejected at Checker Stage',
        claimNumber: claim.claimNumber,
        providerName: claim.provider?.name ?? 'Unknown provider',
        bodyLines: [
          `A claim you previously reviewed — <strong style="color:#e4e4e7">${claim.claimNumber}</strong> (${claim.provider?.name ?? 'Unknown provider'}) — has been rejected at second-level (checker) review.`,
          'No further action is required from you at this stage.',
        ],
        reasonLabel: 'Reason', reasonText: reason,
      });
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
    await this.emailAddressHtml(claim.provider.email, {
      subject: `Claim Returned — Action Required: ${claim.claimNumber}`,
      badgeText: 'Action Required', badgeStyle: 'amber',
      title: 'Claim Returned — Additional Documents Needed',
      subtitle: 'Returned by checker at second-level review',
      claimNumber: claim.claimNumber,
      providerName: claim.provider?.name ?? 'Unknown provider',
      invoiceAmount: claim.invoiceAmount ?? undefined,
      bodyLines: [
        `Claim <strong style="color:#e4e4e7">${claim.claimNumber}</strong> has been returned and requires additional information before it can proceed to the next stage.`,
        'Please log in to the provider portal, provide the missing documents listed below, and resubmit your claim.',
      ],
      reasonLabel: 'Reason for return', reasonText: reason,
      ...(missingDocuments.length ? { missingDocuments } : {}),
      ctaText: 'Resubmit in Portal', ctaUrl: `${this.appUrl}/claims`,
    });
    await this.emailUserHtml(checkerId, {
      subject: `You returned claim ${claim.claimNumber} to the provider`,
      badgeText: 'Returned', badgeStyle: 'amber',
      title: 'Claim Returned to Provider',
      claimNumber: claim.claimNumber,
      providerName: claim.provider?.name ?? 'Unknown provider',
      bodyLines: [
        `You returned claim <strong style="color:#e4e4e7">${claim.claimNumber}</strong> to the provider for additional documentation.`,
        'The provider has been notified and will resubmit once they have addressed the outstanding requirements.',
      ],
      reasonLabel: 'Reason', reasonText: reason,
      ...(missingDocuments.length ? { missingDocuments } : {}),
    });

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

    const originalMakerId = await this.findOriginalMaker(claimId);
    const makerRecipients = originalMakerId ? [originalMakerId] : await this.findMakers();
    await this.emailUsersHtml(makerRecipients, {
      subject: `Claim returned for corrections: ${claim.claimNumber}`,
      badgeText: 'Returned', badgeStyle: 'amber',
      title: 'Claim Returned for Corrections',
      subtitle: 'Returned by checker · please address and re-submit',
      claimNumber: claim.claimNumber,
      providerName: claim.provider?.name ?? 'Unknown provider',
      bodyLines: [
        `Claim <strong style="color:#e4e4e7">${claim.claimNumber}</strong> (${claim.provider?.name ?? 'Unknown provider'}) has been returned by the checker for corrections.`,
        'Please open the Maker Queue to review the outstanding issues, make the necessary corrections, and re-submit for second-level approval.',
      ],
      reasonLabel: 'Reason for return', reasonText: reason,
      ctaText: 'Open Maker Queue', ctaUrl: `${this.appUrl}/workflow`,
    });
    await this.emailUserHtml(checkerId, {
      subject: `You returned claim ${claim.claimNumber} to the maker`,
      badgeText: 'Returned', badgeStyle: 'amber',
      title: 'Claim Returned to Maker',
      claimNumber: claim.claimNumber,
      providerName: claim.provider?.name ?? 'Unknown provider',
      bodyLines: [
        `You returned claim <strong style="color:#e4e4e7">${claim.claimNumber}</strong> to the maker for corrections.`,
        'The maker has been notified and will address the issues before re-submitting.',
      ],
      reasonLabel: 'Reason', reasonText: reason,
    });

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

    const providerNotes = notes?.trim() ?? '';
    const makerIds = await this.findMakers();
    await this.emailUsersHtml(makerIds, {
      subject: `Claim resubmitted: ${claim.claimNumber}`,
      badgeText: 'Resubmitted', badgeStyle: 'blue',
      title: 'Provider Resubmission Received',
      subtitle: 'Claim back in the maker queue · ready for review',
      claimNumber: claim.claimNumber,
      providerName: claim.provider?.name ?? 'Unknown provider',
      invoiceAmount: claim.invoiceAmount ?? undefined,
      bodyLines: [
        `Claim <strong style="color:#e4e4e7">${claim.claimNumber}</strong> (${claim.provider?.name ?? 'Unknown provider'}) has been resubmitted by the provider with additional documents and is ready for first-level review.`,
        'Please open the Maker Queue to begin your review.',
      ],
      ...(providerNotes ? { reasonLabel: "Provider's notes", reasonText: providerNotes } : {}),
      ctaText: 'Open Maker Queue', ctaUrl: `${this.appUrl}/workflow`,
    });
    if (claim.provider?.email) {
      await this.emailAddressHtml(claim.provider.email, {
        subject: `Resubmission received: ${claim.claimNumber}`,
        badgeText: 'Received', badgeStyle: 'green',
        title: 'Resubmission Successfully Received',
        claimNumber: claim.claimNumber,
        providerName: claim.provider?.name ?? 'Unknown provider',
        invoiceAmount: claim.invoiceAmount ?? undefined,
        bodyLines: [
          `We have received your resubmission of claim <strong style="color:#e4e4e7">${claim.claimNumber}</strong>.`,
          'It is back in the review queue and the claims team has been notified. You will receive an update once the review is complete.',
        ],
        ...(providerNotes ? { reasonLabel: 'Your notes', reasonText: providerNotes } : {}),
        nextNote: 'For queries, quote the claim reference above when contacting the Claims Department at claims@cic.co.ke.',
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

  private async emailUserHtml(userId: string, dto: Omit<WorkflowEmailDto, 'recipientEmail'>) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, isActive: true },
    });
    if (!user?.email || !user.isActive) return;
    try {
      await this.emailService.sendWorkflowEmail({ ...dto, recipientEmail: user.email });
    } catch (err: any) {
      this.logger.warn(`HTML email to user ${userId} failed: ${err?.message}`);
    }
  }

  private async emailUsersHtml(userIds: string[], dto: Omit<WorkflowEmailDto, 'recipientEmail'>) {
    if (!userIds.length) return;
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds }, isActive: true, email: { not: '' } },
      select: { email: true },
    });
    await Promise.all(
      users.map((u) =>
        this.emailService
          .sendWorkflowEmail({ ...dto, recipientEmail: u.email })
          .catch((err: any) =>
            this.logger.warn(`HTML fan-out email to ${redactEmail(u.email)} failed: ${err?.message}`),
          ),
      ),
    );
  }

  private async emailAddressHtml(email: string, dto: Omit<WorkflowEmailDto, 'recipientEmail'>) {
    if (!email) return;
    try {
      await this.emailService.sendWorkflowEmail({ ...dto, recipientEmail: email });
    } catch (err: any) {
      this.logger.warn(`HTML email to ${redactEmail(email)} failed: ${err?.message}`);
    }
  }

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
