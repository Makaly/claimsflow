import {
  Controller, Get, Post, UseInterceptors, UploadedFile, UploadedFiles,
  BadRequestException, Body,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { OcrService } from './ocr.service';
import { VisionRouterService } from './vision-router.service';
import * as multer from 'multer';
import * as path from 'path';
import * as fs from 'fs';

const uploadDir = path.join(process.cwd(), 'uploads', 'ocr-temp');

@Controller('ocr')
export class OcrController {
  constructor(
    private readonly ocrService: OcrService,
    private readonly visionRouter: VisionRouterService,
  ) {}

  /**
   * GET /api/ocr/models
   * List available vision models so the UI can render a dropdown.
   */
  @Get('models')
  async listModels() {
    const models = await this.visionRouter.listModels();
    const defaultProvider = process.env.VISION_DEFAULT_PROVIDER || 'claude';
    const defaultModel =
      models.find(m => m.available && m.provider === defaultProvider && m.tier === 'recommended')?.id
      ?? models.find(m => m.available && m.provider === defaultProvider)?.id
      ?? models.find(m => m.available)?.id;
    return { models, defaultModel };
  }

  /**
   * POST /api/ocr/extract
   * Upload a single PDF/image, get extracted invoice data back.
   * Optional form field: model=<id from /ocr/models>
   */
  @Post('extract')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: multer.diskStorage({
        destination: (req, file, cb) => {
          if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
          cb(null, uploadDir);
        },
        filename: (req, file, cb) => {
          cb(null, `ocr-${Date.now()}-${file.originalname}`);
        },
      }),
      limits: { fileSize: 50 * 1024 * 1024 },
    }),
  )
  async extractSingle(
    @UploadedFile() file: Express.Multer.File,
    @Body('model') model?: string,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');

    try {
      const result = await this.ocrService.extractAndParseInvoice(file.path, file.mimetype, model);
      return {
        success: true,
        fileName: file.originalname,
        pageCount: result.pageCount,
        invoices: result.invoices,
        modelUsed: result.modelUsed,
      };
    } finally {
      try { fs.unlinkSync(file.path); } catch {}
    }
  }

  /**
   * POST /api/ocr/extract-batch
   * Upload multiple PDFs/images. Optional form field: model=<id>
   */
  @Post('extract-batch')
  @UseInterceptors(
    FilesInterceptor('files', 100, {
      storage: multer.diskStorage({
        destination: (req, file, cb) => {
          if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
          cb(null, uploadDir);
        },
        filename: (req, file, cb) => {
          cb(null, `ocr-${Date.now()}-${Math.random().toString(36).slice(2)}-${file.originalname}`);
        },
      }),
      limits: { fileSize: 50 * 1024 * 1024 },
    }),
  )
  async extractBatch(
    @UploadedFiles() files: Express.Multer.File[],
    @Body('model') model?: string,
  ) {
    if (!files || files.length === 0) throw new BadRequestException('No files uploaded');

    const results = [];
    for (const file of files) {
      try {
        const result = await this.ocrService.extractAndParseInvoice(file.path, file.mimetype, model);
        results.push({
          success: true,
          fileName: file.originalname,
          pageCount: result.pageCount,
          invoices: result.invoices,
          modelUsed: result.modelUsed,
        });
      } catch (err) {
        results.push({
          success: false,
          fileName: file.originalname,
          error: err.message,
          invoices: [],
        });
      } finally {
        try { fs.unlinkSync(file.path); } catch {}
      }
    }

    return { results };
  }

  /**
   * POST /api/ocr/zone-text
   * Lightweight endpoint for zone-crop OCR: accepts a single PNG/JPEG image
   * and returns the raw Tesseract text without any invoice-parsing overhead.
   */
  @Post('zone-text')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: multer.diskStorage({
        destination: (req, file, cb) => {
          if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
          cb(null, uploadDir);
        },
        filename: (req, file, cb) => {
          cb(null, `zone-${Date.now()}-${file.originalname}`);
        },
      }),
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  async extractZoneText(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');
    try {
      const text = await this.ocrService.extractTextFromImage(file.path);
      return { success: true, text: text.trim() };
    } finally {
      try { fs.unlinkSync(file.path); } catch {}
    }
  }
}
