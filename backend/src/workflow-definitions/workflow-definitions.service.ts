import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface WorkflowStep {
  id: string;
  kind: string;
  sla_hours: number;
  branch_rule?: string;
}

@Injectable()
export class WorkflowDefinitionsService {
  constructor(private prisma: PrismaService) {}

  async list() {
    return this.prisma.workflowDefinition.findMany({ orderBy: [{ name: 'asc' }, { version: 'desc' }] });
  }

  async getById(id: string) {
    const def = await this.prisma.workflowDefinition.findUnique({ where: { id } });
    if (!def) throw new NotFoundException(`WorkflowDefinition ${id} not found`);
    return def;
  }

  // Workflow runner: return the published definition for a name, or null (fallback
  // to the hardcoded workflow in WorkflowService when no active row exists).
  async getActiveForName(name: string) {
    return this.prisma.workflowDefinition.findFirst({
      where: { name, status: 'published' },
    });
  }

  async create(data: { name: string; dslJsonb: { steps: WorkflowStep[] }; createdBy?: string }) {
    return this.prisma.workflowDefinition.create({
      data: { name: data.name, dslJsonb: data.dslJsonb as any, status: 'draft', createdBy: data.createdBy },
    });
  }

  async update(id: string, data: { name?: string; dslJsonb?: { steps: WorkflowStep[] } }) {
    return this.prisma.workflowDefinition.update({ where: { id }, data: data as any });
  }

  // Publish: archive any existing published version for the same name, then
  // bump version and set status to published.
  async publish(id: string) {
    const def = await this.getById(id);

    const existing = await this.prisma.workflowDefinition.findFirst({
      where: { name: def.name, status: 'published' },
    });
    if (existing && existing.id !== id) {
      await this.prisma.workflowDefinition.update({
        where: { id: existing.id },
        data: { status: 'archived' },
      });
    }

    return this.prisma.workflowDefinition.update({
      where: { id },
      data: { status: 'published', version: (existing?.version ?? def.version) + 1 },
    });
  }

  // Rollback: find the most recent archived version for the same name and
  // republish it, archiving the current published one.
  async rollback(name: string) {
    const current = await this.prisma.workflowDefinition.findFirst({
      where: { name, status: 'published' },
    });
    const previous = await this.prisma.workflowDefinition.findFirst({
      where: { name, status: 'archived' },
      orderBy: { version: 'desc' },
    });

    if (!previous) throw new ConflictException('No archived version to roll back to');

    if (current) {
      await this.prisma.workflowDefinition.update({
        where: { id: current.id },
        data: { status: 'archived' },
      });
    }
    return this.prisma.workflowDefinition.update({
      where: { id: previous.id },
      data: { status: 'published' },
    });
  }
}
