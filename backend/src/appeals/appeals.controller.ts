import {
  Controller, Get, Post, Patch, Body, Param, Query, UseGuards, Request,
  UseInterceptors, UploadedFile, Res, BadRequestException, NotFoundException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join, basename } from 'path';
import { existsSync, mkdirSync, createReadStream } from 'fs';
import type { Response } from 'express';
import { AppealsService } from './appeals.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

const APPEAL_UPLOAD_DIR = join(process.cwd(), 'uploads', 'appeals');
if (!existsSync(APPEAL_UPLOAD_DIR)) mkdirSync(APPEAL_UPLOAD_DIR, { recursive: true });

@Controller('appeals')
@UseGuards(JwtAuthGuard)
export class AppealsController {
  constructor(private readonly appealsService: AppealsService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles('provider_admin', 'provider_user', 'admin', 'claims_officer')
  fileAppeal(
    @Body() body: { claimId: string; reason: string; additionalNotes?: string },
    @Request() req,
  ) {
    return this.appealsService.fileAppeal({ ...body, filedBy: req.user.userId });
  }

  @Get()
  @UseGuards(RolesGuard)
  @Roles('admin', 'claims_officer', 'maker_checker', 'fraud_officer', 'provider_admin', 'provider_user')
  getAppeals(
    @Request() req,
    @Query('status') status?: string,
    @Query('claimId') claimId?: string,
    @Query('outcome') outcome?: string,
    @Query('search') search?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: 'asc' | 'desc',
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const isProvider = req.user.role === 'provider_admin' || req.user.role === 'provider_user';
    return this.appealsService.getAppeals({
      status,
      claimId,
      outcome,
      search,
      dateFrom,
      dateTo,
      sortBy,
      sortOrder,
      providerId: isProvider ? req.user.providerId : undefined,
      limit: limit ? parseInt(limit) : undefined,
      offset: offset ? parseInt(offset) : undefined,
    });
  }

  @Get('analytics')
  @UseGuards(RolesGuard)
  @Roles('admin', 'claims_officer', 'maker_checker', 'fraud_officer', 'provider_admin', 'provider_user')
  getAnalytics(@Request() req) {
    const isProvider = req.user.role === 'provider_admin' || req.user.role === 'provider_user';
    return this.appealsService.getAnalytics({
      providerId: isProvider ? req.user.providerId : undefined,
    });
  }

  @Patch(':id/adjudicate')
  @UseGuards(RolesGuard)
  @Roles('admin', 'claims_officer')
  adjudicate(
    @Param('id') id: string,
    @Body() body: { outcome: 'upheld' | 'dismissed'; outcomeNotes?: string },
    @Request() req,
  ) {
    return this.appealsService.adjudicateAppeal(id, req.user.userId, body);
  }

  @Patch(':id/status')
  @UseGuards(RolesGuard)
  @Roles('admin', 'claims_officer')
  updateStatus(
    @Param('id') id: string,
    @Body() body: { status: 'under_review' | 'pending' },
  ) {
    return this.appealsService.updateAppealStatus(id, body.status);
  }

  // Three-party appeal messaging
  @Get(':id/messages')
  @UseGuards(RolesGuard)
  @Roles('admin', 'claims_officer', 'fraud_officer', 'provider_admin', 'provider_user')
  getMessages(@Param('id') id: string) {
    return this.appealsService.getMessages(id);
  }

  @Post(':id/messages')
  @UseGuards(RolesGuard)
  @Roles('admin', 'claims_officer', 'fraud_officer', 'provider_admin', 'provider_user')
  addMessage(
    @Param('id') id: string,
    @Body() body: { message: string; attachments?: Array<{ name: string; url: string; size?: number; mime?: string }> },
    @Request() req,
  ) {
    return this.appealsService.addMessage(id, req.user.userId, req.user.role, body.message, body.attachments);
  }

  // Attachment upload — saved to uploads/appeals, referenced from a message.
  @Post('attachments/upload')
  @UseGuards(RolesGuard)
  @Roles('admin', 'claims_officer', 'fraud_officer', 'provider_admin', 'provider_user')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: APPEAL_UPLOAD_DIR,
        filename: (_req, file, cb) => {
          const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
          cb(null, `${uniqueSuffix}${extname(file.originalname)}`);
        },
      }),
      limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10485760 },
      fileFilter: (_req, file, cb) => {
        if (!file.originalname.match(/\.(pdf|jpe?g|png|tiff?|docx?|xlsx?|csv)$/i)) {
          return cb(new Error('Unsupported file type'), false);
        }
        cb(null, true);
      },
    }),
  )
  uploadAttachment(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');
    return {
      name: file.originalname,
      url: `/appeals/attachments/${file.filename}`,
      size: file.size,
      mime: file.mimetype,
    };
  }

  // Serve a previously uploaded attachment (auth-guarded; traversal-safe).
  @Get('attachments/:filename')
  @UseGuards(RolesGuard)
  @Roles('admin', 'claims_officer', 'fraud_officer', 'provider_admin', 'provider_user')
  serveAttachment(@Param('filename') filename: string, @Res() res: Response) {
    const safe = basename(filename); // strip any path components
    const filePath = join(APPEAL_UPLOAD_DIR, safe);
    if (!filePath.startsWith(APPEAL_UPLOAD_DIR) || !existsSync(filePath)) {
      throw new NotFoundException('Attachment not found');
    }
    res.setHeader('Content-Disposition', `inline; filename="${safe}"`);
    createReadStream(filePath).pipe(res);
  }
}
