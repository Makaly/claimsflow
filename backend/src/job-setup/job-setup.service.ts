import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LookupService } from '../lookup/lookup.service';
import { JobSetupKnowledgeService } from './job-setup-knowledge.service';

const FIELD_TYPES = ['text', 'number', 'date', 'select', 'currency', 'boolean', 'textarea'];
const FIELD_SOURCES = ['manual', 'extraction', 'lookup'];

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export interface ResolveOutcome {
  values: Record<string, any>;
  filled: Record<string, { value: any; via: string; source?: string }>;
  warnings: string[];
}

@Injectable()
export class JobSetupService {
  constructor(
    private prisma: PrismaService,
    private lookup: LookupService,
    private knowledge: JobSetupKnowledgeService,
  ) {}

  // ── Setup CRUD ───────────────────────────────────────────────────────────────

  list(activeOnly = false) {
    return this.prisma.jobSetup.findMany({
      where: activeOnly ? { isActive: true } : undefined,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { fields: { orderBy: { sortOrder: 'asc' } }, _count: { select: { knowledge: true } } },
    });
  }

  async get(id: string) {
    const setup = await this.prisma.jobSetup.findUnique({
      where: { id },
      include: { fields: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!setup) throw new NotFoundException('Job setup not found');
    return setup;
  }

  async getBySlug(slug: string) {
    const setup = await this.prisma.jobSetup.findUnique({
      where: { slug },
      include: { fields: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!setup) throw new NotFoundException('Job setup not found');
    return setup;
  }

  private async uniqueSlug(base: string): Promise<string> {
    let slug = base || 'setup';
    let n = 1;
    // eslint-disable-next-line no-await-in-loop
    while (await this.prisma.jobSetup.findUnique({ where: { slug } })) {
      slug = `${base}-${++n}`;
    }
    return slug;
  }

  async create(body: any, userId?: string) {
    if (!body?.name) throw new BadRequestException('name is required');
    const slug = await this.uniqueSlug(slugify(body.slug || body.name));
    const fields = Array.isArray(body.fields) ? body.fields : [];
    return this.prisma.jobSetup.create({
      data: {
        name: body.name,
        slug,
        description: body.description ?? null,
        documentType: body.documentType ?? null,
        templateId: body.templateId ?? null,
        icon: body.icon ?? null,
        color: body.color ?? null,
        isActive: body.isActive ?? true,
        learningEnabled: body.learningEnabled ?? true,
        autoPopulateFromHistory: body.autoPopulateFromHistory ?? true,
        sortOrder: body.sortOrder ?? 0,
        createdBy: userId ?? null,
        fields: {
          create: fields.map((f: any, i: number) => this.fieldData(f, i)),
        },
      },
      include: { fields: { orderBy: { sortOrder: 'asc' } } },
    });
  }

  async update(id: string, body: any) {
    await this.get(id);
    const data: any = {};
    for (const k of [
      'name',
      'description',
      'documentType',
      'templateId',
      'icon',
      'color',
      'isActive',
      'learningEnabled',
      'autoPopulateFromHistory',
      'sortOrder',
    ]) {
      if (body[k] !== undefined) data[k] = body[k];
    }
    // If a full fields array is supplied, replace the field set transactionally.
    if (Array.isArray(body.fields)) {
      await this.prisma.$transaction([
        this.prisma.jobSetupField.deleteMany({ where: { jobSetupId: id } }),
        this.prisma.jobSetup.update({
          where: { id },
          data: {
            ...data,
            fields: { create: body.fields.map((f: any, i: number) => this.fieldData(f, i)) },
          },
        }),
      ]);
      return this.get(id);
    }
    await this.prisma.jobSetup.update({ where: { id }, data });
    return this.get(id);
  }

  async remove(id: string) {
    await this.get(id);
    return this.prisma.jobSetup.delete({ where: { id } });
  }

  async clone(id: string, userId?: string) {
    const src = await this.get(id);
    const slug = await this.uniqueSlug(`${src.slug}-copy`);
    return this.prisma.jobSetup.create({
      data: {
        name: `${src.name} (copy)`,
        slug,
        description: src.description,
        documentType: src.documentType,
        templateId: src.templateId,
        icon: src.icon,
        color: src.color,
        isActive: false,
        learningEnabled: src.learningEnabled,
        autoPopulateFromHistory: src.autoPopulateFromHistory,
        sortOrder: src.sortOrder,
        createdBy: userId ?? null,
        fields: { create: src.fields.map((f, i) => this.fieldData(f, i)) },
      },
      include: { fields: { orderBy: { sortOrder: 'asc' } } },
    });
  }

  // ── Field CRUD ─────────────────────────────────────────────────────────────

  private fieldData(f: any, index: number) {
    if (!f?.key) throw new BadRequestException('each field requires a key');
    if (!f?.label) throw new BadRequestException(`field "${f.key}" requires a label`);
    const type = FIELD_TYPES.includes(f.type) ? f.type : 'text';
    const source = FIELD_SOURCES.includes(f.source) ? f.source : 'manual';
    return {
      key: String(f.key).trim(),
      label: String(f.label).trim(),
      type,
      required: !!f.required,
      sortOrder: f.sortOrder ?? index,
      placeholder: f.placeholder ?? null,
      defaultValue: f.defaultValue ?? null,
      options: f.options ?? [],
      validationRegex: f.validationRegex ?? null,
      source,
      extractionKey: f.extractionKey ?? null,
      lookupSourceId: f.lookupSourceId ?? null,
      lookupKeyField: f.lookupKeyField ?? null,
      lookupReturn: f.lookupReturn ?? null,
      autoPopulate: !!f.autoPopulate,
      isKey: !!f.isKey,
    };
  }

  async addField(jobSetupId: string, body: any) {
    await this.get(jobSetupId);
    const count = await this.prisma.jobSetupField.count({ where: { jobSetupId } });
    return this.prisma.jobSetupField.create({
      data: { jobSetupId, ...this.fieldData(body, count) },
    });
  }

  async updateField(fieldId: string, body: any) {
    const existing = await this.prisma.jobSetupField.findUnique({ where: { id: fieldId } });
    if (!existing) throw new NotFoundException('Field not found');
    const data = this.fieldData({ ...existing, ...body }, existing.sortOrder);
    return this.prisma.jobSetupField.update({ where: { id: fieldId }, data });
  }

  async deleteField(fieldId: string) {
    const existing = await this.prisma.jobSetupField.findUnique({ where: { id: fieldId } });
    if (!existing) throw new NotFoundException('Field not found');
    return this.prisma.jobSetupField.delete({ where: { id: fieldId } });
  }

  // ── Auto-populate resolution engine ───────────────────────────────────────────

  /**
   * Given the current index values for a setup, fill in everything we can:
   *  1. reference-data lookups (member/policy, drugs, eligibility, Excel/CSV, …)
   *     for fields whose lookupKeyField has a value and that are empty;
   *  2. this setup's own learned history (isolated), for still-empty fields.
   * Returns the merged values plus a `filled` provenance map for the UI.
   */
  async resolve(
    jobSetupId: string,
    values: Record<string, any>,
    opts: { onlyField?: string; useHistory?: boolean } = {},
  ): Promise<ResolveOutcome> {
    const setup = await this.get(jobSetupId);
    const out: Record<string, any> = { ...values };
    const filled: ResolveOutcome['filled'] = {};
    const warnings: string[] = [];
    const isEmpty = (v: any) => v === null || v === undefined || String(v).trim() === '';

    // Cache one query per (sourceId, keyValue) so multiple return fields that
    // share a key (e.g. memberName + planName from one member lookup) cost one call.
    const cache = new Map<string, Promise<Record<string, any> | null>>();
    const runQuery = (sourceId: string, key: string) => {
      const ck = `${sourceId}::${key}`;
      if (!cache.has(ck)) cache.set(ck, this.lookup.query(sourceId, key).catch(() => null));
      return cache.get(ck)!;
    };

    const lookupFields = setup.fields.filter(
      (f) =>
        f.source === 'lookup' &&
        f.autoPopulate &&
        f.lookupSourceId &&
        f.lookupKeyField &&
        f.lookupReturn &&
        (!opts.onlyField || f.lookupKeyField === opts.onlyField || f.key === opts.onlyField),
    );

    for (const f of lookupFields) {
      const keyVal = out[f.lookupKeyField!];
      if (isEmpty(keyVal)) continue;
      // Don't clobber a value the user already typed.
      if (!isEmpty(out[f.key])) continue;
      // eslint-disable-next-line no-await-in-loop
      const row = await runQuery(f.lookupSourceId!, String(keyVal));
      if (!row) {
        warnings.push(`No match for ${f.lookupKeyField} = "${keyVal}"`);
        continue;
      }
      const val = row[f.lookupReturn!];
      if (!isEmpty(val)) {
        out[f.key] = val;
        filled[f.key] = { value: val, via: 'lookup', source: f.lookupSourceId! };
      }
    }

    // Fall back to this setup's own learned history for still-empty fields.
    const useHistory = opts.useHistory ?? setup.autoPopulateFromHistory;
    if (useHistory && setup.learningEnabled) {
      for (const f of setup.fields) {
        if (!isEmpty(out[f.key])) continue;
        if (opts.onlyField && f.key !== opts.onlyField) continue;
        // eslint-disable-next-line no-await-in-loop
        const top = await this.knowledge.topValue(jobSetupId, f.key);
        if (top !== null) {
          out[f.key] = top;
          filled[f.key] = { value: top, via: 'history' };
        }
      }
    }

    return { values: out, filled, warnings };
  }

  /** Record confirmed values into this setup's isolated knowledge base. */
  recordKnowledge(jobSetupId: string, values: Record<string, any>) {
    return this.knowledge.record(jobSetupId, values);
  }

  suggest(jobSetupId: string, fieldKey: string, prefix?: string) {
    return this.knowledge.suggest(jobSetupId, fieldKey, prefix);
  }

  knowledgeStats(jobSetupId: string) {
    return this.knowledge.stats(jobSetupId);
  }

  resetKnowledge(jobSetupId: string) {
    return this.knowledge.reset(jobSetupId);
  }
}
