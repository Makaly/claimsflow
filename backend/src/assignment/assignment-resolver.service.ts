import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type ReviewerRole = 'maker_checker' | 'claims_officer';
export type AssignmentStrategy = 'workload' | 'fifo';

/**
 * Single source of truth for "who should this claim go to?".
 *
 * Resolution order (the most dynamic mechanism, admin-configurable):
 *   1. Provider PIN — if the provider has a dedicated reviewer for this role
 *      and that user is available (correct role, active, not on leave), use it.
 *   2. RELIEVER — if the pinned reviewer is on leave/inactive, use their
 *      configured reliever when that reliever is available.
 *   3. GLOBAL STRATEGY — otherwise pick from all available reviewers of the
 *      role using the admin-selected default strategy:
 *        - 'workload' (default): the least-loaded reviewer (fewest open claims)
 *        - 'fifo': round-robin — the reviewer assigned a claim least recently
 *   4. null — no available reviewer exists (caller leaves the claim unassigned
 *      for the periodic reroute sweep to pick up once someone is available).
 *
 * Lives in its own module that only depends on the global PrismaService, so it
 * can be shared by ClaimsService (maker stage), MakerCheckerService (claims-
 * officer stage + reroute sweep) without introducing a module cycle.
 */
@Injectable()
export class AssignmentResolverService {
  // Statuses that represent "open work still awaiting this reviewer's action".
  private static readonly OPEN_STATUSES = ['submitted', 'under_review', 'resubmitted'];

  constructor(private prisma: PrismaService) {}

  async resolveAssignee(
    role: ReviewerRole,
    providerId: string | null | undefined,
  ): Promise<{ userId: string | null }> {
    // 1 + 2 — provider pin, then its reliever.
    const pinnedId = providerId ? await this.pinnedFor(role, providerId) : null;
    if (pinnedId) {
      const direct = await this.userIfAvailable(pinnedId, role);
      if (direct) return { userId: direct };

      const reliever = await this.relieverIfAvailable(pinnedId, role);
      if (reliever) return { userId: reliever };
    }

    // 3 + 4 — global strategy over the available pool, else null.
    return { userId: await this.pickByStrategy(role) };
  }

  /** Ids of every available reviewer of a role (active, not on leave). */
  async availableReviewerIds(role: ReviewerRole): Promise<string[]> {
    const users = await this.prisma.user.findMany({
      where: { role, isActive: true, isOnLeave: false },
      select: { id: true },
    });
    return users.map((u) => u.id);
  }

  /** The default reviewer-picking strategy, read from SystemConfig. */
  async getDefaultStrategy(): Promise<AssignmentStrategy> {
    const cfg = await this.prisma.systemConfig.findUnique({
      where: { key: 'assignment_default_strategy' },
    });
    return cfg?.value === 'fifo' ? 'fifo' : 'workload';
  }

  // ───────────────────────────── internals ─────────────────────────────

  private async pinnedFor(role: ReviewerRole, providerId: string): Promise<string | null> {
    const rule = await this.prisma.providerAssignmentRule.findUnique({
      where: { providerId },
      select: { makerCheckerId: true, claimsOfficerId: true },
    });
    if (!rule) return null;
    return role === 'maker_checker' ? rule.makerCheckerId : rule.claimsOfficerId;
  }

  /** Returns the userId if that user is a valid, available reviewer of role. */
  private async userIfAvailable(userId: string, role: ReviewerRole): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, isActive: true, isOnLeave: true },
    });
    if (user && user.role === role && user.isActive && !user.isOnLeave) return user.id;
    return null;
  }

  /** The pinned user's reliever, if that reliever is itself available. */
  private async relieverIfAvailable(pinnedId: string, role: ReviewerRole): Promise<string | null> {
    const pinned = await this.prisma.user.findUnique({
      where: { id: pinnedId },
      select: { relieverId: true },
    });
    if (!pinned?.relieverId) return null;
    return this.userIfAvailable(pinned.relieverId, role);
  }

  private async pickByStrategy(role: ReviewerRole): Promise<string | null> {
    const strategy = await this.getDefaultStrategy();
    return strategy === 'fifo' ? this.pickLeastRecentlyAssigned(role) : this.pickLeastLoaded(role);
  }

  /** Least open work — mirrors the original autoAssignToMaker behaviour. */
  private async pickLeastLoaded(role: ReviewerRole): Promise<string | null> {
    const reviewers = await this.prisma.user.findMany({
      where: { role, isActive: true, isOnLeave: false },
      select: {
        id: true,
        _count: {
          select: {
            claimsAssigned: {
              where: { status: { in: AssignmentResolverService.OPEN_STATUSES } },
            },
          },
        },
      },
    });
    if (reviewers.length === 0) return null;
    reviewers.sort((a, b) => a._count.claimsAssigned - b._count.claimsAssigned);
    return reviewers[0].id;
  }

  /** Round-robin: the reviewer who received a claim least recently (or never). */
  private async pickLeastRecentlyAssigned(role: ReviewerRole): Promise<string | null> {
    const ids = await this.availableReviewerIds(role);
    if (ids.length === 0) return null;

    const recent = await this.prisma.claim.groupBy({
      by: ['assignedTo'],
      where: { assignedTo: { in: ids } },
      _max: { createdAt: true },
    });
    const lastAssigned = new Map<string, Date>();
    for (const row of recent) {
      if (row.assignedTo && row._max.createdAt) lastAssigned.set(row.assignedTo, row._max.createdAt);
    }

    // A reviewer never assigned a claim sorts first (oldest possible).
    let chosen = ids[0];
    let chosenTime = lastAssigned.get(chosen)?.getTime() ?? -Infinity;
    for (const id of ids) {
      const t = lastAssigned.get(id)?.getTime() ?? -Infinity;
      if (t < chosenTime) {
        chosen = id;
        chosenTime = t;
      }
    }
    return chosen;
  }
}
