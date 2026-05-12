import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PolicyService {
  constructor(private prisma: PrismaService) {}

  // ── Policy Plans ──
  async createPlan(dto: any) {
    return this.prisma.policyPlan.create({ data: dto });
  }

  async getPlans(filters: { isActive?: boolean } = {}) {
    return this.prisma.policyPlan.findMany({
      where: { ...(filters.isActive !== undefined && { isActive: filters.isActive }) },
      orderBy: { planName: 'asc' },
      include: { _count: { select: { memberPolicies: true } } },
    });
  }

  async updatePlan(id: string, dto: any) {
    const plan = await this.prisma.policyPlan.findUnique({ where: { id } });
    if (!plan) throw new NotFoundException('Policy plan not found');
    return this.prisma.policyPlan.update({ where: { id }, data: dto });
  }

  async deactivatePlan(id: string) {
    return this.prisma.policyPlan.update({ where: { id }, data: { isActive: false } });
  }

  // ── Member Policies ──
  async createMember(dto: any) {
    return this.prisma.memberPolicy.create({
      data: {
        ...dto,
        policyStartDate: new Date(dto.policyStartDate),
        policyEndDate: new Date(dto.policyEndDate),
      },
    });
  }

  async getMembers(filters: { search?: string; planId?: string; isActive?: boolean } = {}) {
    const where: any = {};
    if (filters.search) {
      where.OR = [
        { memberNumber: { contains: filters.search, mode: 'insensitive' } },
        { memberName: { contains: filters.search, mode: 'insensitive' } },
      ];
    }
    if (filters.planId) where.planId = filters.planId;
    if (filters.isActive !== undefined) where.isActive = filters.isActive;
    return this.prisma.memberPolicy.findMany({
      where,
      include: { plan: true },
      orderBy: { memberNumber: 'asc' },
      take: 200,
    });
  }

  async getMemberByNumber(memberNumber: string) {
    return this.prisma.memberPolicy.findUnique({
      where: { memberNumber },
      include: { plan: true },
    });
  }

  async updateMember(id: string, dto: any) {
    const data: any = { ...dto };
    if (dto.policyStartDate) data.policyStartDate = new Date(dto.policyStartDate);
    if (dto.policyEndDate) data.policyEndDate = new Date(dto.policyEndDate);
    return this.prisma.memberPolicy.update({ where: { id }, data });
  }
}
