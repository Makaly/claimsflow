import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Query,
  Request,
  UseInterceptors,
  UploadedFile,
  ForbiddenException,
  NotFoundException,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { createReadStream, readFileSync } from 'fs';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { ProvidersService } from './providers.service';
import { DocumentsService } from '../documents/documents.service';
import { CreateProviderDto } from './dto/create-provider.dto';
import { UpdateProviderDto } from './dto/update-provider.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

/** MIME types accepted for provider proof and onboarding documents. */
const ALLOWED_DOC_MIMES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/tiff',
]);

function docFileFilter(_req: any, file: Express.Multer.File, cb: any) {
  if (!ALLOWED_DOC_MIMES.has(file.mimetype)) {
    return cb(new Error('Only PDF, JPEG, PNG and TIFF files are accepted'), false);
  }
  cb(null, true);
}

const proofStorage = diskStorage({
  destination: (_req, _file, cb) => {
    const dir = join(process.cwd(), 'uploads', 'provider-proofs');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e6);
    cb(null, `proof-${unique}${extname(file.originalname)}`);
  },
});

const docStorage = diskStorage({
  destination: (_req, _file, cb) => {
    const dir = join(process.cwd(), 'uploads', 'provider-documents');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e6);
    cb(null, `doc-${unique}${extname(file.originalname)}`);
  },
});

const onboardingStorage = diskStorage({
  destination: (_req, _file, cb) => {
    const dir = join(process.cwd(), 'uploads', 'provider-onboarding');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e6);
    cb(null, `onb-${unique}${extname(file.originalname)}`);
  },
});

/** Categories accepted by POST /self-service/onboarding-document. */
const ONBOARDING_CATEGORIES = [
  'company_profile',        // item (a)
  'experience_evidence',    // item (b)
  'firm_certifications',    // item (d) firm level
  'staff_certifications',   // item (d) staff level
  'program_of_works',       // item (f)
  'other',
] as const;
type OnboardingCategory = typeof ONBOARDING_CATEGORIES[number];

@Controller('providers')
@UseGuards(JwtAuthGuard)
export class ProvidersController {
  constructor(
    private readonly providersService: ProvidersService,
    private readonly documentsService: DocumentsService,
  ) {}

  // ── Self-Service Endpoints ───────────────────────────────────────────────

  private ensureProviderId(req: any): string {
    const providerId = req.user?.providerId;
    if (!providerId) {
      throw new ForbiddenException('User is not associated with a provider');
    }
    return providerId;
  }

  @Get('self-service/profile')
  @UseGuards(RolesGuard)
  @Roles('provider_admin', 'provider_user')
  getSelfProfile(@Request() req) {
    const providerId = this.ensureProviderId(req);
    return this.providersService.getSelfProfile(providerId);
  }

  @Patch('self-service/profile')
  @UseGuards(RolesGuard)
  @Roles('provider_admin', 'provider_user')
  updateSelfProfile(
    @Request() req,
    @Body() body: { phone?: string; email?: string; contactPerson?: string; physicalAddress?: string },
  ) {
    const providerId = this.ensureProviderId(req);
    return this.providersService.updateSelfProfile(providerId, body);
  }

  @Get('self-service/claims')
  @UseGuards(RolesGuard)
  @Roles('provider_admin', 'provider_user')
  getSelfClaims(
    @Request() req,
    @Query('status') status?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const providerId = this.ensureProviderId(req);
    return this.providersService.getSelfClaims(
      providerId,
      { status, dateFrom, dateTo, search },
      limit ? parseInt(limit, 10) : undefined,
      offset ? parseInt(offset, 10) : undefined,
    );
  }

  @Get('self-service/branches')
  @UseGuards(RolesGuard)
  @Roles('provider_admin', 'provider_user')
  getSelfBranches(
    @Request() req,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const providerId = this.ensureProviderId(req);
    return this.providersService.getSelfBranches(
      providerId,
      limit ? parseInt(limit, 10) : undefined,
      offset ? parseInt(offset, 10) : undefined,
    );
  }

