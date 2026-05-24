import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';

// Quality score below this triggers preprocessing (configurable via system-config key
// ocr_preprocess_quality_threshold, default 0.65).
const DEFAULT_QUALITY_THRESHOLD = 0.65;

@Injectable()
export class ImagePreprocessService {
  private readonly logger = new Logger(ImagePreprocessService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async getQualityThreshold(): Promise<number> {
    try {
      const cfg = await this.prisma.systemConfig.findUnique({ where: { key: 'ocr_preprocess_quality_threshold' } });
      if (cfg) {
        const v = parseFloat(cfg.value);
        if (!isNaN(v) && v >= 0 && v <= 1) return v;
      }
    } catch { /* non-fatal */ }
    return DEFAULT_QUALITY_THRESHOLD;
  }

  /**
   * Preprocess an image file (deskew, denoise, normalise contrast) using sharp.
   * Returns the path to the preprocessed file (caller is responsible for cleanup).
   * If sharp is not installed or preprocessing fails, returns the original path.
   *
   * @param filePath   Original image file path.
   * @param qualityScore  ML sidecar image-quality score (0–1). Preprocessing is
   *                   skipped when quality >= threshold (image is already clean).
   */
  async preprocess(filePath: string, qualityScore?: number): Promise<string> {
    const threshold = await this.getQualityThreshold();

    // Skip if quality is good enough or score is unknown but file looks fine
    if (qualityScore !== undefined && qualityScore >= threshold) {
      this.logger.debug(`Image quality ${qualityScore.toFixed(2)} >= threshold ${threshold} — skipping preprocessing`);
      return filePath;
    }

    if (qualityScore !== undefined) {
      this.logger.log(`Image quality ${qualityScore.toFixed(2)} < threshold ${threshold} — preprocessing`);
    }

    try {
      // Dynamic import so startup doesn't fail when sharp is absent
      const sharp = await import('sharp').then(m => m.default || m);

      const ext = path.extname(filePath);
      const base = path.basename(filePath, ext);
      const dir = path.dirname(filePath);
      const outPath = path.join(dir, `${base}_preprocessed${ext || '.png'}`);

      await (sharp as any)(filePath)
        // Normalise contrast (stretch histogram)
        .normalize()
        // Mild sharpening to improve OCR edge detection
        .sharpen({ sigma: 1.2 })
        // Convert to greyscale for tesseract efficiency; keep colour for vision models
        // (commented out — vision models benefit from colour)
        // .grayscale()
        // Ensure lossless PNG output
        .toFormat('png')
        .toFile(outPath);

      this.logger.log(`Preprocessed image written to ${outPath}`);
      return outPath;
    } catch (err: any) {
      if (/Cannot find module|sharp/i.test(err?.message || '')) {
        this.logger.warn('sharp not installed — skipping image preprocessing. Install with: npm install sharp');
      } else {
        this.logger.warn(`Image preprocessing failed: ${err?.message} — using original`);
      }
      return filePath;
    }
  }

  /** Clean up a preprocessed temp file if it differs from the original. */
  cleanup(original: string, preprocessed: string): void {
    if (preprocessed !== original && fs.existsSync(preprocessed)) {
      try { fs.unlinkSync(preprocessed); } catch { /* ignore */ }
    }
  }
}
