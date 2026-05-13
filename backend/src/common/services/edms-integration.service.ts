import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import axios, { AxiosInstance } from 'axios';
import * as fs from 'fs';
import * as FormData from 'form-data';

/**
 * EDMS Integration Service
 *
 * Handles bidirectional sync with the Electronic Document Management System.
 * On checker approval all claim documents are pushed to EDMS for archiving.
 *
 * Configure via: EDMS_BASE_URL, EDMS_API_KEY
 * Graceful degradation when not configured.
 */
@Injectable()
export class EdmsIntegrationService {
  private readonly logger = new Logger(EdmsIntegrationService.name);
  private readonly edmsClient: AxiosInstance | null;
  private readonly enabled: boolean;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {
    const baseUrl = this.configService.get<string>('EDMS_BASE_URL');
    const apiKey = this.configService.get<string>('EDMS_API_KEY');

    this.enabled = !!baseUrl && !!apiKey;

    if (this.enabled) {
      this.edmsClient = axios.create({
        baseURL: baseUrl,
        timeout: 30_000,
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });
      this.logger.log('EDMS integration enabled');
    } else {
      this.edmsClient = null;
      this.logger.warn('EDMS integration disabled – missing EDMS_BASE_URL / EDMS_API_KEY');
    }
  }

  // ──────────────────────────────────────────────────────────────
  // Upload
  // ──────────────────────────────────────────────────────────────

