import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { createReadStream, existsSync, readFileSync } from 'fs';
import { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailService } from '../notifications/email.service';
import { EventsGateway } from '../notifications/events.gateway';
import { CreateProviderDto } from './dto/create-provider.dto';
import { UpdateProviderDto } from './dto/update-provider.dto';

@Injectable()
export class ProvidersService {
  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
    private emailService: EmailService,
    private eventsGateway: EventsGateway,
  ) {}

  // ── Self-Service Methods ──────────────────────────────────────────────

  /**
   * Get the provider's own profile
   */
  async getSelfProfile(providerId: string) {
    const provider = await this.prisma.provider.findUnique({
      where: { id: providerId },
      include: {
        branches_rel: true,
      },
    });

    if (!provider) {
      throw new NotFoundException(`Provider with ID ${providerId} not found`);
    }

    return provider;
  }

  /**
   * Update provider contact information (self-service)
   */
  async updateSelfProfile(
    providerId: string,
    data: { phone?: string; email?: string; contactPerson?: string; physicalAddress?: string },
  ) {
    const provider = await this.prisma.provider.findUnique({
      where: { id: providerId },
    });

    if (!provider) {
      throw new NotFoundException(`Provider with ID ${providerId} not found`);
    }

    // Only allow updating contact-related fields
    const allowedUpdate: Record<string, string> = {};
    if (data.phone !== undefined) allowedUpdate.phone = data.phone;
    if (data.email !== undefined) allowedUpdate.email = data.email;
    if (data.contactPerson !== undefined) allowedUpdate.contactPerson = data.contactPerson;
    if (data.physicalAddress !== undefined) allowedUpdate.physicalAddress = data.physicalAddress;

    return this.prisma.provider.update({
      where: { id: providerId },
      data: allowedUpdate,
    });
  }

  /**
   * Get claims belonging to the provider with optional filters
   */
  async getSelfClaims(
    providerId: string,
    filters: { status?: string; dateFrom?: string; dateTo?: string; search?: string },
    limit = 50,
    offset = 0,
  ) {
    const where: any = { providerId };

    if (filters.status) {
      where.status = filters.status;
    }

    if (filters.dateFrom || filters.dateTo) {
      where.createdAt = {};
      if (filters.dateFrom) {
        where.createdAt.gte = new Date(filters.dateFrom);
      }
      if (filters.dateTo) {
        where.createdAt.lte = new Date(filters.dateTo);
      }
    }

    if (filters.search) {
      where.OR = [
        { claimNumber: { contains: filters.search, mode: 'insensitive' } },
        { memberName: { contains: filters.search, mode: 'insensitive' } },
        { patientName: { contains: filters.search, mode: 'insensitive' } },
        { invoiceNumber: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const [claims, total] = await Promise.all([
      this.prisma.claim.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.claim.count({ where }),
    ]);
    return { claims, total };
  }

  /**
   * Get branches belonging to the provider
   */
  async getSelfBranches(providerId: string, limit = 50, offset = 0) {
    const where = { providerId };
    const [branches, total] = await Promise.all([
      this.prisma.branch.findMany({
        where,
        orderBy: { name: 'asc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.branch.count({ where }),
    ]);
    return { branches, total };
  }

  /**
   * Create a new branch for the provider (self-service)
   */
  async createSelfBranch(
    providerId: string,
    data: { code: string; name: string; region?: string; county?: string; address?: string; phone?: string; email?: string; contactPerson?: string },
  ) {
    const provider = await this.prisma.provider.findUnique({
      where: { id: providerId },
    });

    if (!provider) {
      throw new NotFoundException(`Provider with ID ${providerId} not found`);
    }

    return this.prisma.branch.create({
      data: {
        ...data,
        providerId,
      },
    });
  }

  /**
   * Get dashboard statistics for the provider
   */
  async getSelfStatistics(providerId: string) {
    const [
      totalClaims,
      submittedClaims,
      underReviewClaims,
      approvedClaims,
      rejectedClaims,
      paidClaims,
      amountAggregation,
    ] = await Promise.all([
      this.prisma.claim.count({ where: { providerId } }),
      this.prisma.claim.count({ where: { providerId, status: 'submitted' } }),
      this.prisma.claim.count({ where: { providerId, status: 'under_review' } }),
      this.prisma.claim.count({ where: { providerId, status: 'approved' } }),
      this.prisma.claim.count({ where: { providerId, status: 'rejected' } }),
      this.prisma.claim.count({ where: { providerId, status: 'paid' } }),
      this.prisma.claim.aggregate({
        where: { providerId },
        _sum: { invoiceAmount: true },
      }),
    ]);

    const approvedAmount = await this.prisma.claim.aggregate({
      where: { providerId, status: 'approved' },
      _sum: { invoiceAmount: true },
    });

    const paidAmount = await this.prisma.claim.aggregate({
      where: { providerId, status: 'paid' },
      _sum: { invoiceAmount: true },
    });

    return {
      claimsByStatus: {
        total: totalClaims,
        submitted: submittedClaims,
        underReview: underReviewClaims,
        approved: approvedClaims,
        rejected: rejectedClaims,
        paid: paidClaims,
      },
      amounts: {
        totalInvoiced: amountAggregation._sum.invoiceAmount || 0,
        totalApproved: approvedAmount._sum.invoiceAmount || 0,
        totalPaid: paidAmount._sum.invoiceAmount || 0,
      },
    };
  }

  // ── Admin / General Methods ────────────────────────────────────────────

  async create(createProviderDto: CreateProviderDto) {
    return this.prisma.provider.create({
      data: createProviderDto,
    });
  }

  async findAll(limit = 50, offset = 0) {
    const [providers, total] = await Promise.all([
      this.prisma.provider.findMany({
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.provider.count(),
    ]);
    return { providers, total };
  }

  async findOne(id: string) {
    const provider = await this.prisma.provider.findUnique({
      where: { id },
      include: {
        claims: {
          take: 10,
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!provider) {
      throw new NotFoundException(`Provider with ID ${id} not found`);
    }

    return provider;
  }

  async update(id: string, updateProviderDto: UpdateProviderDto) {
    try {
      return await this.prisma.provider.update({
        where: { id },
        data: updateProviderDto,
      });
    } catch (error) {
      throw new NotFoundException(`Provider with ID ${id} not found`);
    }
  }

  async remove(id: string) {
    try {
      await this.prisma.provider.delete({
        where: { id },
      });
      return { message: 'Provider deleted successfully' };
    } catch (error) {
      throw new NotFoundException(`Provider with ID ${id} not found`);
    }
  }

  async findByType(type: string, limit = 50, offset = 0) {
    const where = { type };
    const [providers, total] = await Promise.all([
      this.prisma.provider.findMany({
        where,
        orderBy: { name: 'asc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.provider.count({ where }),
    ]);
    return { providers, total };
  }

  async getActiveProviders(limit = 50, offset = 0) {
    const where = { isActive: true };
    const [providers, total] = await Promise.all([
      this.prisma.provider.findMany({
        where,
        orderBy: { name: 'asc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.provider.count({ where }),
    ]);
    return { providers, total };
  }

  /**
   * Get providers pending approval
   */
  async getPendingApprovals(limit = 50, offset = 0) {
    const where = {
      approvalStatus: { in: ['pending', 'pending_approval'] },
    };
    const [rows, total] = await Promise.all([
      this.prisma.provider.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.provider.count({ where }),
    ]);
    // Normalise to the shape the frontend expects
    const providers = rows.map((p) => ({
      id:              p.id,
      name:            p.name,
      type:            p.type,
      licenseNumber:   p.licenseNumber,
      contactPerson:   p.contactPerson,
      email:           p.email,
      phone:           p.phone,
      physicalAddress: p.physicalAddress,
      city:            p.city,
      region:          p.region,
      kraPin:          p.kraPin,
      notes:           p.rejectionReason ?? undefined,
      appliedAt:       p.createdAt.toISOString(),
    }));
    return providers;
  }

  /**
   * Approve provider registration. PR1 — refuses to proceed unless the
   * reviewing admin has scrolled through every page of every onboarding
   * document, captures the admin's approval comment, and notifies the
   * provider with a branded email.
   */
  async approveProvider(id: string, approvedBy: string, comment?: string) {
    const provider = await this.prisma.provider.findUnique({
      where: { id },
      include: { users: { where: { role: 'provider_admin' }, take: 1 } },
    });

    if (!provider) {
      throw new NotFoundException(`Provider with ID ${id} not found`);
    }
    if (provider.approvalStatus === 'approved') {
      return provider;
    }
    if (!['pending_approval', 'pending'].includes(provider.approvalStatus)) {
      throw new BadRequestException(
        `Provider cannot be approved from its current status: ${provider.approvalStatus}`,
      );
    }
    if (!comment || !comment.trim()) {
      throw new BadRequestException('An approval comment is required.');
    }

    // Per-page review gate — every onboarding document must have been viewed
    // page-by-page by THIS admin. Without this guard, approval would defeat
    // the audit-trail requirement we shipped specifically for this flow.
    const readiness = await this.getReviewReadiness(approvedBy, id);
    if (!readiness.readyToApprove) {
      const incomplete = readiness.documents.filter((d) => !d.complete).map((d) => ({
        documentId: d.id, fileName: d.fileName,
        viewed: d.viewedPages.length, total: d.pageCount,
      }));
      throw new BadRequestException({
        message: 'You must view every page of every uploaded document before approving.',
        code: 'review_incomplete',
        incomplete,
      });
    }

    const updatedProvider = await this.prisma.provider.update({
      where: { id },
      data: {
        approvalStatus: 'approved',
        status: 'approved',
        isActive: true,
        canSubmitClaims: true,
        approvedBy,
        approvedAt: new Date(),
        approvalComment: comment.trim(),
        rejectionReason: null,
      },
    });

    // Audit-log the approval itself separately from page views.
    const admin = await this.prisma.user.findUnique({
      where: { id: approvedBy }, select: { name: true, role: true },
    });
    await this.prisma.activityLog.create({
      data: {
        userId: approvedBy,
        username: admin?.name,
        userRole: admin?.role,
        action: 'approve_provider',
        entity: 'provider',
        entityId: id,
        status: 'success',
        metadata: { comment: comment.trim(), readiness: { totalDocuments: readiness.totalDocuments } },
      },
    });

    // Notify the provider admin with the branded "Approved" template.
    const adminUser = provider.users[0];
    this.emailService.sendProviderApprovalDecision({
      recipientEmail: adminUser?.email ?? provider.email,
      recipientName: adminUser?.name ?? provider.contactPerson,
      providerName: provider.name,
      decision: 'approved',
      comment: comment.trim(),
      loginUrl: `${process.env.APP_URL || 'http://localhost:3000'}/login`,
    }).catch(() => undefined);
    // Real-time bell badge for every provider_admin attached to this provider.
    const adminIds = provider.users.map((u) => u.id);
    if (adminIds.length) {
      this.eventsGateway.emitProviderDecision(adminIds, {
        providerId: id, providerName: provider.name, decision: 'approved', comment: comment.trim(),
      });
    }

    return updatedProvider;
  }

  /**
   * Reject provider registration. PR1 — requires both a rejection reason
   * (sent to the provider) and an internal admin comment.
   */
  async rejectProvider(id: string, reason: string, rejectedBy: string, comment?: string) {
    const provider = await this.prisma.provider.findUnique({
      where: { id },
      include: { users: { where: { role: 'provider_admin' }, take: 1 } },
    });

    if (!provider) {
      throw new NotFoundException(`Provider with ID ${id} not found`);
    }
    if (!['pending_approval', 'pending'].includes(provider.approvalStatus)) {
      throw new BadRequestException('Provider is not pending approval');
    }
    if (!reason || !reason.trim()) {
      throw new BadRequestException('A rejection reason is required.');
    }

    const updatedProvider = await this.prisma.provider.update({
      where: { id },
      data: {
        approvalStatus: 'rejected',
        status: 'rejected',
        isActive: false,
        canSubmitClaims: false,
        rejectionReason: reason.trim(),
        approvalComment: comment?.trim() || null,
      },
    });

    const admin = await this.prisma.user.findUnique({
      where: { id: rejectedBy }, select: { name: true, role: true },
    });
    await this.prisma.activityLog.create({
      data: {
        userId: rejectedBy,
        username: admin?.name,
        userRole: admin?.role,
        action: 'reject_provider',
        entity: 'provider',
        entityId: id,
        status: 'success',
        metadata: { reason: reason.trim(), comment: comment?.trim() ?? null },
      },
    });

    const adminUser = provider.users[0];
    this.emailService.sendProviderApprovalDecision({
      recipientEmail: adminUser?.email ?? provider.email,
      recipientName: adminUser?.name ?? provider.contactPerson,
      providerName: provider.name,
      decision: 'rejected',
      rejectionReason: reason.trim(),
      comment: comment?.trim(),
      loginUrl: `${process.env.APP_URL || 'http://localhost:3000'}/login`,
    }).catch(() => undefined);
    const adminIds = provider.users.map((u) => u.id);
    if (adminIds.length) {
      this.eventsGateway.emitProviderDecision(adminIds, {
        providerId: id, providerName: provider.name, decision: 'rejected', reason: reason.trim(), comment: comment?.trim(),
      });
    }

    return updatedProvider;
  }

  /**
   * Suspend provider (admin action)
   */
  async suspendProvider(id: string, reason: string, suspendedBy: string) {
    const provider = await this.prisma.provider.findUnique({
      where: { id },
    });

    if (!provider) {
      throw new NotFoundException(`Provider with ID ${id} not found`);
    }

    const updatedProvider = await this.prisma.provider.update({
      where: { id },
      data: {
        isActive: false,
        status: 'suspended',
        rejectionReason: reason, // Store suspension reason in rejectionReason field
      },
    });

    // Send notification
    await this.notificationsService.sendEmail({
      recipient: provider.email,
      subject: 'Provider Account Suspended',
      message: `Your provider account for ${provider.name} has been suspended. Reason: ${reason}. Please contact support.`,
    });

    return updatedProvider;
  }

  /**
   * Reactivate suspended provider
   */
  async reactivateProvider(id: string, reactivatedBy: string) {
    const provider = await this.prisma.provider.findUnique({
      where: { id },
    });

    if (!provider) {
      throw new NotFoundException(`Provider with ID ${id} not found`);
    }

    if (provider.approvalStatus !== 'approved') {
      throw new BadRequestException(
        'Provider must be approved before reactivation',
      );
    }

    const updatedProvider = await this.prisma.provider.update({
      where: { id },
      data: {
        isActive: true,
        status: 'approved',
        rejectionReason: null,
      },
    });

    // Send notification
    await this.notificationsService.sendEmail({
      recipient: provider.email,
      subject: 'Provider Account Reactivated',
      message: `Your provider account for ${provider.name} has been reactivated. You can now resume submitting claims.`,
    });

    return updatedProvider;
  }

  async deleteProofDocument(id: string) {
    const provider = await this.prisma.provider.findUnique({ where: { id } });
    if (!provider) throw new NotFoundException(`Provider ${id} not found`);
    if (provider.proofDocumentPath) {
      try { require('fs').unlinkSync(provider.proofDocumentPath); } catch { /* file may not exist */ }
    }
    return this.prisma.provider.update({
      where: { id },
      data: { proofDocumentPath: null, proofDocumentName: null },
    });
  }

  // ── Provider Documents ──────────────────────────────────────────────────

  async listDocuments(providerId: string) {
    return this.prisma.document.findMany({
      where: { providerId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, originalName: true, mimetype: true, size: true, documentType: true, createdAt: true },
    });
  }

  async addDocument(providerId: string, file: Express.Multer.File, uploadedBy?: string, displayName?: string) {
    return this.prisma.document.create({
      data: {
        filename: file.filename,
        originalName: displayName?.trim() || file.originalname,
        mimetype: file.mimetype,
        size: BigInt(file.size),
        path: file.path,
        providerId,
        uploadedBy: uploadedBy || null,
      },
      select: { id: true, originalName: true, mimetype: true, size: true, createdAt: true },
    });
  }

  async removeDocument(providerId: string, docId: string) {
    const doc = await this.prisma.document.findFirst({ where: { id: docId, providerId } });
    if (!doc) throw new NotFoundException('Document not found');
    try { require('fs').unlinkSync(doc.path); } catch { /* file may not exist */ }
    return this.prisma.document.delete({ where: { id: docId } });
  }

  // ── Onboarding Packet (procurement spec items a–f) ─────────────────────

  async updateOnboardingInfo(
    providerId: string,
    patch: {
      companyStructure?: string;
      yearsProvidingServices?: number;
      scopeUnderstanding?: string;
      programOfWorksText?: string;
    },
  ) {
    return this.prisma.provider.update({
      where: { id: providerId },
      data: {
        ...(patch.companyStructure !== undefined ? { companyStructure: patch.companyStructure } : {}),
        ...(patch.yearsProvidingServices !== undefined ? { yearsProvidingServices: patch.yearsProvidingServices } : {}),
        ...(patch.scopeUnderstanding !== undefined ? { scopeUnderstanding: patch.scopeUnderstanding } : {}),
        ...(patch.programOfWorksText !== undefined ? { programOfWorksText: patch.programOfWorksText } : {}),
      },
    });
  }

  async addOnboardingDocument(
    providerId: string,
    data: {
      category: string;
      fileName: string;
      filePath: string;
      fileSize?: number;
      mimeType?: string;
      uploadedBy?: string;
    },
  ) {
    // PR1 — extract page count so the admin review-readiness gate can require
    // per-page acknowledgement. Images count as 1 page; PDFs use pdf-parse.
    // A failure to extract is non-fatal: pageCount stays null and the gate
    // treats it as a single page (the safest default for tracking).
    let pageCount: number | null = null;
    if (data.mimeType === 'application/pdf') {
      try {
        const pdfParse = await import('pdf-parse');
        const buf = readFileSync(data.filePath);
        const parsed = await (pdfParse.default || (pdfParse as any))(buf);
        if (parsed?.numpages && parsed.numpages > 0) pageCount = parsed.numpages;
      } catch {
        pageCount = null;
      }
    } else if (data.mimeType && data.mimeType.startsWith('image/')) {
      pageCount = 1;
    }

    return this.prisma.providerOnboardingDocument.create({
      data: { providerId, ...data, pageCount: pageCount ?? undefined },
    });
  }

  // ── PR1: Per-page document view tracking ────────────────────────────────

  /**
   * Records that an admin viewed a specific page of an onboarding document.
   * Each (admin, document, page) tuple only needs to exist once — duplicates
   * are harmless but inflate the activity log, so we skip if already present.
   * Returns the running coverage for this document so the UI can update its
   * checkmark immediately without a second round-trip.
   */
  async recordDocumentPageView(
    adminUserId: string,
    documentId: string,
    pageNumber: number,
    meta?: { ipAddress?: string; userAgent?: string },
  ) {
    const doc = await this.prisma.providerOnboardingDocument.findUnique({
      where: { id: documentId },
    });
    if (!doc) throw new NotFoundException('Document not found');
    if (pageNumber < 1) throw new BadRequestException('pageNumber must be >= 1');
    if (doc.pageCount && pageNumber > doc.pageCount) {
      throw new BadRequestException(`pageNumber exceeds document length (${doc.pageCount})`);
    }

    // Idempotency check — we don't want one drag-the-scrollbar gesture to
    // create 200 audit rows for the same page.
    const existing = await this.prisma.activityLog.findFirst({
      where: {
        userId: adminUserId,
        action: 'view_page',
        entity: 'provider_onboarding_document',
        entityId: documentId,
        metadata: { path: ['pageNumber'], equals: pageNumber },
      },
      select: { id: true },
    });
    if (!existing) {
      const admin = await this.prisma.user.findUnique({
        where: { id: adminUserId },
        select: { name: true, role: true },
      });
      await this.prisma.activityLog.create({
        data: {
          userId: adminUserId,
          username: admin?.name,
          userRole: admin?.role,
          action: 'view_page',
          entity: 'provider_onboarding_document',
          entityId: documentId,
          status: 'success',
          ipAddress: meta?.ipAddress,
          userAgent: meta?.userAgent,
          metadata: { pageNumber, providerId: doc.providerId, category: doc.category },
        },
      });
    }

    const viewedPages = await this.getViewedPagesForDoc(adminUserId, documentId);
    return {
      documentId,
      pageCount: doc.pageCount ?? 1,
      viewedPages,
      complete: viewedPages.length >= (doc.pageCount ?? 1),
    };
  }

  /** Returns the distinct page numbers this admin has acknowledged for a doc. */
  private async getViewedPagesForDoc(adminUserId: string, documentId: string): Promise<number[]> {
    const rows = await this.prisma.activityLog.findMany({
      where: {
        userId: adminUserId,
        action: 'view_page',
        entity: 'provider_onboarding_document',
        entityId: documentId,
      },
      select: { metadata: true },
    });
    const pages = new Set<number>();
    for (const r of rows) {
      const p = (r.metadata as any)?.pageNumber;
      if (typeof p === 'number') pages.add(p);
    }
    return Array.from(pages).sort((a, b) => a - b);
  }

  /**
   * Computes whether the admin has scrolled through every page of every
   * onboarding document for a provider — the precondition for approval.
   * Returned shape is consumed directly by the admin review UI to render
   * per-document checkmarks and gate the Approve button.
   */
  async getReviewReadiness(adminUserId: string, providerId: string) {
    const docs = await this.prisma.providerOnboardingDocument.findMany({
      where: { providerId },
      orderBy: [{ category: 'asc' }, { uploadedAt: 'asc' }],
    });

    const results = await Promise.all(
      docs.map(async (d) => {
        const viewed = await this.getViewedPagesForDoc(adminUserId, d.id);
        const total = d.pageCount ?? 1;
        return {
          id: d.id,
          category: d.category,
          fileName: d.fileName,
          mimeType: d.mimeType,
          pageCount: total,
          viewedPages: viewed,
          complete: viewed.length >= total,
        };
      }),
    );

    const readyToApprove = results.length > 0 && results.every((r) => r.complete);
    return {
      providerId,
      documents: results,
      totalDocuments: results.length,
      completedDocuments: results.filter((r) => r.complete).length,
      readyToApprove,
    };
  }

  /** Stream an onboarding document inline (PDF viewer / image preview). */
  async streamOnboardingDocument(providerId: string, docId: string, res: Response) {
    const doc = await this.prisma.providerOnboardingDocument.findFirst({
      where: { id: docId, providerId },
    });
    if (!doc) throw new NotFoundException('Onboarding document not found');
    if (!existsSync(doc.filePath)) {
      throw new NotFoundException('Onboarding document file is missing on disk');
    }
    const mime = doc.mimeType || 'application/octet-stream';
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `inline; filename="${doc.fileName}"`);
    createReadStream(doc.filePath).pipe(res);
  }

  async removeOnboardingDocument(providerId: string, docId: string) {
    const doc = await this.prisma.providerOnboardingDocument.findFirst({
      where: { id: docId, providerId },
    });
    if (!doc) throw new NotFoundException('Onboarding document not found');
    try { require('fs').unlinkSync(doc.filePath); } catch { /* file may be gone */ }
    return this.prisma.providerOnboardingDocument.delete({ where: { id: docId } });
  }

  async addReference(
    providerId: string,
    data: {
      clientName: string;
      contactPerson: string;
      contactEmail?: string;
      contactPhone?: string;
      servicesProvided: string;
      engagementStartDate: string;
      engagementEndDate?: string;
    },
  ) {
    return this.prisma.providerReference.create({
      data: {
        providerId,
        clientName: data.clientName,
        contactPerson: data.contactPerson,
        contactEmail: data.contactEmail ?? null,
        contactPhone: data.contactPhone ?? null,
        servicesProvided: data.servicesProvided,
        engagementStartDate: new Date(data.engagementStartDate),
        engagementEndDate: data.engagementEndDate ? new Date(data.engagementEndDate) : null,
      },
    });
  }

  async removeReference(providerId: string, refId: string) {
    const ref = await this.prisma.providerReference.findFirst({
      where: { id: refId, providerId },
    });
    if (!ref) throw new NotFoundException('Reference not found');
    return this.prisma.providerReference.delete({ where: { id: refId } });
  }

  /** Returns the full onboarding packet + a per-section completeness report. */
  async getOnboardingPacket(providerId: string) {
    const provider = await this.prisma.provider.findUnique({
      where: { id: providerId },
      include: {
        onboardingDocuments: { orderBy: { uploadedAt: 'desc' } },
        references: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!provider) throw new NotFoundException('Provider not found');

    const docsByCategory = (cat: string) => provider.onboardingDocuments.filter(d => d.category === cat);
    const has = (cat: string) => docsByCategory(cat).length > 0;

    const sections = {
      // (a) Company profile + structure: need companyStructure AND at least one company_profile doc
      a_companyProfile: {
        complete: !!provider.companyStructure && has('company_profile'),
        requirements: ['companyStructure set', 'company_profile document uploaded'],
        companyStructure: provider.companyStructure,
        documents: docsByCategory('company_profile'),
      },
      // (b) Years of experience + evidence
      b_yearsOfExperience: {
        complete: (provider.yearsProvidingServices ?? 0) > 0 && has('experience_evidence'),
        yearsProvidingServices: provider.yearsProvidingServices,
        documents: docsByCategory('experience_evidence'),
      },
      // (c) Scope understanding — narrative text (min 100 chars to avoid trivial stubs)
      c_scopeUnderstanding: {
        complete: !!provider.scopeUnderstanding && provider.scopeUnderstanding.trim().length >= 100,
        scopeUnderstanding: provider.scopeUnderstanding,
      },
      // (d) Firm and staff certifications
      d_certifications: {
        complete: has('firm_certifications') && has('staff_certifications'),
        firmDocuments:  docsByCategory('firm_certifications'),
        staffDocuments: docsByCategory('staff_certifications'),
      },
      // (e) References — need at least 2 past engagements
      e_references: {
        complete: provider.references.length >= 2,
        references: provider.references,
      },
      // (f) Program of works — either a doc OR narrative text
      f_programOfWorks: {
        complete: !!provider.programOfWorksText && provider.programOfWorksText.trim().length >= 50
          || has('program_of_works'),
        programOfWorksText: provider.programOfWorksText,
        documents: docsByCategory('program_of_works'),
      },
    };

    const sectionKeys = Object.keys(sections) as (keyof typeof sections)[];
    const completedCount = sectionKeys.filter(k => sections[k].complete).length;
    const isComplete = completedCount === sectionKeys.length;
    const missing = sectionKeys.filter(k => !sections[k].complete);

    return {
      providerId: provider.id,
      providerName: provider.name,
      approvalStatus: provider.approvalStatus,
      onboardingSubmittedAt: provider.onboardingSubmittedAt,
      sections,
      completedCount,
      totalSections: sectionKeys.length,
      isComplete,
      missing,
    };
  }

  /** Called by the provider when they've filled every section and are ready
   *  for CIC review. Refuses to mark as submitted if the packet is incomplete. */
  async submitOnboarding(providerId: string) {
    const packet = await this.getOnboardingPacket(providerId);
    if (!packet.isComplete) {
      throw new BadRequestException({
        message: 'Onboarding packet is incomplete',
        missing: packet.missing,
      });
    }
    return this.prisma.provider.update({
      where: { id: providerId },
      data: {
        onboardingSubmittedAt: new Date(),
        approvalStatus: 'pending_approval',
        status: 'pending',
        rejectionReason: null,
      },
    });
  }

  // ── PR2: Provider-admin manages users under their provider ──────────────

  /** Users belonging to this provider, with optional status filter. */
  async listProviderUsers(providerId: string, opts?: { status?: 'pending' | 'approved' | 'rejected' }) {
    const where: any = { providerId, deletedAt: null };
    if (opts?.status) where.providerApprovalStatus = opts.status;
    const users = await this.prisma.user.findMany({
      where,
      orderBy: [{ providerApprovalStatus: 'asc' }, { createdAt: 'desc' }],
      select: {
        id: true, name: true, email: true, role: true, isActive: true,
        createdAt: true, lastLogin: true,
        emailVerifiedAt: true,
        providerApprovalStatus: true,
        providerApprovedAt: true,
        providerApprovedBy: true,
        providerApprovalComment: true,
        providerRejectionReason: true,
      },
    });
    return users;
  }

  /**
   * Provider admin approves one of their users. Refuses to operate on
   * users not attached to this provider (defense-in-depth on top of the
   * RolesGuard) and refuses to act on non-pending users.
   */
  async approveProviderUser(
    providerId: string,
    targetUserId: string,
    actingAdminId: string,
    comment?: string,
  ) {
    if (!comment || !comment.trim()) {
      throw new BadRequestException('An approval comment is required.');
    }
    const user = await this.prisma.user.findUnique({ where: { id: targetUserId } });
    if (!user || user.providerId !== providerId) {
      throw new NotFoundException('User not found under this provider');
    }
    if (user.providerApprovalStatus === 'approved') return user;
    if (user.providerApprovalStatus && user.providerApprovalStatus !== 'pending') {
      throw new BadRequestException(`Cannot approve from status: ${user.providerApprovalStatus}`);
    }

    const updated = await this.prisma.user.update({
      where: { id: targetUserId },
      data: {
        providerApprovalStatus: 'approved',
        providerApprovedBy: actingAdminId,
        providerApprovedAt: new Date(),
        providerApprovalComment: comment.trim(),
        providerRejectionReason: null,
      },
    });

    // Audit trail.
    const admin = await this.prisma.user.findUnique({
      where: { id: actingAdminId }, select: { name: true, role: true },
    });
    await this.prisma.activityLog.create({
      data: {
        userId: actingAdminId,
        username: admin?.name,
        userRole: admin?.role,
        action: 'approve_provider_user',
        entity: 'user',
        entityId: targetUserId,
        status: 'success',
        metadata: { providerId, comment: comment.trim() },
      },
    });

    const provider = await this.prisma.provider.findUnique({ where: { id: providerId }, select: { name: true } });
    this.emailService.sendUserApprovalDecision({
      recipientEmail: user.email,
      recipientName: user.name,
      providerName: provider?.name ?? 'your provider',
      decision: 'approved',
      comment: comment.trim(),
      loginUrl: `${process.env.APP_URL || 'http://localhost:3000'}/login`,
    }).catch(() => undefined);
    // Real-time toast for the user — they'll see a confirmation the moment
    // they refresh the login screen.
    this.eventsGateway.emitUserDecision(targetUserId, {
      providerId, providerName: provider?.name ?? 'your provider', decision: 'approved', comment: comment.trim(),
    });

    return updated;
  }

  async rejectProviderUser(
    providerId: string,
    targetUserId: string,
    actingAdminId: string,
    reason: string,
    comment?: string,
  ) {
    if (!reason || !reason.trim()) {
      throw new BadRequestException('A rejection reason is required.');
    }
    const user = await this.prisma.user.findUnique({ where: { id: targetUserId } });
    if (!user || user.providerId !== providerId) {
      throw new NotFoundException('User not found under this provider');
    }
    if (user.providerApprovalStatus && user.providerApprovalStatus !== 'pending') {
      throw new BadRequestException(`Cannot reject from status: ${user.providerApprovalStatus}`);
    }

    const updated = await this.prisma.user.update({
      where: { id: targetUserId },
      data: {
        providerApprovalStatus: 'rejected',
        providerApprovedBy: actingAdminId,
        providerApprovedAt: new Date(),
        providerRejectionReason: reason.trim(),
        providerApprovalComment: comment?.trim() || null,
        isActive: false,
      },
    });

    const admin = await this.prisma.user.findUnique({
      where: { id: actingAdminId }, select: { name: true, role: true },
    });
    await this.prisma.activityLog.create({
      data: {
        userId: actingAdminId,
        username: admin?.name,
        userRole: admin?.role,
        action: 'reject_provider_user',
        entity: 'user',
        entityId: targetUserId,
        status: 'success',
        metadata: { providerId, reason: reason.trim(), comment: comment?.trim() ?? null },
      },
    });

    const provider = await this.prisma.provider.findUnique({ where: { id: providerId }, select: { name: true } });
    this.emailService.sendUserApprovalDecision({
      recipientEmail: user.email,
      recipientName: user.name,
      providerName: provider?.name ?? 'your provider',
      decision: 'rejected',
      rejectionReason: reason.trim(),
      comment: comment?.trim(),
      loginUrl: `${process.env.APP_URL || 'http://localhost:3000'}/login`,
    }).catch(() => undefined);
    this.eventsGateway.emitUserDecision(targetUserId, {
      providerId, providerName: provider?.name ?? 'your provider', decision: 'rejected', reason: reason.trim(), comment: comment?.trim(),
    });

    return updated;
  }

  // ── A3: Monthly statement ──────────────────────────────────────────────

  async getStatementClaims(providerId: string, from: Date, to: Date) {
    return this.prisma.claim.findMany({
      where: {
        providerId,
        status: { in: ['approved', 'paid'] },
        approvedAt: { gte: from, lt: to },
      },
      select: {
        id: true,
        claimNumber: true,
        patientName: true,
        memberNumber: true,
        invoiceAmount: true,
        invoiceNumber: true,
        status: true,
        approvedAt: true,
        paidAt: true,
      },
      orderBy: { approvedAt: 'asc' },
    });
  }
}
