import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CasesService {
  constructor(private prisma: PrismaService) {}

  async list(filters: { status?: string; ownerId?: string; limit?: number; offset?: number }) {
    const { status, ownerId, limit = 50, offset = 0 } = filters;
    return this.prisma.case.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(ownerId ? { ownerId } : {}),
      },
      include: { claim: { select: { claimNumber: true, status: true } }, owner: { select: { name: true } } },
      orderBy: { openedAt: 'desc' },
      take: limit,
      skip: offset,
    });
  }

  async getById(id: string) {
    const c = await this.prisma.case.findUnique({
      where: { id },
      include: {
        claim: true,
        owner: { select: { id: true, name: true } },
        comments: { orderBy: { createdAt: 'asc' }, include: { author: { select: { id: true, name: true } } } },
        links: true,
      },
    });
    if (!c) throw new NotFoundException(`Case ${id} not found`);
    return c;
  }

  // Convert a claim to a case. The SLA is configurable per case; defaults to 72 h.
  async convertFromClaim(claimId: string, ownerId?: string, slaDueAt?: Date) {
    const claim = await this.prisma.claim.findUnique({ where: { id: claimId } });
    if (!claim) throw new NotFoundException(`Claim ${claimId} not found`);

    const defaultSla = slaDueAt ?? new Date(Date.now() + 72 * 60 * 60 * 1000);
    return this.prisma.case.create({
      data: { claimId, ownerId, slaDueAt: defaultSla, status: 'open' },
    });
  }

  async updateStatus(id: string, status: string, actorId?: string) {
    const update: any = { status };
    if (['resolved', 'escalated'].includes(status)) update.closedAt = new Date();
    return this.prisma.case.update({ where: { id }, data: update });
  }

  async addComment(caseId: string, authorId: string, body: string) {
    return this.prisma.caseComment.create({ data: { caseId, authorId, body } });
  }

  async addLink(caseId: string, type: string, targetId: string) {
    return this.prisma.caseLink.create({ data: { caseId, type, targetId } });
  }

  // Unified timeline: claim status events + case comments + appeals/fraud ordered by timestamp.
  async getTimeline(caseId: string) {
    const caseRow = await this.getById(caseId);
    const claimId = caseRow.claimId;

    const [statusHistory, comments, appeals] = await Promise.all([
      this.prisma.claimStatusHistory.findMany({ where: { claimId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.caseComment.findMany({
        where: { caseId },
        orderBy: { createdAt: 'asc' },
        include: { author: { select: { id: true, name: true } } },
      }),
      this.prisma.appeal.findMany({ where: { claimId }, orderBy: { createdAt: 'asc' } }),
    ]);

    const events = [
      ...statusHistory.map((e) => ({ kind: 'status_change', at: e.createdAt, data: e })),
      ...comments.map((e) => ({ kind: 'comment', at: e.createdAt, data: e })),
      ...appeals.map((e) => ({ kind: 'appeal', at: e.createdAt, data: e })),
    ];
    events.sort((a, b) => a.at.getTime() - b.at.getTime());
    return events;
  }
}
