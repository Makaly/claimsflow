import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as ExcelJS from 'exceljs';

export type ClaimLabelType = 'legitimate' | 'suspicious' | 'fraud';
export type ClaimLabelSource = 'auto_approve' | 'auto_reject' | 'manual_review' | 'fraud_confirmed' | 'appeal_outcome';

@Injectable()
export class ClaimLabelsService {
  private readonly logger = new Logger(ClaimLabelsService.name);

  constructor(private prisma: PrismaService) {}

  async upsertLabel(claimId: string, label: ClaimLabelType, source: ClaimLabelSource, labelledBy?: string, notes?: string) {
    const claim = await this.prisma.claim.findUnique({
      where: { id: claimId },
      include: { ocrData: true },
    });
    if (!claim) {
      this.logger.warn(`Cannot label non-existent claim ${claimId}`);
      return null;
    }

    const featuresSnapshot = {
      invoiceAmount: claim.invoiceAmount,
      ocrConfidence: claim.ocrConfidence,
      anomalyScore: claim.ocrData?.anomalyScore ?? null,
      fraudSignalCount: Array.isArray(claim.fraudSignals) ? (claim.fraudSignals as any[]).length : 0,
      fraudSignalCritical: Array.isArray(claim.fraudSignals)
        ? (claim.fraudSignals as any[]).filter((s: any) => s?.level === 'critical').length
        : 0,
      memberNumberPresent: !!claim.memberNumber,
      providerId: claim.providerId,
      resubmissionCount: claim.resubmissionCount,
      submittedAt: claim.submittedAt,
      fraudSignalTitles: Array.isArray(claim.fraudSignals)
        ? (claim.fraudSignals as any[]).map((s: any) => s?.title).filter(Boolean)
        : [],
    };

    const existing = await this.prisma.claimLabel.findUnique({ where: { claimId } });
    if (existing && existing.source === 'manual_review' && source !== 'manual_review' && source !== 'fraud_confirmed') {
      return existing;
    }

    return this.prisma.claimLabel.upsert({
      where: { claimId },
      create: { claimId, label, source, labelledBy, notes, featuresSnapshot },
      update: { label, source, labelledBy: labelledBy ?? existing?.labelledBy, notes: notes ?? existing?.notes, featuresSnapshot },
    });
  }

  async getLabel(claimId: string) {
    return this.prisma.claimLabel.findUnique({ where: { claimId } });
  }

