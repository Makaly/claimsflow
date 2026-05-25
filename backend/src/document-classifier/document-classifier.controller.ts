import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  Request,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Res,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { Response } from 'express';
import * as fs from 'fs';
import { DocumentClassifierService } from './document-classifier.service';
import { CreateTemplateDto } from './create-template.dto';
import { CreateZoneDto } from './create-zone.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

const templateStorage = diskStorage({
  destination: './uploads/templates',
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `${unique}${extname(file.originalname)}`);
  },
});

@Controller('document-classifiers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'maker_checker')
export class DocumentClassifierController {
  constructor(private readonly service: DocumentClassifierService) {}

  // ── Static routes MUST come before :id routes ─────────────────────────────

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get('ai-config')
  getAiConfig() {
    return this.service.getProviderStatus();
  }

  @Patch('ai-config')
  setAiProvider(@Body() body: { provider?: 'anthropic' | 'gemini' | 'auto'; anthropicModel?: string; geminiModel?: string }) {
    if (body.provider)       process.env.CLASSIFIER_AI_PROVIDER = body.provider;
    if (body.anthropicModel) process.env.ANTHROPIC_MODEL        = body.anthropicModel;
    if (body.geminiModel)    process.env.GEMINI_MODEL            = body.geminiModel;
    return this.service.getProviderStatus();
  }

  // ── Sample document merge (static — must be before :id routes) ───────────────

  @Post('merge-samples')
  mergeTemplateSamples(
    @Body() body: { templateIds: string[]; outputName?: string },
    @Request() req: any,
  ) {
    return this.service.mergeTemplateSamples(
      body.templateIds,
      body.outputName || 'merged_samples.pdf',
      req.user?.userId,
    );
  }

  // ── Classify ─────────────────────────────────────────────────────────────────

  @Post('classify')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads/classify-temp',
        filename: (req, file, cb) => {
          const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
          cb(null, `${unique}${extname(file.originalname)}`);
        },
      }),
    }),
  )
  async classify(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      return { templateId: null, fields: {} };
    }
    try {
      const result = await this.service.classifyAndExtract(file.path, file.mimetype);
      return result;
    } finally {
      try { fs.unlinkSync(file.path); } catch (_) {}
    }
  }

  // ── Templates (parameterised) ─────────────────────────────────────────────

  @Post()
  @UseInterceptors(FileInterceptor('file', { storage: templateStorage }))
  create(
    @Body() body: any,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const dto: CreateTemplateDto = {
      name: body.name,
      documentType: body.documentType,
      description: body.description,
      providerType: body.providerType,
      specificProvider: body.specificProvider,
    };
    return this.service.create(dto, file);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Get(':id/sample')
  async serveSample(@Param('id') id: string, @Res() res: Response) {
    const template = await this.service.findOne(id);
    if (!template.sampleFilePath) {
      return res.status(404).json({ message: 'No sample file' });
    }
    if (!fs.existsSync(template.sampleFilePath)) {
      return res.status(404).json({ message: 'Sample file not found on disk' });
    }
    const ext = extname(template.sampleFilePath).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.pdf': 'application/pdf',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
    };
    const mime = mimeMap[ext] || 'application/octet-stream';
    res.set({
      'Content-Type': mime,
      'Content-Disposition': `inline; filename="${template.sampleFileName || 'sample'}"`,
    });
    fs.createReadStream(template.sampleFilePath).pipe(res);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: Partial<CreateTemplateDto>) {
    return this.service.update(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string) {
    await this.service.delete(id);
  }

  // ── Zones ────────────────────────────────────────────────────────────────────

  @Post(':id/zones')
  addZone(
    @Param('id') templateId: string,
    @Body() dto: CreateZoneDto,
    @Request() req: any,
  ) {
    dto.updatedByName = req.user?.name || req.user?.email || 'Unknown';
    return this.service.addZone(templateId, dto);
  }

  @Patch(':id/zones/:zoneId')
  updateZone(
    @Param('id') templateId: string,
    @Param('zoneId') zoneId: string,
    @Body() dto: Partial<CreateZoneDto>,
    @Request() req: any,
  ) {
    dto.updatedByName = req.user?.name || req.user?.email || 'Unknown';
    return this.service.updateZone(zoneId, dto);
  }

  @Delete(':id/zones/:zoneId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeZone(
    @Param('id') templateId: string,
    @Param('zoneId') zoneId: string,
  ) {
    await this.service.deleteZone(zoneId);
  }

  // ── Zone OCR ─────────────────────────────────────────────────────────────────

  @Post(':id/zones/:zoneId/ocr')
  ocrZone(
    @Param('id') templateId: string,
    @Param('zoneId') zoneId: string,
  ) {
    return this.service.ocrZone(templateId, zoneId);
  }

  // ── Auto-suggest zones ────────────────────────────────────────────────────────

  @Post(':id/suggest-zones')
  suggestZones(@Param('id') templateId: string) {
    return this.service.suggestZones(templateId);
  }

  // ── Sample split & AI page analysis ──────────────────────────────────────────

  @Post(':id/analyze-pages')
  analyzeTemplateSamplePages(@Param('id') id: string) {
    return this.service.analyzeTemplateSamplePages(id);
  }

  @Post('from-document')
  createTemplateFromDocument(
    @Body() body: { documentId: string; name?: string; documentType?: string; specificProvider?: string },
  ) {
    return this.service.createTemplateFromDocument(body.documentId, body);
  }

  @Post(':id/split-sample')
  splitTemplateSample(
    @Param('id') id: string,
    @Body() body: { pageRanges: Array<{ start: number; end: number; name: string; documentType?: string }> },
    @Request() req: any,
  ) {
    return this.service.splitTemplateSample(id, body.pageRanges, req.user?.userId);
  }

  // ── Confusion matrix & retraining wiring ─────────────────────────────────────

  /**
   * GET /document-classifiers/confusion-matrix
   * Computes a confusion matrix from reviewed UnknownDocument labels.
   * Rows = true label (guessedType), columns = predicted label (guessedType on
   * first-pass triage). Counts only records with status='template_created' or
   * 'reviewed' where the human has validated the type.
   */
  @Get('confusion-matrix')
  async getConfusionMatrix() {
    const reviewed = await this.service.getReviewedLabels();
    return this.service.buildConfusionMatrix(reviewed);
  }

  /**
   * POST /document-classifiers/retrain
   * Pulls all reviewed+labelled UnknownDocuments and triggers a lightweight
   * refitting pass via the ML sidecar. The actual training happens in the
   * background; this endpoint returns the label set used as training data.
   *
   * TODO: wire to the real ML sidecar /retrain endpoint once the sidecar
   * exposes a document-type classifier route (see ml-sidecar/main.py).
   */
  @Post('retrain')
  @Roles('admin')
  async triggerRetrain() {
    return this.service.triggerRetrain();
  }

  // ── Zone analytics & feedback ─────────────────────────────────────────────────

  @Get('zone-analytics')
  getZoneAnalytics(@Query('templateId') templateId?: string) {
    return this.service.getZoneAnalytics(templateId || undefined);
  }

  @Get('zone-hits/best-values')
  getBestKnownValues(@Query('templateId') templateId: string) {
    return this.service.getBestKnownValues(templateId);
  }

  @Post('zone-hits')
  recordManualZoneHit(
    @Body() body: { fieldName: string; extractedValue: string; confidence?: number; engine?: string; claimId?: string; documentId?: string },
  ) {
    return this.service.recordManualZoneHit(body);
  }

  @Patch('zone-hits/:hitId/correct')
  recordCorrection(
    @Param('hitId') hitId: string,
    @Body() body: { correctedValue: string },
    @Request() req: any,
  ) {
    return this.service.recordZoneCorrection(hitId, body.correctedValue, req.user?.userId);
  }

  @Patch('zone-hits/:hitId/confirm')
  confirmHit(@Param('hitId') hitId: string, @Request() req: any) {
    return this.service.confirmZoneHit(hitId, req.user?.userId);
  }
}
