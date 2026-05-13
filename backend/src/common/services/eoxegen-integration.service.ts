import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import axios, { AxiosInstance } from 'axios';

/**
 * eOxegen Integration Service
 *
 * Handles integration with the eOxegen/Smart claims processing system.
 * OCR-extracted invoice data is dumped here so eOxegen can link it with
 * the E-claim from Smart. Fields match EOxegenData schema exactly.
 *
 * Configure via environment variables:
 *   EOXEGEN_BASE_URL, EOXEGEN_API_KEY
 *
 * When these are not set the service runs in graceful-degradation mode:
 * data is still written locally, but outbound sync is skipped.
 */
@Injectable()
export class EoxegenIntegrationService {
  private readonly logger = new Logger(EoxegenIntegrationService.name);
  private readonly eoxegenClient: AxiosInstance | null;
  private readonly enabled: boolean;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {
    const baseUrl = this.configService.get<string>('EOXEGEN_BASE_URL');
    const apiKey = this.configService.get<string>('EOXEGEN_API_KEY');

    this.enabled = !!baseUrl && !!apiKey;

    if (this.enabled) {
      this.eoxegenClient = axios.create({
        baseURL: baseUrl,
        timeout: 60_000,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });
      this.logger.log('eOxegen integration enabled');
    } else {
      this.eoxegenClient = null;
      this.logger.warn('eOxegen integration disabled – missing EOXEGEN_BASE_URL / EOXEGEN_API_KEY');
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Core: save OCR-extracted data locally (always) then sync out
  // ─────────────────────────────────────────────────────────────

  /**
   * Called by the OCR processor immediately after extraction.
   * Upserts the extracted invoice fields into EOxegenData so they
   * are available for linking with the Smart e-claim.
   */
  async saveOcrData(claimId: string, ocrData: {
    memberNumber?: string;
    memberName?: string;
    providerName?: string;
    invoiceNumber?: string;
    invoiceDate?: string;
    invoiceAmount?: number;
  }) {
    const invoiceDateParsed = ocrData.invoiceDate ? new Date(ocrData.invoiceDate) : null;
    const validDate = invoiceDateParsed && !isNaN(invoiceDateParsed.getTime())
      ? invoiceDateParsed
      : null;

    // Upsert – if OCR runs again we just overwrite
    await this.prisma.eOxegenData.upsert({
      where: { claimId },
      create: {
        claimId,
        memberNumber: ocrData.memberNumber || null,
        memberName: ocrData.memberName || null,
        providerName: ocrData.providerName || null,
        invoiceNumber: ocrData.invoiceNumber || null,
        invoiceDate: validDate,
        invoiceAmount: ocrData.invoiceAmount || null,
        syncStatus: 'pending',
      },
      update: {
        memberNumber: ocrData.memberNumber || undefined,
        memberName: ocrData.memberName || undefined,
        providerName: ocrData.providerName || undefined,
        invoiceNumber: ocrData.invoiceNumber || undefined,
        invoiceDate: validDate || undefined,
        invoiceAmount: ocrData.invoiceAmount || undefined,
        syncStatus: 'pending',
        syncError: null,
      },
    });

    this.logger.log(`OCR data saved to EOxegenData for claim ${claimId}`);

    // Attempt outbound sync immediately if integration is live
    if (this.enabled) {
      this.syncClaim(claimId).catch((err) =>
        this.logger.warn(`Async eOxegen sync failed for claim ${claimId}: ${err.message}`),
      );
    }
  }

  /**
   * Push a single claim's extracted data to eOxegen/Smart.
   * Used both immediately after OCR and during bulk retry.
   */
  async syncClaim(claimId: string) {
    const record = await this.prisma.eOxegenData.findUnique({ where: { claimId } });

    if (!record) {
      throw new Error(`No EOxegenData found for claim ${claimId}`);
    }

    if (!this.enabled) {
      this.logger.warn(`eOxegen sync skipped for claim ${claimId} – integration disabled`);
      return null;
    }

    try {
      const payload = {
        claimId,
        memberNumber: record.memberNumber,
        memberName: record.memberName,
        providerName: record.providerName,
        invoiceNumber: record.invoiceNumber,
        invoiceDate: record.invoiceDate,
        invoiceAmount: record.invoiceAmount,
      };

      const response = await this.eoxegenClient!.post('/ocr-data/import', payload);

      await this.prisma.eOxegenData.update({
        where: { claimId },
        data: {
          syncStatus: 'synced',
          syncedAt: new Date(),
          syncError: null,
          smartClaimId: response.data?.smartClaimId || null,
          smartClaimNumber: response.data?.smartClaimNumber || null,
        },
      });

      this.logger.log(`Claim ${claimId} synced to eOxegen successfully`);
      return response.data;
    } catch (err: any) {
      await this.prisma.eOxegenData.update({
        where: { claimId },
        data: {
          syncStatus: 'failed',
          syncError: err?.message || String(err),
        },
      });
      this.logger.error(`eOxegen sync failed for claim ${claimId}: ${err?.message}`);
      throw err;
    }
  }

  /**
   * Transfer an approved claim to eOxegen for payment processing.
   * Called after checker approval.
   */
  async transferApprovedClaim(claimId: string) {
    if (!this.enabled) {
      this.logger.warn(`eOxegen transfer skipped for claim ${claimId} – integration disabled`);
      return null;
    }

    try {
      const claim = await this.prisma.claim.findUnique({
        where: { id: claimId },
        include: { provider: true, approvals: { orderBy: { createdAt: 'desc' } } },
      });

      if (!claim) throw new Error(`Claim ${claimId} not found`);

      const payload = {
        claimNumber: claim.claimNumber,
        claimType: 'medical',
        memberNumber: claim.memberNumber,
        memberName: claim.memberName,
        providerName: claim.provider.name,
        providerCode: claim.provider.licenseNumber,
        invoiceNumber: claim.invoiceNumber,
        invoiceDate: claim.invoiceDate,
        invoiceAmount: claim.invoiceAmount,
        dateOfService: claim.dateOfService,
        diagnosis: claim.diagnosis,
        batchNumber: claim.batchNumber,
        approvedAt: claim.approvedAt,
        approvalHistory: claim.approvals.map((a) => ({
          level: a.level,
          decision: a.decision,
          comments: a.comments,
          timestamp: a.createdAt,
        })),
      };

      const response = await this.eoxegenClient!.post('/claims/approved', payload);

      await this.prisma.eOxegenData.upsert({
        where: { claimId },
        create: {
          claimId,
          memberNumber: claim.memberNumber,
          memberName: claim.memberName,
          providerName: claim.provider.name,
          invoiceNumber: claim.invoiceNumber,
          invoiceDate: claim.invoiceDate,
          invoiceAmount: claim.invoiceAmount,
          syncStatus: 'synced',
          syncedAt: new Date(),
          smartClaimId: response.data?.smartClaimId || null,
          smartClaimNumber: response.data?.smartClaimNumber || null,
        },
        update: {
          syncStatus: 'synced',
          syncedAt: new Date(),
          syncError: null,
          smartClaimId: response.data?.smartClaimId || null,
          smartClaimNumber: response.data?.smartClaimNumber || null,
        },
      });

      this.logger.log(`Approved claim ${claimId} transferred to eOxegen`);
      return response.data;
    } catch (err: any) {
      this.logger.error(`eOxegen transfer failed for claim ${claimId}: ${err?.message}`);
      // Record failure but don't throw – approval should not be blocked
      await this.prisma.eOxegenData.upsert({
        where: { claimId },
        create: { claimId, syncStatus: 'failed', syncError: err?.message || String(err) },
        update: { syncStatus: 'failed', syncError: err?.message || String(err) },
      });
      return null;
    }
  }

  /**
   * Sync claim status back from eOxegen (payment updates).
   */
  async syncClaimStatus(claimId: string) {
    if (!this.enabled) return null;

    const record = await this.prisma.eOxegenData.findUnique({ where: { claimId } });
    if (!record?.smartClaimId) {
      throw new Error(`No Smart claim ID for claim ${claimId}`);
    }

    try {
      const response = await this.eoxegenClient!.get(`/claims/${record.smartClaimId}/status`);
      const { paymentStatus, paymentDate } = response.data || {};

      if (paymentStatus === 'paid') {
        await this.prisma.claim.update({
          where: { id: claimId },
          data: {
            status: 'paid',
            paidAt: paymentDate ? new Date(paymentDate) : new Date(),
          },
        });
      }

      await this.prisma.eOxegenData.update({
        where: { claimId },
        data: { syncedAt: new Date() },
      });

      return response.data;
    } catch (err: any) {
      this.logger.error(`Status sync failed for claim ${claimId}: ${err?.message}`);
      throw err;
    }
  }

  /**
   * Bulk sync all pending records.
   */
  async bulkSync() {
    if (!this.enabled) return { synced: 0, failed: 0, skipped: 0 };

    const pending = await this.prisma.eOxegenData.findMany({
      where: { syncStatus: { in: ['pending', 'failed'] } },
      take: 100,
    });

    let synced = 0, failed = 0;
    for (const rec of pending) {
      try {
        await this.syncClaim(rec.claimId);
        synced++;
      } catch {
        failed++;
      }
    }
    return { synced, failed, total: pending.length };
  }

  /**
   * Link a claim with a Smart system policy number.
   */
  async linkWithSmart(claimId: string, smartPolicyNumber: string) {
    if (!this.enabled) return { linked: false, reason: 'integration_disabled' };

    try {
      await this.eoxegenClient!.post('/claims/link', {
        claimId,
        smartPolicyNumber,
      });

      await this.prisma.eOxegenData.upsert({
        where: { claimId },
        create: { claimId, smartClaimNumber: smartPolicyNumber, syncStatus: 'synced', syncedAt: new Date() },
        update: { smartClaimNumber: smartPolicyNumber },
      });

      return { linked: true, smartPolicyNumber };
    } catch (err: any) {
      this.logger.error(`Smart link failed for claim ${claimId}: ${err?.message}`);
      throw err;
    }
  }

  async getTransferStatus(claimId: string) {
    const record = await this.prisma.eOxegenData.findUnique({ where: { claimId } });
    return {
      synced: record?.syncStatus === 'synced',
      status: record?.syncStatus || 'not_synced',
      smartClaimId: record?.smartClaimId || null,
      smartClaimNumber: record?.smartClaimNumber || null,
      syncedAt: record?.syncedAt || null,
      error: record?.syncError || null,
    };
  }

  async getStatistics() {
    const [total, synced, failed, pending] = await Promise.all([
      this.prisma.eOxegenData.count(),
      this.prisma.eOxegenData.count({ where: { syncStatus: 'synced' } }),
      this.prisma.eOxegenData.count({ where: { syncStatus: 'failed' } }),
      this.prisma.eOxegenData.count({ where: { syncStatus: 'pending' } }),
    ]);
    return {
      total, synced, failed, pending,
      successRate: total > 0 ? Math.round((synced / total) * 100) : 0,
    };
  }

  async healthCheck(): Promise<boolean> {
    if (!this.enabled) return false;
    try {
      await this.eoxegenClient!.get('/health');
      return true;
    } catch {
      return false;
    }
  }
}
