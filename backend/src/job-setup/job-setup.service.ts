import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LookupService } from '../lookup/lookup.service';
import { JobSetupKnowledgeService } from './job-setup-knowledge.service';

const FIELD_TYPES = ['text', 'number', 'date', 'select', 'currency', 'boolean', 'textarea'];
const FIELD_SOURCES = ['manual', 'extraction', 'lookup', 'system', 'barcode', 'ocrZone'];
const SYSTEM_VALUES = [
  'date', 'time', 'datetime', 'batchName', 'batchCounter', 'docCounter', 'pageCount', 'sequence', 'operator',
];

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

/** Runtime context a system-value field can draw from. */
export interface SystemContext {
  batchName?: string;
  operator?: string;
  pageCount?: number;
  barcode?: string;
}

export interface FieldError {
  field: string;
  label: string;
  message: string;
}

@Injectable()
export class JobSetupService {
  constructor(
    private prisma: PrismaService,
    private lookup: LookupService,
    private knowledge: JobSetupKnowledgeService,
  ) {}

  // ── Setup CRUD ───────────────────────────────────────────────────────────────

  private isPrivilegedRole(role?: string) {
    return role === 'admin' || role === 'claims_officer';
  }

  list(activeOnly = false, userId?: string, userRole?: string) {
    const baseWhere: any = activeOnly ? { isActive: true } : {};
    // Admins/claims_officers always see everything. Other users only see setups
    // assigned to them; if a setup has no assignments at all it remains visible
    // to everyone (backwards-compat before assignments are configured).
    const where =
      !userId || this.isPrivilegedRole(userRole)
        ? baseWhere
        : {
            ...baseWhere,
            OR: [
              { assignments: { some: { userId } } },
              { assignments: { none: {} } },
            ],
          };
    return this.prisma.jobSetup.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        fields: { orderBy: { sortOrder: 'asc' } },
        _count: { select: { knowledge: true, assignments: true } },
      },
    });
  }

  // ── User assignments ─────────────────────────────────────────────────────────

  async getAssignments(id: string) {
    await this.get(id);
    return this.prisma.jobSetupAssignment.findMany({
      where: { jobSetupId: id },
      include: { user: { select: { id: true, name: true, email: true, role: true } } },
      orderBy: { assignedAt: 'asc' },
    });
  }

  async setAssignments(id: string, userIds: string[]) {
    await this.get(id);
    const unique = [...new Set(userIds)];
    await this.prisma.$transaction(async (tx) => {
      await tx.jobSetupAssignment.deleteMany({ where: { jobSetupId: id } });
      if (unique.length > 0) {
        await tx.jobSetupAssignment.createMany({
          data: unique.map((userId) => ({ jobSetupId: id, userId })),
        });
      }
    });
    return this.getAssignments(id);
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
        naming: body.naming ?? undefined,
        captureSettings: body.captureSettings ?? undefined,
        separationRules: body.separationRules ?? undefined,
        outputTargets: body.outputTargets ?? undefined,
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
      'naming',
      'captureSettings',
      'separationRules',
      'outputTargets',
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
        naming: (src as any).naming ?? undefined,
        captureSettings: (src as any).captureSettings ?? undefined,
        separationRules: (src as any).separationRules ?? undefined,
        outputTargets: (src as any).outputTargets ?? undefined,
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
    const systemValue =
      source === 'system' && SYSTEM_VALUES.includes(f.systemValue) ? f.systemValue : null;
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
      validation: f.validation ?? null,
      inputMask: f.inputMask ?? null,
      source,
      extractionKey: f.extractionKey ?? null,
      systemValue,
      zone: f.zone ?? null,
      lookupSourceId: f.lookupSourceId ?? null,
      lookupKeyField: f.lookupKeyField ?? null,
      lookupReturn: f.lookupReturn ?? null,
      autoPopulate: !!f.autoPopulate,
      isKey: !!f.isKey,
      verifyDoubleKey: !!f.verifyDoubleKey,
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
    opts: { onlyField?: string; useHistory?: boolean; context?: SystemContext } = {},
  ): Promise<ResolveOutcome> {
    const setup = await this.get(jobSetupId);
    const out: Record<string, any> = { ...values };
    const filled: ResolveOutcome['filled'] = {};
    const warnings: string[] = [];
    const isEmpty = (v: any) => v === null || v === undefined || String(v).trim() === '';

    // ── System values (date/time/counters/operator…) for still-empty fields ──
    // Counter previews (batchCounter/docCounter/sequence) are peeked here, not
    // incremented — the committed value is stamped at publish via assignCounters().
    for (const f of setup.fields) {
      if (f.source !== 'system' || !f.systemValue) continue;
      if (opts.onlyField && f.key !== opts.onlyField) continue;
      if (!isEmpty(out[f.key])) continue;
      // eslint-disable-next-line no-await-in-loop
      const val = await this.systemValueFor(jobSetupId, f.systemValue, opts.context, true);
      if (!isEmpty(val)) {
        out[f.key] = val;
        filled[f.key] = { value: val, via: 'system' };
      }
    }

    // ── Default values for still-empty manual fields ──────────────────────────
    for (const f of setup.fields) {
      if (opts.onlyField && f.key !== opts.onlyField) continue;
      if (!isEmpty(out[f.key]) || isEmpty(f.defaultValue)) continue;
      out[f.key] = f.defaultValue;
    }

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

  // ── System values & counters ──────────────────────────────────────────────

  /**
   * Resolve a single system value. When `peek` is true, counter values are read
   * without incrementing (for live preview); the committed value is stamped at
   * publish via assignCounters().
   */
  async systemValueFor(
    jobSetupId: string,
    name: string,
    ctx: SystemContext = {},
    peek = false,
  ): Promise<string | null> {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    switch (name) {
      case 'date':
        return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      case 'time':
        return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
      case 'datetime':
        return now.toISOString();
      case 'batchName':
        return ctx.batchName ?? null;
      case 'operator':
        return ctx.operator ?? null;
      case 'pageCount':
        return ctx.pageCount != null ? String(ctx.pageCount) : null;
      case 'batchCounter':
      case 'docCounter':
      case 'sequence': {
        const n = peek
          ? await this.peekCounter(jobSetupId, name)
          : await this.nextCounter(jobSetupId, name);
        return String(n);
      }
      default:
        return null;
    }
  }

  /** Read the next value a counter would produce, without consuming it. */
  async peekCounter(jobSetupId: string, name: string): Promise<number> {
    const row = await this.prisma.jobSetupCounter.findUnique({
      where: { jobSetupId_name: { jobSetupId, name } },
    });
    return (row?.value ?? 0) + 1;
  }

  /** Atomically increment and return the next value for a named counter. */
  async nextCounter(jobSetupId: string, name: string): Promise<number> {
    const row = await this.prisma.jobSetupCounter.upsert({
      where: { jobSetupId_name: { jobSetupId, name } },
      create: { jobSetupId, name, value: 1 },
      update: { value: { increment: 1 } },
    });
    return row.value;
  }

  /**
   * Stamp committed counter/system values onto a value set at publish time.
   * Increments each counter exactly once per call. Returns the merged values.
   */
  async assignCounters(
    jobSetupId: string,
    values: Record<string, any>,
    ctx: SystemContext = {},
  ): Promise<Record<string, any>> {
    const setup = await this.get(jobSetupId);
    const out = { ...values };
    for (const f of setup.fields) {
      if (f.source !== 'system' || !f.systemValue) continue;
      const v = await this.systemValueFor(jobSetupId, f.systemValue, ctx, false);
      if (v !== null) out[f.key] = v;
    }
    return out;
  }

  // ── Validation ────────────────────────────────────────────────────────────

  /**
   * Enforce a setup's field rules against a value set: required, type coercion,
   * regex (validationRegex or validation.regex), min/max length, numeric/date
   * range, and input mask. Returns a flat list of field-level errors (empty when
   * valid). Mirrors the client util in the index form so the same rules apply
   * before submit and on publish.
   */
  validateValues(setup: { fields: any[] }, values: Record<string, any>): FieldError[] {
    const errors: FieldError[] = [];
    const isEmpty = (v: any) => v === null || v === undefined || String(v).trim() === '';

    for (const f of setup.fields) {
      const raw = values?.[f.key];
      const label = f.label || f.key;
      if (isEmpty(raw)) {
        if (f.required) errors.push({ field: f.key, label, message: `${label} is required` });
        continue;
      }
      const val = String(raw);
      const rules = (f.validation ?? {}) as any;

      if (f.type === 'number' || f.type === 'currency') {
        const num = Number(val.replace(/[^0-9.\-]/g, ''));
        if (Number.isNaN(num)) {
          errors.push({ field: f.key, label, message: `${label} must be a number` });
          continue;
        }
        if (rules.min != null && num < Number(rules.min))
          errors.push({ field: f.key, label, message: `${label} must be ≥ ${rules.min}` });
        if (rules.max != null && num > Number(rules.max))
          errors.push({ field: f.key, label, message: `${label} must be ≤ ${rules.max}` });
      }

      if (f.type === 'date' && Number.isNaN(Date.parse(val))) {
        errors.push({ field: f.key, label, message: `${label} is not a valid date` });
        continue;
      }

      if (rules.minLength != null && val.length < Number(rules.minLength))
        errors.push({ field: f.key, label, message: `${label} must be at least ${rules.minLength} characters` });
      if (rules.maxLength != null && val.length > Number(rules.maxLength))
        errors.push({ field: f.key, label, message: `${label} must be at most ${rules.maxLength} characters` });

      const pattern: string | null = rules.regex ?? f.validationRegex ?? null;
      if (pattern) {
        let re: RegExp | null = null;
        try {
          re = new RegExp(pattern);
        } catch {
          re = null; // a bad regex shouldn't block submission
        }
        if (re && !re.test(val))
          errors.push({ field: f.key, label, message: rules.message || `${label} is invalid` });
      }

      if (f.inputMask && !this.matchesMask(val, f.inputMask))
        errors.push({ field: f.key, label, message: `${label} must match ${f.inputMask}` });
    }
    return errors;
  }

  /** Validate a value against a Kodak-style mask: # = digit, A = letter, * = any. */
  private matchesMask(val: string, mask: string): boolean {
    if (val.length !== mask.length) return false;
    for (let i = 0; i < mask.length; i++) {
      const m = mask[i];
      const c = val[i];
      if (m === '#' && !/[0-9]/.test(c)) return false;
      if (m === 'A' && !/[A-Za-z]/.test(c)) return false;
      if (m === '*') continue;
      if (m !== '#' && m !== 'A' && m !== '*' && c !== m) return false; // literal
    }
    return true;
  }

  /** Validate a value set against a setup by id (throws nothing — returns errors). */
  async validate(jobSetupId: string, values: Record<string, any>): Promise<FieldError[]> {
    const setup = await this.get(jobSetupId);
    return this.validateValues(setup, values);
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