  /**
   * Upload a single document to EDMS.
   * Builds a multipart form-data request with the file and metadata.
   */
  async uploadDocument(documentId: string): Promise<any> {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      include: { claim: { include: { provider: true } } },
    });

    if (!document) throw new Error(`Document ${documentId} not found`);

    if (!this.enabled) {
      this.logger.warn(`EDMS upload skipped for document ${documentId} – integration disabled`);
      // Record locally as "pending" so it can be retried once configured
      await this.prisma.edmsDocument.upsert({
        where: { claimId: document.claimId! },
        create: {
          claimId: document.claimId!,
          edmsDocumentId: `LOCAL_${documentId}`,
          syncStatus: 'pending',
        },
        update: { syncStatus: 'pending' },
      });
      return null;
    }

    try {
      const form = new FormData();

      if (fs.existsSync(document.path)) {
        form.append('file', fs.createReadStream(document.path), {
          filename: document.originalName,
          contentType: document.mimetype,
        });
      }

      form.append('documentId', document.id);
      form.append('documentType', document.documentType || 'unknown');
      form.append('claimNumber', document.claim?.claimNumber || '');
      form.append('providerName', document.claim?.provider?.name || '');
      form.append('batchNumber', document.batchNumber || '');
      form.append('uploadDate', document.createdAt.toISOString());

      const response = await this.edmsClient!.post('/documents/upload', form, {
        headers: { ...form.getHeaders() },
      });

      await this.prisma.edmsDocument.upsert({
        where: { claimId: document.claimId! },
        create: {
          claimId: document.claimId!,
          edmsDocumentId: response.data.documentId || `EDMS_${Date.now()}`,
          edmsMetadata: response.data,
          syncStatus: 'synced',
          lastSyncAt: new Date(),
        },
        update: {
          edmsDocumentId: response.data.documentId || `EDMS_${Date.now()}`,
          edmsMetadata: response.data,
          syncStatus: 'synced',
          lastSyncAt: new Date(),
          syncError: null,
        },
      });

      this.logger.log(`Document ${documentId} uploaded to EDMS`);
      return response.data;
    } catch (err: any) {
      this.logger.error(`EDMS upload failed for document ${documentId}: ${err?.message}`);

      await this.prisma.edmsDocument.upsert({
        where: { claimId: document.claimId! },
        create: {
          claimId: document.claimId!,
          edmsDocumentId: `FAILED_${Date.now()}`,
          syncStatus: 'failed',
          syncError: err?.message || String(err),
        },
        update: {
          syncStatus: 'failed',
          syncError: err?.message || String(err),
        },
      });

      throw err;
    }
  }

  /**
   * Upload all documents for a claim.
   * Called after checker approval so everything goes to EDMS together.
   */
  async uploadClaimDocuments(claimId: string): Promise<{ uploaded: number; failed: number }> {
    const documents = await this.prisma.document.findMany({ where: { claimId } });

    let uploaded = 0, failed = 0;
    for (const doc of documents) {
      try {
        await this.uploadDocument(doc.id);
        uploaded++;
      } catch {
        failed++;
      }
    }

    this.logger.log(`EDMS upload for claim ${claimId}: ${uploaded} uploaded, ${failed} failed`);
    return { uploaded, failed };
  }

  // ──────────────────────────────────────────────────────────────
  // Retrieve / metadata
  // ──────────────────────────────────────────────────────────────

  async retrieveDocument(edmsDocumentId: string) {
    if (!this.enabled) throw new Error('EDMS integration disabled');

    try {
      const response = await this.edmsClient!.get(`/documents/${edmsDocumentId}`);
      this.logger.log(`Document ${edmsDocumentId} retrieved from EDMS`);
      return {
        documentId: response.data.id,
        fileName: response.data.fileName,
        content: response.data.content,
        metadata: response.data.metadata,
      };
    } catch (err: any) {
      this.logger.error(`EDMS retrieval failed: ${err?.message}`);
      throw err;
    }
  }

  async updateDocumentMetadata(edmsDocumentId: string, metadata: any) {
    if (!this.enabled) return null;
    try {
      const response = await this.edmsClient!.patch(`/documents/${edmsDocumentId}/metadata`, metadata);
      return response.data;
    } catch (err: any) {
      this.logger.error(`EDMS metadata update failed: ${err?.message}`);
      throw err;
    }
  }

  async deleteDocument(edmsDocumentId: string) {
    if (!this.enabled) return null;
    try {
      await this.edmsClient!.delete(`/documents/${edmsDocumentId}`);
      await this.prisma.edmsDocument.updateMany({
        where: { edmsDocumentId },
        data: { syncStatus: 'deleted' },
      });
      this.logger.log(`Document ${edmsDocumentId} deleted from EDMS`);
    } catch (err: any) {
      this.logger.error(`EDMS delete failed: ${err?.message}`);
      throw err;
    }
  }

  // ──────────────────────────────────────────────────────────────
  // Bulk ops
  // ──────────────────────────────────────────────────────────────

  async syncPendingDocuments() {
    if (!this.enabled) return { synced: 0, failed: 0 };

    const pendingClaims = await this.prisma.claim.findMany({
      where: { edmsData: null },
      take: 100,
    });

    let synced = 0, failed = 0;
    for (const doc of pendingClaims) {
      try {
        await this.uploadClaimDocuments(doc.id);
        synced++;
      } catch {
        failed++;
      }
    }
    return { synced, failed, total: pendingClaims.length };
  }

  async retryFailedSyncs() {
    if (!this.enabled) return { retried: 0, succeeded: 0, failed: 0 };

    const failed = await this.prisma.edmsDocument.findMany({
      where: { syncStatus: 'failed' },
      take: 50,
    });

    let succeeded = 0, failedCount = 0;
    for (const rec of failed) {
      // find the underlying document
      const doc = await this.prisma.document.findFirst({ where: { claimId: rec.claimId } });
      if (doc) {
        try {
          await this.uploadDocument(doc.id);
          succeeded++;
        } catch {
          failedCount++;
        }
      }
    }
    return { retried: failed.length, succeeded, failed: failedCount };
  }

  // ──────────────────────────────────────────────────────────────
  // Status / health
  // ──────────────────────────────────────────────────────────────

  async getSyncStatus(claimId: string) {
    const rec = await this.prisma.edmsDocument.findFirst({
      where: { claimId },
      orderBy: { createdAt: 'desc' },
    });
    return {
      synced: rec?.syncStatus === 'synced',
      status: rec?.syncStatus || 'not_synced',
      edmsDocumentId: rec?.edmsDocumentId || null,
      lastSyncAt: rec?.lastSyncAt || null,
      error: rec?.syncError || null,
    };
  }

  async handleWebhook(webhookData: any) {
    this.logger.log('EDMS webhook received');
    try {
      const { edmsDocumentId, status } = webhookData || {};
      if (edmsDocumentId) {
        await this.prisma.edmsDocument.updateMany({
          where: { edmsDocumentId },
          data: { syncStatus: status || 'synced', lastSyncAt: new Date() },
        });
      }
      return { processed: true };
    } catch (err: any) {
      this.logger.error(`EDMS webhook processing failed: ${err?.message}`);
      throw err;
    }
  }

  async healthCheck(): Promise<boolean> {
    if (!this.enabled) return false;
    try {
      await this.edmsClient!.get('/health');
      return true;
    } catch {
      return false;
    }
  }
}
