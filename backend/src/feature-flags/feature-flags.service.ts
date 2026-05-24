import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface FlagContext {
  userId?: string;
  role?: string;
  providerId?: string;
}

interface Targeting {
  percentage?: number;
  roles?: string[];
  provider_ids?: string[];
  user_ids?: string[];
}

@Injectable()
export class FeatureFlagsService {
  constructor(private prisma: PrismaService) {}

  async isEnabled(key: string, ctx: FlagContext = {}): Promise<boolean> {
    const flag = await this.prisma.featureFlag.findUnique({ where: { key } });
    if (!flag || !flag.enabled) return false;

    const targeting = flag.targetingJsonb as Targeting;

    // No targeting rules → globally on for everyone.
    if (!targeting || Object.keys(targeting).length === 0) return true;

    // user_ids whitelist — exact match takes priority.
    if (targeting.user_ids?.length && ctx.userId) {
      if (targeting.user_ids.includes(ctx.userId)) return true;
    }

    // roles — caller's role must be in the allowed set.
    if (targeting.roles?.length && ctx.role) {
      if (!targeting.roles.includes(ctx.role)) return false;
    }

    // provider_ids — provider-scoped feature.
    if (targeting.provider_ids?.length && ctx.providerId) {
      if (!targeting.provider_ids.includes(ctx.providerId)) return false;
    }

    // percentage rollout — deterministic per userId so a user always gets the
    // same experience. Falls back to random when no userId supplied.
    if (targeting.percentage !== undefined) {
      const bucket = ctx.userId
        ? this.hashBucket(key + ctx.userId)
        : Math.random() * 100;
      if (bucket >= targeting.percentage) return false;
    }

    return true;
  }

  // Canary pattern: create a flag with targeting.percentage = N to roll out
  // to N% of users. Increase N gradually, watching error rates in Grafana.
  // When confident, set enabled=true and clear targeting to ship to everyone.

  async list() {
    return this.prisma.featureFlag.findMany({ orderBy: { key: 'asc' } });
  }

  async create(data: { key: string; description?: string; enabled?: boolean; targetingJsonb?: any }) {
    return this.prisma.featureFlag.create({ data });
  }

  async update(id: string, data: { description?: string; enabled?: boolean; targetingJsonb?: any }) {
    return this.prisma.featureFlag.update({ where: { id }, data });
  }

  async delete(id: string) {
    return this.prisma.featureFlag.delete({ where: { id } });
  }

  // Deterministic bucket: 0–100 based on HMAC-SHA1 of seed string.
  private hashBucket(seed: string): number {
    const crypto = require('crypto');
    const digest = crypto.createHash('sha1').update(seed).digest('hex');
    return (parseInt(digest.slice(0, 8), 16) % 100);
  }
}
