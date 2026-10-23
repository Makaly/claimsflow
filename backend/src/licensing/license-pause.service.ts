import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LicenseService } from './license.service';
import { LicenseEmailService } from './license-email.service';

interface CreatePauseInput {
  type: 'PAUSE' | 'RESUME';
  reason?: string;
  proofUrl?: string;
  ticketRef?: string;
}

/**
 * Subscription pause/resume workflow (mirrors helpdesk's pause-requests). A
 * request is raised with a reason/proof, then approved or rejected by an admin.
 * Approval executes the underlying licence transition — and on RESUME the days
 * the licence sat paused are credited back onto the expiry (handled in
 * LicenseService.resumeLicense). An admin may also auto-approve at creation.
 */
@Injectable()
export class LicensePauseService {
  private readonly logger = new Logger(LicensePauseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly licenses: LicenseService,
    private readonly emails: LicenseEmailService,
  ) {}

  /** Raise a pause/resume request. autoApprove executes it immediately. */
  async createRequest(tenantId: string, input: CreatePauseInput, requestedBy?: string, autoApprove = false) {
    if (!['PAUSE', 'RESUME'].includes(input.type)) throw new BadRequestException('type must be PAUSE or RESUME');

    const info = await this.licenses.getLicenseInfo(tenantId); // 404s if tenant missing
    if (input.type === 'PAUSE' && info.isPaused) throw new ConflictException('Subscription is already paused');
    if (input.type === 'RESUME' && !info.isPaused) throw new ConflictException('Subscription is not paused');

    // Block duplicate pending requests.
    const pending = await this.prisma.licensePauseRequest.findFirst({
      where: { tenantId, status: 'PENDING' },
      select: { id: true },
    });
    if (pending) throw new ConflictException('A pause/resume request is already pending for this tenant');

    const req = await this.prisma.licensePauseRequest.create({
      data: {
        tenantId,
        type: input.type,
        reason: input.reason,
        proofUrl: input.proofUrl,
        ticketRef: input.ticketRef,
        requestedBy,
        status: autoApprove ? 'PENDING' : 'PENDING',
      },
    });

    if (autoApprove) return this.approve(req.id, requestedBy);
    return req;
  }

  /** Approve a pending request and execute the licence transition. */
  async approve(requestId: string, reviewedBy?: string) {
    const req = await this.prisma.licensePauseRequest.findUnique({ where: { id: requestId } });
    if (!req) throw new NotFoundException('Pause request not found');
    if (req.status !== 'PENDING') throw new ConflictException(`Request already ${req.status.toLowerCase()}`);

    let daysPaused = 0;
    let info;
    if (req.type === 'PAUSE') {
      info = await this.licenses.pauseLicense(req.tenantId);
    } else {
      const res = await this.licenses.resumeLicense(req.tenantId);
      info = res.info;
      daysPaused = res.daysPaused;
    }

    const updated = await this.prisma.licensePauseRequest.update({
      where: { id: requestId },
      data: { status: 'APPROVED', reviewedBy, reviewedAt: new Date(), daysPaused },
    });

    // Notify the tenant admin (best-effort).
    const admin = await this.prisma.user.findFirst({
      where: { tenantId: req.tenantId, role: 'admin', isActive: true },
      select: { email: true },
    });
    if (admin?.email) {
      try {
        if (req.type === 'PAUSE') await this.emails.sendPauseNotification(info, admin.email);
        else await this.emails.sendResumeNotification(info, admin.email, daysPaused);
      } catch (e) {
        this.logger.warn(`Pause/resume email failed for tenant ${req.tenantId}: ${(e as Error).message}`);
      }
    }

    this.logger.log(`Pause request ${requestId} (${req.type}) approved for tenant ${req.tenantId}; daysPaused=${daysPaused}`);
    return { request: updated, info, daysPaused };
  }

  /** Reject a pending request. */
  async reject(requestId: string, reviewedBy?: string, reason?: string) {
    const req = await this.prisma.licensePauseRequest.findUnique({ where: { id: requestId } });
    if (!req) throw new NotFoundException('Pause request not found');
    if (req.status !== 'PENDING') throw new ConflictException(`Request already ${req.status.toLowerCase()}`);
    return this.prisma.licensePauseRequest.update({
      where: { id: requestId },
      data: { status: 'REJECTED', reviewedBy, reviewedAt: new Date(), reason: reason ?? req.reason },
    });
  }

  /** List requests, optionally filtered by status and/or tenant. */
  async list(filter: { status?: string; tenantId?: string } = {}) {
    return this.prisma.licensePauseRequest.findMany({
      where: {
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.tenantId ? { tenantId: filter.tenantId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: { tenant: { select: { name: true } } },
    });
  }
}
