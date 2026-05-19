import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

export interface PreprocessResult {
  outputPath: string;
  filename: string;
  originalWidth: number;
  originalHeight: number;
  finalWidth: number;
  finalHeight: number;
  deskewAngleDegrees: number;
  wasCroppedToPage: boolean;
  dpiScaleRatio: number;
  targetDpi: number;
  stepsApplied: string[];
}

export interface PreprocessOptions {
  deskew?: boolean;
  cropToPage?: boolean;
  removeShadow?: boolean;
  clahe?: boolean;
  denoise?: boolean;
  grayscale?: boolean;
  targetDpi?: number;
  paperLongEdgeInches?: number;
  force?: boolean;
}

const ALLOWED_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/tiff',
  'image/x-tiff',
]);

/**
 * Calls the ml-sidecar's /preprocess-image endpoint to run an OpenCV
 * preprocessing pipeline (deskew, crop, shadow removal, CLAHE, denoise,
 * 300 DPI normalization) on a single image. Writes the preprocessed PNG
 * to disk and returns the metadata; returns null when the sidecar is
 * unavailable so callers degrade gracefully.
 *
 * PDFs are explicitly not handled here — convert pages to images first
 * (see ocr.service extractTextFromPDF for the pdftoppm pattern).
 */
@Injectable()
export class ImagePreprocessorService {
  private readonly logger = new Logger(ImagePreprocessorService.name);
  private readonly baseUrl: string;
  private readonly enabled: boolean;
  private readonly timeoutMs = 60_000;

  constructor() {
    this.baseUrl = process.env.ML_SIDECAR_URL ?? 'http://localhost:8000';
    this.enabled = !!process.env.ML_SIDECAR_URL;
    if (!this.enabled) {
      this.logger.log('Image preprocessor disabled — set ML_SIDECAR_URL to enable.');
    }
  }

  outputPath(documentId: string): string {
    return path.join(process.cwd(), 'uploads', 'preprocessed', `${documentId}.png`);
  }

  exists(documentId: string): boolean {
    return fs.existsSync(this.outputPath(documentId));
  }

  /**
   * Run preprocessing on `filePath`. Returns null when the sidecar is
   * disabled or unreachable so the caller can fall back to the original
   * image. Throws only on caller error (unsupported mime, missing file).
   */
  async preprocess(
    documentId: string,
    filePath: string,
    mimetype: string,
    opts: PreprocessOptions = {},
  ): Promise<PreprocessResult | null> {
    if (!this.enabled) return null;
    if (!ALLOWED_MIMES.has(mimetype.toLowerCase())) {
      throw new Error(
        `Image preprocessor does not accept ${mimetype}. Render PDFs to images first.`,
      );
    }
    if (!fs.existsSync(filePath)) {
      throw new Error(`Image preprocessor: source not found at ${filePath}`);
    }

    const out = this.outputPath(documentId);
    if (!opts.force && fs.existsSync(out)) {
      // Return a minimal cached metadata blob — we don't persist the full
      // step list, so callers wanting it should pass force: true.
      return null;
    }

    const imageBase64 = fs.readFileSync(filePath).toString('base64');
    const body: Record<string, unknown> = { imageBase64, filename: path.basename(filePath) };
    if (opts.deskew !== undefined) body.deskew = opts.deskew;
    if (opts.cropToPage !== undefined) body.cropToPage = opts.cropToPage;
    if (opts.removeShadow !== undefined) body.removeShadow = opts.removeShadow;
    if (opts.clahe !== undefined) body.clahe = opts.clahe;
    if (opts.denoise !== undefined) body.denoise = opts.denoise;
    if (opts.grayscale !== undefined) body.grayscale = opts.grayscale;
    if (opts.targetDpi !== undefined) body.targetDpi = opts.targetDpi;
    if (opts.paperLongEdgeInches !== undefined) body.paperLongEdgeInches = opts.paperLongEdgeInches;

    let resp: Response;
    try {
      resp = await globalThis.fetch(`${this.baseUrl}/preprocess-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err: any) {
      this.logger.warn(`Sidecar unreachable for preprocessing: ${err?.message ?? err}`);
      return null;
    }

    if (!resp.ok) {
      this.logger.warn(`Sidecar /preprocess-image returned ${resp.status}`);
      return null;
    }

    const payload = (await resp.json()) as {
      imageBase64: string;
      filename?: string;
      originalWidth: number;
      originalHeight: number;
      finalWidth: number;
      finalHeight: number;
      deskewAngleDegrees: number;
      wasCroppedToPage: boolean;
      dpiScaleRatio: number;
      targetDpi: number;
      stepsApplied: string[];
    };

    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, Buffer.from(payload.imageBase64, 'base64'));

    return {
      outputPath: out,
      filename: payload.filename ?? path.basename(filePath),
      originalWidth: payload.originalWidth,
      originalHeight: payload.originalHeight,
      finalWidth: payload.finalWidth,
      finalHeight: payload.finalHeight,
      deskewAngleDegrees: payload.deskewAngleDegrees,
      wasCroppedToPage: payload.wasCroppedToPage,
      dpiScaleRatio: payload.dpiScaleRatio,
      targetDpi: payload.targetDpi,
      stepsApplied: payload.stepsApplied,
    };
  }
}