  @Post('self-service/branches')
  @UseGuards(RolesGuard)
  @Roles('provider_admin', 'provider_user')
  createSelfBranch(
    @Request() req,
    @Body() body: { code: string; name: string; region?: string; county?: string; address?: string; phone?: string; email?: string; contactPerson?: string },
  ) {
    const providerId = this.ensureProviderId(req);
    return this.providersService.createSelfBranch(providerId, body);
  }

  @Get('self-service/statistics')
  @UseGuards(RolesGuard)
  @Roles('provider_admin', 'provider_user')
  getSelfStatistics(@Request() req) {
    const providerId = this.ensureProviderId(req);
    return this.providersService.getSelfStatistics(providerId);
  }

  // Providers upload/replace their own proof document (used before approval or
  // when admin declines with a "resubmit documents" note).
  @Post('self-service/proof-document')
  @UseGuards(RolesGuard)
  @Roles('provider_admin')
  @UseInterceptors(FileInterceptor('proofDocument', { storage: proofStorage, fileFilter: docFileFilter }))
  async uploadSelfProofDocument(
    @Request() req,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const providerId = this.ensureProviderId(req);
    if (!file) throw new NotFoundException('Proof document file is required');
    return this.providersService.update(providerId, {
      proofDocumentPath: file.path,
      proofDocumentName: file.originalname,
      // Bring the record back into review; if the provider was previously
      // rejected, flip it to pending so CIC staff can re-approve.
      approvalStatus: 'pending_approval',
      status: 'pending',
      rejectionReason: null,
    } as any);
  }

  // ── Self-Service Onboarding Packet (procurement spec items a–f) ─────────
  // Each endpoint is scoped to the provider linked to the authenticated user.

  /** Save the text-only parts of the onboarding packet:
   *   - companyStructure (item a)
   *   - yearsProvidingServices (item b)
   *   - scopeUnderstanding (item c, narrative)
   *   - programOfWorksText (item f, narrative)
   */
  @Patch('self-service/onboarding-info')
  @UseGuards(RolesGuard)
  @Roles('provider_admin')
  async saveOnboardingInfo(
    @Request() req,
    @Body() body: {
      companyStructure?: string;
      yearsProvidingServices?: number;
      scopeUnderstanding?: string;
      programOfWorksText?: string;
    },
  ) {
    const providerId = this.ensureProviderId(req);
    return this.providersService.updateOnboardingInfo(providerId, body);
  }

  /** Upload one file into a specific onboarding category. */
  @Post('self-service/onboarding-document')
  @UseGuards(RolesGuard)
  @Roles('provider_admin')
  @UseInterceptors(FileInterceptor('file', { storage: onboardingStorage, fileFilter: docFileFilter }))
  async uploadOnboardingDocument(
    @Request() req,
    @Body('category') category: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const providerId = this.ensureProviderId(req);
    if (!file) throw new NotFoundException('file is required');
    if (!ONBOARDING_CATEGORIES.includes(category as OnboardingCategory)) {
      throw new ForbiddenException(`Invalid category. Expected one of: ${ONBOARDING_CATEGORIES.join(', ')}`);
    }
    return this.providersService.addOnboardingDocument(providerId, {
      category: category as OnboardingCategory,
      fileName: file.originalname,
      filePath: file.path,
      fileSize: file.size,
      mimeType: file.mimetype,
      uploadedBy: req.user?.userId,
    });
  }

  /** Remove an uploaded onboarding document. */
  @Delete('self-service/onboarding-document/:docId')
  @UseGuards(RolesGuard)
  @Roles('provider_admin')
  async removeOnboardingDocument(@Request() req, @Param('docId') docId: string) {
    const providerId = this.ensureProviderId(req);
    return this.providersService.removeOnboardingDocument(providerId, docId);
  }

  /** Add a past-engagement reference (item e). */
  @Post('self-service/references')
  @UseGuards(RolesGuard)
  @Roles('provider_admin')
  async addReference(
    @Request() req,
    @Body() body: {
      clientName: string;
      contactPerson: string;
      contactEmail?: string;
      contactPhone?: string;
      servicesProvided: string;
      engagementStartDate: string;
      engagementEndDate?: string;
    },
  ) {
    const providerId = this.ensureProviderId(req);
    return this.providersService.addReference(providerId, body);
  }

