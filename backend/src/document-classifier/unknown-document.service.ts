import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as fs from 'fs';
import * as path from 'path';
import Anthropic from '@anthropic-ai/sdk';

@Injectable()
export class UnknownDocumentService {
  private readonly logger = new Logger(UnknownDocumentService.name);
  private client: Anthropic | null = null;

  constructor(private readonly prisma: PrismaService) {}

  private getClient(): Anthropic | null {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) return null;
    if (!this.client) this.client = new Anthropic({ apiKey: key });
    return this.client;
  }

  async recordUnknown(params: {
    filePath: string;
    fileName: string;
    mimeType: string;
    claimId?: string;
    uploadedBy?: string;
    classificationReason?: string;
  }) {
    const client = this.getClient();
    let guessedType: string | undefined;
    let guessedProvider: string | undefined;
    let rawExtract: Record<string, string> | undefined;

    // Best-effort AI triage on the unknown document
    if (client && fs.existsSync(params.filePath)) {
      try {
        const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
        const b64   = fs.readFileSync(params.filePath).toString('base64');
        const isPdf = params.mimeType === 'application/pdf' || params.filePath.endsWith('.pdf');
        const docBlock: Anthropic.ContentBlockParam = isPdf
          ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }
          : { type: 'image', source: { type: 'base64', media_type: 'image/jpeg' as any, data: b64 } };

        const triageTool: Anthropic.Tool = {
          name: 'triage_document',
          description: 'Identify what type of document this is and extract key fields.',
          input_schema: {
            type: 'object' as const,
            properties: {
              documentType:  { type: 'string', description: 'e.g. Hospital Invoice, Prescription, Lab Report, Discharge Summary, Radiology Report' },
              providerName:  { type: 'string', description: 'Hospital / clinic / lab name if visible' },
              fields: {
                type: 'object',
                additionalProperties: { type: 'string' },
                description: 'Key field values you can extract: patient_name, invoice_number, invoice_date, total_amount, diagnosis, etc.',
              },
            },
            required: ['documentType'],
          },
        };

        const resp = await client.messages.create({
          model, max_tokens: 1024,
          tools: [triageTool],
          tool_choice: { type: 'tool', name: 'triage_document' },
          messages: [{
            role: 'user',
            content: [docBlock, { type: 'text', text:
              'This document was uploaded to an insurance claims system but does not match any known template. Identify what type of document it is, who the provider is, and extract any key field values you can see.' }],
          }],
        });

        const input = (resp.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')?.input ?? {}) as any;
        guessedType     = input.documentType;
        guessedProvider = input.providerName;
        rawExtract      = input.fields ?? {};
        this.logger.log(`Triaged unknown doc: type="${guessedType}" provider="${guessedProvider}"`);
      } catch (err) {
        this.logger.warn(`AI triage failed for unknown doc: ${err}`);
      }
    }

    // Copy the file to a permanent storage folder so it survives temp cleanup
    const permanentDir = path.join(process.cwd(), 'uploads', 'unknown-documents');
    fs.mkdirSync(permanentDir, { recursive: true });
    let permanentPath = params.filePath;
    if (fs.existsSync(params.filePath)) {
      const destName = `${Date.now()}-${path.basename(params.filePath)}`;
      const dest = path.join(permanentDir, destName);
      try {
        fs.copyFileSync(params.filePath, dest);
        permanentPath = dest;
      } catch (err) {
        this.logger.warn(`Could not copy unknown doc to permanent storage: ${err}`);
      }
    }

    const record = await this.prisma.unknownDocument.create({
      data: {
        filePath:              permanentPath,
        fileName:              params.fileName,
        mimeType:              params.mimeType,
        claimId:               params.claimId,
        uploadedBy:            params.uploadedBy,
        classificationReason:  params.classificationReason,
        guessedType,
        guessedProvider,
        rawExtract:            rawExtract ?? {},
        status:                'pending',
      },
    });

    this.logger.log(`Recorded unknown document: ${record.id} (${params.fileName})`);

    // Create in-app notification for all admins
    try {
      const admins = await this.prisma.user.findMany({
        where: { role: { in: ['admin', 'maker_checker'] } },
        select: { id: true },
      });
      if (admins.length) {
        await this.prisma.notification.createMany({
          data: admins.map((a) => ({
            type:        'in_app',
            channel:     'in_app',
            recipientId: a.id,
            subject:     'New Unknown Document Type',
            message:     `An unrecognised document was uploaded: "${params.fileName}"${guessedType ? ` (AI guess: ${guessedType}${guessedProvider ? ` from ${guessedProvider}` : ''})` : ''}. Review and add a classifier template.`,
            status:      'pending',
          })),
        });
      }
    } catch (err) {
      this.logger.warn(`Failed to create admin notifications: ${err}`);
    }

    return record;
  }

  async findAll(params: { status?: string; page?: number; limit?: number }) {
    const { status, page = 1, limit = 20 } = params;
    const where = status ? { status } : {};
    const [items, total] = await Promise.all([
      this.prisma.unknownDocument.findMany({
        where, orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit, take: limit,
      }),
      this.prisma.unknownDocument.count({ where }),
    ]);
    return { items, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async findOne(id: string) {
    const doc = await this.prisma.unknownDocument.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException(`Unknown document ${id} not found`);
    return doc;
  }

  async markReviewed(id: string, reviewedBy: string, notes?: string) {
    await this.findOne(id);
    return this.prisma.unknownDocument.update({
      where: { id },
      data: { status: 'reviewed', reviewedBy, reviewedAt: new Date(), notes },
    });
  }

  async markTemplateCreated(id: string, reviewedBy: string) {
    await this.findOne(id);
    return this.prisma.unknownDocument.update({
      where: { id },
      data: { status: 'template_created', reviewedBy, reviewedAt: new Date() },
    });
  }

  async getPendingCount(): Promise<number> {
    return this.prisma.unknownDocument.count({ where: { status: 'pending' } });
  }

  async serveSample(id: string, res: any) {
    const doc = await this.findOne(id);
    if (!fs.existsSync(doc.filePath)) {
      return res.status(404).json({ message: 'File not found on disk' });
    }
    const ext = path.extname(doc.filePath).toLowerCase();
    const mime = ({ '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' })[ext] || 'application/octet-stream';
    res.set({ 'Content-Type': mime, 'Content-Disposition': `inline; filename="${doc.fileName}"` });
    fs.createReadStream(doc.filePath).pipe(res);
  }

  async promoteToTemplate(id: string, templateId: string, reviewedBy: string): Promise<{ templateId: string }> {
    const doc = await this.findOne(id);
    if (!fs.existsSync(doc.filePath)) {
      throw new BadRequestException('Source file no longer exists on disk');
    }

    const template = await this.prisma.ocrTemplate.findUnique({ where: { id: templateId } });
    if (!template) throw new NotFoundException(`Template ${templateId} not found`);

    const templatesDir = path.join(process.cwd(), 'uploads', 'templates');
    fs.mkdirSync(templatesDir, { recursive: true });
    const ext = path.extname(doc.filePath);
    const destName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    const destPath = path.join(templatesDir, destName);
    fs.copyFileSync(doc.filePath, destPath);

    // Remove old sample file if present
    if (template.sampleFilePath && fs.existsSync(template.sampleFilePath)) {
      try { fs.unlinkSync(template.sampleFilePath); } catch (_) {}
    }

    await this.prisma.ocrTemplate.update({
      where: { id: templateId },
      data: { sampleFilePath: destPath, sampleFileName: doc.fileName },
    });

    await this.prisma.unknownDocument.update({
      where: { id },
      data: { status: 'template_created', reviewedBy, reviewedAt: new Date() },
    });

    return { templateId };
  }

  async createTemplateFromUnknown(
    id: string,
    templateData: { name: string; documentType: string; description?: string; providerType?: string; specificProvider?: string },
    reviewedBy: string,
  ): Promise<{ templateId: string }> {
    const doc = await this.findOne(id);
    if (!fs.existsSync(doc.filePath)) {
      throw new BadRequestException('Source file no longer exists on disk');
    }

    const templatesDir = path.join(process.cwd(), 'uploads', 'templates');
    fs.mkdirSync(templatesDir, { recursive: true });
    const ext = path.extname(doc.filePath);
    const destName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    const destPath = path.join(templatesDir, destName);
    fs.copyFileSync(doc.filePath, destPath);

    const template = await this.prisma.ocrTemplate.create({
      data: {
        name:            templateData.name,
        documentType:    templateData.documentType,
        description:     templateData.description,
        providerType:    templateData.providerType,
        specificProvider: templateData.specificProvider,
        fieldDefinitions: {},
        sampleFilePath:  destPath,
        sampleFileName:  doc.fileName,
      },
    });

    await this.prisma.unknownDocument.update({
      where: { id },
      data: { status: 'template_created', reviewedBy, reviewedAt: new Date() },
    });

    return { templateId: template.id };
  }

  async ensureDraftTemplate(id: string, reviewedBy: string): Promise<{ templateId: string; created: boolean }> {
    const doc = await this.findOne(id);

    // Return existing linked template if still present
    if ((doc as any).linkedTemplateId) {
      const existing = await this.prisma.ocrTemplate.findUnique({ where: { id: (doc as any).linkedTemplateId } });
      if (existing) return { templateId: existing.id, created: false };
    }

    if (!fs.existsSync(doc.filePath)) {
      throw new BadRequestException('Source file no longer exists on disk');
    }

    // Derive a sensible name + document type from the AI guess
    const guessedType = (doc as any).guessedType as string | undefined;
    const guessedProvider = (doc as any).guessedProvider as string | undefined;
    const name = guessedProvider
      ? `${guessedProvider}${guessedType ? ` – ${guessedType}` : ''}`
      : guessedType || path.basename(doc.fileName, path.extname(doc.fileName));

    const TYPE_MAP: Record<string, string> = {
      invoice: 'invoice', 'hospital invoice': 'invoice', 'inpatient invoice': 'inpatient_invoice',
      prescription: 'prescription', lab: 'lab_result', 'lab result': 'lab_result',
      'lab report': 'lab_result', medical: 'medical_report', 'medical report': 'medical_report',
      discharge: 'discharge_summary', 'discharge summary': 'discharge_summary',
      claim: 'claim_form', 'claim form': 'claim_form',
      authorization: 'authorization_letter', 'authorization letter': 'authorization_letter',
    };
    const lower = (guessedType || '').toLowerCase();
    const documentType = Object.entries(TYPE_MAP).find(([k]) => lower.includes(k))?.[1] ?? 'other';

    const templatesDir = path.join(process.cwd(), 'uploads', 'templates');
    fs.mkdirSync(templatesDir, { recursive: true });
    const ext = path.extname(doc.filePath);
    const destName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    const destPath = path.join(templatesDir, destName);
    fs.copyFileSync(doc.filePath, destPath);

    const template = await this.prisma.ocrTemplate.create({
      data: {
        name,
        documentType,
        description: `Draft template created from unknown document: ${doc.fileName}`,
        specificProvider: guessedProvider || undefined,
        fieldDefinitions: {},
        sampleFilePath: destPath,
        sampleFileName: doc.fileName,
      },
    });

    await this.prisma.unknownDocument.update({
      where: { id },
      data: { linkedTemplateId: template.id, status: 'template_created', reviewedBy, reviewedAt: new Date() },
    });

    return { templateId: template.id, created: true };
  }

  async remove(id: string) {
    const doc = await this.findOne(id);
    // Clean up the file if it still exists
    if (doc.filePath && fs.existsSync(doc.filePath)) {
      try { fs.unlinkSync(doc.filePath); } catch (_) {}
    }
    await this.prisma.unknownDocument.delete({ where: { id } });
  }
}
