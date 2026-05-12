import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MakerCheckerService } from './maker-checker.service';
import { CompletenessValidationService } from './completeness-validation.service';
import { AssignmentService } from './assignment.service';

@Injectable()
export class WorkflowService {
  constructor(
    private prisma: PrismaService,
    private makerCheckerService: MakerCheckerService,
    private completenessService: CompletenessValidationService,
    private assignmentService: AssignmentService,
  ) {}

  /**
   * Get claims by workflow stage, scoped to the caller's role:
   *  - claims_officer at maker_review   → only claims assigned to them
   *  - checker at checker_review        → only claims assigned to them, or
   *                                       unclaimed ones awaiting pickup
   *  - supervisor / admin               → everything (optionally filter by `assignedTo`)
   *  - anyone else (incl. provider_*)   → empty list (they have no business here)
   */
  async getClaimsByStage(
    stage: string,
    assignedTo?: string,
    limit: number = 50,
    offset: number = 0,
    user?: { userId: string; role: string },
  ) {
    const where: any = { workflowStage: stage };

    if (user) {
      const { role, userId } = user;
      if (role === 'admin' || role === 'supervisor') {
        if (assignedTo) where.assignedTo = assignedTo;
      } else if (role === 'claims_officer') {
        // Makers only see claims assigned to them.
        where.assignedTo = userId;
      } else if (role === 'checker') {
        // Checkers see their assigned work plus any unclaimed checker_review
        // claims (post maker-approve, awaiting pickup).
        where.OR = [{ assignedTo: userId }, { assignedTo: null }];
      } else {
        // Provider users and everyone else have no reviewer role here.
        return { claims: [], total: 0 };
      }
    } else if (assignedTo) {
      where.assignedTo = assignedTo;
    }

    const [claims, total] = await Promise.all([
      this.prisma.claim.findMany({
        where,
        include: {
          provider: true,
          documents: true,
          _count: {
            select: { approvals: true },
          },
        },
        orderBy: { submittedAt: 'asc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.claim.count({ where }),
    ]);

    return { claims, total };
  }

  /**
   * Get workflow statistics
   */
  async getWorkflowStatistics() {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const [
      initialReview,
      makerReview,
      checkerReview,
      finalApproval,
      completedToday,
      totalValueAgg,
    ] = await Promise.all([
      this.prisma.claim.count({ where: { workflowStage: 'initial_review' } }),
      this.prisma.claim.count({ where: { workflowStage: 'maker_review' } }),
      this.prisma.claim.count({ where: { workflowStage: 'checker_review' } }),
      this.prisma.claim.count({ where: { workflowStage: 'final_approval' } }),
      this.prisma.claim.count({
        where: { workflowStage: 'completed', updatedAt: { gte: today } },
      }),
      this.prisma.claim.aggregate({
        where: { workflowStage: { in: ['initial_review', 'maker_review', 'checker_review', 'final_approval'] } },
        _sum: { invoiceAmount: true },
      }),
    ]);

    // Count claims with non-empty fraudSignals array
    const flaggedResult = await this.prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*)::int AS count FROM "claims"
      WHERE "fraudSignals" IS NOT NULL
        AND "fraudSignals"::text != '[]'
        AND "fraudSignals"::text != 'null'
    `;
    const flagged = Number(flaggedResult[0]?.count ?? 0);

    return {
      initialReview,
      makerReview,
      checkerReview,
      finalApproval,
      completed: completedToday,
      total: initialReview + makerReview + checkerReview + finalApproval,
      totalValue: Number(totalValueAgg._sum.invoiceAmount ?? 0),
      flagged,
    };
  }

  /**
   * Get claims pending assignment
   */
  async getClaimsPendingAssignment(limit: number = 50, offset: number = 0) {
    const where = {
      assignedTo: null,
      status: 'submitted',
      isComplete: true,
    };

    const [claims, total] = await Promise.all([
      this.prisma.claim.findMany({
        where,
        include: {
          provider: true,
        },
        orderBy: { submittedAt: 'asc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.claim.count({ where }),
    ]);

    return { claims, total };
  }
}
