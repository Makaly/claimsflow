import {
  Controller,
  Post,
  Get,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
  Request,
  BadRequestException,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { BatchSubmissionService } from './batch-submission.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ProviderApprovedGuard } from '../auth/guards/provider-approved.guard';

@Controller('batch-submissions')
@UseGuards(JwtAuthGuard)
export class BatchSubmissionController {
  constructor(private readonly batchSubmissionService: BatchSubmissionService) {}

  @Post('upload')
  @UseGuards(ProviderApprovedGuard)
  @UseInterceptors(
    FilesInterceptor('files', 100, {
      storage: diskStorage({
        destination: './uploads/claims',
        filename: (req, file, cb) => {
          const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
          cb(null, `claim-${uniqueSuffix}${extname(file.originalname)}`);
        },
      }),
      limits: {
        fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10485760, // 10MB per file
        files: 100, // Max 100 files per batch
      },
      fileFilter: (_req, file, cb) => {
        const extOk = /\.pdf$/i.test(file.originalname);
        const mimeOk = file.mimetype === 'application/pdf';
        if (!extOk || !mimeOk) {
          return cb(new BadRequestException('Only PDF files are allowed'), false);
        }
        cb(null, true);
      },
    }),
  )
  async uploadBatch(
    @UploadedFiles() files: Express.Multer.File[],
    @Request() req,
    @Query('providerId') providerId?: string,
  ) {
    if (!files || files.length === 0) {
      throw new BadRequestException('No files uploaded');
    }

    // Provider roles are locked to their own providerId (prevents cross-provider
    // uploads); CIC staff may supply providerId explicitly.
    const role = req.user?.role;
    const isProviderRole = role === 'provider_admin' || role === 'provider_user';
    const finalProviderId = isProviderRole ? req.user?.providerId : (providerId || req.user?.providerId);

    if (!finalProviderId) {
      throw new BadRequestException('Provider ID required');
    }

    return this.batchSubmissionService.createBatchSubmission(
      finalProviderId,
      files,
      'web_upload',
      req.user.userId,
      req.ip,
      undefined,
      req.user?.branchId ?? null,
    );
  }

  @Post('reserve-number')
  async reserveBatchNumber() {
    return this.batchSubmissionService.reserveBatchNumber();
  }

  @Get()
  async getAllBatches(
    @Request() req: any,
    @Query('providerId') providerId?: string,
    @Query('status') status?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const role = req.user?.role;
    const isProviderRole = role === 'provider_admin' || role === 'provider_user';
    // Provider roles are always scoped to their own provider regardless of params.
    const effectiveProviderId = isProviderRole ? req.user?.providerId : providerId;
    if (isProviderRole && !effectiveProviderId) {
      return { batches: [], total: 0, limit: 0, offset: 0 };
    }
    return this.batchSubmissionService.getAllBatches({
      providerId: effectiveProviderId,
      status,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      limit: limit ? parseInt(limit) : undefined,
      offset: offset ? parseInt(offset) : undefined,
    });
  }

  @Get('statistics')
  async getStatistics(
    @Request() req: any,
    @Query('providerId') providerId?: string,
  ) {
    const role = req.user?.role;
    const isProviderRole = role === 'provider_admin' || role === 'provider_user';
    const effectiveProviderId = isProviderRole ? req.user?.providerId : providerId;
    if (isProviderRole && !effectiveProviderId) {
      return { total: 0, processing: 0, completed: 0, failed: 0, totalClaims: 0 };
    }
    return this.batchSubmissionService.getBatchStatistics(effectiveProviderId);
  }

  @Post('scan-station/upload')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'claims_officer', 'supervisor')
  @UseInterceptors(
    FilesInterceptor('files', 100, {
      storage: diskStorage({
        destination: './uploads/claims',
        filename: (req, file, cb) => {
          const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
          cb(null, `scan-${uniqueSuffix}${extname(file.originalname)}`);
        },
      }),
      limits: {
        fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10485760,
        files: 100,
      },
      fileFilter: (_req, file, cb) => {
        const extOk = /\.pdf$/i.test(file.originalname);
        const mimeOk = file.mimetype === 'application/pdf';
        if (!extOk || !mimeOk) {
          return cb(new BadRequestException('Only PDF files are allowed'), false);
        }
        cb(null, true);
      },
    }),
  )
  async uploadScanStationBatch(
    @UploadedFiles() files: Express.Multer.File[],
    @Request() req,
    @Query('stationId') stationId: string,
    @Query('providerId') providerId?: string,
  ) {
    if (!stationId) {
      throw new BadRequestException('Station ID is required');
    }

    if (!files || files.length === 0) {
      throw new BadRequestException('No files uploaded');
    }

    const finalProviderId = providerId || req.user.providerId;

    if (!finalProviderId) {
      throw new BadRequestException('Provider ID required');
    }

    return this.batchSubmissionService.createBatchSubmission(
      finalProviderId,
      files,
      'scan_station',
      req.user.userId,
      req.ip,
      stationId,
      req.user?.branchId ?? null,
    );
  }

  @Get('scan-station/batches')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'claims_officer', 'supervisor')
  async getScanStationBatches(
    @Query('stationId') stationId?: string,
    @Query('status') status?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.batchSubmissionService.getAllBatches({
      providerId: undefined,
      status,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      limit: limit ? parseInt(limit) : undefined,
      offset: offset ? parseInt(offset) : undefined,
      submissionMethod: 'scan_station',
      stationId,
    });
  }

  @Get(':id')
  async getBatchById(@Param('id') id: string) {
    return this.batchSubmissionService.getBatchById(id);
  }
}
