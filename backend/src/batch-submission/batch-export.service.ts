import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Response } from 'express';
import * as fs from 'fs';
import archiver from 'archiver';
import { PrismaService } from '../prisma/prisma.service';
import { SearchablePdfService } from '../ocr/searchable-pdf.service';

type OutputFormat = 'csv' | 'xml' | 'json' | 'searchablePdf';
interface OutputTarget {
  id: string;
  type: OutputFormat;
  namePattern?: string;
  subfolderBy?: string;
  destination?: string;
  fields?: string[];
}

/**
 * Produces the export bundle for a completed batch according to its Job Setup's
 * `outputTargets` (Kodak Capture Pro-style output): per-target index files
 * (CSV/XML/JSON) plus optional searchable-PDF renders of each document, zipped
 * and streamed to the caller. File names and subfolders are driven by the
 * setup's naming patterns.
 */
@Injectable()
export class BatchExportService {
  private readonly logger = new Logger(BatchExportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly searchablePdf: SearchablePdfService,
  ) {}

  private safe(name: string): string {
    return (name || 'export').replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'export';
  }

  private today(): string {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  /** Resolve a name pattern's tokens: {batchName} {date} {docCounter} {field:KEY}. */
  private applyPattern(
    pattern: string | undefined,
    ctx: { batchName: string; counter: number; record?: Record<string, any> },
    fallback: string,
  ): string {
    if (!pattern) return fallback;
    const out = pattern.replace(/\{(\w+)(?::([\w.-]+))?\}/g, (_m, tok: string, arg: string) => {
      switch (tok) {
        case 'batchName': return ctx.batchName;
        case 'date': return this.today();
        case 'docCounter':
        case 'counter':
        case 'sequence': return String(ctx.counter);
        case 'field': return arg ? String(ctx.record?.[arg] ?? '') : '';
        default: return '';
      }
    });
    return this.safe(out) || fallback;
  }

  /** Flatten a claim into an index record: standard fields + custom index fields. */
  private indexRecord(claim: any): Record<string, any> {
    const ocr = claim.ocrData ?? {};
    const custom = (ocr.customFields as Record<string, any>) ?? {};
    const base: Record<string, any> = {
      claimNumber: claim.claimNumber ?? '',
      barcode: claim.barcode ?? '',
      memberNumber: claim.memberNumber ?? ocr.memberNumber ?? '',
      memberName: claim.memberName ?? ocr.memberName ?? '',
      patientName: claim.patientName ?? ocr.patientName ?? '',
      invoiceNumber: claim.invoiceNumber ?? ocr.invoiceNumber ?? '',
      invoiceAmount: claim.invoiceAmount ?? ocr.invoiceAmount ?? '',
      invoiceDate: claim.invoiceDate ? new Date(claim.invoiceDate).toISOString().slice(0, 10) : '',
      diagnosis: claim.diagnosis ?? ocr.diagnosis ?? '',
      providerName: claim.provider?.name ?? ocr.providerName ?? '',
    };
    return { ...base, ...custom }; // custom index fields override the standard ones
  }

  private toCsv(records: Record<string, any>[], columns: string[]): string {
    const esc = (v: any) => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = columns.map(esc).join(',');
    const rows = records.map((r) => columns.map((c) => esc(r[c])).join(','));
    return [header, ...rows].join('\n');
  }

  private toXml(records: Record<string, any>[], columns: string[]): string {
    const esc = (v: any) => String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const items = records.map((r) => {
      const cols = columns.map((c) => `    <${c}>${esc(r[c])}</${c}>`).join('\n');
      return `  <document>\n${cols}\n  </document>`;
    });
    return `<?xml version="1.0" encoding="UTF-8"?>\n<batch>\n${items.join('\n')}\n</batch>\n`;
  }

  /**
   * Build the export bundle and stream it as a zip to `res`. Accepts either a
   * BatchSubmission id (scan-station / mobile flows) or a batchNumber (the web
   * upload flow publishes claims by number without a BatchSubmission row).
   */
  async exportBatch(idOrNumber: string, res: Response): Promise<void> {
    const claimInclude = { provider: true, documents: true, ocrData: true } as const;

    let batchNumberLabel: string;
    let jobSetupId: string | null;
    let claims: any[];

    const batch =
      (await this.prisma.batchSubmission.findUnique({
        where: { id: idOrNumber },
        include: { claims: { include: claimInclude } },
      })) ??
      (await this.prisma.batchSubmission.findFirst({
        where: { batchNumber: idOrNumber },
        include: { claims: { include: claimInclude } },
      }));

    if (batch) {
      claims = batch.claims;
      batchNumberLabel = batch.batchNumber;
      jobSetupId = batch.jobSetupId ?? null;
    } else {
      // No BatchSubmission row — gather the claims by batchNumber directly.
      claims = await this.prisma.claim.findMany({ where: { batchNumber: idOrNumber }, include: claimInclude });
      if (!claims.length) throw new NotFoundException('Batch not found');
      batchNumberLabel = idOrNumber;
      jobSetupId = null;
    }

    // Fall back to the Job Setup recorded on the OCR extraction when the batch
    // row didn't carry one (web flow).
    if (!jobSetupId) jobSetupId = claims.find((c) => c.ocrData?.jobSetupId)?.ocrData?.jobSetupId ?? null;

    const setup = jobSetupId
      ? await this.prisma.jobSetup.findUnique({ where: { id: jobSetupId }, include: { fields: true } })
      : null;

    const targets: OutputTarget[] = ((setup?.outputTargets as any) as OutputTarget[]) ?? [];
    const batchName = this.safe(batchNumberLabel);
    const records = claims.map((c) => this.indexRecord(c));

    // Default column set: setup index fields (if any) + the standard base keys.
    const setupKeys = (setup?.fields ?? []).map((f: any) => f.key);
    const defaultColumns = Array.from(new Set([...setupKeys, ...(records[0] ? Object.keys(records[0]) : [])]));

    // When no targets are configured, fall back to a single CSV index.
    const effectiveTargets: OutputTarget[] = targets.length
      ? targets
      : [{ id: 'default', type: 'csv', namePattern: '{batchName}-index', fields: defaultColumns }];

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${batchName}-export.zip"`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('warning', (e) => this.logger.warn(`archiver: ${e.message}`));
    archive.on('error', (e) => { this.logger.error(`archiver failed: ${e.message}`); try { res.end(); } catch { /* */ } });
    archive.pipe(res);

    try {
      for (const t of effectiveTargets) {
        const columns = t.fields?.length ? t.fields : defaultColumns;
        const folder = t.destination ? `${this.safe(t.destination)}/` : '';

        if (t.type === 'csv' || t.type === 'xml' || t.type === 'json') {
          const fileBase = this.applyPattern(t.namePattern, { batchName, counter: 1 }, `${batchName}-index`);
          const ext = t.type;
          const body =
            t.type === 'csv' ? this.toCsv(records, columns)
            : t.type === 'xml' ? this.toXml(records, columns)
            : JSON.stringify(records.map((r) => Object.fromEntries(columns.map((c) => [c, r[c] ?? null]))), null, 2);
          archive.append(body, { name: `${folder}${fileBase}.${ext}` });
        } else if (t.type === 'searchablePdf') {
          let counter = 0;
          for (const claim of claims) {
            counter++;
            const rec = this.indexRecord(claim);
            const sub = t.subfolderBy ? `${this.safe(String(rec[t.subfolderBy] ?? 'unsorted'))}/` : '';
            for (const doc of claim.documents ?? []) {
              if (!doc.path || !fs.existsSync(doc.path)) continue;
              try {
                const pdfPath = await this.searchablePdf.generateFromFile(doc.id, doc.path, doc.mimetype);
                if (fs.existsSync(pdfPath)) {
                  const fileBase = this.applyPattern(t.namePattern, { batchName, counter, record: rec }, `${batchName}-${counter}`);
                  archive.file(pdfPath, { name: `${folder}${sub}${fileBase}.pdf` });
                }
              } catch (e: any) {
                this.logger.warn(`Searchable PDF failed for document ${doc.id}: ${e?.message ?? e}`);
              }
            }
          }
        }
      }
    } catch (e: any) {
      this.logger.error(`Export build failed for batch ${idOrNumber}: ${e?.message ?? e}`);
    }

    await archive.finalize();
  }
}
