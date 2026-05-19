import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULTS: Record<string, number> = {
  pharmacy: 30,
  outpatient: 90,
  inpatient: 180,
  dental: 90,
  optical: 90,
};

@Injectable()
export class ClaimTypeConfigService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.claimTypeConfig.findMany({ orderBy: { claimType: 'asc' } });
  }

  async getWindow(claimType: string): Promise<number> {
    const row = await this.prisma.claimTypeConfig.findUnique({ where: { claimType } });
    return row?.windowDays ?? DEFAULTS[claimType] ?? 90;
  }

  async upsert(claimType: string, windowDays: number, updatedBy: string) {
    return this.prisma.claimTypeConfig.upsert({
      where: { claimType },
      create: { claimType, windowDays, updatedBy },
      update: { windowDays, updatedBy },
    });
  }
}
