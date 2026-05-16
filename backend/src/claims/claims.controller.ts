import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Query,
  Request,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import * as fs from 'fs';
import { ClaimsService } from './claims.service';
import { AnomalyScoringService } from './anomaly-scoring.service';
import { CreateClaimDto } from './dto/create-claim.dto';
import { UpdateClaimDto } from './dto/update-claim.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ProviderApprovedGuard } from '../auth/guards/provider-approved.guard';
import { EmailService } from '../notifications/email.service';

// Allowed MIME signatures (magic bytes) for uploaded files
const MAGIC_BYTES: Record<string, Buffer[]> = {
  pdf: [Buffer.from([0x25, 0x50, 0x44, 0x46])],             // %PDF
  jpg: [Buffer.from([0xff, 0xd8, 0xff])],
  png: [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
};

function verifyMagicBytes(filePath: string, ext: string): boolean {
  const key = ext.replace('.', '').toLowerCase();
  const signatures = MAGIC_BYTES[key === 'jpeg' ? 'jpg' : key];
  if (!signatures) return false;
  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(8);
  fs.readSync(fd, buf, 0, 8, 0);
  fs.closeSync(fd);
  return signatures.some((sig) => buf.slice(0, sig.length).equals(sig));
}

@Controller('claims')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ClaimsController {
  constructor(
    private readonly claimsService: ClaimsService,
    private readonly emailService: EmailService,
    private readonly anomalyScoringService: AnomalyScoringService,
  ) {}

  @Post()
  @UseGuards(ProviderApprovedGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads/claims',
        filename: (req, file, cb) => {
          const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
          cb(null, `${uniqueSuffix}${extname(file.originalname)}`);
        },
      }),
      limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10485760 },
      fileFilter: (req, file, cb) => {
        if (!file.originalname.match(/\.(pdf|jpg|jpeg|png)$/)) {
          return cb(new Error('Only PDF and image files are allowed!'), false);
        }
        cb(null, true);
      },
    }),
  )
  async create(
    @Body() createClaimDto: CreateClaimDto,
    @UploadedFile() file?: Express.Multer.File,
    @Request() req?: any,
  ) {
    if (file) {
      const ext = extname(file.originalname).toLowerCase();
      if (!verifyMagicBytes(file.path, ext)) {
        fs.unlinkSync(file.path);
        throw new BadRequestException('File content does not match its declared type');
      }
    }

    const claim = await this.claimsService.create(
      createClaimDto,
      this.actorFrom(req),
    );

    // Send single-claim confirmation email if caller supplied a recipient address
    if (createClaimDto.recipientEmail) {
      const fmt = (n: number) =>
        'KES ' + (n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2 });

      this.emailService
        .sendBatchConfirmation({
          recipientEmail: createClaimDto.recipientEmail,
          submittedBy: createClaimDto.recipientEmail,
          batchNumber: claim.claimNumber,
          totalClaims: 1,
          totalAmount: createClaimDto.amount || 0,
          claims: [
            {
              claimNumber: claim.claimNumber,
              barcode: claim.barcode,
              patientName: createClaimDto.patientName || 'Unknown Patient',
              providerName: createClaimDto.providerName || claim.provider?.name || 'Unknown Provider',
              invoiceNumber: createClaimDto.invoiceNumber || '',
              invoiceDate: createClaimDto.invoiceDate || '',
              invoiceAmount: createClaimDto.amount || 0,
              diagnosis: createClaimDto.diagnosis || '',
            },
          ],
        })
        .catch(() => {}); // non-blocking — email failure must not fail the claim save
    }

    return claim;
  }

  @Get()
  findAll(
    @Query('status') status?: string,
    @Query('providerId') providerId?: string,
    @Query('batchId') batchId?: string,
    @Query('branchId') branchId?: string,
    @Query('assignedTo') assignedTo?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Request() req?,
  ) {
    return this.claimsService.findAll({
      user: req?.user,
      status,
      providerId,
      batchId,
      branchId,
      assignedTo,
      dateFrom,
      dateTo,
      search,
      limit: limit ? parseInt(limit) : undefined,
      offset: offset ? parseInt(offset) : undefined,
    });
  }

  @Get('statistics')
  getStatistics(@Request() req) {
    return this.claimsService.getStatistics(req.user);
  }

  @Get('ml/factor-effectiveness')
  @Roles('admin', 'claims_officer')
  async getFactorEffectiveness() {
    return this.anomalyScoringService.getFactorEffectiveness();
  }

  // ── Fraud workflow ─────────────────────────────────────────────
  // These must be declared BEFORE @Get(':id') / @Patch(':id') / @Delete(':id')
  // so the specific `fraud-queue` and `:id/fraud/*` paths aren't swallowed
  // by the id-only handlers above.
  //
  // GET  /claims/fraud-queue        — fraud team inbox of claims on hold
  // POST /claims/:id/fraud/escalate — maker/checker pushes a claim to fraud
  // POST /claims/:id/fraud/clear    — fraud team clears; resumes normal flow
  // POST /claims/:id/fraud/confirm  — fraud team confirms; claim hard-rejected

  @Get('fraud-confirmed')
  @Roles('admin', 'fraud_officer', 'claims_officer')
  getFraudConfirmed(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.claimsService.getFraudConfirmed({
      limit: limit ? parseInt(limit) : undefined,
      offset: offset ? parseInt(offset) : undefined,
    });
  }

  @Get('fraud-queue')
  @Roles('admin', 'fraud_officer', 'claims_officer')
  getFraudQueue(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.claimsService.getFraudQueue({
      limit: limit ? parseInt(limit) : undefined,
      offset: offset ? parseInt(offset) : undefined,
    });
  }

  @Post(':id/fraud/escalate')
  @Roles('admin', 'claims_officer', 'fraud_officer')
  escalateToFraud(
    @Param('id') id: string,
    @Body() body: { reason: string },
    @Request() req: any,
  ) {
    return this.claimsService.escalateToFraud(id, body?.reason, this.actorFrom(req));
  }

  @Post(':id/fraud/clear')
  @Roles('admin', 'fraud_officer')
  clearFraud(
    @Param('id') id: string,
    @Body() body: { notes?: string },
    @Request() req: any,
  ) {
    return this.claimsService.clearFraud(id, body?.notes ?? '', this.actorFrom(req));
  }

  @Post(':id/fraud/confirm')
  @Roles('admin', 'fraud_officer')
  confirmFraud(
    @Param('id') id: string,
    @Body() body: { notes?: string },
    @Request() req: any,
  ) {
    return this.claimsService.confirmFraud(id, body?.notes ?? '', this.actorFrom(req));
  }

  @Post(':id/notify-denial')
  @Roles('admin', 'claims_officer', 'fraud_officer')
  notifyDenial(
    @Param('id') id: string,
    @Body() body: { message?: string; cc?: string; attachments?: { filename: string; path?: string; content?: string; encoding?: string }[] },
    @Request() req: any,
  ) {
    return this.claimsService.notifyFraudDenial(
      id,
      body?.message ?? '',
      this.actorFrom(req),
      body?.cc ?? '',
      body?.attachments,
    );
  }

  @Get(':id/emails')
  @Roles('admin', 'claims_officer', 'fraud_officer')
  getClaimEmails(@Param('id') id: string) {
    return this.claimsService.getClaimEmails(id);
  }

  @Post(':id/reprocess')
  @Roles('admin', 'claims_officer', 'fraud_officer')
  reprocessClaim(
    @Param('id') id: string,
    @Body() body: { reason?: string },
    @Request() req: any,
  ) {
    return this.claimsService.reprocessClaim(id, body?.reason ?? '', this.actorFrom(req));
  }

  @Get('by-barcode/:barcode')
  async findByBarcode(@Param('barcode') barcode: string) {
    const claim = await this.claimsService.findByBarcode(barcode);
    if (!claim) {
      return { found: false, barcode };
    }
    return { found: true, claim };
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Request() req: any) {
    return this.claimsService.findOne(id, this.actorFrom(req));
  }

  @Get(':id/ocr-fields')
  getOcrFields(@Param('id') id: string, @Request() req: any) {
    return this.claimsService.getOcrFields(id, this.actorFrom(req));
  }

  @Get(':id/anomaly-detail')
  async getAnomalyDetail(@Param('id') id: string) {
    return this.anomalyScoringService.getAnomalyDetail(id);
  }

  @Get(':id/audit-trail')
  getAuditTrail(@Param('id') id: string, @Request() req: any) {
    return this.claimsService.getAuditTrail(id, this.actorFrom(req));
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateClaimDto: UpdateClaimDto,
    @Request() req: any,
  ) {
    return this.claimsService.update(id, updateClaimDto, this.actorFrom(req));
  }

  // ── Annotations ────────────────────────────────────────────────
  @Get(':id/annotations')
  getAnnotations(@Param('id') id: string, @Request() req: any) {
    return this.claimsService.getAnnotations(id, this.actorFrom(req));
  }

  @Patch(':id/annotations')
  saveAnnotations(
    @Param('id') id: string,
    @Body() body: { annotations: any[] },
    @Request() req: any,
  ) {
    return this.claimsService.saveAnnotations(
      id,
      body.annotations,
      this.actorFrom(req),
    );
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Request() req: any) {
    return this.claimsService.remove(id, this.actorFrom(req));
  }

  private actorFrom(req: any) {
    if (!req) return undefined;
    const ipAddress =
      req.headers?.['x-forwarded-for']?.split(',')[0] ||
      req.headers?.['x-real-ip'] ||
      req.ip ||
      null;
    return {
      userId: req.user?.userId ?? null,
      role: req.user?.role ?? null,
      email: req.user?.email ?? null,
      name: req.user?.name ?? null,
      providerId: req.user?.providerId ?? null,
      branchId: req.user?.branchId ?? null,
      ipAddress,
      userAgent: req.headers?.['user-agent'] ?? null,
    };
  }
}