  async listLabels(filters: { label?: string; source?: string; limit?: number; offset?: number } = {}) {
    const where: any = {};
    if (filters.label) where.label = filters.label;
    if (filters.source) where.source = filters.source;
    const [items, total, counts] = await Promise.all([
      this.prisma.claimLabel.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: filters.limit ?? 100,
        skip: filters.offset ?? 0,
      }),
      this.prisma.claimLabel.count({ where }),
      this.prisma.claimLabel.groupBy({ by: ['label'], _count: { label: true } }),
    ]);
    const distribution = counts.reduce((acc: any, c: any) => { acc[c.label] = c._count.label; return acc; }, {});
    return { items, total, distribution };
  }

  async exportDataset() {
    const labels = await this.prisma.claimLabel.findMany({ orderBy: { createdAt: 'asc' } });
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      totalRows: labels.length,
      schema: ['claimId', 'label', 'source', 'features'],
      data: labels.map(l => ({
        claimId: l.claimId,
        label: l.label,
        source: l.source,
        features: l.featuresSnapshot,
      })),
    };
  }

  /** Export as CSV string. */
  async exportCsv(): Promise<string> {
    const labels = await this.prisma.claimLabel.findMany({ orderBy: { createdAt: 'asc' } });
    const header = [
      'claimId', 'label', 'source', 'labelledAt',
      'invoiceAmount', 'ocrConfidence', 'anomalyScore',
      'fraudSignalCount', 'fraudSignalCritical', 'memberNumberPresent',
      'resubmissionCount', 'fraudSignalTitles',
    ].join(',');

    const rows = labels.map(l => {
      const f = (l.featuresSnapshot as any) ?? {};
      const escape = (v: any) => {
        const s = String(v ?? '');
        return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
      };
      return [
        escape(l.claimId),
        escape(l.label),
        escape(l.source),
        escape(l.createdAt.toISOString()),
        escape(f.invoiceAmount ?? ''),
        escape(f.ocrConfidence ?? ''),
        escape(f.anomalyScore ?? ''),
        escape(f.fraudSignalCount ?? 0),
        escape(f.fraudSignalCritical ?? 0),
        escape(f.memberNumberPresent ? 1 : 0),
        escape(f.resubmissionCount ?? 0),
        escape(Array.isArray(f.fraudSignalTitles) ? f.fraudSignalTitles.join('; ') : ''),
      ].join(',');
    });

    return [header, ...rows].join('\n');
  }

  /** Export as Excel workbook buffer. */
  async exportExcel(): Promise<Buffer> {
    const labels = await this.prisma.claimLabel.findMany({ orderBy: { createdAt: 'asc' } });

    const wb = new ExcelJS.Workbook();
    wb.creator = 'ClaimsFlow';
    wb.created = new Date();

    // ── Sheet 1: Raw dataset ─────────────────────────────────────────────────
    const ws = wb.addWorksheet('Claim Labels');
    ws.columns = [
      { header: 'Claim ID',               key: 'claimId',              width: 38 },
      { header: 'Label',                  key: 'label',                width: 14 },
      { header: 'Source',                 key: 'source',               width: 18 },
      { header: 'Labelled At',            key: 'labelledAt',           width: 22 },
      { header: 'Invoice Amount (KES)',   key: 'invoiceAmount',        width: 20 },
      { header: 'OCR Confidence',         key: 'ocrConfidence',        width: 16 },
      { header: 'Anomaly Score',          key: 'anomalyScore',         width: 14 },
      { header: 'Fraud Signals',          key: 'fraudSignalCount',     width: 14 },
      { header: 'Critical Signals',       key: 'fraudSignalCritical',  width: 16 },
      { header: 'Member ID Present',      key: 'memberNumberPresent',  width: 16 },
      { header: 'Resubmissions',          key: 'resubmissionCount',    width: 14 },
      { header: 'Signal Titles',          key: 'fraudSignalTitles',    width: 60 },
    ];

    // Style header row
    const headerRow = ws.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };
    headerRow.alignment = { vertical: 'middle' };

    const labelColour: Record<string, string> = {
      legitimate: 'FFD1FAE5',
      suspicious: 'FFFEF3C7',
      fraud:      'FFFEE2E2',
    };

    for (const l of labels) {
      const f = (l.featuresSnapshot as any) ?? {};
      const row = ws.addRow({
        claimId:             l.claimId,
        label:               l.label,
        source:              l.source,
        labelledAt:          l.createdAt.toISOString().replace('T', ' ').slice(0, 19),
        invoiceAmount:       f.invoiceAmount ?? null,
        ocrConfidence:       f.ocrConfidence != null ? parseFloat((f.ocrConfidence * 100).toFixed(1)) : null,
        anomalyScore:        f.anomalyScore != null ? parseFloat((f.anomalyScore * 100).toFixed(1)) : null,
        fraudSignalCount:    f.fraudSignalCount ?? 0,
        fraudSignalCritical: f.fraudSignalCritical ?? 0,
        memberNumberPresent: f.memberNumberPresent ? 'Yes' : 'No',
        resubmissionCount:   f.resubmissionCount ?? 0,
        fraudSignalTitles:   Array.isArray(f.fraudSignalTitles) ? f.fraudSignalTitles.join('; ') : '',
      });

      const colour = labelColour[l.label];
      if (colour) {
        row.getCell('label').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colour } };
      }
    }

    ws.autoFilter = { from: 'A1', to: 'L1' };

    // ── Sheet 2: Summary statistics ──────────────────────────────────────────
    const ws2 = wb.addWorksheet('Analysis Summary');

    const counts: Record<string, number> = { legitimate: 0, suspicious: 0, fraud: 0 };
    const amtSums: Record<string, number> = { legitimate: 0, suspicious: 0, fraud: 0 };
    const anomalySums: Record<string, number> = { legitimate: 0, suspicious: 0, fraud: 0 };
    const sourceCounts: Record<string, number> = {};
    const signalFreq: Record<string, number> = {};

    for (const l of labels) {
      const f = (l.featuresSnapshot as any) ?? {};
      counts[l.label] = (counts[l.label] ?? 0) + 1;
      amtSums[l.label] = (amtSums[l.label] ?? 0) + (f.invoiceAmount ?? 0);
      anomalySums[l.label] = (anomalySums[l.label] ?? 0) + (f.anomalyScore ?? 0);
      sourceCounts[l.source] = (sourceCounts[l.source] ?? 0) + 1;
      if (Array.isArray(f.fraudSignalTitles)) {
        for (const t of f.fraudSignalTitles) {
          signalFreq[t] = (signalFreq[t] ?? 0) + 1;
        }
      }
    }

    ws2.addRow(['Label Distribution']).font = { bold: true, size: 12 };
    ws2.addRow(['Label', 'Count', 'Avg Invoice (KES)', 'Avg Anomaly Score %']);
    const headerRow2 = ws2.getRow(2);
    headerRow2.font = { bold: true };
    headerRow2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E7FF' } };

    for (const [lbl, cnt] of Object.entries(counts)) {
      ws2.addRow([
        lbl,
        cnt,
        cnt > 0 ? Math.round(amtSums[lbl] / cnt) : 0,
        cnt > 0 ? parseFloat((anomalySums[lbl] / cnt * 100).toFixed(1)) : 0,
      ]);
    }

    ws2.addRow([]);
    ws2.addRow(['Label Source Breakdown']).font = { bold: true, size: 12 };
    ws2.addRow(['Source', 'Count']);
    for (const [src, cnt] of Object.entries(sourceCounts).sort((a, b) => b[1] - a[1])) {
      ws2.addRow([src, cnt]);
    }

    ws2.addRow([]);
    ws2.addRow(['Most Frequent Fraud Signals']).font = { bold: true, size: 12 };
    ws2.addRow(['Signal Title', 'Occurrences']);
    for (const [sig, cnt] of Object.entries(signalFreq).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
      ws2.addRow([sig, cnt]);
    }

    ws2.getColumn(1).width = 40;
    ws2.getColumn(2).width = 14;
    ws2.getColumn(3).width = 22;
    ws2.getColumn(4).width = 22;

    return wb.xlsx.writeBuffer() as unknown as Promise<Buffer>;
  }

  /** Deep analysis for the ML dashboard. */
  async getDeepAnalysis() {
    const labels = await this.prisma.claimLabel.findMany({
      orderBy: { createdAt: 'asc' },
    });

    const total = labels.length;
    if (total === 0) return { total: 0, message: 'No labelled claims yet.' };

    // ── Per-label stats ──────────────────────────────────────────────────────
    const labelStats: Record<string, {
      count: number; pct: number;
      avgAmount: number; avgAnomaly: number; avgOcrConf: number;
      avgFraudSignals: number; avgCriticalSignals: number;
    }> = {};

    for (const lbl of ['legitimate', 'suspicious', 'fraud']) {
      const rows = labels.filter(l => l.label === lbl);
      const feat = (r: any) => (r.featuresSnapshot as any) ?? {};
      const avg = (arr: number[]) => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
      labelStats[lbl] = {
        count: rows.length,
        pct: parseFloat((rows.length / total * 100).toFixed(1)),
        avgAmount: Math.round(avg(rows.map(r => feat(r).invoiceAmount ?? 0))),
        avgAnomaly: parseFloat((avg(rows.map(r => feat(r).anomalyScore ?? 0)) * 100).toFixed(1)),
        avgOcrConf: parseFloat((avg(rows.map(r => feat(r).ocrConfidence ?? 1)) * 100).toFixed(1)),
        avgFraudSignals: parseFloat(avg(rows.map(r => feat(r).fraudSignalCount ?? 0)).toFixed(2)),
        avgCriticalSignals: parseFloat(avg(rows.map(r => feat(r).fraudSignalCritical ?? 0)).toFixed(2)),
      };
    }

    // ── Monthly trend ────────────────────────────────────────────────────────
    const monthBuckets: Record<string, Record<string, number>> = {};
    for (const l of labels) {
      const month = l.createdAt.toISOString().slice(0, 7); // YYYY-MM
      if (!monthBuckets[month]) monthBuckets[month] = { legitimate: 0, suspicious: 0, fraud: 0 };
      monthBuckets[month][l.label] = (monthBuckets[month][l.label] ?? 0) + 1;
    }
    const trend = Object.entries(monthBuckets)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, counts]) => ({ month, ...counts }));

    // ── Fraud signal frequency ───────────────────────────────────────────────
    const signalFreq: Record<string, { total: number; onFraud: number; onLegit: number }> = {};
    for (const l of labels) {
      const titles: string[] = (l.featuresSnapshot as any)?.fraudSignalTitles ?? [];
      for (const t of titles) {
        if (!signalFreq[t]) signalFreq[t] = { total: 0, onFraud: 0, onLegit: 0 };
        signalFreq[t].total++;
        if (l.label === 'fraud' || l.label === 'suspicious') signalFreq[t].onFraud++;
        else signalFreq[t].onLegit++;
      }
    }
    const topSignals = Object.entries(signalFreq)
      .map(([title, s]) => ({
        title,
        total: s.total,
        fraudRate: parseFloat((s.total > 0 ? s.onFraud / s.total * 100 : 0).toFixed(1)),
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 12);

    // ── Source breakdown ─────────────────────────────────────────────────────
    const sourceCounts: Record<string, number> = {};
    for (const l of labels) {
      sourceCounts[l.source] = (sourceCounts[l.source] ?? 0) + 1;
    }

    // ── Invoice amount bands ─────────────────────────────────────────────────
    const bands = [
      { label: '0–50k',    min: 0,      max: 50000   },
      { label: '50k–100k', min: 50000,  max: 100000  },
      { label: '100k–200k',min: 100000, max: 200000  },
      { label: '200k–500k',min: 200000, max: 500000  },
      { label: '500k+',    min: 500000, max: Infinity },
    ];
    const amountBands = bands.map(b => {
      const inBand = labels.filter(l => {
        const amt = (l.featuresSnapshot as any)?.invoiceAmount ?? 0;
        return amt >= b.min && amt < b.max;
      });
      const fraudInBand = inBand.filter(l => l.label === 'fraud' || l.label === 'suspicious').length;
      return {
        band: b.label,
        total: inBand.length,
        fraudCount: fraudInBand,
        fraudRate: parseFloat((inBand.length > 0 ? fraudInBand / inBand.length * 100 : 0).toFixed(1)),
      };
    });

    // ── OCR confidence vs fraud rate ─────────────────────────────────────────
    const ocrBands = [
      { label: '< 50%', min: 0,   max: 0.5  },
      { label: '50–70%',min: 0.5, max: 0.7  },
      { label: '70–85%',min: 0.7, max: 0.85 },
      { label: '85–95%',min: 0.85,max: 0.95 },
      { label: '≥ 95%', min: 0.95,max: 2    },
    ];
    const ocrFraudRate = ocrBands.map(b => {
      const inBand = labels.filter(l => {
        const conf = (l.featuresSnapshot as any)?.ocrConfidence ?? 1;
        return conf >= b.min && conf < b.max;
      });
      const fraudInBand = inBand.filter(l => l.label === 'fraud' || l.label === 'suspicious').length;
      return {
        band: b.label,
        total: inBand.length,
        fraudRate: parseFloat((inBand.length > 0 ? fraudInBand / inBand.length * 100 : 0).toFixed(1)),
      };
    });

    return {
      total,
      labelStats,
      trend,
      topSignals,
      sourceCounts,
      amountBands,
      ocrFraudRate,
      generatedAt: new Date().toISOString(),
    };
  }
}
