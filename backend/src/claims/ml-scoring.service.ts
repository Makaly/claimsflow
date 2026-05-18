import { Injectable, Logger } from '@nestjs/common';

export interface MlScoreResult {
  claimId: string;
  fraudProbability: number;
  riskLevel: 'low' | 'medium' | 'high';
  modelUsed: string;
}

export interface MlTrainResult {
  success: boolean;
  sampleSize: number;
  fraudCount: number;
  legitimateCount: number;
  aucRoc?: number;
  featureImportances?: Record<string, number>;
}

export interface ClaimFeatureVector {
  invoiceAmount: number;
  ocrConfidence: number;
  anomalyScore: number;
  fraudSignalCount: number;
  fraudSignalCritical: number;
  resubmissionCount: number;
  memberNumberPresent: number;
  // Line-item derived features
  lineItemCount?: number;
  arithmeticErrorCount?: number;
  highRiskItemCount?: number;
  maxItemPriceDeviation?: number;
  itemPriceStdDev?: number;
}

export interface MlLineItem {
  description: string;
  quantity?: number;
  unitPrice?: number;
  totalPrice?: number;
  taxAmount?: number;
  discount?: number;
  serviceDate?: string;
  procedureCode?: string;
  ocrConfidence?: number;
}

export interface MlLineItemsResult {
  claimId: string;
  itemCount: number;
  results: Array<{
    lineNumber: number;
    description: string;
    fraudRisk: 'low' | 'medium' | 'high';
    fraudScore: number;
    flags: string[];
    arithmeticValid: boolean;
  }>;
  invoiceLevelFlags: string[];
  arithmeticErrors: number;
  overallRisk: 'low' | 'medium' | 'high';
  invoiceFraudProbability: number;
  calculatedTotal: number;
}

export interface ImageQualityResult {
  overallScore: number;
  sharpnessScore: number;
  brightnessScore: number;
  contrastScore: number;
  resolutionScore: number;
  estimatedDpi: number;
  orientation: string;
  ocrReady: boolean;
  recommendations: string[];
  recommendedPipeline: string[];
}

interface LabeledRow {
  label: string;
  features: ClaimFeatureVector;
}

@Injectable()
export class MlScoringService {
  private readonly logger = new Logger(MlScoringService.name);
  private readonly baseUrl: string;
  private readonly enabled: boolean;

  constructor() {
    this.baseUrl = process.env.ML_SIDECAR_URL ?? 'http://localhost:8000';
    this.enabled = !!process.env.ML_SIDECAR_URL;
    if (!this.enabled) {
      this.logger.log('ML sidecar disabled — set ML_SIDECAR_URL to enable. Heuristic fallback active.');
    }
  }

  private async fetch<T>(path: string, options?: RequestInit): Promise<T> {
    const resp = await globalThis.fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options?.headers ?? {}) },
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) throw new Error(`ML sidecar ${path} returned ${resp.status}`);
    return resp.json() as Promise<T>;
  }

  /** Score a single claim. Returns heuristic result if sidecar is unavailable. */
  async score(claimId: string, features: ClaimFeatureVector): Promise<MlScoreResult> {
    if (!this.enabled) return this.heuristicScore(claimId, features);
    try {
      return await this.fetch<MlScoreResult>('/score', {
        method: 'POST',
        body: JSON.stringify({ claimId, features }),
      });
    } catch (err: any) {
      this.logger.warn(`ML sidecar unavailable — using heuristic fallback: ${err.message}`);
      return this.heuristicScore(claimId, features);
    }
  }

  /** Send labelled dataset to the sidecar for model training. */
  async train(data: LabeledRow[]): Promise<MlTrainResult> {
    if (!this.enabled) throw new Error('ML sidecar is not configured (ML_SIDECAR_URL not set)');
    return this.fetch<MlTrainResult>('/train', {
      method: 'POST',
      body: JSON.stringify({ data }),
    });
  }

  /** Score line items via the ML sidecar's Isolation Forest endpoint. */
  async scoreLineItems(
    claimId: string,
    lineItems: MlLineItem[],
    invoiceTotal: number,
  ): Promise<MlLineItemsResult | null> {
    if (!this.enabled || lineItems.length === 0) return null;
    try {
      return await this.fetch<MlLineItemsResult>('/score-line-items', {
        method: 'POST',
        body: JSON.stringify({ claimId, lineItems, invoiceTotal }),
      });
    } catch (err: any) {
      this.logger.warn(`Line item ML scoring unavailable: ${err.message}`);
      return null;
    }
  }

  /** Score an image's OCR-readiness via the ML sidecar. */
  async scoreImageQuality(imageBase64: string, filename?: string): Promise<ImageQualityResult | null> {
    if (!this.enabled) return null;
    try {
      return await this.fetch<ImageQualityResult>('/image-quality', {
        method: 'POST',
        body: JSON.stringify({ imageBase64, filename }),
      });
    } catch (err: any) {
      this.logger.warn(`Image quality scoring unavailable: ${err.message}`);
      return null;
    }
  }

  async getWeights(): Promise<Record<string, any>> {
    if (!this.enabled) return { modelLoaded: false };
    try {
      return await this.fetch<Record<string, any>>('/weights');
    } catch {
      return { modelLoaded: false };
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      const h = await this.fetch<{ status: string }>('/health');
      return h.status === 'ok';
    } catch {
      return false;
    }
  }

  private heuristicScore(claimId: string, f: ClaimFeatureVector): MlScoreResult {
    const itemBoost = Math.min(0.20,
      (f.highRiskItemCount ?? 0) * 0.05 +
      (f.arithmeticErrorCount ?? 0) * 0.06,
    );
    const prob = Math.min(1, (
      f.fraudSignalCritical * 0.22 +
      f.fraudSignalCount * 0.05 +
      f.anomalyScore * 0.38 +
      (1 - Math.min(1, f.ocrConfidence)) * 0.10 +
      (1 - f.memberNumberPresent) * 0.18 +
      itemBoost
    ));
    return {
      claimId,
      fraudProbability: parseFloat(prob.toFixed(4)),
      riskLevel: prob >= 0.6 ? 'high' : prob >= 0.3 ? 'medium' : 'low',
      modelUsed: 'heuristic_fallback',
    };
  }
}