  /** Remove a reference. */
  @Delete('self-service/references/:refId')
  @UseGuards(RolesGuard)
  @Roles('provider_admin')
  async removeReference(@Request() req, @Param('refId') refId: string) {
    const providerId = this.ensureProviderId(req);
    return this.providersService.removeReference(providerId, refId);
  }

  /** Provider declares the packet complete and ready for CIC review. */
  @Post('self-service/onboarding-submit')
  @UseGuards(RolesGuard)
  @Roles('provider_admin')
  async submitOnboarding(@Request() req) {
    const providerId = this.ensureProviderId(req);
    return this.providersService.submitOnboarding(providerId);
  }

  /** Full onboarding packet — used by the provider to populate their own
   *  dashboard and by admins when reviewing. */
  @Get('self-service/onboarding-packet')
  @UseGuards(RolesGuard)
  @Roles('provider_admin', 'provider_user')
  async getOwnOnboardingPacket(@Request() req) {
    const providerId = this.ensureProviderId(req);
    return this.providersService.getOnboardingPacket(providerId);
  }

  // ── Admin / General Endpoints ──────────────────────────────────────────

  /** Create provider – accepts multipart/form-data so a proof file can be
   *  uploaded in the same request.  Falls back to JSON if no file is sent. */
  @Post()
  @UseGuards(RolesGuard)
  @Roles('admin', 'supervisor')
  @UseInterceptors(FileInterceptor('proofDocument', { storage: proofStorage, fileFilter: docFileFilter }))
  create(
    @Body() body: CreateProviderDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (file) {
      body.proofDocumentPath = file.path;
      body.proofDocumentName = file.originalname;
    }
    if (body.incorporationDate) {
      (body as any).incorporationDate = new Date(body.incorporationDate);
    }
    if (body.numberOfPartners) {
      body.numberOfPartners = Number(body.numberOfPartners);
    }
    return this.providersService.create(body);
  }

  @Get()
  @UseGuards(RolesGuard)
  @Roles('admin', 'supervisor', 'claims_officer', 'checker', 'fraud_officer')
  findAll(
    @Query('type') type?: string,
    @Query('active') active?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const take = limit ? parseInt(limit, 10) : undefined;
    const skip = offset ? parseInt(offset, 10) : undefined;
    if (type) return this.providersService.findByType(type, take, skip);
    if (active === 'true') return this.providersService.getActiveProviders(take, skip);
    return this.providersService.findAll(take, skip);
  }

  @Get(':id')
  @UseGuards(RolesGuard)
  @Roles('admin', 'supervisor', 'claims_officer', 'checker', 'fraud_officer', 'provider_admin', 'provider_user')
  findOne(@Param('id') id: string, @Request() req) {
    // provider_admin / provider_user may only read their OWN provider record.
    const role = req.user.role;
    if ((role === 'provider_admin' || role === 'provider_user') && req.user.providerId !== id) {
      throw new ForbiddenException('You can only view your own provider record');
    }
    return this.providersService.findOne(id);
  }

  /** Admin-facing: full onboarding packet for approval review. */
  @Get(':id/onboarding-packet')
  @UseGuards(RolesGuard)
  @Roles('admin', 'supervisor')
  getOnboardingPacket(@Param('id') id: string) {
    return this.providersService.getOnboardingPacket(id);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('admin', 'supervisor')
  @UseInterceptors(FileInterceptor('proofDocument', { storage: proofStorage, fileFilter: docFileFilter }))
  update(
    @Param('id') id: string,
    @Body() updateProviderDto: UpdateProviderDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (file) {
      (updateProviderDto as any).proofDocumentPath = file.path;
      (updateProviderDto as any).proofDocumentName = file.originalname;
    }
    return this.providersService.update(id, updateProviderDto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('admin', 'supervisor')
  remove(@Param('id') id: string) {
    return this.providersService.remove(id);
  }

  @Get(':id/proof-document')
  @UseGuards(RolesGuard)
  @Roles('admin', 'supervisor', 'claims_officer', 'checker', 'fraud_officer')
  async serveProofDocument(@Param('id') id: string, @Res() res: Response) {
    const provider = await this.providersService.findOne(id);
    if (!provider?.proofDocumentPath || !existsSync(provider.proofDocumentPath)) {
      throw new NotFoundException('Proof document not found');
    }
    const ext = provider.proofDocumentPath.split('.').pop()?.toLowerCase();
    let mime = ext === 'pdf' ? 'application/pdf'
      : ext === 'png' ? 'image/png'
      : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
      : 'application/octet-stream';
    // Sniff magic bytes when extension is missing or unrecognised
    if (mime === 'application/octet-stream') {
      try {
        const buf = readFileSync(provider.proofDocumentPath, { flag: 'r' });
        if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) mime = 'application/pdf';
        else if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) mime = 'image/png';
        else if (buf[0] === 0xff && buf[1] === 0xd8) mime = 'image/jpeg';
      } catch { /* keep octet-stream */ }
    }
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `inline; filename="${provider.proofDocumentName || 'document'}"`);
    createReadStream(provider.proofDocumentPath).pipe(res);
  }

