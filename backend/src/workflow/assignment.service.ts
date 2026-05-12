import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

type AssignmentStrategy = 'fifo' | 'workload' | 'region' | 'provider' | 'random';

@Injectable()
export class AssignmentService {
  constructor(private prisma: PrismaService) {}

  /**
   * Assign claims using specified strategy
   */
  async assignClaims(
    claimIds: string[],
    reviewerIds: string[],
    strategy: AssignmentStrategy = 'fifo',
  ) {
    switch (strategy) {
      case 'fifo':
        return this.assignFIFO(claimIds, reviewerIds);
      case 'workload':
        return this.assignByWorkload(claimIds, reviewerIds);
      case 'region':
        return this.assignByRegion(claimIds, reviewerIds);
      case 'provider':
        return this.assignByProvider(claimIds, reviewerIds);
      case 'random':
        return this.assignRandom(claimIds, reviewerIds);
      default:
        return this.assignFIFO(claimIds, reviewerIds);
    }
  }

  /**
   * FIFO Assignment: Distribute claims evenly in order
   */
  private async assignFIFO(claimIds: string[], reviewerIds: string[]) {
    const assignments = [];

    for (let i = 0; i < claimIds.length; i++) {
      const reviewerId = reviewerIds[i % reviewerIds.length];
      const claim = await this.prisma.claim.update({
        where: { id: claimIds[i] },
        data: {
          assignedTo: reviewerId,
          assignmentStrategy: 'fifo',
        },
      });
      assignments.push({ claimId: claim.id, reviewerId });
    }

    return assignments;
  }

  /**
   * Workload-Based Assignment: Assign to reviewer with least workload
   */
  private async assignByWorkload(claimIds: string[], reviewerIds: string[]) {
    const assignments = [];

    for (const claimId of claimIds) {
      // Count current workload for each reviewer
      const workloadCounts = await Promise.all(
        reviewerIds.map(async (reviewerId) => {
          const count = await this.prisma.claim.count({
            where: {
              assignedTo: reviewerId,
              status: {
                in: ['under_review', 'submitted'],
              },
            },
          });
          return { reviewerId, count };
        }),
      );

      // Find reviewer with minimum workload
      const minWorkload = workloadCounts.reduce((min, current) =>
        current.count < min.count ? current : min,
      );

      const claim = await this.prisma.claim.update({
        where: { id: claimId },
        data: {
          assignedTo: minWorkload.reviewerId,
          assignmentStrategy: 'workload',
        },
      });

      assignments.push({ claimId: claim.id, reviewerId: minWorkload.reviewerId });
    }

    return assignments;
  }

  /**
   * Region-Based Assignment: Assign based on provider region
   */
  private async assignByRegion(claimIds: string[], reviewerIds: string[]) {
    const assignments = [];

    for (const claimId of claimIds) {
      const claim = await this.prisma.claim.findUnique({
        where: { id: claimId },
        include: { provider: true },
      });

      // Simple region-based assignment (can be enhanced with region mapping)
      const regionHash = (claim.provider.region || 'default').charCodeAt(0);
      const reviewerId = reviewerIds[regionHash % reviewerIds.length];

      const updatedClaim = await this.prisma.claim.update({
        where: { id: claimId },
        data: {
          assignedTo: reviewerId,
          assignmentStrategy: 'region',
        },
      });

      assignments.push({ claimId: updatedClaim.id, reviewerId });
    }

    return assignments;
  }

  /**
   * Provider-Based Assignment: Assign same provider to same reviewer
   */
  private async assignByProvider(claimIds: string[], reviewerIds: string[]) {
    const assignments = [];
    const providerReviewerMap = new Map<string, string>();

    for (const claimId of claimIds) {
      const claim = await this.prisma.claim.findUnique({
        where: { id: claimId },
        include: { provider: true },
      });

      let reviewerId = providerReviewerMap.get(claim.providerId);

      if (!reviewerId) {
        // Assign new provider to reviewer with least providers
        const providerCounts = await Promise.all(
          reviewerIds.map(async (rid) => {
            const distinctProviders = await this.prisma.claim.findMany({
              where: { assignedTo: rid },
              select: { providerId: true },
              distinct: ['providerId'],
            });
            return { reviewerId: rid, count: distinctProviders.length };
          }),
        );

        const minCount = providerCounts.reduce((min, current) =>
          current.count < min.count ? current : min,
        );

        reviewerId = minCount.reviewerId;
        providerReviewerMap.set(claim.providerId, reviewerId);
      }

      const updatedClaim = await this.prisma.claim.update({
        where: { id: claimId },
        data: {
          assignedTo: reviewerId,
          assignmentStrategy: 'provider',
        },
      });

      assignments.push({ claimId: updatedClaim.id, reviewerId });
    }

    return assignments;
  }

  /**
   * Random Assignment
   */
  private async assignRandom(claimIds: string[], reviewerIds: string[]) {
    const assignments = [];

    for (const claimId of claimIds) {
      const randomIndex = Math.floor(Math.random() * reviewerIds.length);
      const reviewerId = reviewerIds[randomIndex];

      const claim = await this.prisma.claim.update({
        where: { id: claimId },
        data: {
          assignedTo: reviewerId,
          assignmentStrategy: 'random',
        },
      });

      assignments.push({ claimId: claim.id, reviewerId });
    }

    return assignments;
  }

  /**
   * Get reviewer workload statistics
   */
  async getReviewerWorkload(reviewerId?: string) {
    const assignedWhere: any = {
      assignedTo: { not: null },
      workflowStage: { in: ['maker_review', 'checker_review', 'final_approval'] },
    };
    if (reviewerId) assignedWhere.assignedTo = reviewerId;

    const completedWhere: any = {
      assignedTo: { not: null },
      workflowStage: 'completed',
    };
    if (reviewerId) completedWhere.assignedTo = reviewerId;

    const [assigned, completed] = await Promise.all([
      this.prisma.claim.groupBy({ by: ['assignedTo'], where: assignedWhere, _count: { id: true } }),
      this.prisma.claim.groupBy({ by: ['assignedTo'], where: completedWhere, _count: { id: true } }),
    ]);

    const allUserIds = [
      ...new Set([
        ...assigned.map((r) => r.assignedTo!),
        ...completed.map((r) => r.assignedTo!),
      ]),
    ];

    const users = await this.prisma.user.findMany({
      where: { id: { in: allUserIds } },
      select: { id: true, name: true },
    });
    const nameMap = new Map(users.map((u) => [u.id, u.name]));
    const completedMap = new Map(completed.map((r) => [r.assignedTo, r._count.id]));

    return assigned.map((r) => ({
      name:      nameMap.get(r.assignedTo!) || r.assignedTo,
      assigned:  r._count.id,
      completed: completedMap.get(r.assignedTo!) ?? 0,
    }));
  }
}
