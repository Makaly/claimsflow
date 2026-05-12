import { Injectable } from '@nestjs/common';
import * as bwipjs from 'bwip-js';

@Injectable()
export class BarcodeService {
  /**
   * Generate barcode for a claim
   * Format: CIC-BATCH-FOLIO-YYYYMMDD-SEQUENCE
   * Example: CIC-20251230-001-00001
   */
  async generateClaimBarcode(
    batchNumber: string,
    folioNumber: string,
  ): Promise<string> {
    const date = new Date();
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
    return `CIC-${batchNumber}-${folioNumber}`;
  }

  /**
   * Generate barcode image as PNG buffer
   */
  async generateBarcodeImage(
    barcodeText: string,
    options?: {
      width?: number;
      height?: number;
      includeText?: boolean;
    },
  ): Promise<Buffer> {
    try {
      const png = await bwipjs.toBuffer({
        bcid: 'code128', // Barcode type
        text: barcodeText, // Text to encode
        scale: 3, // Scaling factor
        height: options?.height || 10, // Bar height in millimeters
        includetext: options?.includeText !== false, // Show human-readable text
        textxalign: 'center',
      });

      return png;
    } catch (error) {
      throw new Error(`Failed to generate barcode: ${error.message}`);
    }
  }

  /**
   * Generate batch number
   * Format: YYYYMMDD-XXX (date + sequence)
   */
  generateBatchNumber(sequence: number): string {
    const date = new Date();
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
    const seqStr = sequence.toString().padStart(3, '0');
    return `${dateStr}-${seqStr}`;
  }

  /**
   * Generate folio number
   * Format: 5-digit sequence within batch
   */
  generateFolioNumber(sequence: number): string {
    return sequence.toString().padStart(5, '0');
  }

  /**
   * Validate barcode format
   */
  validateBarcode(barcode: string): boolean {
    const pattern = /^CIC-\d{8}-\d{3}-\d{5}$/;
    return pattern.test(barcode);
  }

  /**
   * Parse barcode to extract components
   */
  parseBarcode(barcode: string): {
    batchNumber: string;
    folioNumber: string;
    date: string;
  } | null {
    if (!this.validateBarcode(barcode)) {
      return null;
    }

    const parts = barcode.split('-');
    return {
      batchNumber: `${parts[1]}-${parts[2]}`,
      folioNumber: parts[3],
      date: parts[1],
    };
  }
}