  // ── Approval Endpoints ──────────────────────────────────────────────────

  @Get('approvals/pending')
  @UseGuards(RolesGuard)
  @Roles('admin', 'supervisor')
  getPendingApprovals(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.providersService.getPendingApprovals(
      limit ? parseInt(limit, 10) : undefined,
      offset ? parseInt(offset, 10) : undefined,
    );
  }

  @Post(':id/approve')
  @UseGuards(RolesGuard)
  @Roles('admin', 'supervisor')
  approveProvider(@Param('id') id: string, @Request() req) {
    return this.providersService.approveProvider(id, req.user.userId);
  }

  @Post(':id/reject')
  @UseGuards(RolesGuard)
  @Roles('admin', 'supervisor')
  rejectProvider(
    @Param('id') id: string,
    @Body() body: { reason: string },
    @Request() req,
  ) {
    return this.providersService.rejectProvider(id, body.reason, req.user.userId);
  }

  @Post(':id/suspend')
  @UseGuards(RolesGuard)
  @Roles('admin', 'supervisor')
  suspendProvider(
    @Param('id') id: string,
    @Body() body: { reason: string },
    @Request() req,
  ) {
    return this.providersService.suspendProvider(id, body.reason, req.user.userId);
  }

  @Post(':id/reactivate')
  @UseGuards(RolesGuard)
  @Roles('admin', 'supervisor')
  reactivateProvider(@Param('id') id: string, @Request() req) {
    return this.providersService.reactivateProvider(id, req.user.userId);
  }

  @Delete(':id/proof-document')
  deleteProofDocument(@Param('id') id: string) {
    return this.providersService.deleteProofDocument(id);
  }

  // ── Provider Documents ──────────────────────────────────────────────────

  @Get(':id/documents')
  async listProviderDocuments(@Param('id') id: string) {
    return this.providersService.listDocuments(id);
  }

  @Post(':id/documents')
  @UseInterceptors(FileInterceptor('file', {
    storage: docStorage,
    limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10485760 },
    fileFilter: (_req, file, cb) => {
      if (!file.originalname.match(/\.(pdf|jpg|jpeg|png|tiff?|tif)$/i)) {
        return cb(new Error('Only PDF and image files are allowed'), false);
      }
      cb(null, true);
    },
  }))
  async uploadProviderDocument(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('name') name: string,
    @Request() req,
  ) {
    return this.providersService.addDocument(id, file, req.user.userId, name);
  }

  @Get(':id/documents/:docId/file')
  async serveProviderDocument(
    @Param('id') id: string,
    @Param('docId') docId: string,
    @Request() req: any,
    @Res() res: Response,
  ) {
    const { stream, mimetype, filename } = await this.documentsService.getFileStream(docId, req.user);
    res.set({ 'Content-Type': mimetype, 'Content-Disposition': `inline; filename="${filename}"` });
    stream.pipe(res);
  }

  @Delete(':id/documents/:docId')
  async deleteProviderDocument(
    @Param('id') id: string,
    @Param('docId') docId: string,
  ) {
    return this.providersService.removeDocument(id, docId);
  }
}
