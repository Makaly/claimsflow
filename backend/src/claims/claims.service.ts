import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { CreateClaimDto } from './dto/create-claim.dto';
import { UpdateClaimDto } from './dto/update-claim.dto';
import { computeFraudSignals, providerMismatchSignal, DuplicateClaimRef } from './fraud-signals';
import { AuditService, AuditActor } from '../common/services/audit.service';
import { DocumentsService } from '../documents/documents.service';
import { EmailService } from '../notifications/email.service';
import { EligibilityService } from './eligibility.service';
import { AnomalyScoringService } from './anomaly-scoring.service';

@Injectable()
export class ClaimsService {
  constructor(
    private prisma: PrismaService,
    @InjectQueue('claims') private claimsQueue: Queue,
    private audit: AuditService,
    private documentsService: DocumentsService,
    private emailService: EmailService,
    private eligibilityService: EligibilityService,
    private anomalyScoringService: AnomalyScoringService,
  ) {}

  /**
   * Enforce provider-scoped access for per-claim operations.
   * Throws ForbiddenException if the caller is a provider_* role and the claim
   * does not belong to their provider. CIC staff roles (admin, supervisor,
   * claims_officer, checker, fraud_officer) are unaffected.
   * Returns the claim's providerId/branchId for callers that need them.
   */
  private async assertProviderCanAccessClaim(
    claimId: string,
    actor?: { role?: string | null; providerId?: string | null },
  ): Promise<{ providerId: string | null; branchId: string | null } | undefined> {
    if (!actor?.role) return undefined;
    const role = actor.role;
    if (role !== 'provider_admin' && role !== 'provider_user') return undefined;
    if (!actor.providerId) throw new ForbiddenException('Access denied');
    const claim = await this.prisma.claim.findUnique({
      where: { id: claimId },
      select: { providerId: true, branchId: true, createdBy: true },
    });
    if (!claim) throw new NotFoundException(`Claim with ID ${claimId} not found`);
    if (claim.providerId !== actor.providerId) {
      throw new ForbiddenException('Access denied');
    }
    // provider_user with a branchId may only touch claims from their branch.
    if (role === 'provider_user' && (actor as any).branchId) {
      const userBranchId = (actor as any).branchId as string;
      if (claim.branchId && claim.branchId !== userBranchId) {
        throw new ForbiddenException('Access denied');
      }
      // Fallback for historical claims that predate Claim.branchId: allow only
      // claims created by a user who currently belongs to the same branch.
      if (!claim.branchId) {
        const creator = claim.createdBy
          ? await this.prisma.user.findUnique({
              where: { id: claim.createdBy },
              select: { branchId: true },
            })
          : null;
        const creatorBranchId = creator?.branchId ?? null;
        if (creatorBranchId && creatorBranchId !== userBranchId) {
          throw new ForbiddenException('Access denied');
        }
      }
    }
    return { providerId: claim.providerId, branchId: claim.branchId };
  }

