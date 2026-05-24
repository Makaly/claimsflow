import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { parseMt940, ParsedLine } from './parsers/mt940.parser';
import { parseCamt053 } from './parsers/camt053.parser';
import { parseCsvStatement } from './parsers/csv-statement.parser';
import { v4 as uuid } from 'uuid';

const AMOUNT_TOLERANCE = 0.01; // 1% relative tolerance
const DATE_TOLERANCE_DAYS = 3;

@Injectable()
export class BankReconService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Ingest ────────────────────────────────────────────────────────────

  async ingest(content: string, format: 'mt940' | 'camt053' | 'csv'): Promise<{ uploadId: string; lineCount: number }> {
    let lines: ParsedLine[];
    switch (format) {
      case 'mt940':   lines = parseMt940(content); break;
      case 'camt053': lines = parseCamt053(content); break;
      case 'csv':     lines = parseCsvStatement(content); break;
      default: throw new BadRequestException(`Unknown format: ${format}`);
    }

    const uploadId = uuid();
    await this.prisma.bankStatementLine.createMany({
      data: lines.map(l => ({
        uploadId,
        format,
        reference: l.reference,
        amount: l.amount,
        currency: l.currency,
        valueDate: l.valueDate,
        description: l.description,
        status: 'unreconciled',
      })),
    });

    // Auto-match after ingestion
    await this.autoMatch(uploadId);
    return { uploadId, lineCount: lines.length };
  }

  // ── Auto-match ────────────────────────────────────────────────────────

  private async autoMatch(uploadId: string) {
    const unmatched = await this.prisma.bankStatementLine.findMany({
      where: { uploadId, status: 'unreconciled' },
    });

    for (const line of unmatched) {
      const match = await this.findClaimMatch(line);
      if (match) {
        await this.prisma.bankStatementLine.update({
          where: { id: line.id },
          data: { status: 'matched', matchedClaimId: match.id, matchedAt: new Date() },
        });
      }
    }
  }

  private async findClaimMatch(line: { reference?: string | null; amount: number; valueDate: Date }) {
    const from = new Date(line.valueDate.getTime() - DATE_TOLERANCE_DAYS * 86400000);
    const to = new Date(line.valueDate.getTime() + DATE_TOLERANCE_DAYS * 86400000);
    const lo = line.amount * (1 - AMOUNT_TOLERANCE);
    const hi = line.amount * (1 + AMOUNT_TOLERANCE);

    const candidates = await this.prisma.claim.findMany({
      where: {
        status: 'paid',
        invoiceAmount: { gte: lo, lte: hi },
        paidAt: { gte: from, lte: to },
      },
      take: 5,
    });

    // Prefer reference match
    if (line.reference) {
      const refMatch = candidates.find(c =>
        c.claimNumber.includes(line.reference!) || c.invoiceNumber?.includes(line.reference!),
      );
      if (refMatch) return refMatch;
    }

    // Fall back to amount+date closest match
    return candidates[0] ?? null;
  }

  // ── Queue & actions ───────────────────────────────────────────────────

  getUnreconciled(take = 50) {
    return this.prisma.bankStatementLine.findMany({
      where: { status: 'unreconciled' },
      orderBy: { valueDate: 'desc' },
      take,
    });
  }

  async manualMatch(lineId: string, claimId: string, matchedBy: string) {
    const line = await this.prisma.bankStatementLine.findUnique({ where: { id: lineId } });
    if (!line) throw new NotFoundException('Bank statement line not found');
    return this.prisma.bankStatementLine.update({
      where: { id: lineId },
      data: { status: 'matched', matchedClaimId: claimId, matchedAt: new Date(), matchedBy },
    });
  }

  async writeOff(lineId: string, reason: string, matchedBy: string) {
    const line = await this.prisma.bankStatementLine.findUnique({ where: { id: lineId } });
    if (!line) throw new NotFoundException('Bank statement line not found');
    return this.prisma.bankStatementLine.update({
      where: { id: lineId },
      data: { status: 'written_off', writeOffReason: reason, matchedAt: new Date(), matchedBy },
    });
  }

  getSummary() {
    return this.prisma.bankStatementLine.groupBy({
      by: ['status'],
      _count: { id: true },
      _sum: { amount: true },
    });
  }
}
