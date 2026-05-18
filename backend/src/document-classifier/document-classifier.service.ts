import { Injectable, NotFoundException, Logger, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTemplateDto } from './create-template.dto';
import { CreateZoneDto } from './create-zone.dto';
import { UnknownDocumentService } from './unknown-document.service';
import { GeminiClassifierService } from './gemini-classifier.service';
import { PdfOperationsService } from '../common/services/pdf-operations.service';
import * as fs from 'fs';
import * as path from 'path';
import Anthropic from '@anthropic-ai/sdk';

// Default fieldName → claim model field mapping (overridden per-zone by zone.claimField)
const IMPLICIT_CLAIM_FIELD: Record<string, string> = {
  patient_name:             'patientName',
  patient_id:               'patientId',
  membership_number:        'memberNumber',
  invoice_number:           'invoiceNumber',
  invoice_date:             'invoiceDate',
  invoice_amount:           'invoiceAmount',
  total_billed:             'invoiceAmount',
  provider_name:            'providerName',
  provider_branch:          'providerBranch',
  diagnosis:                'diagnosis',
  diagnosis_code:           'diagnosisCode',
  treatment:                'treatment',
  service_date:             'dateOfService',
  admission_date:           'admissionDate',
  discharge_date:           'dateOfService',
  account_name:             'memberNumber',
  account_number:           'memberNumber',
  policy_number:            'policyNumber',
  insurance_company:        'providerName',
  gender:                   'gender',
  sponsor_coverage:         'sponsorCoverage',
  patient_payable:          'patientPayable',
  nhif_notification_number: 'nhifNumber',
  ak_number:                'memberNumber',
};

