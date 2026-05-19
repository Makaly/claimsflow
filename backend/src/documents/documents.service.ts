import { Injectable, NotFoundException, ForbiddenException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OcrService } from '../ocr/ocr.service';
import { SearchablePdfService } from '../ocr/searchable-pdf.service';
import { ImagePreprocessorService, PreprocessOptions, PreprocessResult } from '../ocr/image-preprocessor.service';
import { tenantScope } from '../common/tenant-scope';
import { PdfOperationsService } from '../common/services/pdf-operations.service';
import { EdmsIntegrationService } from '../common/services/edms-integration.service';
import * as fs from 'fs';
import * as path from 'path';
import * as pdfParse from 'pdf-parse';
import Anthropic from '@anthropic-ai/sdk';

// Root folder for the structured file dump — configurable via UPLOAD_DUMP_DIR env var
const DUMP_ROOT = process.env.UPLOAD_DUMP_DIR || path.resolve(process.cwd(), 'uploaded_files');

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private prisma: PrismaService,
    private ocrService: OcrService,
    private pdfOperationsService: PdfOperationsService,
    private edmsService: EdmsIntegrationService,
    private searchablePdfService: SearchablePdfService,
    private imagePreprocessorService: ImagePreprocessorService,
  ) {}

  /**
   * Run the ml-sidecar OpenCV preprocessing pipeline (deskew, page-crop,
   * shadow removal, CLAHE, denoise, 300 DPI) on the document. Image inputs
   * only — PDFs return 400 because callers should render to images first.
   * Persists step metadata onto Document.metadata.preprocessing and returns
   * the result. Lazy / opt-in — does NOT auto-run from the OCR queue.
   */
  async preprocessDocumentImage(
    id: string,
    user?: { role?: string | null; providerId?: string | null; branchId?: string | null },
    opts: PreprocessOptions = {},
  ): Promise<PreprocessResult> {
    const document = await this.findOne(id, user);
    if (!fs.existsSync(document.path)) {
      throw new NotFoundException('Source file not found on disk');
    }
    const result = await this.imagePreprocessorService.preprocess(
      document.id,
      document.path,
      document.mimetype,
      { ...opts, force: true },
    );
    if (!result) {
      throw new BadRequestException(
        'Preprocessing unavailable — ml-sidecar is disabled or unreachable',
      );
    }

    const merged = {
      ...((document.metadata as Record<string, unknown>) ?? {}),
      preprocessing: {
        path: result.outputPath,
        stepsApplied: result.stepsApplied,
        deskewAngleDegrees: result.deskewAngleDegrees,
        wasCroppedToPage: result.wasCroppedToPage,
        dpiScaleRatio: result.dpiScaleRatio,
        targetDpi: result.targetDpi,
        finalWidth: result.finalWidth,
        finalHeight: result.finalHeight,
        processedAt: new Date().toISOString(),
      },
    };
    await this.prisma.document.update({
      where: { id: document.id },
      data: { metadata: merged },
    });

    return result;
  }

  /** Stream the preprocessed PNG. 404 if it hasn't been generated yet. */
  async getPreprocessedStream(
    id: string,
    user?: { role?: string | null; providerId?: string | null; branchId?: string | null },
  ) {
    const document = await this.findOne(id, user);
    const out = this.imagePreprocessorService.outputPath(document.id);
    if (!fs.existsSync(out)) {
      throw new NotFoundException('Preprocessed image not available — call POST /preprocess first');
    }
    return {
      stream: fs.createReadStream(out),
      mimetype: 'image/png',
      filename: `${document.originalName.replace(/\.[^.]+$/, '')}.preprocessed.png`,
    };
  }

  /**
   * Stream a searchable PDF for the document. Generates lazily on first
   * request (image background + invisible Tesseract hOCR text layer), then
   * caches the output to disk so subsequent calls are instant.
   *
   * Inherits provider/branch access control from findOne.
   */
  async getSearchablePdfStream(
    id: string,
    user?: { role?: string | null; providerId?: string | null; branchId?: string | null },
    opts: { regenerate?: boolean } = {},
  ) {
    const document = await this.findOne(id, user);
    if (!fs.existsSync(document.path)) {
      throw new NotFoundException('Source file not found on disk');
    }

    const outPath = await this.searchablePdfService.generateFromFile(
      document.id,
      document.path,
      document.mimetype,
      { force: opts.regenerate === true },
    );

    return {
      stream: fs.createReadStream(outPath),
      mimetype: 'application/pdf',
      filename: this.searchablePdfFilename(document.originalName),
    };
  }

  private searchablePdfFilename(originalName: string): string {
    const base = originalName.replace(/\.[^.]+$/, '');
    return `${base}.searchable.pdf`;
  }

  // ─────────────────────────────────────────────────────────────
  // CRUD
  // ─────────────────────────────────────────────────────────────

  async uploadDocument(file: Express.Multer.File, claimId?: string, branchName?: string) {
    const document = await this.prisma.document.create({
      data: {
        filename: file.filename,
        originalName: file.originalname,
        mimetype: file.mimetype,
        size: BigInt(file.size),
        path: file.path,
        claimId: claimId || null,
      },
    });

    await this.ocrService.processDocument(document.id, file.path, file.mimetype);

    // Async batch file dump — non-blocking, failures are logged but don't affect response
    if (claimId) {
      this.dumpBatchFile(file, claimId, branchName).catch((err) =>
        this.logger.warn(`Batch file dump failed for document ${document.id}: ${err?.message}`),
      );
    }

    return document;
  }

  /** Dump PDF + companion XML to the structured folder hierarchy. */
  private async dumpBatchFile(
    file: Express.Multer.File,
    claimId: string,
    branchName?: string,
  ): Promise<void> {
    const claim = await this.prisma.claim.findUnique({
      where: { id: claimId },
      include: { provider: true },
    });
    if (!claim) return;

    // Do not dump files for claims under fraud investigation. They stay only
    // in the claim record until the fraud team either clears or confirms fraud.
    // On clear, dumpByClaimId() is called to write the files retrospectively.
    if (claim.status === 'fraud_hold') {
      this.logger.log(
        `Skipping batch dump for claim ${claimId} — on fraud hold`,
      );
      return;
    }

    const providerName = claim.provider?.name || 'Unknown Provider';
    const branch = branchName || 'Main Branch';
    const barcode = claim.barcode || claim.claimNumber;

    // Batch folder name: batchNumber + date of upload (ISO date)
    const uploadDate = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const rawBatchNum = claim.batchNumber || 'SINGLE';
    const batchFolder = `${rawBatchNum}_${uploadDate}`;

    // Sanitise each path segment — strip characters not safe for filenames
    const sanitise = (s: string) =>
      s.replace(/[^\w\s\-().]/g, '_').replace(/\s+/g, '_').slice(0, 80);

    const dumpDir = path.join(
      DUMP_ROOT,
      sanitise(branch),
      sanitise(providerName),
      sanitise(batchFolder),
    );
    fs.mkdirSync(dumpDir, { recursive: true });

    // ── Copy PDF (or image) as {barcode}.{ext} ───────────────────
    const ext = path.extname(file.originalname).toLowerCase() || '.pdf';
    const pdfDest = path.join(dumpDir, `${sanitise(barcode)}${ext}`);
    fs.copyFileSync(file.path, pdfDest);

    // ── Count pages for XML ──────────────────────────────────────
    let pageCount = 1;
    if (file.mimetype === 'application/pdf') {
      try {
        const buf = fs.readFileSync(file.path);
        const parsed = await pdfParse(buf);
        pageCount = parsed.numpages || 1;
      } catch {
        pageCount = 1;
      }
    }

    // ── Write companion XML with all claim fields ────────────────
    const xmlDest = path.join(dumpDir, `${sanitise(barcode)}.xml`);

    const x = (v: any) => this.escapeXml(v != null ? String(v) : '');
    const fmtDate = (d: any) => d ? new Date(d).toISOString().slice(0, 10) : '';

    const fields: Array<{ level: string; name: string; value: string }> = [
      // Batch-level
      { level: 'batch', name: 'Client Name',        value: x(providerName) },
      { level: 'batch', name: 'Policy Number',      value: x(claim.memberNumber) },
      { level: 'batch', name: 'Batch Number',       value: x(claim.batchNumber) },
      { level: 'batch', name: 'Upload Date',        value: x(uploadDate) },
      // Patient
      { level: 'patient', name: 'Full Name',        value: x(claim.memberName || claim.patientName) },
      { level: 'patient', name: 'Patient ID',       value: x(claim.patientId) },
      { level: 'patient', name: 'Member Number',    value: x(claim.memberNumber) },
      // Document
      { level: 'document', name: 'Document Type',   value: 'Application' },
      { level: 'document', name: 'Barcode',         value: x(claim.barcode) },
      { level: 'document', name: 'Claim Number',    value: x(claim.claimNumber) },
      { level: 'document', name: 'Folio Number',    value: x(claim.folioNumber) },
      // Invoice
      { level: 'invoice', name: 'Invoice Number',   value: x(claim.invoiceNumber) },
      { level: 'invoice', name: 'Invoice Date',     value: x(fmtDate(claim.invoiceDate)) },
      { level: 'invoice', name: 'Total Amount',     value: x(claim.invoiceAmount) },
      { level: 'invoice', name: 'Service Date',     value: x(fmtDate(claim.dateOfService)) },
      // Medical
      { level: 'medical', name: 'Diagnosis',        value: x(claim.diagnosis) },
      { level: 'medical', name: 'ICD Code',         value: x((claim.procedureCodes as string[] | null)?.[0]) },
      { level: 'medical', name: 'Procedure Code',   value: x((claim.procedureCodes as string[] | null)?.[1]) },
      { level: 'medical', name: 'Treatment',        value: x(claim.treatment) },
      // System
      { level: 'system', name: 'Image count in document', value: String(pageCount) },
      { level: 'system', name: 'OCR Confidence',    value: claim.ocrConfidence != null ? `${Math.round(claim.ocrConfidence * 100)}%` : '' },
      { level: 'system', name: 'Claim Status',      value: x(claim.status) },
      { level: 'system', name: 'Workflow Stage',    value: x(claim.workflowStage) },
      { level: 'system', name: 'Priority',          value: x(claim.priority) },
    ];

    const fieldLines = fields
      .map(f => `  <field level="${f.level}" name="${f.name}" value="${f.value}"/>`)
      .join('\n');

    const xml = `<?xml version="1.0" encoding="utf-8"?>\n<root>\n<document>\n${fieldLines}\n</document>\n</root>`;
    fs.writeFileSync(xmlDest, xml, 'utf-8');

    this.logger.log(
      `Batch dump: ${pdfDest} + XML (${pageCount} page${pageCount !== 1 ? 's' : ''})`,
    );
  }

  /**
   * Replay the batch dump for every document linked to a claim.
   * Called by the fraud workflow after a fraud-hold is cleared — the original
   * upload skipped the dump, so we do it now from the files on disk.
   */
  async dumpHeldClaimDocuments(claimId: string, branchName?: string): Promise<void> {
    const docs = await this.prisma.document.findMany({ where: { claimId } });
    for (const doc of docs) {
      if (!fs.existsSync(doc.path)) {
        this.logger.warn(`Cannot dump ${doc.id}: file missing on disk at ${doc.path}`);
        continue;
      }
      const reconstructed = {
        path: doc.path,
        originalname: doc.originalName,
        mimetype: doc.mimetype,
        filename: doc.filename,
        size: Number(doc.size),
      } as Express.Multer.File;
      try {
        await this.dumpBatchFile(reconstructed, claimId, branchName);
      } catch (err: any) {
        this.logger.warn(`Retroactive dump failed for ${doc.id}: ${err?.message}`);
      }
    }
  }

  private escapeXml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Reject access when the caller is a provider_* role and the document's
   * parent claim belongs to a different provider. CIC staff are unaffected.
   */
  private async assertProviderCanAccessDocument(
    documentId: string,
    user?: { role?: string | null; providerId?: string | null; branchId?: string | null; tenantId?: string | null },
  ) {
    if (!user?.role) return;
    if (user.role !== 'provider_admin' && user.role !== 'provider_user') return;
    if (!user.providerId) throw new ForbiddenException('Access denied');
    const doc = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: {
        providerId: true,
        tenantId: true,
        claim: { select: { providerId: true, branchId: true, tenantId: true, createdBy: true } },
      },
    });
    if (!doc) throw new NotFoundException(`Document ${documentId} not found`);
    // Resolve the document's owning provider: prefer the parent claim's provider,
    // fall back to the document's own providerId (for provider-attached files
    // like registration certificates).
    const ownerProviderId = doc.claim?.providerId ?? doc.providerId ?? null;
    if (!ownerProviderId || ownerProviderId !== user.providerId) {
      throw new ForbiddenException('Access denied');
    }
    if (user.role === 'provider_user' && user.branchId && doc.claim) {
      if (doc.claim.branchId && doc.claim.branchId !== user.branchId) {
        throw new ForbiddenException('Access denied');
      }
    }
    // Phase 4 — tenant scoping (additive). When caller has a tenantId, the
    // document or its parent claim must share it (legacy NULL tenantId rows
    // are still allowed so single-org behaviour is unchanged).
    if (user.tenantId) {
      const docTenant = doc.tenantId ?? doc.claim?.tenantId ?? null;
      if (docTenant && docTenant !== user.tenantId) {
        throw new ForbiddenException('Access denied');
      }
    }
  }

  async findAll(
    claimId?: string,
    limit: number = 50,
    offset: number = 0,
    user?: { role?: string | null; providerId?: string | null; branchId?: string | null; tenantId?: string | null },
  ) {
    const where: any = claimId ? { claimId } : {};

    // Force provider-scope for provider_* roles regardless of claimId filter.
    if (user?.role === 'provider_admin' || user?.role === 'provider_user') {
      if (!user.providerId) return { documents: [], total: 0 };
      where.claim = { providerId: user.providerId };
      if (user.role === 'provider_user' && user.branchId) {
        where.claim = { ...where.claim, OR: [{ branchId: user.branchId }, { branchId: null }] };
      }
    }

    // Phase 4 — additive tenant scoping. Only applied when the caller has a
    // tenantId; otherwise the query is unchanged so legacy single-org users
    // continue to see all rows.
    const ts = tenantScope(user);
    if (ts.tenantId) {
      where.OR = [
        { tenantId: ts.tenantId },
        { tenantId: null },              // legacy rows with no tenantId yet
      ];
    }

    const [documents, total] = await Promise.all([
      this.prisma.document.findMany({
        where,
        include: {
          annotations: true,
          claim: { select: { claimNumber: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.document.count({ where }),
    ]);
    return { documents, total };
  }

  async findOne(
    id: string,
    user?: { role?: string | null; providerId?: string | null; branchId?: string | null; tenantId?: string | null },
  ) {
    await this.assertProviderCanAccessDocument(id, user);
    const document = await this.prisma.document.findUnique({
      where: { id },
      include: { claim: true, annotations: true, versions: true },
    });

    if (!document) throw new NotFoundException(`Document ${id} not found`);

    // Phase 4 — tenant scoping. When the caller has a tenantId, the document
    // (or its parent claim) must match. Documents/claims with NULL tenantId
    // are legacy data — let them through so single-org behaviour is unchanged.
    if (user?.tenantId) {
      const docTenant = document.tenantId ?? document.claim?.tenantId ?? null;
      if (docTenant && docTenant !== user.tenantId) {
        throw new ForbiddenException('Access denied');
      }
    }

    return document;
  }

  async getFileStream(
    id: string,
    user?: { role?: string | null; providerId?: string | null; branchId?: string | null },
  ) {
    const document = await this.findOne(id, user);
    if (!fs.existsSync(document.path)) throw new NotFoundException('File not found on disk');
    return {
      stream: fs.createReadStream(document.path),
      mimetype: document.mimetype,
      filename: document.originalName,
    };
  }

  async remove(id: string) {
    const document = await this.findOne(id);
    if (fs.existsSync(document.path)) fs.unlinkSync(document.path);
    await this.prisma.document.delete({ where: { id } });
    return { message: 'Document deleted successfully' };
  }

  async getOcrText(
    id: string,
    user?: { role?: string | null; providerId?: string | null; branchId?: string | null },
  ) {
    const document = await this.findOne(id, user);
    if (!document.ocrText) throw new NotFoundException('OCR text not available yet');
    return { documentId: id, ocrText: document.ocrText, ocrStatus: document.ocrStatus };
  }

  // ─────────────────────────────────────────────────────────────
  // Merge / Split
  // ─────────────────────────────────────────────────────────────

  async mergeDocuments(
    documentIds: string[],
    outputName: string,
    claimId: string,
    requestedBy: string,
  ) {
    if (documentIds.length < 2) throw new BadRequestException('At least 2 documents required for merge');

    const docs = await Promise.all(documentIds.map((id) => this.findOne(id)));
    const pdfPaths = docs.map((d) => d.path).filter((p) => fs.existsSync(p));

    if (pdfPaths.length === 0) throw new BadRequestException('No accessible PDF files found');

    const uploadDir = path.join(process.cwd(), 'uploads', 'documents');
    fs.mkdirSync(uploadDir, { recursive: true });
    const outputPath = path.join(uploadDir, `${Date.now()}_merged_${outputName}`);

    await this.pdfOperationsService.mergePdfs(pdfPaths, outputPath);

    const stats = fs.statSync(outputPath);
    const mergedDoc = await this.prisma.document.create({
      data: {
        filename: path.basename(outputPath),
        originalName: outputName,
        mimetype: 'application/pdf',
        size: BigInt(stats.size),
        path: outputPath,
        claimId,
        documentType: 'merged',
        version: 1,
        isLatestVersion: true,
        metadata: { mergedFrom: documentIds, mergedBy: requestedBy },
      },
    });

    // Create purge request for source documents
    const purgeRequest = await this.prisma.purgeRequest.create({
      data: {
        mergedDocumentId: mergedDoc.id,
        sourceDocumentIds: documentIds,
        reason: `Merged into ${outputName}`,
        requestedBy,
        status: 'pending',
      },
    });

    // Create version records for source docs
    for (const doc of docs) {
      await this.prisma.documentVersion.create({
        data: {
          documentId: doc.id,
          version: (doc.version || 1),
          changeType: 'merge',
          changeDescription: `Merged into ${mergedDoc.id}`,
          filePath: doc.path,
          fileSize: doc.size,
          createdBy: requestedBy,
        },
      });
    }

    return { mergedDocument: mergedDoc, purgeRequest };
  }

  async splitDocument(
    documentId: string,
    pageRanges: Array<{ start: number; end: number; name: string; documentType?: string }>,
    requestedBy: string,
  ) {
    const doc = await this.findOne(documentId);
    if (!fs.existsSync(doc.path)) throw new NotFoundException('File not found on disk');

    const uploadDir = path.join(process.cwd(), 'uploads', 'documents');
    fs.mkdirSync(uploadDir, { recursive: true });

    const outputDocs: any[] = [];

    for (let i = 0; i < pageRanges.length; i++) {
      const range = pageRanges[i];
      const outputName = `${range.name || `split_part_${i + 1}`}.pdf`;
      const outputPath = path.join(uploadDir, `${Date.now()}_${i}_${outputName}`);

      await this.pdfOperationsService.splitPdf(doc.path, [{
        start: range.start,
        end: range.end,
        outputPath,
      }]);

      if (fs.existsSync(outputPath)) {
        const stats = fs.statSync(outputPath);
        const splitDoc = await this.prisma.document.create({
          data: {
            filename: path.basename(outputPath),
            originalName: outputName,
            mimetype: 'application/pdf',
            size: BigInt(stats.size),
            path: outputPath,
            claimId: doc.claimId,
            documentType: range.documentType || doc.documentType,
            version: 1,
            isLatestVersion: true,
            metadata: { splitFrom: documentId, pages: `${range.start}-${range.end}` },
          },
        });
        outputDocs.push(splitDoc);
      }
    }

    // Create version record
    await this.prisma.documentVersion.create({
      data: {
        documentId: doc.id,
        version: doc.version || 1,
        changeType: 'split',
        changeDescription: `Split into ${pageRanges.length} parts`,
        filePath: doc.path,
        fileSize: doc.size,
        createdBy: requestedBy,
      },
    });

    return { splitDocuments: outputDocs, sourceDocumentId: documentId };
  }

  // ─────────────────────────────────────────────────────────────
  // AI page analysis / categorization
  // ─────────────────────────────────────────────────────────────

  async analyzeDocumentPages(documentId: string, _userId: string) {
    const doc = await this.findOne(documentId);
    if (!fs.existsSync(doc.path)) throw new NotFoundException('File not found on disk');
    if (doc.mimetype !== 'application/pdf') {
      // For images return a single-segment result
      return {
        segments: [{
          start: 1, end: 1,
          documentType: doc.documentType || 'medical_report',
          label: doc.originalName,
          confidence: 1.0,
          notes: 'Single-page image document',
        }],
        totalPages: 1,
      };
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new BadRequestException('AI provider not configured');

    const client = new Anthropic({ apiKey });
    const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';

    const b64 = fs.readFileSync(doc.path).toString('base64');

    const PAGE_ANALYSIS_TOOL: Anthropic.Tool = {
      name: 'categorize_document_pages',
      description: 'Identify distinct document sections within the PDF and suggest where to split it.',
      input_schema: {
        type: 'object',
        properties: {
          totalPages: { type: 'number', description: 'Total number of pages in the document' },
          segments: {
            type: 'array',
            description: 'Consecutive page segments, each representing one document type. Must be non-overlapping and cover all pages.',
            items: {
              type: 'object',
              properties: {
                start:        { type: 'number', description: 'First page of this segment (1-indexed)' },
                end:          { type: 'number', description: 'Last page of this segment (1-indexed, inclusive)' },
                documentType: {
                  type: 'string',
                  enum: ['invoice', 'lab_result', 'prescription', 'discharge_summary', 'medical_report', 'claim_form', 'pre_auth', 'referral', 'supporting'],
                  description: 'Document category',
                },
                label:        { type: 'string', description: 'Short descriptive label, e.g. "Hospital Invoice - Aga Khan" or "Lab Results - CBC"' },
                confidence:   { type: 'number', description: 'Your confidence 0.0–1.0 for this segment classification' },
                notes:        { type: 'string', description: 'Optional notes about what was found (provider name, patient, totals, etc.)' },
              },
              required: ['start', 'end', 'documentType', 'label', 'confidence'],
            },
          },
        },
        required: ['totalPages', 'segments'],
      },
    };

    const resp = await client.messages.create({
      model,
      max_tokens: 1024,
      tools: [PAGE_ANALYSIS_TOOL],
      tool_choice: { type: 'tool', name: 'categorize_document_pages' },
      messages: [{
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: b64 },
          } as any,
          {
            type: 'text',
            text: `This is a Kenyan medical insurance claim document. Analyze ALL pages carefully and identify each distinct document section (e.g. hospital invoice, lab results, prescription, discharge summary, claim form, pre-authorization, referral letter, supporting documents).

Group consecutive pages that belong to the same document into one segment. A single PDF often contains:
- One or more hospital/pharmacy invoices (itemized billing sheets)
- Lab or radiology result pages
- A claim form (filled by the patient or hospital)
- A discharge summary or admission sheet
- Prescriptions
- Referral or pre-authorization letters

Return ALL segments so that together they cover every page with no gaps or overlaps. List them in page order.`,
          },
        ],
      }],
    });

    const toolResult = resp.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    if (!toolResult) throw new BadRequestException('AI did not return page analysis');

    const result = toolResult.input as { totalPages: number; segments: any[] };
    this.logger.log(`Page analysis for ${documentId}: ${result.segments.length} segment(s) across ${result.totalPages} pages`);
    return result;
  }

  // ─────────────────────────────────────────────────────────────
  // Purge workflow
  // ─────────────────────────────────────────────────────────────

  async getPendingPurgeRequests() {
    return this.prisma.purgeRequest.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'desc' },
    });
  }

  async approvePurgeRequest(purgeRequestId: string, reviewedBy: string, notes?: string) {
    const request = await this.prisma.purgeRequest.findUnique({ where: { id: purgeRequestId } });
    if (!request) throw new NotFoundException('Purge request not found');
    if (request.status !== 'pending') throw new BadRequestException('Purge request is not pending');

    // Execute purge
    const sourceIds = request.sourceDocumentIds as string[];
    let purgedCount = 0;

    for (const docId of sourceIds) {
      try {
        const doc = await this.prisma.document.findUnique({ where: { id: docId } });
        if (doc) {
          // Delete file from disk
          if (fs.existsSync(doc.path)) fs.unlinkSync(doc.path);
          // Soft-delete: mark as purged rather than hard delete to preserve audit trail
          await this.prisma.document.update({
            where: { id: docId },
            data: {
              isLatestVersion: false,
              metadata: { ...(doc.metadata as any || {}), purgedAt: new Date().toISOString(), purgedBy: reviewedBy },
            },
          });
          purgedCount++;
        }
      } catch { /* continue */ }
    }

    return this.prisma.purgeRequest.update({
      where: { id: purgeRequestId },
      data: {
        status: 'approved',
        reviewedBy,
        reviewedAt: new Date(),
        reviewNotes: notes,
        executedAt: new Date(),
        purgedCount,
      },
    });
  }

  async rejectPurgeRequest(purgeRequestId: string, reviewedBy: string, notes: string) {
    const request = await this.prisma.purgeRequest.findUnique({ where: { id: purgeRequestId } });
    if (!request) throw new NotFoundException('Purge request not found');
    if (request.status !== 'pending') throw new BadRequestException('Purge request is not pending');

    return this.prisma.purgeRequest.update({
      where: { id: purgeRequestId },
      data: { status: 'rejected', reviewedBy, reviewedAt: new Date(), reviewNotes: notes },
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Annotations (role-based with audit trails)
  // ─────────────────────────────────────────────────────────────

  // Annotation type permissions per role
  private readonly annotationPermissions: Record<string, string[]> = {
    admin: ['stamp', 'redaction', 'highlight', 'comment', 'signature', 'drawing', 'whiteout', 'underline', 'strikethrough'],
    // The maker_checker is the document-QA owner under the new role layout —
    // they get every annotation type the old `supervisor` role had.
    maker_checker: ['stamp', 'redaction', 'highlight', 'comment', 'signature', 'drawing', 'whiteout', 'underline', 'strikethrough'],
    claims_officer: ['stamp', 'highlight', 'comment', 'signature', 'drawing', 'underline', 'strikethrough'],
    fraud_officer: ['highlight', 'comment', 'redaction'],
    finance: ['comment'],
    provider_admin: ['comment'],
    provider_user: ['comment'],
    user: [],
  };

  async getAnnotations(documentId: string, user: { userId: string; role: string }) {
    await this.findOne(documentId);
    const annotations = await this.prisma.documentAnnotation.findMany({
      where: { documentId },
      orderBy: { createdAt: 'asc' },
    });

    // Provider users can only see their own annotations and non-redacted annotations
    if (user.role === 'provider_admin' || user.role === 'provider_user') {
      return annotations.filter(a => a.type !== 'redaction' || a.createdBy === user.userId);
    }

    return annotations;
  }

  async createAnnotation(
    documentId: string,
    annotation: {
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
    user: { userId: string; role: string; name: string },
  ) {
    await this.findOne(documentId);

    // Check role permission for annotation type
    const allowed = this.annotationPermissions[user.role] || [];
    if (!allowed.includes(annotation.type)) {
      throw new ForbiddenException(
        `Role '${user.role}' cannot create '${annotation.type}' annotations`,
      );
    }

    const ann = await this.prisma.documentAnnotation.create({
      data: {
        documentId,
        type: annotation.type,
        pageNumber: annotation.pageNumber,
        x: annotation.x,
        y: annotation.y,
        width: annotation.width,
        height: annotation.height,
        content: annotation.content,
        color: annotation.color,
        signatureData: annotation.signatureData,
        signerName: annotation.signerName || user.name,
        signedAt: annotation.signatureData ? new Date() : null,
        createdBy: user.userId,
      },
    });

    // Update document annotation count
    await this.prisma.document.update({
      where: { id: documentId },
      data: {
        hasAnnotations: true,
        annotationsCount: { increment: 1 },
      },
    });

    // Audit trail
    await this.prisma.activityLog.create({
      data: {
        action: 'annotation_created',
        entity: 'document_annotation',
        entityId: ann.id,
        userId: user.userId,
        username: user.name,
        userRole: user.role,
        status: 'success',
        newValue: {
          documentId,
          type: annotation.type,
          pageNumber: annotation.pageNumber,
          content: annotation.content,
        },
      },
    });

    return ann;
  }

  async updateAnnotation(
    documentId: string,
    annotationId: string,
    updates: {
      content?: string;
      color?: string;
      x?: number;
      y?: number;
      width?: number;
      height?: number;
    },
    user: { userId: string; role: string; name: string },
  ) {
    const ann = await this.prisma.documentAnnotation.findUnique({ where: { id: annotationId } });
    if (!ann || ann.documentId !== documentId) throw new NotFoundException('Annotation not found');

    // Only the creator, maker_checkers, or admins can edit
    if (ann.createdBy !== user.userId && !['admin', 'maker_checker'].includes(user.role)) {
      throw new ForbiddenException('You can only edit your own annotations');
    }

    const oldValue = { content: ann.content, color: ann.color, x: ann.x, y: ann.y };

    const updated = await this.prisma.documentAnnotation.update({
      where: { id: annotationId },
      data: {
        ...(updates.content !== undefined && { content: updates.content }),
        ...(updates.color !== undefined && { color: updates.color }),
        ...(updates.x !== undefined && { x: updates.x }),
        ...(updates.y !== undefined && { y: updates.y }),
        ...(updates.width !== undefined && { width: updates.width }),
        ...(updates.height !== undefined && { height: updates.height }),
      },
    });

    // Audit trail
    await this.prisma.activityLog.create({
      data: {
        action: 'annotation_updated',
        entity: 'document_annotation',
        entityId: annotationId,
        userId: user.userId,
        username: user.name,
        userRole: user.role,
        status: 'success',
        oldValue,
        newValue: updates,
      },
    });

    return updated;
  }

  async deleteAnnotation(
    documentId: string,
    annotationId: string,
    user: { userId: string; role: string; name: string },
  ) {
    const ann = await this.prisma.documentAnnotation.findUnique({ where: { id: annotationId } });
    if (!ann || ann.documentId !== documentId) throw new NotFoundException('Annotation not found');

    // Signatures can only be deleted by signer or admin
    if (ann.type === 'signature' && ann.createdBy !== user.userId && user.role !== 'admin') {
      throw new ForbiddenException('Only the signer or an admin can remove signatures');
    }

    // Other annotations: only creator, maker_checkers, or admins can delete
    if (ann.createdBy !== user.userId && !['admin', 'maker_checker'].includes(user.role)) {
      throw new ForbiddenException('You can only delete your own annotations');
    }

    await this.prisma.documentAnnotation.delete({ where: { id: annotationId } });

    const remaining = await this.prisma.documentAnnotation.count({ where: { documentId } });
    await this.prisma.document.update({
      where: { id: documentId },
      data: {
        hasAnnotations: remaining > 0,
        annotationsCount: remaining,
      },
    });

    // Audit trail
    await this.prisma.activityLog.create({
      data: {
        action: 'annotation_deleted',
        entity: 'document_annotation',
        entityId: annotationId,
        userId: user.userId,
        username: user.name,
        userRole: user.role,
        status: 'success',
        oldValue: {
          documentId,
          type: ann.type,
          pageNumber: ann.pageNumber,
          content: ann.content,
          createdBy: ann.createdBy,
        },
      },
    });

    return { message: 'Annotation removed' };
  }

  // ─────────────────────────────────────────────────────────────
  // EDMS sync status
  // ─────────────────────────────────────────────────────────────

  async getEdmsSyncStatus(documentId: string) {
    const doc = await this.findOne(documentId);
    if (!doc.claimId) return { synced: false, status: 'no_claim' };
    return this.edmsService.getSyncStatus(doc.claimId);
  }

  async triggerEdmsSync(documentId: string) {
    return this.edmsService.uploadDocument(documentId);
  }
}
