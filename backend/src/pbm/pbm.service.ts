import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as fs from 'fs';
import * as path from 'path';

interface DrugRow {
  drugCode: string;
  brandName: string;
  genericName: string;
  formularyTier: number;
  covered: boolean;
  genericAlt: string;
  copayAmount: number;
}

interface InteractionRow {
  drugA: string;
  drugB: string;
  severity: string;
  description: string;
}

interface DrugEligibilityResult {
  drugCode: string;
  covered: boolean;
  formularyTier: number;
  genericAlt: string | null;
  copayAmount: number;
  ddInteractionWarnings: string[];
}

function parseCsv(filePath: string): Record<string, string>[] {
  const lines = fs.readFileSync(filePath, 'utf-8')
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('#'));
  if (lines.length === 0) return [];
  const headers = lines[0].split(',');
  return lines.slice(1).map((line) => {
    const vals = line.split(',');
    return Object.fromEntries(headers.map((h, i) => [h.trim(), (vals[i] ?? '').trim()]));
  });
}

@Injectable()
export class PbmService implements OnModuleInit {
  private readonly logger = new Logger(PbmService.name);
  private drugs: Map<string, DrugRow> = new Map();
  private interactions: InteractionRow[] = [];
  // Resolve assets from the compiled output (dist/pbm/assets) at runtime.
  // In development (ts-node) __dirname == src/pbm; in production == dist/pbm.
  private readonly assetsDir = path.join(__dirname, 'assets');

  constructor(private prisma: PrismaService) {}

  onModuleInit() {
    this.loadAssets();
  }

  private loadAssets() {
    try {
      const drugRows = parseCsv(path.join(this.assetsDir, 'drugs.csv'));
      for (const r of drugRows) {
        this.drugs.set(r.drugCode.toUpperCase(), {
          drugCode: r.drugCode,
          brandName: r.brandName,
          genericName: r.genericName,
          formularyTier: parseInt(r.formularyTier),
          covered: r.covered === 'true',
          genericAlt: r.genericAlt,
          copayAmount: parseFloat(r.copayAmount) || 0,
        });
      }
      const ixRows = parseCsv(path.join(this.assetsDir, 'interactions.csv'));
      this.interactions = ixRows.map((r) => ({
        drugA: r.drugA.toLowerCase(),
        drugB: r.drugB.toLowerCase(),
        severity: r.severity,
        description: r.description,
      }));
      this.logger.log(`PBM loaded ${this.drugs.size} drugs, ${this.interactions.length} interactions`);
    } catch (e) {
      this.logger.warn(`PBM asset load failed: ${(e as Error).message}`);
    }
  }

  checkEligibility(drugCodes: string[]): DrugEligibilityResult[] {
    const genericNames = drugCodes
      .map((c) => this.drugs.get(c.toUpperCase())?.genericName?.toLowerCase())
      .filter(Boolean) as string[];

    return drugCodes.map((code) => {
      const drug = this.drugs.get(code.toUpperCase());
      if (!drug) {
        return {
          drugCode: code,
          covered: false,
          formularyTier: 0,
          genericAlt: null,
          copayAmount: 0,
          ddInteractionWarnings: [],
        };
      }

      // Check interactions against all other drugs in the same claim
      const warnings: string[] = [];
      const thisName = drug.genericName.toLowerCase();
      for (const otherName of genericNames) {
        if (otherName === thisName) continue;
        for (const ix of this.interactions) {
          if (
            (ix.drugA === thisName && ix.drugB === otherName) ||
            (ix.drugB === thisName && ix.drugA === otherName)
          ) {
            warnings.push(`[${ix.severity}] ${ix.description}`);
          }
        }
      }

      return {
        drugCode: drug.drugCode,
        covered: drug.covered,
        formularyTier: drug.formularyTier,
        genericAlt: drug.genericAlt || null,
        copayAmount: drug.copayAmount,
        ddInteractionWarnings: warnings,
      };
    });
  }

  async getFormulary(tier?: number) {
    // Prefer DB; fall back to in-memory CSV data
    try {
      return this.prisma.formularyDrug.findMany({
        where: tier ? { formularyTier: tier } : undefined,
        orderBy: { formularyTier: 'asc' },
      });
    } catch {
      const all = [...this.drugs.values()];
      return tier ? all.filter((d) => d.formularyTier === tier) : all;
    }
  }
}
