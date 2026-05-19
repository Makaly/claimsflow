import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query,
  UseGuards, UseInterceptors, UploadedFile, Res, Request,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { Response } from 'express';
import { DocumentsService } from './documents.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('documents')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  // ─────────────────────────────────────────────────────────────
  // Upload / CRUD
  // ─────────────────────────────────────────────────────────────

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads/documents',
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
  uploadDocument(
    @UploadedFile() file: Express.Multer.File,
    @Query('claimId') claimId?: string,
    @Query('branchName') branchName?: string,
  ) {
    return this.documentsService.uploadDocument(file, claimId, branchName);
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
