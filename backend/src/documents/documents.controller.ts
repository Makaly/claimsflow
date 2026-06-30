import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query,
  UseGuards, UseInterceptors, UploadedFile, Res, Request,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import * as fs from 'fs';
import { Response } from 'express';
import { DocumentsService } from './documents.service';
import { assertAllowedFileSignature } from './file-signature';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ScanMeteringService } from '../scan-metering/scan-metering.service';

// Resolve upload directory from env (Render sets UPLOAD_DIR=/tmp/uploads) with
// a fallback for local dev. Create it eagerly so multer never fails on a fresh
// container boot where the directory doesn't exist yet.
const DOCUMENTS_UPLOAD_DIR = join(process.env.UPLOAD_DIR || './uploads', 'documents');
fs.mkdirSync(DOCUMENTS_UPLOAD_DIR, { recursive: true });

@Controller('documents')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DocumentsController {
  constructor(
    private readonly documentsService: DocumentsService,
    private readonly metering: ScanMeteringService,
  ) {}

  // ─────────────────────────────────────────────────────────────
  // Upload / CRUD
  // ─────────────────────────────────────────────────────────────

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: DOCUMENTS_UPLOAD_DIR,
        filename: (req, file, cb) => {
          const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
          cb(null, `${uniqueSuffix}${extname(file.originalname)}`);
        },
      }),
      limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10485760 },
      fileFilter: (req, file, cb) => {
        if (!file.originalname.match(/\.(pdf|jpg|jpeg|png|tiff?|tif)$/i)) {
          return cb(new Error('Only PDF, image and TIFF files are allowed'), false);
        }
        cb(null, true);
      },
    }),
  )
  async uploadDocument(
    @UploadedFile() file: Express.Multer.File,
    @Request() req: any,
    @Query('claimId') claimId?: string,
    @Query('branchName') branchName?: string,
  ) {
    // Defence-in-depth: the multer fileFilter only checks the (spoofable)
    // filename extension. Confirm the real file header matches an allowed type
    // before the document is persisted/processed; rejects + deletes otherwise.
    if (file?.path) assertAllowedFileSignature(file.path);
    const document = await this.documentsService.uploadDocument(file, claimId, branchName);

    // Meter the upload as a billable "scan" so invoice uploads show up on the
    // Scan Metering dashboard exactly like physical scans. Best-effort: never
    // let metering (or a disabled/exempt provider) fail the upload itself.
    const userAgent = req?.headers?.['user-agent'];
    await this.metering.recordEvent({
      userId: req.user.userId,
      providerId: req.user.providerId ?? null,
      branchId: req.user.branchId ?? null,
      deviceClass: 'web',
      os: 'web',
      userAgent: typeof userAgent === 'string' ? userAgent : null,
      scannerName: 'Upload',
      pages: (document as { pageCount?: number | null })?.pageCount ?? null,
      success: true,
    }).catch(() => {});

    return document;
  }

  @Get()
  findAll(
    @Request() req: any,
    @Query('claimId') claimId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.documentsService.findAll(
      claimId,
      limit ? parseInt(limit, 10) : undefined,
      offset ? parseInt(offset, 10) : undefined,
      req.user,
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Request() req: any) {
    return this.documentsService.findOne(id, req.user);
  }

  @Get(':id/download')
  async downloadDocument(@Param('id') id: string, @Request() req: any, @Res() res: Response) {
    const { stream, mimetype, filename } = await this.documentsService.getFileStream(id, req.user);
    res.set({
      'Content-Type': mimetype,
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    stream.pipe(res);
  }

  @Get(':id/preview')
  async previewDocument(@Param('id') id: string, @Request() req: any, @Res() res: Response) {
    const { stream, mimetype, filename } = await this.documentsService.getFileStream(id, req.user);
    res.set({
      'Content-Type': mimetype,
      'Content-Disposition': `inline; filename="${filename}"`,
    });
    stream.pipe(res);
  }

  @Get(':id/ocr')
  getOcrText(@Param('id') id: string, @Request() req: any) {
    return this.documentsService.getOcrText(id, req.user);
  }

  @Get(':id/searchable-pdf')
  async searchablePdf(
    @Param('id') id: string,
    @Request() req: any,
    @Query('regenerate') regenerate: string | undefined,
    @Res() res: Response,
  ) {
    const { stream, mimetype, filename } = await this.documentsService.getSearchablePdfStream(
      id,
      req.user,
      { regenerate: regenerate === 'true' || regenerate === '1' },
    );
    res.set({
      'Content-Type': mimetype,
      'Content-Disposition': `inline; filename="${filename}"`,
    });
    stream.pipe(res);
  }

  @Post(':id/preprocess')
  preprocess(
    @Param('id') id: string,
    @Body() body: {
      deskew?: boolean;
      cropToPage?: boolean;
      removeShadow?: boolean;
      clahe?: boolean;
      denoise?: boolean;
      grayscale?: boolean;
      targetDpi?: number;
      paperLongEdgeInches?: number;
    } | undefined,
    @Request() req: any,
  ) {
    return this.documentsService.preprocessDocumentImage(id, req.user, body ?? {});
  }

  @Get(':id/preprocessed')
  async preprocessedImage(@Param('id') id: string, @Request() req: any, @Res() res: Response) {
    const { stream, mimetype, filename } = await this.documentsService.getPreprocessedStream(id, req.user);
    res.set({
      'Content-Type': mimetype,
      'Content-Disposition': `inline; filename="${filename}"`,
    });
    stream.pipe(res);
  }

  /** Update document metadata — used by the maker-checker indexing workflow. */
  @Patch(':id')
  @Roles('admin', 'claims_officer', 'maker_checker')
  updateMeta(
    @Param('id') id: string,
    @Body() body: { documentType?: string; originalName?: string; indexingNotes?: string },
    @Request() req: any,
  ) {
    const actor = req?.user ? { userId: req.user.userId, name: req.user.name || req.user.email } : undefined;
    return this.documentsService.updateMeta(id, body, actor);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.documentsService.remove(id);
  }

  // ─────────────────────────────────────────────────────────────
  // Merge / Split
  // ─────────────────────────────────────────────────────────────

  @Post('merge')
  mergeDocuments(
    @Body() body: { documentIds: string[]; outputName: string; claimId: string },
    @Request() req,
  ) {
    return this.documentsService.mergeDocuments(
      body.documentIds,
      body.outputName || 'merged.pdf',
      body.claimId,
      req.user.userId,
    );
  }

  @Post(':id/split')
  splitDocument(
    @Param('id') id: string,
    @Body() body: { pageRanges: Array<{ start: number; end: number; name: string; documentType?: string }> },
    @Request() req,
  ) {
    return this.documentsService.splitDocument(id, body.pageRanges, req.user.userId);
  }

  @Post(':id/analyze-pages')
  analyzeDocumentPages(@Param('id') id: string, @Request() req) {
    return this.documentsService.analyzeDocumentPages(id, req.user.userId);
  }

  // ─────────────────────────────────────────────────────────────
  // Purge workflow
  // ─────────────────────────────────────────────────────────────

  @Get('purge-requests/pending')
  getPendingPurgeRequests() {
    return this.documentsService.getPendingPurgeRequests();
  }

  @Post('purge-requests/:id/approve')
  approvePurgeRequest(
    @Param('id') id: string,
    @Body() body: { notes?: string },
    @Request() req,
  ) {
    return this.documentsService.approvePurgeRequest(id, req.user.userId, body.notes);
  }

  @Post('purge-requests/:id/reject')
  rejectPurgeRequest(
    @Param('id') id: string,
    @Body() body: { notes: string },
    @Request() req,
  ) {
    return this.documentsService.rejectPurgeRequest(id, req.user.userId, body.notes);
  }

  // ─────────────────────────────────────────────────────────────
  // Annotations (role-based access)
  // ─────────────────────────────────────────────────────────────

  @Get(':id/annotations')
  getAnnotations(@Param('id') id: string, @Request() req) {
    return this.documentsService.getAnnotations(id, req.user);
  }

  @Post(':id/annotations')
  @Roles('admin', 'claims_officer', 'maker_checker')
  createAnnotation(
    @Param('id') id: string,
    @Body() body: {
      type: string;
      pageNumber: number;
      x: number;
      y: number;
      width?: number;
      height?: number;
      content?: string;
      color?: string;
      signatureData?: string;
      signerName?: string;
    },
    @Request() req,
  ) {
    return this.documentsService.createAnnotation(id, body, req.user);
  }

  @Patch(':id/annotations/:annotationId')
  @Roles('admin', 'claims_officer', 'maker_checker')
  updateAnnotation(
    @Param('id') id: string,
    @Param('annotationId') annotationId: string,
    @Body() body: {
      content?: string;
      color?: string;
      x?: number;
      y?: number;
      width?: number;
      height?: number;
    },
    @Request() req,
  ) {
    return this.documentsService.updateAnnotation(id, annotationId, body, req.user);
  }

  @Delete(':id/annotations/:annotationId')
  @Roles('admin', 'claims_officer', 'maker_checker')
  deleteAnnotation(
    @Param('id') id: string,
    @Param('annotationId') annotationId: string,
    @Request() req,
  ) {
    return this.documentsService.deleteAnnotation(id, annotationId, req.user);
  }

  // ─────────────────────────────────────────────────────────────
  // EDMS
  // ─────────────────────────────────────────────────────────────

  @Get(':id/edms-status')
  getEdmsSyncStatus(@Param('id') id: string) {
    return this.documentsService.getEdmsSyncStatus(id);
  }

  @Post(':id/edms-sync')
  triggerEdmsSync(@Param('id') id: string) {
    return this.documentsService.triggerEdmsSync(id);
  }
}
