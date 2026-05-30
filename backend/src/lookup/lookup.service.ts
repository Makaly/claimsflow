import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import axios from 'axios';
import * as fs from 'fs';
import * as ExcelJS from 'exceljs';
import csvParser = require('csv-parser');

export type LookupResult = Record<string, any> | null;

/** Built-in source types resolve live against existing tables / external APIs.
 *  File-backed (excel/csv) types resolve against ingested LookupRow rows.
 *  rest_api calls a configured endpoint. */
export const SOURCE_TYPES = [
  'member_policy',
  'provider',
  'drug_formulary',
  'diagnosis',
  'eoxegen_eligibility',
  'excel',
  'csv',
  'rest_api',
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

const FILE_BACKED: SourceType[] = ['excel', 'csv'];

function normKey(v: any): string {
  return String(v ?? '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

@Injectable()
export class LookupService {
  private readonly logger = new Logger(LookupService.name);

  constructor(private prisma: PrismaService) {}

  // ── Source CRUD ────────────────────────────────────────────────────────────

  listSources(activeOnly = false) {
    return this.prisma.lookupSource.findMany({
      where: activeOnly ? { isActive: true } : undefined,
      orderBy: { name: 'asc' },
    });
  }

  async getSource(id: string) {
    const src = await this.prisma.lookupSource.findUnique({ where: { id } });
    if (!src) throw new NotFoundException('Lookup source not found');
    return src;
  }

  async createSource(body: any, userId?: string) {
    if (!body?.name) throw new BadRequestException('name is required');
    if (!SOURCE_TYPES.includes(body.type)) {
      throw new BadRequestException(`type must be one of: ${SOURCE_TYPES.join(', ')}`);
    }
    const slug = body.slug ? slugify(body.slug) : await this.uniqueSlug(slugify(body.name));
    return this.prisma.lookupSource.create({
      data: {
        name: body.name,
        slug,
        type: body.type,
        description: body.description ?? null,
        isActive: body.isActive ?? true,
        config: body.config ?? {},
        keyColumn: body.keyColumn ?? null,
        columns: body.columns ?? [],
        createdBy: userId ?? null,
      },
    });
  }

  async updateSource(id: string, body: any) {
    await this.getSource(id);
    const data: any = {};
    for (const k of ['name', 'description', 'isActive', 'config', 'keyColumn', 'columns']) {
      if (body[k] !== undefined) data[k] = body[k];
    }
    return this.prisma.lookupSource.update({ where: { id }, data });
  }

  async deleteSource(id: string) {
    await this.getSource(id);
    return this.prisma.lookupSource.delete({ where: { id } });
  }

  private async uniqueSlug(base: string): Promise<string> {
    let slug = base || 'source';
    let n = 1;
    // eslint-disable-next-line no-await-in-loop
    while (await this.prisma.lookupSource.findUnique({ where: { slug } })) {
      slug = `${base}-${++n}`;
    }
    return slug;
  }

  // ── File ingestion (excel / csv) ────────────────────────────────────────────

  /** Parse an uploaded spreadsheet/CSV into LookupRow rows keyed by keyColumn. */
  async ingestFile(sourceId: string, file: Express.Multer.File, keyColumn?: string) {
    const src = await this.getSource(sourceId);
    if (!FILE_BACKED.includes(src.type as SourceType)) {
      throw new BadRequestException(`Source type "${src.type}" is not file-backed`);
    }

    const isCsv = src.type === 'csv' || /\.csv$/i.test(file.originalname);
    const rows = isCsv ? await this.parseCsv(file.path) : await this.parseXlsx(file.path);
    if (rows.length === 0) throw new BadRequestException('File contained no data rows');

    const columns = Object.keys(rows[0]);
    const key = keyColumn || src.keyColumn || columns[0];
    if (!columns.includes(key)) {
      throw new BadRequestException(`Key column "${key}" not found. Columns: ${columns.join(', ')}`);
    }

    // Replace previous rows for this source (full re-sync on upload).
    await this.prisma.lookupRow.deleteMany({ where: { sourceId } });
    const BATCH = 500;
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH).map((r) => ({
        sourceId,
        keyValue: normKey(r[key]),
        data: r as any,
      }));
      // eslint-disable-next-line no-await-in-loop
      await this.prisma.lookupRow.createMany({ data: chunk });
    }

    const updated = await this.prisma.lookupSource.update({
      where: { id: sourceId },
      data: {
        fileName: file.originalname,
        filePath: file.path,
        keyColumn: key,
        columns: columns.map((c) => ({ name: c, label: c })),
        rowCount: rows.length,
        lastSyncAt: new Date(),
      },
    });
    return { rowCount: rows.length, columns, keyColumn: key, source: updated };
  }

  private async parseCsv(path: string): Promise<Record<string, any>[]> {
    return new Promise((resolve, reject) => {
      const out: Record<string, any>[] = [];
      fs.createReadStream(path)
        .pipe(csvParser())
        .on('data', (row: Record<string, any>) => out.push(row))
        .on('end', () => resolve(out))
        .on('error', reject);
    });
  }

  private async parseXlsx(path: string): Promise<Record<string, any>[]> {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(path);
    const ws = wb.worksheets[0];
    if (!ws) return [];
    const headers: string[] = [];
    ws.getRow(1).eachCell((cell, col) => {
      headers[col] = String(cell.value ?? `col${col}`).trim();
    });
    const out: Record<string, any>[] = [];
    ws.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const obj: Record<string, any> = {};
      row.eachCell((cell, col) => {
        const h = headers[col];
        if (h) obj[h] = cell.value instanceof Object && 'text' in (cell.value as any)
          ? (cell.value as any).text
          : cell.value;
      });
      if (Object.values(obj).some((v) => v !== null && v !== undefined && v !== '')) out.push(obj);
    });
    return out;
  }

  // ── Resolution ───────────────────────────────────────────────────────────────

  /** Resolve a single key against a source, returning a flat column→value map. */
  async query(sourceId: string, key: string): Promise<LookupResult> {
    const src = await this.getSource(sourceId);
    if (!src.isActive) return null;
    const k = String(key ?? '').trim();
    if (!k) return null;

    switch (src.type as SourceType) {
      case 'member_policy':
        return this.queryMemberPolicy(k);
      case 'provider':
        return this.queryProvider(k);
      case 'drug_formulary':
        return this.queryDrug(k);
      case 'diagnosis':
        return this.queryDiagnosis(k);
      case 'eoxegen_eligibility':
        return this.queryEligibility(k, src.config as any);
      case 'excel':
      case 'csv':
        return this.queryFile(sourceId, k);
      case 'rest_api':
        return this.queryRestApi(k, src.config as any);
      default:
        return null;
    }
  }

  private async queryMemberPolicy(key: string): Promise<LookupResult> {
    const m = await this.prisma.memberPolicy.findUnique({
      where: { memberNumber: key },
      include: { plan: true },
    });
    if (!m) return null;
    return {
      memberNumber: m.memberNumber,
      memberName: m.memberName,
      planCode: m.plan?.planCode,
      planName: m.plan?.planName,
      policyStartDate: m.policyStartDate,
      policyEndDate: m.policyEndDate,
      isActive: m.isActive,
      inpatientLimit: m.plan?.inpatientLimit,
      outpatientLimit: m.plan?.outpatientLimit,
      dentalLimit: m.plan?.dentalLimit,
      opticalLimit: m.plan?.opticalLimit,
      maternityLimit: m.plan?.maternityLimit,
      inpatientBalance: (m.plan?.inpatientLimit ?? 0) - m.inpatientUsed,
      outpatientBalance: (m.plan?.outpatientLimit ?? 0) - m.outpatientUsed,
      copayPercent: m.plan?.copayPercent,
    };
  }

  private async queryProvider(key: string): Promise<LookupResult> {
    const norm = normKey(key);
    const byLicense = await this.prisma.provider.findFirst({ where: { licenseNumber: key } });
    const provider =
      byLicense ??
      (await this.prisma.provider.findFirst({
        where: { OR: [{ name: { equals: key, mode: 'insensitive' } }, { aliases: { some: { alias: norm } } }] },
      }));
    if (!provider) return null;
    return {
      providerId: provider.id,
      providerName: provider.name,
      type: provider.type,
      licenseNumber: provider.licenseNumber,
      city: provider.city,
      region: provider.region,
      canSubmitClaims: provider.canSubmitClaims,
      status: provider.status,
    };
  }

  private async queryDrug(key: string): Promise<LookupResult> {
    const drug =
      (await this.prisma.formularyDrug.findUnique({ where: { drugCode: key } })) ??
      (await this.prisma.formularyDrug.findFirst({
        where: {
          OR: [
            { brandName: { equals: key, mode: 'insensitive' } },
            { genericName: { equals: key, mode: 'insensitive' } },
          ],
        },
      }));
    if (!drug) return null;
    return {
      drugCode: drug.drugCode,
      brandName: drug.brandName,
      genericName: drug.genericName,
      formularyTier: drug.formularyTier,
      covered: drug.covered,
      genericAlt: drug.genericAlt,
      copayAmount: drug.copayAmount,
    };
  }

  private async queryDiagnosis(key: string): Promise<LookupResult> {
    const cond =
      (await this.prisma.chronicCondition.findUnique({ where: { code: key } })) ??
      (await this.prisma.chronicCondition.findFirst({
        where: { name: { contains: key, mode: 'insensitive' } },
      }));
    if (!cond) return null;
    return { code: cond.code, name: cond.name };
  }

  private async queryEligibility(memberNumber: string, config: any): Promise<LookupResult> {
    const baseUrl = config?.baseUrl || process.env.EOXEGEN_BASE_URL;
    const apiKey = config?.apiKey || process.env.EOXEGEN_API_KEY;
    if (!baseUrl) {
      return { eligible: null, notes: 'eligibility check pending (eOxegen not configured)' };
    }
    try {
      const res = await axios.get(`${baseUrl.replace(/\/$/, '')}/members/eligibility`, {
        params: { memberNumber },
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
        timeout: 10_000,
      });
      return {
        eligible: res.data?.eligible ?? null,
        notes: res.data?.notes ?? '',
        planName: res.data?.planName,
        memberName: res.data?.memberName,
      };
    } catch (e: any) {
      this.logger.warn(`eOxegen eligibility lookup failed: ${e?.message}`);
      return { eligible: null, notes: 'eligibility service unavailable' };
    }
  }

  private async queryFile(sourceId: string, key: string): Promise<LookupResult> {
    const row = await this.prisma.lookupRow.findFirst({
      where: { sourceId, keyValue: normKey(key) },
    });
    return (row?.data as Record<string, any>) ?? null;
  }

  private async queryRestApi(key: string, config: any): Promise<LookupResult> {
    if (!config?.url) return null;
    try {
      const keyParam = config.keyParam || 'q';
      const res = await axios.get(config.url, {
        params: { [keyParam]: key, ...(config.params || {}) },
        headers: config.headers || undefined,
        timeout: config.timeoutMs || 10_000,
      });
      let data = res.data;
      // Optional dot-path to drill into the response (e.g. "data.0").
      if (config.resultPath) {
        for (const seg of String(config.resultPath).split('.')) data = data?.[seg];
      }
      if (data && typeof data === 'object' && !Array.isArray(data)) return data;
      if (Array.isArray(data) && data[0] && typeof data[0] === 'object') return data[0];
      return null;
    } catch (e: any) {
      this.logger.warn(`REST lookup failed: ${e?.message}`);
      return null;
    }
  }

  /** Preview the first N ingested rows of a file-backed source. */
  async previewRows(sourceId: string, take = 10) {
    return this.prisma.lookupRow.findMany({ where: { sourceId }, take, orderBy: { createdAt: 'asc' } });
  }
}
