import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ClaimTypeConfigService {
  private cache = new Map<string, { windowDays: number; at: number }>();
  private readonly TTL_MS = 5 * 60 * 1000;

  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.claimTypeConfig.findMany({ orderBy: { claimType: 'asc' } });
  }

  async getDuplicateWindowDays(claimType?: string | null): Promise<number> {
    const key = (claimType || 'default').toLowerCase();
    const hit = this.cache.get(key);
    const now = Date.now();
    if (hit && now - hit.at < this.TTL_MS) return hit.windowDays;

    const row = await this.prisma.claimTypeConfig.findUnique({ where: { claimType: key } });
    if (row) {
      this.cache.set(key, { windowDays: row.windowDays, at: now });
      return row.windowDays;
    }

    if (key !== 'default') return this.getDuplicateWindowDays('default');
    this.cache.set('default', { windowDays: 0, at: now });
    return 0;
  }

  async upsert(claimType: string, windowDays: number, updatedBy: string) {
    const result = await this.prisma.claimTypeConfig.upsert({
      where: { claimType },
      create: { claimType, windowDays, updatedBy },
      update: { windowDays, updatedBy },
    });
    this.cache.delete(claimType.toLowerCase());
    return result;
  }

  invalidate(claimType?: string) {
    if (claimType) this.cache.delete(claimType.toLowerCase());
    else this.cache.clear();
  }
}