  async create(createClaimDto: CreateClaimDto, actor?: AuditActor) {
    const {
      amount, providerName, claimNumber: _dtoClaimNumber, barcode: dtoBarcode,
      invoiceDate, dateOfService, diagnosisCode, procedureCode, ocrConfidence,
      recipientEmail: _recipientEmail, // not a Claim DB field — used only for email
      uploadedBy: _uploadedBy,         // not a Claim DB field
      branchName: _branchName,         // not a Claim DB field
      batchNumber: dtoBatchNumber,     // plain string, stored directly on Claim
      ...restDto
    } = createClaimDto;

    const batchNumber = dtoBatchNumber || undefined;

    // Always generate a guaranteed-unique claim number from the backend.
    // Never trust the frontend value — it resets across sessions and causes duplicates.
    const claimNumber = await this.generateClaimNumber();

    // Barcode: use provided value if unique, otherwise generate a fresh one.
    const barcode = dtoBarcode || this.generateBarcode();

    // Resolve providerId: look up by name, or create provider if not found
    let resolvedProviderId = restDto.providerId;
    if (!resolvedProviderId) {
      const nameToFind = providerName || 'Unknown Provider';
      let provider = await this.prisma.provider.findFirst({
        where: { name: { contains: nameToFind, mode: 'insensitive' } },
      });
      if (!provider) {
        // Auto-create provider from OCR-extracted name
        provider = await this.prisma.provider.create({
          data: {
            name: nameToFind,
            type: 'hospital',
            licenseNumber: `AUTO-${Date.now()}`,
            contactPerson: 'Pending',
            email: `pending-${Date.now()}@provider.local`,
            phone: '000',
            physicalAddress: 'Pending',
            status: 'pending',
            approvalStatus: 'pending_approval',
            isActive: false,
            canSubmitClaims: false,
          },
        });
      }
      resolvedProviderId = provider.id;
    }

    // Build data object
    const uploaderIdentity = actor?.email || actor?.name || _uploadedBy || null;
    // Resolve branchId from the authenticated user's profile so the claim
    // carries the branch it was uploaded from. Falls back to null when the
    // uploader isn't bound to a branch (CIC staff, scripted imports, etc.).
    const actorBranchId = actor?.branchId ?? null;
    const data: any = {
      ...restDto,
      claimNumber,
      barcode,
      providerId: resolvedProviderId,
      ...(actorBranchId ? { branchId: actorBranchId } : {}),
      invoiceAmount: amount,
      status: 'submitted',
      workflowStage: 'initial_review',
      ocrStatus: 'completed',
      ocrConfidence: ocrConfidence,
      ...(batchNumber ? { batchNumber } : {}),
      ...(actor?.userId ? { createdBy: actor.userId } : {}),
      ...(uploaderIdentity ? { uploadedBy: uploaderIdentity } : {}),
    };

    if (invoiceDate) {
      const d = new Date(invoiceDate);
      if (!isNaN(d.getTime())) data.invoiceDate = d;
    }
    if (dateOfService) {
      const d = new Date(dateOfService);
      if (!isNaN(d.getTime())) data.dateOfService = d;
    }
    if (diagnosisCode || procedureCode) {
      data.procedureCodes = [diagnosisCode, procedureCode].filter(Boolean);
    }

    // Compute fraud signals at submission time — stored permanently on the claim
    // so reviewers always see what was detected at the moment of processing.
    const [existingInvoiceClaims, batchSiblings] = await Promise.all([
      this.prisma.claim.findMany({
        where: { providerId: resolvedProviderId, invoiceNumber: { not: null } },
        select: { invoiceNumber: true, claimNumber: true, uploadedBy: true, submittedAt: true },
      }),
      // Load existing claims in this batch to detect within-batch velocity patterns
      batchNumber
        ? this.prisma.claim.findMany({
            where: { batchNumber },
            select: { memberNumber: true, invoiceAmount: true },
          })
        : Promise.resolve([]),
    ]);
    const invoiceNumSet = new Set(existingInvoiceClaims.map(c => c.invoiceNumber!));
    const batchMemberAmounts = batchSiblings.map(c => ({
      memberNumber: c.memberNumber,
      invoiceAmount: c.invoiceAmount,
    }));
    // Build duplicate claim refs for enriched fraud signal display
    const duplicateClaimRefs: DuplicateClaimRef[] = data.invoiceNumber
      ? existingInvoiceClaims
          .filter(c => c.invoiceNumber?.trim() === data.invoiceNumber?.trim())
          .map(c => ({
            claimNumber: c.claimNumber,
            uploadedBy: c.uploadedBy,
            submittedAt: c.submittedAt?.toISOString() ?? null,
          }))
      : [];
    const fraudSignals = computeFraudSignals(
      {
        invoiceAmount: data.invoiceAmount,
        invoiceNumber: data.invoiceNumber,
        memberNumber: data.memberNumber,
        memberName: data.memberName,
        invoiceDate: data.invoiceDate,
        dateOfService: data.dateOfService,
        ocrConfidence: data.ocrConfidence,
        aiExtracted: data.aiExtracted,
      },
      invoiceNumSet,
      batchMemberAmounts,
      duplicateClaimRefs,
    );

    // Provider mismatch: provider-role users may only submit claims for their own provider.
    // Hard-block the submission so fraudulent cross-provider uploads never reach the DB.
    if (
      actor?.userId &&
      ['provider_user', 'provider_admin'].includes(actor.role ?? '')
    ) {
      const actorUser = await this.prisma.user.findUnique({
        where: { id: actor.userId },
        select: { providerId: true, provider: { select: { name: true } } },
      });
      if (actorUser?.providerId && actorUser.providerId !== resolvedProviderId) {
        const resolvedProvider = await this.prisma.provider.findUnique({
          where: { id: resolvedProviderId },
          select: { name: true },
        });
        // Reject — do not persist the claim at all
        throw new ForbiddenException(
          `Provider mismatch: your account belongs to "${actorUser.provider?.name ?? 'Unknown'}" ` +
          `but this invoice is for "${resolvedProvider?.name ?? providerName ?? 'Unknown'}". ` +
          `You may only submit claims for your own provider.`,
        );
      }
    }

    data.fraudSignals = fraudSignals;

    // Auto-route to fraud review if any critical signal was detected.
    // The claim is persisted but cannot progress through the normal workflow
    // (maker → checker → approval) until the fraud team clears it.
    // Document dumping to the uploaded_files folder is also held (see documents.service).
    const hasCriticalFraud = fraudSignals.some(s => s.level === 'critical');
    if (hasCriticalFraud) {
      data.status = 'fraud_hold';
      data.workflowStage = 'fraud_review';
    }

    // Retry up to 3 times in case of a rare concurrent-insert collision.
    let lastError: any;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (attempt > 0) {
          // Re-generate both unique keys on retry
          data.claimNumber = await this.generateClaimNumber();
          data.barcode = this.generateBarcode();
        }
        const claim = await this.prisma.claim.create({
          data,
          include: { provider: true },
        });
        await this.audit.record({
          actor,
          action: 'claim_created',
          entity: 'claim',
          entityId: claim.id,
          newValue: {
            claimNumber: claim.claimNumber,
            invoiceNumber: claim.invoiceNumber,
            invoiceAmount: claim.invoiceAmount,
            providerId: claim.providerId,
            status: claim.status,
            workflowStage: claim.workflowStage,
          },
          metadata: { source: 'claims.service.create' },
        });
        // Auto-route to the least-loaded claims officer so uploads land in the
        // Maker Queue immediately. Best-effort — if no officer is available
        // the claim stays at initial_review for manual triage.
        const routed = await this.autoAssignToMaker(claim.id, actor);
        // Queue is best-effort — Redis being down must not fail the claim save
        this.claimsQueue.add('process-claim', { claimId: claim.id }, {
          attempts: 3,
          backoff: { type: 'exponential', delay: 3_000 },
        }).catch(() => {});
        // Fire-and-forget eligibility check — must not block the response
        this.eligibilityService.checkEligibility(claim.id, restDto.memberNumber || '', invoiceDate ? new Date(invoiceDate) : null).catch(() => {});
        // Fire-and-forget anomaly scoring — statistical deviation analysis (G17)
        this.anomalyScoringService.scoreClaim(claim.id).catch(() => {});
        return routed ?? claim;
      } catch (err: any) {
        const isUniqueViolation = err?.code === 'P2002';
        if (!isUniqueViolation) throw err;
        lastError = err;
        // Small jitter before retry
        await new Promise(r => setTimeout(r, 50 + Math.random() * 100));
      }
    }
    throw lastError;
  }

  async findAll(params: {
    user?: { userId: string; role: string; providerId?: string; branchId?: string };
    status?: string;
    providerId?: string;
    batchId?: string;
    branchId?: string;
    assignedTo?: string;
    dateFrom?: string;
    dateTo?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }) {
    const where: any = {};
    let isProviderRole = false;

    // Role-based access control (enforced server-side, independent of query params)
    if (params.user) {
      const { role, userId, providerId, branchId } = params.user;
      switch (role) {
        case 'provider_user':
          isProviderRole = true;
          // A provider_user MUST be tied to a provider. If not, return nothing.
          if (!providerId) {
            where.id = '__no_access__';
            break;
          }
          where.providerId = providerId;
          if (branchId) {
            // Primary filter: the claim's own branchId (denormalised at upload).
            // Fallback: historical claims with no branchId — allow if the
            // creator is currently assigned to this branch.
            const branchUsers = await this.prisma.user.findMany({
              where: { branchId, providerId },
              select: { id: true },
            });
            where.OR = [
              { branchId },
              { branchId: null, createdBy: { in: [...branchUsers.map(u => u.id), userId] } },
            ];
          } else {
            // No branch assigned — user only sees claims they themselves created.
            where.createdBy = userId;
          }
          break;
        case 'provider_admin':
          isProviderRole = true;
          // Provider admins see every claim belonging to their provider — and
          // nothing outside it. If the account has no providerId, show nothing.
          if (!providerId) {
            where.id = '__no_access__';
            break;
          }
          where.providerId = providerId;
          break;
        case 'claims_officer':
          // Claims officers see: their assigned claims, unassigned submitted claims,
          // and all fraud-confirmed claims (so they can issue provider denials).
          where.OR = [
            { assignedTo: userId },
            { assignedTo: null, status: 'submitted' },
            { status: 'fraud_confirmed' },
          ];
          break;
        // admin, supervisor, checker, fraud_officer see everything — no filter
      }
    }

    // Apply explicit filters (further restrict the role-based filter).
    // IMPORTANT: a provider_* caller must never be able to widen scope to another
    // provider via ?providerId=, so we silently ignore the param for those roles.
    if (params.status) where.status = params.status;
    if (params.providerId && !isProviderRole) where.providerId = params.providerId;
    if (params.batchId) where.batchId = params.batchId;
    if (params.assignedTo) where.assignedTo = params.assignedTo;

    // Date range filter
    if (params.dateFrom || params.dateTo) {
      where.submittedAt = {};
      if (params.dateFrom) where.submittedAt.gte = new Date(params.dateFrom);
      if (params.dateTo) where.submittedAt.lte = new Date(params.dateTo + 'T23:59:59');
    }

    // Text search across claim number, member name, invoice number
    if (params.search) {
      const searchFilter = {
        OR: [
          { claimNumber: { contains: params.search, mode: 'insensitive' } },
          { memberName: { contains: params.search, mode: 'insensitive' } },
          { invoiceNumber: { contains: params.search, mode: 'insensitive' } },
          { barcode: { contains: params.search, mode: 'insensitive' } },
          { batchNumber: { contains: params.search, mode: 'insensitive' } },
        ],
      };
      // Merge search filter with existing where clause
      if (where.OR) {
        where.AND = [{ OR: where.OR }, searchFilter];
        delete where.OR;
      } else {
        where.AND = [searchFilter];
      }
    }

    const [claims, total] = await Promise.all([
      this.prisma.claim.findMany({
        where,
        include: {
          provider: true,
          documents: true,
          batch: { select: { batchNumber: true } },
        },
        orderBy: { createdAt: 'desc' },
        ...(params.limit !== undefined && { take: params.limit }),
        ...(params.offset !== undefined && { skip: params.offset }),
      }),
      this.prisma.claim.count({ where }),
    ]);

    return { claims, total };
  }

  async findOne(id: string, actor?: AuditActor) {
    await this.assertProviderCanAccessClaim(id, actor);
    const claim = await this.prisma.claim.findUnique({
      where: { id },
      include: {
        provider: true,
        documents: {
          select: {
            id: true, filename: true, originalName: true,
            mimetype: true, size: true, documentType: true, ocrStatus: true,
          },
        },
      },
    });

    if (!claim) {
      throw new NotFoundException(`Claim with ID ${id} not found`);
    }

    return claim;
  }

  async findByBarcode(barcode: string) {
    return this.prisma.claim.findFirst({
      where: { barcode: barcode.trim() },
      include: {
        provider: { select: { id: true, name: true, type: true } },
        documents: true,
        ocrData: true,
        assignedUser: { select: { id: true, name: true, email: true } },
      },
    });
  }

  async getOcrFields(id: string, actor?: AuditActor) {
    await this.assertProviderCanAccessClaim(id, actor);
    const [ocr, documents] = await Promise.all([
      this.prisma.ocrExtraction.findUnique({ where: { claimId: id } }),
      this.prisma.document.findMany({
        where: { claimId: id },
        select: { id: true, originalName: true, documentType: true, mimetype: true, size: true, ocrStatus: true },
      }),
    ]);

    const fieldConf = (ocr?.fieldConfidences as Record<string, number> | null) ?? {};
    const anomalyReasons: string[] = (ocr?.anomalyReasons as string[]) ?? [];

    const fields: Array<{
      page: number; label: string; value: string; confidence?: number; anomaly?: boolean;
    }> = [];

    const push = (label: string, value: string | null | undefined, key: string) => {
      if (!value) return;
      const confidence = fieldConf[key];
      const anomaly = anomalyReasons.some(
        r => r.toLowerCase().includes(key.toLowerCase()) || r.toLowerCase().includes(label.toLowerCase()),
      );
      fields.push({ page: 1, label, value: String(value), ...(confidence !== undefined ? { confidence } : {}), anomaly: anomaly || undefined });
    };

    push('Member', ocr?.memberName, 'memberName');
    push('Member No.', ocr?.memberNumber, 'memberNumber');
    push('Patient ID', ocr?.patientId, 'patientId');
    push('Provider', ocr?.providerName, 'providerName');
    push('Invoice No.', ocr?.invoiceNumber, 'invoiceNumber');
    push('Invoice Date', ocr?.invoiceDate?.toISOString().slice(0, 10), 'invoiceDate');
    push('Amount', ocr?.invoiceAmount != null ? `KES ${ocr.invoiceAmount.toLocaleString('en-KE', { minimumFractionDigits: 2 })}` : undefined, 'invoiceAmount');
    push('Service Date', ocr?.dateOfService?.toISOString().slice(0, 10), 'dateOfService');
    push('Diagnosis', ocr?.diagnosis, 'diagnosis');
    if ((ocr?.procedureCodes as string[] | null)?.length) {
      push('Procedure', (ocr!.procedureCodes as string[]).join(', '), 'procedureCodes');
    }

    const clinicalSections = this.parseClinicalSections(ocr?.rawText ?? '');

    return {
      fields,
      documents: documents.map(d => ({
        id: d.id,
        name: d.originalName,
        documentType: d.documentType ?? 'unknown',
        mimetype: d.mimetype,
        size: Number(d.size),
        ocrStatus: d.ocrStatus,
      })),
      ocrEngine: ocr?.ocrEngine ?? null,
      overallConfidence: ocr?.overallConfidence ?? null,
      anomalyScore: ocr?.anomalyScore ?? null,
      anomalyReasons,
      clinicalSections,
      status: ocr?.status ?? null,
    };
  }

  private parseClinicalSections(rawText: string): {
    chiefComplaint?: string;
    diagnosis?: string;
    treatment?: string;
    medications?: string[];
    labResults?: string;
    doctorNotes?: string;
  } {
    if (!rawText) return {};
    const s: Record<string, any> = {};

    const extract = (pattern: RegExp) => {
      const m = rawText.match(pattern);
      return m ? m[1].replace(/\s+/g, ' ').trim().slice(0, 300) : undefined;
    };

    s.chiefComplaint = extract(/(?:chief\s*complaint|reason\s*for\s*visit|presenting\s*complaint|c\/o)[:\s]+([^\n]{5,200})/i);
    s.diagnosis      = extract(/(?:^|\n)(?:diagnosis|impression|assessment|dx)[:\s]+([^\n]{5,200})/im);
    s.treatment      = extract(/(?:^|\n)(?:treatment|plan|management|procedure\s*done)[:\s]+([^\n]{5,300})/im);
    s.labResults     = extract(/(?:lab(?:oratory)?\s*(?:results?|findings?)|investigation)[:\s]+([^\n]{5,400})/i);
    s.doctorNotes    = extract(/(?:doctor'?s?\s*(?:notes?|comments?|remarks?)|clinical\s*notes?)[:\s]+([^\n]{5,400})/i);

    // Medications: lines that look like drug prescriptions
    const medLines: string[] = [];
    for (const line of rawText.split('\n')) {
      if (/\d+\s*(?:mg|mcg|ml|tab|cap|unit|iu)\b/i.test(line) && line.trim().length > 5) {
        medLines.push(line.trim());
        if (medLines.length >= 8) break;
      }
    }
    if (medLines.length) s.medications = medLines;

    return s;
  }

  async update(id: string, updateClaimDto: UpdateClaimDto, actor?: AuditActor) {
    await this.assertProviderCanAccessClaim(id, actor);
    const before = await this.prisma.claim.findUnique({ where: { id } });
    if (!before) throw new NotFoundException(`Claim with ID ${id} not found`);

    // Claims on fraud hold are frozen. Only the fraud team can move them out
    // of that state — and only through the /fraud/clear or /fraud/confirm
    // endpoints. Reject any other status/workflow change to prevent a maker
    // or checker from silently approving a flagged claim.
    const isFraudTeam = ['admin', 'fraud_officer'].includes(actor?.role ?? '');
    if (before.status === 'fraud_hold' && !isFraudTeam) {
      const touchesWorkflow =
        'status' in (updateClaimDto as any) ||
        'workflowStage' in (updateClaimDto as any) ||
        'assignedTo' in (updateClaimDto as any);
      if (touchesWorkflow) {
        throw new ForbiddenException(
          'Claim is on fraud hold. Only the fraud team can change its status.',
        );
      }
    }

    try {
      const updated = await this.prisma.claim.update({
        where: { id },
        data: updateClaimDto,
        include: { provider: true },
      });

      // Diff only the fields in the incoming DTO so we don't log relational noise.
      const beforeSubset: Record<string, any> = {};
      const afterSubset: Record<string, any> = {};
      for (const key of Object.keys(updateClaimDto || {})) {
        beforeSubset[key] = (before as any)[key] ?? null;
        afterSubset[key] = (updated as any)[key] ?? null;
      }
      await this.audit.recordChange({
        actor,
        action: 'claim_updated',
        entity: 'claim',
        entityId: id,
        before: beforeSubset,
        after: afterSubset,
        metadata: { claimNumber: updated.claimNumber },
      });

      return updated;
    } catch (error) {
      throw new NotFoundException(`Claim with ID ${id} not found`);
    }
  }

  async getAnnotations(id: string, actor?: AuditActor) {
    await this.assertProviderCanAccessClaim(id, actor);
    const claim = await this.prisma.claim.findUnique({
      where: { id },
      select: { id: true, annotations: true },
    });
    if (!claim) throw new NotFoundException(`Claim ${id} not found`);
    return { annotations: claim.annotations ?? [] };
  }

  async saveAnnotations(id: string, annotations: any[], actor?: AuditActor) {
    await this.assertProviderCanAccessClaim(id, actor);
    const before = await this.prisma.claim.findUnique({
      where: { id },
      select: { id: true, annotations: true, claimNumber: true },
    });
    if (!before) throw new NotFoundException(`Claim ${id} not found`);

    try {
      const claim = await this.prisma.claim.update({
        where: { id },
        data: { annotations: annotations as any },
        select: { id: true, annotations: true, updatedAt: true },
      });

      const prevCount = Array.isArray(before.annotations) ? before.annotations.length : 0;
      const nextCount = Array.isArray(annotations) ? annotations.length : 0;
      await this.audit.record({
        actor,
        action: 'annotations_updated',
        entity: 'claim',
        entityId: id,
        oldValue: { annotationCount: prevCount },
        newValue: { annotationCount: nextCount, annotations },
        metadata: { claimNumber: before.claimNumber },
      });

      return { annotations: claim.annotations, updatedAt: claim.updatedAt };
    } catch {
      throw new NotFoundException(`Claim ${id} not found`);
    }
  }

  async remove(id: string, actor?: AuditActor) {
    await this.assertProviderCanAccessClaim(id, actor);
    const before = await this.prisma.claim.findUnique({ where: { id } });
    if (!before) throw new NotFoundException(`Claim with ID ${id} not found`);

    // Delete child records in dependency order before removing the claim
    await this.prisma.$transaction([
      this.prisma.documentAnnotation.deleteMany({ where: { document: { claimId: id } } }),
      this.prisma.documentVersion.deleteMany({ where: { document: { claimId: id } } }),
      this.prisma.claimEmail.deleteMany({ where: { claimId: id } }),
      this.prisma.claimApproval.deleteMany({ where: { claimId: id } }),
      this.prisma.claimStatusHistory.deleteMany({ where: { claimId: id } }),
      this.prisma.ocrExtraction.deleteMany({ where: { claimId: id } }),
      this.prisma.edmsDocument.deleteMany({ where: { claimId: id } }),
      this.prisma.document.deleteMany({ where: { claimId: id } }),
      this.prisma.claim.delete({ where: { id } }),
    ]);
    await this.audit.record({
      actor,
      action: 'claim_deleted',
      entity: 'claim',
      entityId: id,
      oldValue: {
        claimNumber: before.claimNumber,
        status: before.status,
        workflowStage: before.workflowStage,
        invoiceAmount: before.invoiceAmount,
      },
      metadata: { claimNumber: before.claimNumber },
    });
    return { message: 'Claim deleted successfully' };
  }

  async getStatistics(user?: { userId: string; role: string; providerId?: string; branchId?: string }) {
    // Build base where clause for role-based filtering
    const baseWhere: any = {};
    if (user) {
      if (user.role === 'provider_user' && user.providerId) {
        baseWhere.providerId = user.providerId;
      } else if (user.role === 'provider_admin' && user.providerId) {
        baseWhere.providerId = user.providerId;
      }
      // admin/supervisor/claims_officer see all
    }

    const [total, submitted, underReview, approved, rejected, paid, incomplete] = await Promise.all([
      this.prisma.claim.count({ where: baseWhere }),
      this.prisma.claim.count({ where: { ...baseWhere, status: 'submitted' } }),
      this.prisma.claim.count({ where: { ...baseWhere, status: 'under_review' } }),
      this.prisma.claim.count({ where: { ...baseWhere, status: 'approved' } }),
      this.prisma.claim.count({ where: { ...baseWhere, status: 'rejected' } }),
      this.prisma.claim.count({ where: { ...baseWhere, status: 'paid' } }),
      this.prisma.claim.count({ where: { ...baseWhere, status: 'incomplete' } }),
    ]);

    const totalAmount = await this.prisma.claim.aggregate({
      where: baseWhere,
      _sum: { invoiceAmount: true },
    });

    const approvedAmount = await this.prisma.claim.aggregate({
      where: { ...baseWhere, status: 'approved' },
      _sum: { invoiceAmount: true },
    });

    return {
      total,
      submitted,
      underReview,
      processing: underReview,
      pending: submitted,
      approved,
      rejected,
      paid,
      incomplete,
      totalAmount: totalAmount._sum.invoiceAmount || 0,
      approvedAmount: approvedAmount._sum.invoiceAmount || 0,
    };
  }

  /**
   * Aggregate every recorded event that touched a claim: status history,
   * approval decisions, and ActivityLog entries (direct edits, views, admin
   * actions). Returned sorted oldest-first so the UI can render a timeline.
   */
  async getAuditTrail(id: string, actor?: AuditActor) {
    await this.assertProviderCanAccessClaim(id, actor);
    const claim = await this.prisma.claim.findUnique({
      where: { id },
      select: { id: true, claimNumber: true },
    });
    if (!claim) throw new NotFoundException(`Claim ${id} not found`);

    const [statusHistory, approvals, activity] = await Promise.all([
      this.prisma.claimStatusHistory.findMany({
        where: { claimId: id },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.claimApproval.findMany({
        where: { claimId: id },
        include: {
          approver: { select: { id: true, name: true, email: true, role: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.activityLog.findMany({
        where: { entity: 'claim', entityId: id },
        include: {
          user: { select: { id: true, name: true, email: true, role: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    // Resolve changedBy user names for status history in a single query.
    const actorIds = Array.from(
      new Set(statusHistory.map((h) => h.changedBy).filter((v): v is string => !!v)),
    );
    const actors = actorIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, name: true, email: true, role: true },
        })
      : [];
    const actorMap = new Map(actors.map((a) => [a.id, a]));

    const events = [
      ...statusHistory.map((h) => ({
        kind: 'status_change' as const,
        at: h.createdAt,
        actor: h.changedBy ? actorMap.get(h.changedBy) ?? null : null,
        summary: `${h.fromStatus} → ${h.toStatus}`,
        reason: h.reason,
        data: { fromStatus: h.fromStatus, toStatus: h.toStatus },
      })),
      ...approvals.map((a) => ({
        kind: 'approval' as const,
        at: a.createdAt,
        actor: a.approver,
        summary: `${a.level} ${a.decision}`,
        reason: a.comments,
        data: { level: a.level, stage: a.approvalStage, decision: a.decision },
      })),
      ...activity.map((e) => ({
        kind: 'activity' as const,
        at: e.createdAt,
        actor: e.user,
        summary: e.action,
        reason: e.errorMessage,
        data: {
          oldValue: e.oldValue,
          newValue: e.newValue,
          metadata: e.metadata,
          status: e.status,
          ipAddress: e.ipAddress,
        },
      })),
    ].sort((a, b) => a.at.getTime() - b.at.getTime());

    return { claimId: claim.id, claimNumber: claim.claimNumber, events };
  }

  /**
   * Pick the active claims_officer with the fewest open assignments and route
   * the claim to them. Moves the claim to maker_review so it shows up in the
   * Maker Queue immediately after upload. Writes a status-history row plus an
   * audit entry attributing the auto-assignment.
   *
   * Safe to call from any upload path — if no officer is available, the claim
   * is left at initial_review and null is returned.
   */
  private async autoAssignToMaker(claimId: string, actor?: AuditActor) {
    const officers = await this.prisma.user.findMany({
      where: { role: 'claims_officer', isActive: true },
      select: {
        id: true,
        name: true,
        _count: {
          select: {
            // Count only open work — claims still awaiting the officer's action.
            claimsAssigned: { where: { status: { in: ['submitted', 'under_review', 'resubmitted'] } } },
          },
        },
      },
    });
    if (officers.length === 0) return null;

    officers.sort((a, b) => a._count.claimsAssigned - b._count.claimsAssigned);
    const chosen = officers[0];

    const before = await this.prisma.claim.findUnique({ where: { id: claimId } });
    if (!before) return null;

    const updated = await this.prisma.claim.update({
      where: { id: claimId },
      data: {
        assignedTo: chosen.id,
        workflowStage: 'maker_review',
        status: 'under_review',
      },
      include: { provider: true },
    });

    await this.prisma.claimStatusHistory.create({
      data: {
        claimId,
        fromStatus: before.status,
        toStatus: 'under_review',
        changedBy: actor?.userId ?? null,
        reason: `Auto-assigned to maker ${chosen.name}`,
      },
    });

    await this.audit.record({
      actor,
      action: 'maker_auto_assigned',
      entity: 'claim',
      entityId: claimId,
      oldValue: {
        status: before.status,
        workflowStage: before.workflowStage,
        assignedTo: before.assignedTo,
      },
      newValue: {
        status: updated.status,
        workflowStage: updated.workflowStage,
        assignedTo: updated.assignedTo,
      },
      metadata: {
        claimNumber: updated.claimNumber,
        makerName: chosen.name,
        reason: 'auto-routed on upload',
      },
    });

    return updated;
  }

  // ── Fraud workflow ────────────────────────────────────────────────────────
  // A claim sitting in fraud_hold has been detected or reported as potentially
  // fraudulent. It cannot advance through the normal maker/checker/approval
  // stages and its supporting document is not copied to the structured
  // uploaded_files folder until the fraud team clears it.

  /**
   * Any maker/checker/claims officer can push a suspicious claim to the fraud
   * team even if the automatic detector didn't flag it as critical.
   */
  async escalateToFraud(id: string, reason: string, actor?: AuditActor) {
    if (!reason || !reason.trim()) {
      throw new Error('A reason is required when escalating to the fraud team');
    }

    const claim = await this.prisma.claim.findUnique({ where: { id } });
    if (!claim) throw new NotFoundException('Claim not found');
    if (claim.status === 'fraud_hold') return claim; // already on hold

    const existingSignals = (claim.fraudSignals as any[]) || [];
    const escalationSignal = {
      level: 'critical',
      title: 'Manual Escalation by Reviewer',
      detail: `Escalated to fraud team by ${actor?.email || actor?.name || 'reviewer'}: ${reason.trim()}`,
      detectedAt: new Date().toISOString(),
    };

    const updated = await this.prisma.claim.update({
      where: { id },
      data: {
        status: 'fraud_hold',
        workflowStage: 'fraud_review',
        fraudSignals: [escalationSignal, ...existingSignals],
        assignedTo: null, // unassign from normal queue
      },
    });

    await this.audit.record({
      actor,
      action: 'claim_escalated_to_fraud',
      entity: 'claim',
      entityId: id,
      newValue: { status: 'fraud_hold', reason: reason.trim() },
      metadata: { source: 'claims.service.escalateToFraud' },
    });

    return updated;
  }

  /**
   * Fraud team clears the claim — returns it to normal maker review flow.
   * Also triggers document dumping to uploaded_files now that the hold is lifted.
   */
  async clearFraud(id: string, notes: string, actor?: AuditActor) {
    const claim = await this.prisma.claim.findUnique({
      where: { id },
      include: { documents: true, provider: true },
    });
    if (!claim) throw new NotFoundException('Claim not found');
    if (claim.status !== 'fraud_hold') {
      throw new Error('Claim is not on fraud hold');
    }

    const updated = await this.prisma.claim.update({
      where: { id },
      data: {
        status: 'under_review',
        workflowStage: 'claims_officer_review',
        fraudVerdict: 'cleared',
        fraudVerdictAt: new Date(),
        fraudVerdictBy: actor?.userId || null,
        fraudVerdictNotes: notes || null,
        internalNotes: notes
          ? `[Fraud cleared by ${actor?.email || 'fraud team'}]: ${notes}\n${claim.internalNotes || ''}`
          : claim.internalNotes,
        assignedTo: null,
      },
    });

    await this.prisma.claimStatusHistory.create({
      data: {
        claimId: id,
        fromStatus: 'fraud_hold',
        toStatus: 'under_review',
        changedBy: actor?.userId || null,
        reason: `Fraud cleared — forwarded to claims officer for final decision. ${notes || ''}`.trim(),
      },
    });

    await this.audit.record({
      actor,
      action: 'claim_fraud_cleared',
      entity: 'claim',
      entityId: id,
      oldValue: { status: 'fraud_hold' },
      newValue: { status: 'under_review', workflowStage: 'claims_officer_review', fraudVerdict: 'cleared' },
      metadata: { source: 'claims.service.clearFraud' },
    });

    // Dump any held documents now that the fraud hold is lifted.
    this.documentsService
      .dumpHeldClaimDocuments(id)
      .catch((err) => {
        console.warn(`Post-clear dump failed for claim ${id}:`, err?.message);
      });

    return updated;
  }

  /**
   * Fraud team confirms the claim IS fraudulent.
   * Routes to claims_officer_review so the claims officer can relay the
   * fraud verdict to the provider and handle any resulting appeal.
   */
  async confirmFraud(id: string, notes: string, actor?: AuditActor) {
    const claim = await this.prisma.claim.findUnique({
      where: { id },
      include: { provider: true },
    });
    if (!claim) throw new NotFoundException('Claim not found');

    const updated = await this.prisma.claim.update({
      where: { id },
      data: {
        status: 'fraud_confirmed',
        workflowStage: 'claims_officer_review',
        fraudVerdict: 'confirmed',
        fraudVerdictAt: new Date(),
        fraudVerdictBy: actor?.userId || null,
        fraudVerdictNotes: notes || null,
        internalNotes: `[FRAUD CONFIRMED by ${actor?.email || 'fraud team'}]: ${notes || ''}\n${claim.internalNotes || ''}`,
        assignedTo: null,
      },
    });

    await this.prisma.claimStatusHistory.create({
      data: {
        claimId: id,
        fromStatus: claim.status,
        toStatus: 'fraud_confirmed',
        changedBy: actor?.userId || null,
        reason: `Fraud confirmed by fraud officer — awaiting claims officer to notify provider. ${notes || ''}`.trim(),
      },
    });

    await this.audit.record({
      actor,
      action: 'claim_fraud_confirmed',
      entity: 'claim',
      entityId: id,
      oldValue: { status: claim.status },
      newValue: { status: 'fraud_confirmed', workflowStage: 'claims_officer_review', fraudVerdict: 'confirmed' },
      metadata: { source: 'claims.service.confirmFraud' },
    });

    return updated;
  }

  /**
   * Queue of claims currently on fraud hold — used by the fraud team's dashboard.
   */
  async getFraudQueue(params: { limit?: number; offset?: number } = {}) {
    const { limit = 50, offset = 0 } = params;
    const [claims, total] = await Promise.all([
      this.prisma.claim.findMany({
        where: { status: 'fraud_hold' },
        include: { provider: true, documents: true },
        orderBy: { submittedAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.claim.count({ where: { status: 'fraud_hold' } }),
    ]);
    return { claims, total };
  }

  /**
   * Claims officer sends formal denial notification to provider after fraud confirmation.
   * Saves the email to the claim_emails table, logs to audit, and fires the email.
   */
  async notifyFraudDenial(
    id: string,
    message: string,
    actor?: AuditActor,
    cc?: string,
    attachments?: { filename: string; path?: string; content?: string; encoding?: string }[],
  ) {
    const claim = await this.prisma.claim.findUnique({
      where: { id },
      include: { provider: true },
    });
    if (!claim) throw new NotFoundException('Claim not found');

    const providerEmail = (claim.provider as any)?.email || '';
    const subject = `Claim Denial Notice — ${claim.claimNumber}`;
    const ccAddresses = cc ? cc.split(',').map(e => e.trim()).filter(Boolean) : [];

    const bodyLines = (message || '').split('\n');
    const htmlBody = bodyLines
      .map(l => l.trim() === '' ? '<br/>' : `<p style="margin:0 0 10px 0;line-height:1.6">${l}</p>`)
      .join('');

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#f4f4f7;font-family:Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:32px 0">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)">
  <tr><td style="background:#7b1c1c;padding:28px 32px">
    <table width="100%"><tr>
      <td><span style="color:#ffffff;font-size:20px;font-weight:bold">CIC Insurance Group PLC</span>
        <br/><span style="color:#fca5a5;font-size:12px">Medical Claims Automation — ClaimFlow</span></td>
      <td align="right"><span style="background:#991b1b;color:#fecaca;padding:4px 12px;border-radius:20px;font-size:11px;font-weight:600">CLAIM DENIED</span></td>
    </tr></table>
  </td></tr>
  <tr><td style="background:#fef2f2;border-left:4px solid #dc2626;padding:14px 32px">
    <p style="margin:0;font-size:13px;color:#991b1b;font-weight:600">⚠ Formal Fraud Claim Denial Notice</p>
    <p style="margin:4px 0 0 0;font-size:12px;color:#b91c1c">Claim Reference: <strong>${claim.claimNumber}</strong> · Member: <strong>${claim.memberName || 'N/A'}</strong></p>
  </td></tr>
  <tr><td style="padding:28px 32px;color:#1e293b;font-size:14px">${htmlBody}</td></tr>
  <tr><td style="padding:0 32px"><hr style="border:none;border-top:1px solid #e2e8f0"/></td></tr>
  <tr><td style="padding:20px 32px;font-size:11px;color:#94a3b8;line-height:1.6">
    <p style="margin:0">This is an official communication from <strong>CIC Insurance Group PLC</strong>.</p>
    <p style="margin:4px 0 0 0">P.O. Box 59485 – 00200, Nairobi · Tel: +254 703 099 000 · claims@cic.co.ke</p>
    <p style="margin:4px 0 0 0">Generated by ClaimFlow · ${new Date().toLocaleString('en-KE', { dateStyle: 'full', timeStyle: 'short' })}</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;

    // Persist email record to DB
    const emailRecord = await this.prisma.claimEmail.create({
      data: {
        claimId: id,
        sentBy: actor?.userId || null,
        sentByName: actor?.name || actor?.email || null,
        sentTo: providerEmail,
        cc: ccAddresses.join(', ') || null,
        subject,
        body: message,
        htmlBody: html,
        attachments: (attachments || []).map(a => ({ filename: a.filename })) as any,
        status: providerEmail ? 'sent' : 'no_recipient',
      },
    });

    await this.audit.record({
      actor,
      action: 'fraud_denial_notified',
      entity: 'claim',
      entityId: id,
      newValue: { status: claim.status, notifiedBy: actor?.email, message, cc, emailId: emailRecord.id },
      metadata: { source: 'claims.service.notifyFraudDenial' },
    });

    if (providerEmail) {
      const toAddresses = [providerEmail, ...ccAddresses].join(', ');
      this.emailService
        .sendEmail(toAddresses, subject, message, html, attachments)
        .catch(() => {});
    }

    return { success: true, claimId: id, sentTo: providerEmail || null, emailId: emailRecord.id };
  }

  /**
   * Returns full email history for a claim, newest first.
   */
  async getClaimEmails(id: string) {
    const claim = await this.prisma.claim.findUnique({ where: { id }, select: { id: true } });
    if (!claim) throw new NotFoundException('Claim not found');
    const emails = await this.prisma.claimEmail.findMany({
      where: { claimId: id },
      orderBy: { sentAt: 'desc' },
    });
    return { claimId: id, emails };
  }

  /**
   * Reprocess a fraud-confirmed claim back into the normal maker review flow.
   * Used after out-of-band consultation confirms the claim should be re-examined.
   */
  async reprocessClaim(id: string, reason: string, actor?: AuditActor) {
    const claim = await this.prisma.claim.findUnique({ where: { id } });
    if (!claim) throw new NotFoundException('Claim not found');
    if (claim.status !== 'fraud_confirmed') {
      throw new Error('Only fraud_confirmed claims can be reprocessed');
    }

    await this.prisma.claimStatusHistory.create({
      data: {
        claimId: id,
        fromStatus: 'fraud_confirmed',
        toStatus: 'submitted',
        changedBy: actor?.userId ?? null,
        reason: reason || 'Reprocessed after client consultation',
      },
    });

    await this.prisma.claim.update({
      where: { id },
      data: {
        status: 'submitted',
        workflowStage: 'initial_review',
        isRejected: false,
        rejectedAt: null,
        rejectedBy: null,
        rejectionReason: null,
        internalNotes: `[REPROCESSED by ${actor?.email || 'officer'} on ${new Date().toISOString()}]: ${reason || 'Client consultation'}\n${claim.internalNotes || ''}`,
      },
    });

    await this.audit.record({
      actor,
      action: 'claim_reprocessed',
      entity: 'claim',
      entityId: id,
      oldValue: { status: 'fraud_confirmed' },
      newValue: { status: 'submitted', reason },
      metadata: { source: 'claims.service.reprocessClaim' },
    });

    // Route to maker queue
    try {
      await this.autoAssignToMaker(id, actor);
    } catch { /* best effort */ }

    return { success: true, claimId: id };
  }

  /**
   * Confirmed-fraud cases — permanently rejected by the fraud team.
   */
  async getFraudConfirmed(params: { limit?: number; offset?: number } = {}) {
    const { limit = 50, offset = 0 } = params;
    const [claims, total] = await Promise.all([
      this.prisma.claim.findMany({
        where: { status: 'fraud_confirmed' },
        include: { provider: true, documents: true },
        orderBy: { rejectedAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.claim.count({ where: { status: 'fraud_confirmed' } }),
    ]);
    return { claims, total };
  }

  private async generateClaimNumber(): Promise<string> {
    const now = new Date();
    const yyyymm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    // Millisecond timestamp + random suffix — unique without a DB count query
    const unique = `${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
    return `CLM-${yyyymm}-${unique}`;
  }

  private generateBarcode(): string {
    const now = new Date();
    const datePart = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const rand = Math.random().toString(36).slice(2, 11).toUpperCase();
    return `CIC-${datePart}-${rand}`;
  }
}
