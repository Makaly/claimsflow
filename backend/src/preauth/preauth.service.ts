import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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
}
