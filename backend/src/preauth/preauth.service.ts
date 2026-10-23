import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Category strings used by the OCR page classifier to tag a page as a
 * pre-authorisation / authorization letter. The Claude vision backend emits
 * `authorization_letter`; the Gemini backend emits `pre_auth`. Either one
 * means the document packet contains a pre-auth letter, so we match both.
 */
const PRE_AUTH_PAGE_CATEGORIES = ['pre_auth', 'authorization_letter'];

interface DocumentPage {
  pageNumber: number;
  category: string;
  categoryLabel?: string;
  confidence?: number;
  summary?: string;
}

@Injectable()
export class PreAuthService {
  constructor(private prisma: PrismaService) {}

  async create(dto: {
    providerId: string; memberNumber: string; memberName?: string;
    treatmentType: string; diagnosisCode?: string; estimatedAmount: number;
    requestedBy: string; notes?: string;
  }) {
    const ref = `PA-${new Date().getFullYear()}-${Date.now().toString().slice(-7)}`;
    return this.prisma.preAuthorisation.create({
      data: { ...dto, referenceNumber: ref, status: 'pending' },
    });
  }

  async getAll(filters: { status?: string; providerId?: string; memberNumber?: string; limit?: number; offset?: number }) {
    const where: any = {};
    if (filters.status) where.status = filters.status;
    if (filters.providerId) where.providerId = filters.providerId;
    if (filters.memberNumber) where.memberNumber = { contains: filters.memberNumber, mode: 'insensitive' };
    const [items, total] = await Promise.all([
      this.prisma.preAuthorisation.findMany({ where, orderBy: { createdAt: 'desc' }, take: filters.limit ?? 50, skip: filters.offset ?? 0 }),
      this.prisma.preAuthorisation.count({ where }),
    ]);
    return { items, total };
  }

  async review(id: string, reviewerId: string, dto: {
    decision: 'approved' | 'rejected';
    approvedAmount?: number; conditions?: string;
    rejectionReason?: string; validDays?: number;
  }) {
    const pa = await this.prisma.preAuthorisation.findUnique({ where: { id } });
    if (!pa) throw new NotFoundException('Pre-authorisation not found');
    if (pa.status !== 'pending' && pa.status !== 'under_review') throw new BadRequestException('Already finalised');
    const validFrom = dto.decision === 'approved' ? new Date() : undefined;
    const validTo = dto.decision === 'approved' ? new Date(Date.now() + (dto.validDays ?? 30) * 86_400_000) : undefined;
    return this.prisma.preAuthorisation.update({
      where: { id },
      data: {
        status: dto.decision,
        reviewedBy: reviewerId,
        reviewedAt: new Date(),
        approvedAmount: dto.approvedAmount,
        conditions: dto.conditions,
        rejectionReason: dto.rejectionReason,
        validFrom,
        validTo,
      },
    });
  }

  async linkToClaim(preAuthId: string, claimId: string) {
    return this.prisma.preAuthorisation.update({ where: { id: preAuthId }, data: { linkedClaimId: claimId } });
  }

  /**
   * Surface every invoice/claim whose uploaded document packet was classified
   * as containing a pre-authorisation letter (one or more pages categorised as
   * `pre_auth` / `authorization_letter`). These letters arrive as part of the
   * claim's document bundle and are not captured by the manual pre-auth request
   * flow, so we read them straight off the OCR page classification.
   *
   * Provider users only see their own claims; staff see everything.
   */
  async getLetters(filters: {
    providerId?: string;
    memberNumber?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }) {
    const claimWhere: any = {
      // Only claims that have been through OCR can carry a classified letter.
      ocrData: { isNot: null },
    };
    if (filters.providerId) claimWhere.providerId = filters.providerId;
    if (filters.memberNumber) {
      claimWhere.memberNumber = { contains: filters.memberNumber, mode: 'insensitive' };
    }
    if (filters.search) {
      claimWhere.OR = [
        { claimNumber: { contains: filters.search, mode: 'insensitive' } },
        { invoiceNumber: { contains: filters.search, mode: 'insensitive' } },
        { memberName: { contains: filters.search, mode: 'insensitive' } },
        { memberNumber: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    // Prisma cannot filter an array-of-objects JSON column by a nested field,
    // so we fetch the candidate claims (already narrowed by provider/search)
    // and keep only those whose documentPages contain a pre-auth letter page.
    const candidates = await this.prisma.claim.findMany({
      where: claimWhere,
      orderBy: { submittedAt: 'desc' },
      include: {
        provider: { select: { name: true } },
        ocrData: { select: { documentPages: true } },
        documents: {
          orderBy: { createdAt: 'asc' },
          select: { id: true, originalName: true, mimetype: true },
        },
      },
    });

    const matched = candidates
      .map((c) => {
        const pages: DocumentPage[] = Array.isArray(c.ocrData?.documentPages)
          ? (c.ocrData!.documentPages as unknown as DocumentPage[])
          : [];
        const letterPages = pages.filter(
          (p) => p && PRE_AUTH_PAGE_CATEGORIES.includes(p.category),
        );
        if (letterPages.length === 0) return null;
        const primaryDoc = c.documents[0] ?? null;
        return {
          claimId: c.id,
          claimNumber: c.claimNumber,
          barcode: c.barcode,
          providerId: c.providerId,
          providerName: c.provider?.name ?? null,
          memberNumber: c.memberNumber,
          memberName: c.memberName,
          invoiceNumber: c.invoiceNumber,
          invoiceAmount: c.invoiceAmount,
          dateOfService: c.dateOfService,
          status: c.status,
          workflowStage: c.workflowStage,
          submittedAt: c.submittedAt,
          documentId: primaryDoc?.id ?? null,
          documentName: primaryDoc?.originalName ?? null,
          mimeType: primaryDoc?.mimetype ?? null,
          letterPages: letterPages.map((p) => ({
            pageNumber: p.pageNumber,
            categoryLabel: p.categoryLabel ?? 'Authorization Letter',
            confidence: p.confidence ?? null,
            summary: p.summary ?? null,
          })),
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    const offset = filters.offset ?? 0;
    const limit = filters.limit ?? 50;
    return {
      items: matched.slice(offset, offset + limit),
      total: matched.length,
    };
  }
}
