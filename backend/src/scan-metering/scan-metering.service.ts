import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_COST = 5.0;
const DEFAULT_CURRENCY = 'KES';

export interface RecordEventInput {
  userId: string;
  providerId: string | null;
  branchId: string | null;
  deviceClass: 'desktop' | 'mobile' | 'camera';
  os?: string | null;
  machineHostname?: string | null;
  userAgent?: string | null;
  scannerName?: string | null;
  resolution?: number | null;
  mode?: string | null;
  pages?: number | null;
  success?: boolean;
  errorMessage?: string | null;
}

@Injectable()
export class ScanMeteringService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Settings ──────────────────────────────────────────────────────────────

  /** Returns the settings row for a provider, creating defaults on first read. */
  async getOrCreateSettings(providerId: string) {
    const existing = await this.prisma.scanMeteringSettings.findUnique({
      where: { providerId },
    });
    if (existing) return existing;

    return this.prisma.scanMeteringSettings.create({
      data: {
        providerId,
        enabled: true,
        costPerScan: DEFAULT_COST,
        currency: DEFAULT_CURRENCY,
      },
    });
  }

  /** Lightweight check used by the frontend before showing the scan UI. */
  async checkForUser(reqUser: { providerId: string | null }) {
    if (!reqUser.providerId) {
      // Internal/system users without a provider: scanning is implicitly allowed,
      // no charge. Useful for super-admin testing.
      return {
        enabled: true,
        providerId: null as string | null,
        costPerScan: 0,
        currency: DEFAULT_CURRENCY,
      };
    }
    const s = await this.getOrCreateSettings(reqUser.providerId);
    return {
      enabled: s.enabled,
      providerId: s.providerId,
      costPerScan: Number(s.costPerScan),
      currency: s.currency,
    };
  }

  /** Admin/finance: list all provider settings + provider names. */
  async listAllSettings() {
    const rows = await this.prisma.scanMeteringSettings.findMany({
      include: { provider: { select: { id: true, name: true, type: true } } },
      orderBy: { updatedAt: 'desc' },
    });
    return rows.map((r) => ({
      providerId: r.providerId,
      providerName: r.provider.name,
      providerType: r.provider.type,
      enabled: r.enabled,
      costPerScan: Number(r.costPerScan),
      currency: r.currency,
      updatedAt: r.updatedAt,
    }));
  }

  async updateSettings(
    providerId: string,
    actor: { userId: string },
    patch: { enabled?: boolean; costPerScan?: number; currency?: string },
  ) {
    const provider = await this.prisma.provider.findUnique({ where: { id: providerId } });
    if (!provider) throw new NotFoundException('Provider not found');

    return this.prisma.scanMeteringSettings.upsert({
      where: { providerId },
      create: {
        providerId,
        enabled: patch.enabled ?? true,
        costPerScan: patch.costPerScan ?? DEFAULT_COST,
        currency: patch.currency ?? DEFAULT_CURRENCY,
        updatedByUserId: actor.userId,
      },
      update: {
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(patch.costPerScan !== undefined ? { costPerScan: patch.costPerScan } : {}),
        ...(patch.currency !== undefined ? { currency: patch.currency } : {}),
        updatedByUserId: actor.userId,
      },
    });
  }

  // ── Events ────────────────────────────────────────────────────────────────

  /** Records a scan event. Stamps the cost from the *current* org settings,
   *  so future price changes don't retroactively alter historical charges. */
  async recordEvent(input: RecordEventInput) {
    let costAtScan = 0;
    let currency = DEFAULT_CURRENCY;

    if (input.providerId) {
      const s = await this.getOrCreateSettings(input.providerId);
      if (!s.enabled && (input.success ?? true)) {
        // Defensive: a disabled provider should never have produced a success=true scan
        // — the controller's pre-check blocks that. But if a stale browser still posts
        // one, refuse to charge (and refuse to record as billable).
        throw new ForbiddenException('Scanning is disabled for your organization');
      }
      costAtScan = (input.success ?? true) ? Number(s.costPerScan) : 0;
      currency = s.currency;
    }

    return this.prisma.scanEvent.create({
      data: {
        userId: input.userId,
        providerId: input.providerId,
        branchId: input.branchId,
        deviceClass: input.deviceClass,
        os: input.os ?? null,
        machineHostname: input.machineHostname ?? null,
        userAgent: input.userAgent ?? null,
        scannerName: input.scannerName ?? null,
        resolution: input.resolution ?? null,
        mode: input.mode ?? null,
        pages: input.pages ?? null,
        costAtScan,
        currency,
        success: input.success ?? true,
        errorMessage: input.errorMessage ?? null,
      },
    });
  }

  // ── Dashboard aggregates ──────────────────────────────────────────────────

  /** Aggregates for the dashboard. If providerScope is set, restricts to one org. */
  async dashboard(providerScope: string | null) {
    const now = new Date();
    const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
    const startOfWeek = new Date(now); startOfWeek.setDate(now.getDate() - 7);
    const startOfMonth = new Date(now); startOfMonth.setDate(now.getDate() - 30);

    const where = (since: Date) => ({
      createdAt: { gte: since },
      ...(providerScope ? { providerId: providerScope } : {}),
      success: true,
    });

    const [today, week, month, recent] = await Promise.all([
      this.prisma.scanEvent.aggregate({
        _count: { _all: true },
        _sum: { costAtScan: true },
        where: where(startOfDay),
      }),
      this.prisma.scanEvent.aggregate({
        _count: { _all: true },
        _sum: { costAtScan: true },
        where: where(startOfWeek),
      }),
      this.prisma.scanEvent.aggregate({
        _count: { _all: true },
        _sum: { costAtScan: true },
        where: where(startOfMonth),
      }),
      this.prisma.scanEvent.findMany({
        where: providerScope ? { providerId: providerScope } : {},
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          createdAt: true,
          deviceClass: true,
          os: true,
          machineHostname: true,
          scannerName: true,
          pages: true,
          costAtScan: true,
          currency: true,
          success: true,
          user:     { select: { id: true, name: true, email: true } },
          provider: { select: { id: true, name: true } },
          branch:   { select: { id: true, name: true } },
        },
      }),
    ]);

    // Per-org breakdown (only for the admin/finance view).
    let perProvider: Array<{
      providerId: string;
      providerName: string;
      scansThisMonth: number;
      chargesThisMonth: number;
      currency: string;
    }> = [];
    if (!providerScope) {
      const grouped = await this.prisma.scanEvent.groupBy({
        by: ['providerId', 'currency'],
        where: { createdAt: { gte: startOfMonth }, success: true, providerId: { not: null } },
        _count: { _all: true },
        _sum: { costAtScan: true },
      });
      const ids = grouped.map((g) => g.providerId!).filter(Boolean);
      const providers = ids.length
        ? await this.prisma.provider.findMany({
            where: { id: { in: ids } },
            select: { id: true, name: true },
          })
        : [];
      const nameById = new Map(providers.map((p) => [p.id, p.name]));
      perProvider = grouped.map((g) => ({
        providerId: g.providerId!,
        providerName: nameById.get(g.providerId!) ?? 'Unknown',
        scansThisMonth: g._count._all,
        chargesThisMonth: Number(g._sum.costAtScan ?? 0),
        currency: g.currency,
      }));
      perProvider.sort((a, b) => b.chargesThisMonth - a.chargesThisMonth);
    }

    const norm = (a: { _count: { _all: number }; _sum: { costAtScan: any } }) => ({
      scans: a._count._all,
      charges: Number(a._sum.costAtScan ?? 0),
    });

    return {
      today: norm(today),
      week: norm(week),
      month: norm(month),
      perProvider,
      recentEvents: recent.map((e) => ({
        id: e.id,
        createdAt: e.createdAt,
        deviceClass: e.deviceClass,
        os: e.os,
        machineHostname: e.machineHostname,
        scannerName: e.scannerName,
        pages: e.pages,
        costAtScan: Number(e.costAtScan),
        currency: e.currency,
        success: e.success,
        user: e.user,
        provider: e.provider,
        branch: e.branch,
      })),
    };
  }
}
