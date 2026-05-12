import { Injectable, Logger, NotFoundException } from '@nestjs/common';
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
        filePath:        permanentPath,
        fileName:        params.fileName,
        mimeType:        params.mimeType,
        claimId:         params.claimId,
        uploadedBy:      params.uploadedBy,
        guessedType,
        guessedProvider,
        rawExtract:      rawExtract ?? {},
        status:          'pending',
      },
    });

    this.logger.log(`Recorded unknown document: ${record.id} (${params.fileName})`);

    // Create in-app notification for all admins
    try {
      const admins = await this.prisma.user.findMany({
        where: { role: { in: ['admin', 'supervisor'] } },
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

  async remove(id: string) {
    const doc = await this.findOne(id);
    // Clean up the file if it still exists
    if (doc.filePath && fs.existsSync(doc.filePath)) {
      try { fs.unlinkSync(doc.filePath); } catch (_) {}
    }
    await this.prisma.unknownDocument.delete({ where: { id } });
  }
}