@Injectable()
export class DocumentClassifierService {
  private readonly logger = new Logger(DocumentClassifierService.name);
  private client: Anthropic | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly unknownDocService: UnknownDocumentService,
    private readonly gemini: GeminiClassifierService,
    private readonly pdfOps: PdfOperationsService,
  ) {}

  // ── Provider selection ────────────────────────────────────────────────────────

  getActiveProvider(): 'anthropic' | 'gemini' {
    const pref = (process.env.CLASSIFIER_AI_PROVIDER || 'auto').toLowerCase();
    if (pref === 'gemini')     return 'gemini';
    if (pref === 'anthropic')  return 'anthropic';
    // auto: prefer Anthropic if key present, else Gemini
    if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
    if (process.env.GEMINI_API_KEY)    return 'gemini';
    return 'anthropic';
  }

  getProviderStatus() {
    return {
      active:         this.getActiveProvider(),
      anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
      geminiModel:    process.env.GEMINI_MODEL    || 'gemini-2.5-flash',
      anthropic: { available: !!process.env.ANTHROPIC_API_KEY },
      gemini:    { available: !!process.env.GEMINI_API_KEY },
    };
  }

  private getClient(): Anthropic | null {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) return null;
    if (!this.client) this.client = new Anthropic({ apiKey: key });
    return this.client;
  }

  // ── Template CRUD ───────────────────────────────────────────────────────────

  async findAll() {
    const templates = await this.prisma.ocrTemplate.findMany({
      include: {
        _count: { select: { zones: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return templates.map((t) => ({
      ...t,
      zoneCount: t._count.zones,
    }));
  }

  async findOne(id: string) {
    const template = await this.prisma.ocrTemplate.findUnique({
      where: { id },
      include: { zones: { orderBy: { createdAt: 'asc' } } },
    });
    if (!template) throw new NotFoundException(`Template ${id} not found`);
    return template;
  }

  async create(dto: CreateTemplateDto, file?: Express.Multer.File) {
    const data: any = {
      name: dto.name,
      documentType: dto.documentType,
      description: dto.description,
      providerType: dto.providerType,
      specificProvider: dto.specificProvider,
      fieldDefinitions: {},
    };

    if (file) {
      data.sampleFilePath = file.path;
      data.sampleFileName = file.originalname;
    }

    return this.prisma.ocrTemplate.create({ data });
  }

  async update(id: string, dto: Partial<CreateTemplateDto>) {
    await this.findOne(id);
    return this.prisma.ocrTemplate.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.documentType !== undefined && { documentType: dto.documentType }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.providerType !== undefined && { providerType: dto.providerType }),
        ...(dto.specificProvider !== undefined && { specificProvider: dto.specificProvider }),
      },
    });
  }

  async delete(id: string) {
    const template = await this.findOne(id);
    // Remove sample file if present
    if (template.sampleFilePath && fs.existsSync(template.sampleFilePath)) {
      try { fs.unlinkSync(template.sampleFilePath); } catch (_) {}
    }
    return this.prisma.ocrTemplate.delete({ where: { id } });
  }

  // ── Zone CRUD ────────────────────────────────────────────────────────────────

  async addZone(templateId: string, dto: CreateZoneDto) {
    await this.findOne(templateId);
    return this.prisma.documentZone.create({
      data: {
        templateId,
        fieldName:       dto.fieldName,
        fieldLabel:      dto.fieldLabel,
        description:     dto.description,
        locationContext: dto.locationContext,
        searchPhrase:    dto.searchPhrase,
        claimField:      dto.claimField,
        pageNumber:      dto.pageNumber ?? 1,
        xPercent:        dto.xPercent,
        yPercent:        dto.yPercent,
        widthPercent:    dto.widthPercent,
        heightPercent:   dto.heightPercent,
        parentZoneId:    dto.parentZoneId,
        updatedAt:       new Date(),
        updatedByName:   dto.updatedByName,
      },
    });
  }

  async updateZone(zoneId: string, dto: Partial<CreateZoneDto>) {
    const zone = await this.prisma.documentZone.findUnique({ where: { id: zoneId } });
    if (!zone) throw new NotFoundException(`Zone ${zoneId} not found`);
    return this.prisma.documentZone.update({
      where: { id: zoneId },
      data: {
        ...(dto.fieldName        !== undefined && { fieldName:       dto.fieldName }),
        ...(dto.fieldLabel       !== undefined && { fieldLabel:      dto.fieldLabel }),
        ...(dto.description      !== undefined && { description:     dto.description }),
        ...(dto.locationContext  !== undefined && { locationContext: dto.locationContext }),
        ...(dto.searchPhrase     !== undefined && { searchPhrase:    dto.searchPhrase }),
        ...(dto.claimField       !== undefined && { claimField:      dto.claimField }),
        ...(dto.xPercent         !== undefined && { xPercent:        dto.xPercent }),
        ...(dto.yPercent         !== undefined && { yPercent:        dto.yPercent }),
        ...(dto.widthPercent     !== undefined && { widthPercent:    dto.widthPercent }),
        ...(dto.heightPercent    !== undefined && { heightPercent:   dto.heightPercent }),
        ...(dto.parentZoneId     !== undefined && { parentZoneId:    dto.parentZoneId || null }),
        updatedAt:    new Date(),
        updatedByName: dto.updatedByName,
      },
    });
  }

  async deleteZone(zoneId: string) {
    const zone = await this.prisma.documentZone.findUnique({ where: { id: zoneId } });
    if (!zone) throw new NotFoundException(`Zone ${zoneId} not found`);
    return this.prisma.documentZone.delete({ where: { id: zoneId } });
  }

  // ── Shared helper ────────────────────────────────────────────────────────────

  private buildDocBlock(filePath: string, mimetype?: string): Anthropic.ContentBlockParam {
    const b64 = fs.readFileSync(filePath).toString('base64');
    const isPdf = mimetype === 'application/pdf' || filePath.endsWith('.pdf');
    return isPdf
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }
      : { type: 'image', source: { type: 'base64', media_type: (mimetype as any) || 'image/jpeg', data: b64 } };
  }

  private rethrowAnthropicError(err: any, context: string): never {
    const body = err?.error?.error ?? err?.error ?? {};
    const msg: string = body.message ?? err?.message ?? 'Anthropic API error';
    this.logger.error(`${context}: ${msg}`);
    if (msg.toLowerCase().includes('credit') || msg.toLowerCase().includes('billing') || msg.toLowerCase().includes('balance')) {
      throw new ServiceUnavailableException('Anthropic API credits exhausted. Please top up your balance at console.anthropic.com → Plans & Billing.');
    }
    if (err?.status === 429) {
      throw new ServiceUnavailableException('Anthropic API rate limit reached. Please try again in a moment.');
    }
    throw new BadRequestException(`AI processing failed: ${msg}`);
  }

  // ── Zone OCR with confidence ──────────────────────────────────────────────────

  async ocrZone(
    templateId: string,
    zoneId: string,
  ): Promise<{ text: string; confidence: number; reasoning: string }> {
    const template = await this.findOne(templateId);
    const zone = template.zones.find((z) => z.id === zoneId);
    if (!zone) throw new NotFoundException(`Zone ${zoneId} not found`);

    if (!template.sampleFilePath || !fs.existsSync(template.sampleFilePath)) {
      throw new NotFoundException('No sample file available for OCR');
    }

    if (this.getActiveProvider() === 'gemini') {
      return this.gemini.ocrZone({
        filePath:     template.sampleFilePath,
        fieldLabel:   zone.fieldLabel,
        xPercent:     zone.xPercent,
        yPercent:     zone.yPercent,
        widthPercent: zone.widthPercent,
        heightPercent:zone.heightPercent,
        searchPhrase: zone.searchPhrase,
        description:  zone.description,
      });
    }

    const client = this.getClient();
    if (!client) return { text: '', confidence: 0, reasoning: 'API key not configured' };

    if (!template.sampleFilePath || !fs.existsSync(template.sampleFilePath)) {
      throw new NotFoundException('No sample file available for OCR');
    }

    const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
    const docBlock = this.buildDocBlock(template.sampleFilePath);

    const ocrTool: Anthropic.Tool = {
      name: 'extract_field_value',
      description: 'Extract a field value from a specific region of the document.',
      input_schema: {
        type: 'object' as const,
        properties: {
          value:      { type: 'string', description: 'The extracted text, exactly as it appears. Empty string if not found.' },
          confidence: { type: 'number', description: 'Extraction confidence from 0.0 (uncertain) to 1.0 (certain).' },
          reasoning:  { type: 'string', description: 'One sentence explaining what you found and why you are confident.' },
        },
        required: ['value', 'confidence', 'reasoning'],
      },
    };

    const prompt = `Extract the "${zone.fieldLabel}" field from this document.

Zone location (% of document dimensions):
  Left: ${zone.xPercent.toFixed(1)}%  Top: ${zone.yPercent.toFixed(1)}%
  Width: ${zone.widthPercent.toFixed(1)}%  Height: ${zone.heightPercent.toFixed(1)}%
${zone.searchPhrase ? `Look for text near or matching: "${zone.searchPhrase}"` : ''}
${zone.description ? `Extraction hint: ${zone.description}` : ''}

Return the raw value only (no labels). Score your confidence honestly.`;

    let resp: Awaited<ReturnType<typeof client.messages.create>>;
    try {
      resp = await client.messages.create({
        model,
        max_tokens: 512,
        tools: [ocrTool],
        tool_choice: { type: 'tool', name: 'extract_field_value' },
        messages: [{ role: 'user', content: [docBlock, { type: 'text', text: prompt }] }],
      });
    } catch (err) { this.rethrowAnthropicError(err, 'ocrZone'); }

    const toolUse = resp!.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    const input   = (toolUse?.input as any) ?? {};
    const text       = String(input.value      ?? '').trim();
    const confidence = Math.min(1, Math.max(0, Number(input.confidence ?? 0)));
    const reasoning  = String(input.reasoning  ?? '');

    this.logger.log(`Zone OCR "${zone.fieldLabel}": "${text.substring(0, 60)}" (conf=${confidence.toFixed(2)})`);
    return { text, confidence, reasoning };
  }

  // ── Auto-suggest zones from sample document ───────────────────────────────────

  async suggestZones(templateId: string): Promise<Array<{
    fieldName: string; fieldLabel: string; description: string; searchPhrase: string;
    extractedValue: string;
    xPercent: number; yPercent: number; widthPercent: number; heightPercent: number;
    confidence: number;
  }>> {
    const template = await this.findOne(templateId);

    if (!template.sampleFilePath || !fs.existsSync(template.sampleFilePath)) {
      throw new NotFoundException('No sample file available for zone suggestion');
    }

    if (this.getActiveProvider() === 'gemini') {
      return this.gemini.suggestZones({
        filePath:           template.sampleFilePath,
        templateName:       template.name,
        documentType:       template.documentType,
        existingFieldNames: template.zones.map((z) => z.fieldName),
      });
    }

    const client = this.getClient();
    if (!client) return [];

    const model    = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
    const docBlock = this.buildDocBlock(template.sampleFilePath);

    const suggestTool: Anthropic.Tool = {
      name: 'suggest_zones',
      description: 'Identify all extractable field zones on this document.',
      input_schema: {
        type: 'object' as const,
        properties: {
          zones: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                fieldName:      { type: 'string', description: 'snake_case identifier, e.g. invoice_number' },
                fieldLabel:     { type: 'string', description: 'Human-readable label, e.g. "Invoice Number"' },
                description:    { type: 'string', description: 'One-sentence extraction hint' },
                searchPhrase:   { type: 'string', description: 'The label text printed near this value on the document' },
                extractedValue: { type: 'string', description: 'The actual text value you can read at this zone location right now' },
                pageNumber:     { type: 'number', description: 'Page number where this field appears (1-based integer)' },
                xPercent:       { type: 'number', description: 'Left edge of value zone as % of page width (0-100)' },
                yPercent:     { type: 'number', description: 'Top edge of value zone as % of page height (0-100)' },
                widthPercent: { type: 'number', description: 'Zone width as % of page width' },
                heightPercent:{ type: 'number', description: 'Zone height as % of page height' },
                confidence:   { type: 'number', description: 'How certain you are about this zone location (0.0-1.0)' },
              },
              required: ['fieldName','fieldLabel','xPercent','yPercent','widthPercent','heightPercent','confidence'],
            },
          },
        },
        required: ['zones'],
      },
    };

    const existingNames = template.zones.map((z) => z.fieldName);
    const skipNote      = existingNames.length
      ? `\n\nAlready defined (skip these): ${existingNames.join(', ')}`
      : '';

    const prompt = `You are analyzing a "${template.name}" (${template.documentType}) document for an insurance claims system.${skipNote}

This may be a multi-page document. Scan ALL pages and identify every extractable data field.

For each field:
- fieldName: snake_case key (e.g. patient_name, invoice_number, total_amount, diagnosis_code, sponsor_coverage)
- fieldLabel: human label shown in UI
- description: one-sentence extraction hint for an AI assistant
- searchPhrase: the text label printed on the document near this value (e.g. "Invoice #:", "Patient:")
- extractedValue: the ACTUAL text you can read at this zone right now (e.g. "John Doe", "INV-00123", "KES 4,500.00")
- pageNumber: which page this field appears on (1-based integer)
- Coordinates: tightly wrap the VALUE text, not the label. Use % of full page dimensions.
- confidence: 1.0 if clearly visible, 0.5 if estimated

IMPORTANT for provider_name: use the hospital/clinic letterhead or logo at the VERY TOP of the first page (e.g. "THE AGA KHAN UNIVERSITY HOSPITAL"). Extract ONLY the institution name without the city/branch suffix.
For provider_branch: extract the city or branch from the same letterhead line (e.g. "Nairobi" from "THE AGA KHAN UNIVERSITY HOSPITAL, Nairobi"). Do NOT use a "Provider:" label lower on the page.

Also look for:
- sponsor_coverage: amount the insurer/sponsor covers (e.g. near "Sponsor Coverage:" or "AKA Corporate")
- total_billed: total amount billed before deductions
- patient_payable: amount owed by the patient

Focus on: invoice/claim numbers, dates, amounts, patient demographics, provider info, diagnosis/procedure codes, totals, coverage amounts. Return up to 25 zones.`;

    let resp: Awaited<ReturnType<typeof client.messages.create>>;
    try {
      resp = await client.messages.create({
        model,
        max_tokens: 4096,
        tools: [suggestTool],
        tool_choice: { type: 'tool', name: 'suggest_zones' },
        messages: [{ role: 'user', content: [docBlock, { type: 'text', text: prompt }] }],
      });
    } catch (err) { this.rethrowAnthropicError(err, 'suggestZones'); }

    const toolUse = resp!.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    const zones   = ((toolUse?.input as any)?.zones ?? []) as any[];

    this.logger.log(`Auto-suggested ${zones.length} zone(s) for template "${template.name}"`);
    return zones;
  }

  // ── Classification + Extraction ──────────────────────────────────────────────

  async classifyAndExtract(
    filePath: string,
    mimetype: string,
    context?: { fileName?: string; claimId?: string; documentId?: string; uploadedBy?: string },
  ): Promise<{
    templateId: string | null;
    templateName?: string;
    fields: Record<string, string>;
    confidence: Record<string, number>;
    validation: Array<{ field: string; issue: string; severity: 'error' | 'warning' | 'info' }>;
    claimFieldMap: Record<string, string>;
    unknownDocumentId?: string;
  }> {
    const emptyClaimFieldMap: Record<string, string> = {};
    const empty = { templateId: null as string | null, fields: {}, confidence: {}, validation: [], claimFieldMap: emptyClaimFieldMap };

    const templates = await this.prisma.ocrTemplate.findMany({
      where: { isActive: true },
      include: { zones: true },
    });
    if (!templates.length) return empty;

    // ── Route to Gemini ───────────────────────────────────────────────────────
    if (this.getActiveProvider() === 'gemini') {
      try {
        const result = await this.gemini.classifyAndExtract({ filePath, templates });
        if (!result) {
          this.logger.log('Gemini: no template matched — recording unknown document');
          try {
            const rec = await this.unknownDocService.recordUnknown({
              filePath, fileName: context?.fileName || require('path').basename(filePath),
              mimeType: mimetype, claimId: context?.claimId, uploadedBy: context?.uploadedBy,
            });
            return { ...empty, unknownDocumentId: rec.id };
          } catch {}
          return empty;
        }
        const geminiTemplate = templates.find((t) => t.id === result.templateId);
        const geminiConf = result.confidence ?? {};
        const isSuccessfulGemini = Object.values(geminiConf).length > 0
          && Object.values(geminiConf).reduce((s, v) => s + v, 0) / Object.values(geminiConf).length >= 0.7;
        await this.prisma.ocrTemplate.update({
          where: { id: result.templateId },
          data: {
            usageCount:   { increment: 1 },
            ...(isSuccessfulGemini ? { successCount: { increment: 1 } } : {}),
          },
        }).catch(() => {});

        // Write per-zone hits for the analytics dashboard — same logic as
        // Anthropic path; previously missing from the Gemini branch.
        if (geminiTemplate?.zones.length) {
          const zoneHitData = geminiTemplate.zones.map(zone => ({
            zoneId:         zone.id,
            templateId:     result.templateId,
            claimId:        context?.claimId    ?? null,
            documentId:     context?.documentId ?? null,
            fieldName:      zone.fieldName,
            fieldLabel:     zone.fieldLabel,
            extractedValue: result.fields?.[zone.fieldName] || null,
            confidence:     geminiConf[zone.fieldName]      ?? null,
            engine:         'gemini',
          }));
          await this.prisma.ocrZoneHit.createMany({ data: zoneHitData }).catch(() => {});
        }

        // Build claimFieldMap for Gemini path using zone.claimField or implicit default
        const geminiClaimFieldMap: Record<string, string> = {};
        for (const zone of geminiTemplate?.zones ?? []) {
          const target = (zone as any).claimField || IMPLICIT_CLAIM_FIELD[zone.fieldName];
          const value  = result.fields?.[zone.fieldName];
          if (target && value) geminiClaimFieldMap[target] = value;
        }
        return { ...result, claimFieldMap: geminiClaimFieldMap };
      } catch (err) {
        this.logger.error(`Gemini classifyAndExtract failed: ${err}`);
        const msg = String((err as any)?.message ?? err);
        const isQuota = msg.includes('quota') || msg.includes('429');
        if (isQuota && this.getClient()) {
          this.logger.warn('Gemini quota exceeded — falling back to Anthropic for classification');
          // fall through to Anthropic path below
        } else {
          throw err;
        }
      }
    }

    // ── Anthropic path ────────────────────────────────────────────────────────
    const client = this.getClient();
    if (!client) {
      this.logger.warn('ANTHROPIC_API_KEY not set — skipping classification');
      return empty;
    }

    const model  = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
    const isPdf  = mimetype === 'application/pdf' || filePath.endsWith('.pdf');

    let docBlock: Anthropic.ContentBlockParam;
    try {
      docBlock = this.buildDocBlock(filePath, mimetype);
    } catch {
      this.logger.error(`Failed to read file for classification: ${filePath}`);
      return empty;
    }

    // ── STEP 1: Classify ─────────────────────────────────────────────────────
    const templateList = templates
      .map((t) => `- ID: ${t.id} | Name: "${t.name}" | Type: ${t.documentType}${t.specificProvider ? ` | Provider: ${t.specificProvider}` : ''}${t.description ? ` | Desc: ${t.description}` : ''}`)
      .join('\n');

    const classifyTool: Anthropic.Tool = {
      name: 'select_template',
      description: 'Select the best matching document template, or "none".',
      input_schema: {
        type: 'object' as const,
        properties: {
          templateId:  { type: 'string', description: 'Matched template ID, or "none".' },
          confidence:  { type: 'number', description: 'Classification confidence 0.0-1.0.' },
          reasoning:   { type: 'string', description: 'One sentence why this template was chosen.' },
        },
        required: ['templateId', 'confidence'],
      },
    };

    this.logger.log(`Classifying document against ${templates.length} template(s)`);

    let classifyResp: Awaited<ReturnType<typeof client.messages.create>>;
    try {
      classifyResp = await client.messages.create({
        model, max_tokens: 512, tools: [classifyTool],
        tool_choice: { type: 'tool', name: 'select_template' },
        messages: [{
          role: 'user',
          content: [docBlock, { type: 'text', text:
            `You are a document classifier for a medical insurance claims system.\n\nAvailable templates:\n${templateList}\n\nMatch this document to the best template. Consider layout, provider name/logo, header, and structure.` }],
        }],
      });
    } catch (err) { this.rethrowAnthropicError(err, 'classifyAndExtract/classify'); }

    const classifyInput = (classifyResp!.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')?.input ?? {}) as any;
    const rawTemplateId: string = classifyInput.templateId ?? '';
    this.logger.log(`Classifier raw response: templateId="${rawTemplateId}" confidence=${classifyInput.confidence ?? '?'}`);

    let matchedId: string | null = null;
    if (rawTemplateId && rawTemplateId !== 'none') {
      // Primary: model returned the UUID directly
      if (templates.some((t) => t.id === rawTemplateId)) {
        matchedId = rawTemplateId;
      } else {
        // Fallback: model returned the template name instead of the UUID
        const byName = templates.find(
          (t) => t.name.toLowerCase() === rawTemplateId.toLowerCase()
               || t.specificProvider?.toLowerCase() === rawTemplateId.toLowerCase(),
        );
        if (byName) {
          this.logger.warn(`Classifier returned name "${rawTemplateId}" instead of UUID — resolved to ${byName.id}`);
          matchedId = byName.id;
        }
      }
    }

    if (!matchedId) {
      this.logger.log(`No template matched (model returned "${rawTemplateId}") — recording unknown document`);
      try {
        const rec = await this.unknownDocService.recordUnknown({
          filePath,
          fileName:   context?.fileName || require('path').basename(filePath),
          mimeType:   mimetype,
          claimId:    context?.claimId,
          uploadedBy: context?.uploadedBy,
        });
        return { ...empty, unknownDocumentId: rec.id };
      } catch (err) {
        this.logger.warn(`Failed to record unknown document: ${err}`);
      }
      return empty;
    }

    const matchedTemplate = templates.find((t) => t.id === matchedId);
    if (!matchedTemplate) {
      this.logger.warn(`Classifier matched ID "${matchedId}" not found in loaded templates`);
      return empty;
    }

    this.logger.log(`Matched template: "${matchedTemplate.name}" (conf=${(classifyInput.confidence ?? 0).toFixed(2)})`);

    // ── STEP 2: Zone-guided extraction with per-field confidence ──────────────
    if (!matchedTemplate.zones.length) {
      return { templateId: matchedId, templateName: matchedTemplate.name, fields: {}, confidence: {}, validation: [], claimFieldMap: emptyClaimFieldMap };
    }

    const zoneDescriptions = matchedTemplate.zones.map((z) =>
      `- ${z.fieldLabel} (${z.fieldName}): ${z.description || `~${z.xPercent.toFixed(0)}% left, ~${z.yPercent.toFixed(0)}% top`}${z.searchPhrase ? ` — look near "${z.searchPhrase}"` : ''}`,
    ).join('\n');

    // Build extract tool schema — each field returns { value, confidence }
    const extractFieldSchema: Record<string, any> = {};
    for (const zone of matchedTemplate.zones) {
      extractFieldSchema[zone.fieldName] = {
        type: 'object',
        properties: {
          value:      { type: 'string',  description: 'Extracted text exactly as it appears' },
          confidence: { type: 'number',  description: 'Confidence 0.0-1.0' },
        },
        required: ['value', 'confidence'],
      };
    }

    const extractTool: Anthropic.Tool = {
      name: 'extract_fields',
      description: 'Extract each field from the document with a confidence score.',
      input_schema: { type: 'object' as const, properties: extractFieldSchema, required: [] },
    };

    let extractResp: Awaited<ReturnType<typeof client.messages.create>>;
    try {
      extractResp = await client.messages.create({
        model, max_tokens: 2048, tools: [extractTool],
        tool_choice: { type: 'tool', name: 'extract_fields' },
        messages: [{
          role: 'user',
          content: [docBlock, { type: 'text', text:
            `This is a "${matchedTemplate.name}" (${matchedTemplate.documentType}) document. It may have multiple pages — scan ALL pages.\n\nExtract these fields. For each return the value and your confidence:\n\n${zoneDescriptions}\n\nFor provider_name: use the institution name from the letterhead at the top of page 1 (without city/branch suffix).\nFor provider_branch: use the city/branch from the same letterhead line (e.g. "Nairobi").\nCopy values exactly. Empty string + confidence 0 if not found.` }],
        }],
      });
    } catch (err) { this.rethrowAnthropicError(err, 'classifyAndExtract/extract'); }

    const extractInput = (extractResp!.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')?.input ?? {}) as Record<string, any>;

    const fields: Record<string, string>    = {};
    const confidence: Record<string, number> = {};
    for (const [key, val] of Object.entries(extractInput)) {
      if (val && typeof val === 'object') {
        fields[key]     = String(val.value      ?? '').trim();
        confidence[key] = Math.min(1, Math.max(0, Number(val.confidence ?? 0)));
      } else {
        fields[key]     = String(val ?? '').trim();
        confidence[key] = 0.5;
      }
    }

    this.logger.log(`Extracted ${Object.keys(fields).length} field(s)`);

    // ── STEP 3: AI validation ─────────────────────────────────────────────────
    const validation = await this.validateExtractedFields(fields, docBlock, model, client);

    // ── Increment usage count + record per-zone hits ──────────────────────────
    const avgConf = Object.values(confidence).length
      ? Object.values(confidence).reduce((s, v) => s + v, 0) / Object.values(confidence).length
      : 0;
    const isSuccessful = avgConf >= 0.7 && Object.keys(fields).filter(k => fields[k]).length >= 3;

    await this.prisma.ocrTemplate.update({
      where: { id: matchedId },
      data: {
        usageCount: { increment: 1 },
        ...(isSuccessful ? { successCount: { increment: 1 } } : {}),
        accuracy: isSuccessful ? { set: await this.recomputeAccuracy(matchedId, true) } : undefined,
      },
    }).catch(() => {});

    // Persist a zone hit row for every zone that was attempted — this is the
    // knowledge base that drives the zone accuracy analytics dashboard.
    const engine = this.getActiveProvider() === 'gemini' ? 'gemini' : 'anthropic';
    const zoneHitData = matchedTemplate.zones.map(zone => ({
      zoneId:         zone.id,
      templateId:     matchedId,
      claimId:        context?.claimId   ?? null,
      documentId:     context?.documentId ?? null,
      fieldName:      zone.fieldName,
      fieldLabel:     zone.fieldLabel,
      extractedValue: fields[zone.fieldName] || null,
      confidence:     confidence[zone.fieldName] ?? null,
      engine,
    }));
    if (zoneHitData.length) {
      await this.prisma.ocrZoneHit.createMany({ data: zoneHitData }).catch(() => {});
    }

    // Build claimFieldMap: zone.claimField (or implicit default) → extracted value
    const claimFieldMap: Record<string, string> = {};
    for (const zone of matchedTemplate.zones) {
      const target = zone.claimField || IMPLICIT_CLAIM_FIELD[zone.fieldName];
      const value  = fields[zone.fieldName];
      if (target && value) claimFieldMap[target] = value;
    }

    return { templateId: matchedId, templateName: matchedTemplate.name, fields, confidence, validation, claimFieldMap };
  }

  // ── AI field validation ───────────────────────────────────────────────────────

  private async validateExtractedFields(
    fields: Record<string, string>,
    docBlock: Anthropic.ContentBlockParam,
    model: string,
    client: Anthropic,
  ): Promise<Array<{ field: string; issue: string; severity: 'error' | 'warning' | 'info' }>> {
    if (!Object.keys(fields).length) return [];

    const validateTool: Anthropic.Tool = {
      name: 'validate_fields',
      description: 'Validate the extracted insurance claim fields for logical consistency.',
      input_schema: {
        type: 'object' as const,
        properties: {
          issues: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                field:    { type: 'string',  description: 'Field name, or "general" for cross-field issues' },
                issue:    { type: 'string',  description: 'Clear description of the problem' },
                severity: { type: 'string',  enum: ['error','warning','info'], description: 'error=data likely wrong, warning=suspicious, info=note' },
              },
              required: ['field','issue','severity'],
            },
          },
        },
        required: ['issues'],
      },
    };

    const fieldList = Object.entries(fields)
      .filter(([, v]) => v)
      .map(([k, v]) => `- ${k}: "${v}"`)
      .join('\n');

    const prompt = `You are validating extracted medical insurance claim fields.

Extracted values:
${fieldList}

Check for:
1. Date logic: discharge date must be after admission/registration date, service date must be reasonable
2. Amount consistency: totals, subtotals, tax relationships
3. Format issues: malformed dates, impossible amounts (negative, zero on non-zero fields), suspicious patterns
4. Missing critical fields: if invoice_number or invoice_amount appear blank, flag as error
5. Duplicate indicators: same date for admission and discharge on non-same-day surgery

Return an empty array if everything looks correct. Only flag genuine issues, not style preferences.`;

    try {
      const resp = await client.messages.create({
        model, max_tokens: 1024, tools: [validateTool],
        tool_choice: { type: 'tool', name: 'validate_fields' },
        messages: [{ role: 'user', content: [docBlock, { type: 'text', text: prompt }] }],
      });

      const input  = (resp.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')?.input ?? {}) as any;
      const issues = (input.issues ?? []) as Array<{ field: string; issue: string; severity: string }>;
      this.logger.log(`Validation: ${issues.length} issue(s) found`);
      return issues.map((i) => ({
        field:    i.field,
        issue:    i.issue,
        severity: (i.severity === 'error' || i.severity === 'warning' || i.severity === 'info') ? i.severity : 'info',
      }));
    } catch {
      return [];
    }
  }

  // ── Sample document split / merge ─────────────────────────────────────────────

  async analyzeTemplateSamplePages(templateId: string) {
    const template = await this.findOne(templateId);
    if (!template.sampleFilePath || !fs.existsSync(template.sampleFilePath)) {
      throw new NotFoundException('No sample file available for analysis');
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new BadRequestException('AI provider not configured');

    const ext = path.extname(template.sampleFilePath).toLowerCase();
    if (ext !== '.pdf') {
      return {
        totalPages: 1,
        segments: [{
          start: 1, end: 1,
          documentType: template.documentType || 'medical_report',
          label: template.sampleFileName || 'Document',
          confidence: 1.0,
          notes: 'Single-page image document',
        }],
      };
    }

    const client = new Anthropic({ apiKey });
    const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
    const b64 = fs.readFileSync(template.sampleFilePath).toString('base64');

    const PAGE_TOOL: Anthropic.Tool = {
      name: 'categorize_document_pages',
      description: 'Identify distinct document sections and suggest split points.',
      input_schema: {
        type: 'object',
        properties: {
          totalPages: { type: 'number' },
          segments: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                start:        { type: 'number' },
                end:          { type: 'number' },
                documentType: {
                  type: 'string',
                  enum: ['invoice', 'lab_result', 'prescription', 'discharge_summary', 'medical_report', 'claim_form', 'pre_auth', 'referral', 'supporting'],
                },
                label:      { type: 'string' },
                confidence: { type: 'number' },
                notes:      { type: 'string' },
              },
              required: ['start', 'end', 'documentType', 'label', 'confidence'],
            },
          },
        },
        required: ['totalPages', 'segments'],
      },
    };

    const resp = await client.messages.create({
      model, max_tokens: 1024,
      tools: [PAGE_TOOL],
      tool_choice: { type: 'tool', name: 'categorize_document_pages' },
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } } as any,
          { type: 'text', text: 'Analyze this Kenyan medical insurance document. Identify ALL distinct sections (invoices, lab results, prescriptions, discharge summaries, claim forms, referrals). Group consecutive pages of the same type. Return segments covering every page with no gaps.' },
        ],
      }],
    });

    const toolResult = resp.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    if (!toolResult) throw new BadRequestException('AI did not return page analysis');
    return toolResult.input as { totalPages: number; segments: any[] };
  }

  async splitTemplateSample(
    templateId: string,
    pageRanges: Array<{ start: number; end: number; name: string; documentType?: string }>,
    userId: string,
  ) {
    const template = await this.findOne(templateId);
    if (!template.sampleFilePath || !fs.existsSync(template.sampleFilePath)) {
      throw new NotFoundException('No sample file available for splitting');
    }

    const uploadDir = path.join(process.cwd(), 'uploads', 'documents');
    fs.mkdirSync(uploadDir, { recursive: true });

    const createdDocs: any[] = [];

    for (let i = 0; i < pageRanges.length; i++) {
      const range = pageRanges[i];
      const outputName = `${range.name || `split_part_${i + 1}`}.pdf`;
      const outputPath = path.join(uploadDir, `${Date.now()}_${i}_${outputName}`);

      await this.pdfOps.splitPdf(template.sampleFilePath, [{ start: range.start, end: range.end, outputPath }]);

      if (fs.existsSync(outputPath)) {
        const stats = fs.statSync(outputPath);
        const doc = await this.prisma.document.create({
          data: {
            filename:     path.basename(outputPath),
            originalName: outputName,
            mimetype:     'application/pdf',
            size:         BigInt(stats.size),
            path:         outputPath,
            documentType: range.documentType || template.documentType,
            version:      1,
            isLatestVersion: true,
            metadata:     { splitFromTemplate: templateId, pages: `${range.start}-${range.end}`, templateName: template.name },
          },
        });
        createdDocs.push(doc);
      }
    }

    this.logger.log(`Split template ${templateId} sample → ${createdDocs.length} documents`);
    return { documents: createdDocs, templateId };
  }

  async mergeTemplateSamples(templateIds: string[], outputName: string, userId: string) {
    const templates = await Promise.all(templateIds.map((id) => this.findOne(id)));
    const samplePaths = templates
      .map((t) => t.sampleFilePath)
      .filter((p): p is string => !!p && fs.existsSync(p));

    if (samplePaths.length < 2) {
      throw new BadRequestException('At least 2 templates with valid sample files are required for merging');
    }

    const uploadDir = path.join(process.cwd(), 'uploads', 'documents');
    fs.mkdirSync(uploadDir, { recursive: true });
    const outputPath = path.join(uploadDir, `${Date.now()}_${outputName}`);

    await this.pdfOps.mergePdfs(samplePaths, outputPath);

    const stats = fs.statSync(outputPath);
    const doc = await this.prisma.document.create({
      data: {
        filename:     path.basename(outputPath),
        originalName: outputName,
        mimetype:     'application/pdf',
        size:         BigInt(stats.size),
        path:         outputPath,
        documentType: 'merged',
        version:      1,
        isLatestVersion: true,
        metadata:     { mergedFromTemplates: templateIds },
      },
    });

    this.logger.log(`Merged ${samplePaths.length} template samples → document ${doc.id}`);
    return { document: doc, mergedCount: samplePaths.length };
  }

  // ── Zone hit tracking & analytics ────────────────────────────────────────────

  private async recomputeAccuracy(templateId: string, latestWasSuccess: boolean): Promise<number> {
    const t = await this.prisma.ocrTemplate.findUnique({
      where: { id: templateId },
      select: { usageCount: true, successCount: true },
    });
    if (!t) return 0;
    const successes = (t.successCount ?? 0) + (latestWasSuccess ? 1 : 0);
    const total     = (t.usageCount  ?? 0) + 1;
    return total > 0 ? parseFloat((successes / total).toFixed(4)) : 0;
  }

  /** Record user correction on an extracted zone hit — closes the feedback loop. */
  async recordZoneCorrection(hitId: string, correctedValue: string, userId: string) {
    return this.prisma.ocrZoneHit.update({
      where: { id: hitId },
      data: {
        wasCorrect:     false,
        correctedValue,
        correctedBy:    userId,
        correctedAt:    new Date(),
      },
    });
  }

  /** Mark a zone hit as confirmed correct (reviewer verified the extraction). */
  async confirmZoneHit(hitId: string, userId: string) {
    return this.prisma.ocrZoneHit.update({
      where: { id: hitId },
      data: { wasCorrect: true, correctedBy: userId, correctedAt: new Date() },
    });
  }

  /** Per-template and per-zone accuracy analytics — the knowledge base view. */
  async getZoneAnalytics(templateId?: string) {
    const where = templateId ? { templateId } : {};

    const [templates, recentHits, fieldStats] = await Promise.all([
      this.prisma.ocrTemplate.findMany({
        where: templateId ? { id: templateId } : { isActive: true },
        select: {
          id: true, name: true, documentType: true, specificProvider: true,
          usageCount: true, successCount: true, accuracy: true,
          zones: { select: { id: true, fieldName: true, fieldLabel: true } },
        },
        orderBy: { usageCount: 'desc' },
      }),

      // Last 500 hits for trend analysis
      this.prisma.ocrZoneHit.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 500,
        select: {
          id: true, zoneId: true, templateId: true, fieldName: true, fieldLabel: true,
          confidence: true, wasCorrect: true, engine: true, createdAt: true,
          extractedValue: true,
        },
      }),

      // Aggregate per-field across all hits
      this.prisma.ocrZoneHit.groupBy({
        by: ['fieldName', 'fieldLabel', 'templateId'],
        where,
        _count:  { id: true },
        _avg:    { confidence: true },
        _sum:    { confidence: true },
      }),
    ]);

    // Correction rate per field
    const correctionCounts = await this.prisma.ocrZoneHit.groupBy({
      by: ['fieldName', 'templateId'],
      where: { ...where, wasCorrect: false },
      _count: { id: true },
    });
    const corrMap: Record<string, number> = {};
    correctionCounts.forEach(r => { corrMap[`${r.templateId}:${r.fieldName}`] = r._count.id; });

    // Build per-field rows
    const fieldRows = fieldStats.map(r => {
      const key = `${r.templateId}:${r.fieldName}`;
      const corrections = corrMap[key] ?? 0;
      const total = r._count.id;
      const correctionRate = total > 0 ? parseFloat((corrections / total * 100).toFixed(1)) : 0;
      const avgConf = r._avg.confidence != null ? parseFloat((r._avg.confidence * 100).toFixed(1)) : null;
      const template = templates.find(t => t.id === r.templateId);
      return {
        templateId: r.templateId,
        templateName: template?.name ?? 'Unknown',
        fieldName: r.fieldName,
        fieldLabel: r.fieldLabel,
        totalExtractions: total,
        avgConfidence: avgConf,
        correctionRate,
        corrections,
        needsAttention: avgConf !== null && (avgConf < 70 || correctionRate > 20),
      };
    }).sort((a, b) => (b.needsAttention ? 1 : 0) - (a.needsAttention ? 1 : 0) || b.totalExtractions - a.totalExtractions);

    // Confidence trend — bucket last 200 hits by week
    const weekBuckets: Record<string, { hits: number; confSum: number; corrections: number }> = {};
    recentHits.slice(0, 200).forEach(h => {
      const d = new Date(h.createdAt);
      const wk = `${d.getFullYear()}-W${String(Math.ceil(d.getDate() / 7)).padStart(2,'0')}`;
      if (!weekBuckets[wk]) weekBuckets[wk] = { hits: 0, confSum: 0, corrections: 0 };
      weekBuckets[wk].hits++;
      weekBuckets[wk].confSum += h.confidence ?? 0;
      if (h.wasCorrect === false) weekBuckets[wk].corrections++;
    });
    const trend = Object.entries(weekBuckets)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week, b]) => ({
        week,
        hits: b.hits,
        avgConfidence: b.hits > 0 ? parseFloat((b.confSum / b.hits * 100).toFixed(1)) : 0,
        correctionRate: b.hits > 0 ? parseFloat((b.corrections / b.hits * 100).toFixed(1)) : 0,
      }));

    // Summary
    const totalHits    = recentHits.length;
    const avgConf      = totalHits > 0 ? recentHits.reduce((s, h) => s + (h.confidence ?? 0), 0) / totalHits : 0;
    const corrections  = recentHits.filter(h => h.wasCorrect === false).length;
    const unverified   = recentHits.filter(h => h.wasCorrect === null).length;

    return {
      summary: {
        totalHits,
        avgConfidence:  parseFloat((avgConf * 100).toFixed(1)),
        correctionRate: totalHits > 0 ? parseFloat((corrections / totalHits * 100).toFixed(1)) : 0,
        unverifiedHits: unverified,
        templatesActive: templates.length,
      },
      templates: templates.map(t => ({
        id:             t.id,
        name:           t.name,
        documentType:   t.documentType,
        provider:       t.specificProvider,
        usageCount:     t.usageCount,
        successCount:   t.successCount,
        accuracy:       t.accuracy != null ? parseFloat((t.accuracy * 100).toFixed(1)) : null,
        zoneCount:      t.zones.length,
      })),
      fields:   fieldRows,
      trend,
      recentHits: recentHits.slice(0, 50).map(h => ({
        id:             h.id,
        fieldName:      h.fieldName,
        fieldLabel:     h.fieldLabel,
        confidence:     h.confidence != null ? parseFloat((h.confidence * 100).toFixed(1)) : null,
        wasCorrect:     h.wasCorrect,
        engine:         h.engine,
        extractedValue: h.extractedValue?.slice(0, 80) ?? null,
        createdAt:      h.createdAt,
      })),
    };
  }

  /**
   * For a given template, return the best-known value per field — built from
   * confirmed correct zone hits (wasCorrect = true) or, failing that, the
   * most-recent high-confidence extraction. Used to pre-populate fields on
   * re-uploads of the same document type.
   */
  async getBestKnownValues(templateId: string): Promise<Record<string, { value: string; confidence: number; source: 'confirmed' | 'high_confidence' }>> {
    const result: Record<string, { value: string; confidence: number; source: 'confirmed' | 'high_confidence' }> = {};

    // Confirmed correct values — highest quality signal
    const confirmed = await this.prisma.ocrZoneHit.findMany({
      where: { templateId, wasCorrect: true, extractedValue: { not: null } },
      orderBy: { correctedAt: 'desc' },
      select: { fieldName: true, extractedValue: true, confidence: true },
    });
    for (const h of confirmed) {
      if (!result[h.fieldName] && h.extractedValue) {
        result[h.fieldName] = { value: h.extractedValue, confidence: h.confidence ?? 1, source: 'confirmed' };
      }
    }

    // High-confidence recent extractions for fields not yet covered by confirmed hits
    const highConf = await this.prisma.ocrZoneHit.findMany({
      where: {
        templateId,
        wasCorrect: { not: false }, // not explicitly wrong
        confidence: { gte: 0.80 },
        extractedValue: { not: null },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: { fieldName: true, extractedValue: true, confidence: true },
    });
    for (const h of highConf) {
      if (!result[h.fieldName] && h.extractedValue) {
        result[h.fieldName] = { value: h.extractedValue, confidence: h.confidence ?? 0.8, source: 'high_confidence' };
      }
    }

    return result;
  }
}
