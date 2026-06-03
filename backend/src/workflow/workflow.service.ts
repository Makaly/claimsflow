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
   *  - admin                   → everything (optionally filter by `assignedTo`)
   *  - claims_officer          → own claims in claims_officer_review; see-all on other stages
   *  - maker_checker           → only claims assigned to them (auto-assigned on upload)
   *  - fraud_officer           → fraud_review stage only, unfiltered
   *  - anyone else             → empty list
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
      if (role === 'admin') {
        if (assignedTo) where.assignedTo = assignedTo;
      } else if (role === 'claims_officer') {
        // Per-assignee on their own stage: a claims officer sees only the claims
        // assigned to them in claims_officer_review (auto-assigned on maker-checker
        // approval; the reroute sweep covers any left unassigned). On other stages
        // they may legitimately view (e.g. the Maker Queue), they keep see-all
        // behaviour. An explicit ?assignedTo= overrides the self-scope.
        if (stage === 'claims_officer_review') {
          where.assignedTo = assignedTo ?? userId;
        } else if (assignedTo) {
          where.assignedTo = assignedTo;
        }
      } else if (role === 'maker_checker') {
        // Per-assignee queue: a maker_checker sees only the claims assigned to
        // them. Claims are auto-assigned on upload (autoAssignToMaker) and any
        // that slip through unassigned are swept into an assignee by
        // reroute-orphans, so this stays populated without showing a shared pool.
        // An explicit ?assignedTo= (e.g. a supervisor inspecting one checker's
        // load) overrides the self-scope.
        where.assignedTo = assignedTo ?? userId;
      } else if (role === 'fraud_officer') {
        // Fraud officers only work the fraud_review stage.
        if (stage !== 'fraud_review') return { claims: [], total: 0 };
      } else {
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
          assignedUser: { select: { id: true, name: true, email: true } },
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
      makerCheckerReview,
      claimsOfficerReview,
      fraudReview,
      completedToday,
      totalValueAgg,
    ] = await Promise.all([
      this.prisma.claim.count({ where: { workflowStage: 'initial_review' } }),
      this.prisma.claim.count({ where: { workflowStage: 'maker_checker_review' } }),
      this.prisma.claim.count({ where: { workflowStage: 'claims_officer_review' } }),
      this.prisma.claim.count({ where: { workflowStage: 'fraud_review' } }),
      this.prisma.claim.count({
        where: { workflowStage: 'completed', updatedAt: { gte: today } },
      }),
      this.prisma.claim.aggregate({
        where: {
          workflowStage: {
            in: ['initial_review', 'maker_checker_review', 'claims_officer_review', 'fraud_review'],
          },
        },
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
      makerCheckerReview,
      claimsOfficerReview,
      fraudReview,
      completed: completedToday,
      total: initialReview + makerCheckerReview + claimsOfficerReview + fraudReview,
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
