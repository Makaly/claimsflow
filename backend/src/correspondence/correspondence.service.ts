import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { EmailService } from '../notifications/email.service';

@Injectable()
export class CorrespondenceService {
  constructor(
    private prisma: PrismaService,
    private email: EmailService,
  ) {}

  async listTemplates() {
    return this.prisma.letterTemplate.findMany({ where: { isActive: true }, orderBy: { code: 'asc' } });
  }

  async upsertTemplate(data: {
    code: string; name: string; subject: string; bodyTemplate: string;
    channel: string; locale: string;
  }) {
    return this.prisma.letterTemplate.upsert({
      where: { code: data.code },
      create: data,
      update: data,
    });
  }

  // Render a template with {{var}} substitution and return PDF bytes + rendered body.
  async generateLetter(
    templateCode: string,
    variables: Record<string, string>,
    options: { claimId?: string; recipientEmail?: string; send?: boolean },
  ) {
    const template = await this.prisma.letterTemplate.findUnique({ where: { code: templateCode } });
    if (!template) throw new NotFoundException(`Template '${templateCode}' not found`);

    const body = this.interpolate(template.bodyTemplate, variables);
    const subject = this.interpolate(template.subject, variables);

    let pdfBytes: Buffer | null = null;
    if (template.channel !== 'email') {
      pdfBytes = await this.renderPdf(subject, body);
    }

    // File in audit trail as a LETTER document when tied to a claim.
    if (options.claimId) {
      await this.prisma.document.create({
        data: {
          filename: `${templateCode}-${Date.now()}.pdf`,
          originalName: `${template.name}.pdf`,
          mimetype: 'application/pdf',
          size: pdfBytes ? BigInt(pdfBytes.length) : BigInt(0),
          path: `letters/${templateCode}-${Date.now()}.pdf`,
          documentType: 'LETTER',
          claimId: options.claimId,
          ocrStatus: 'skipped',
          metadata: { templateCode, variables, subject },
        },
      });
    }

    // Optionally send via email.
    if (options.send && options.recipientEmail && template.channel !== 'pdf') {
      await this.email.sendEmail({
        to: options.recipientEmail,
        subject,
        text: body,
      });
    }

    return { subject, body, pdfBase64: pdfBytes?.toString('base64') ?? null };
  }

  private interpolate(template: string, vars: Record<string, string>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
  }

  private async renderPdf(title: string, body: string): Promise<Buffer> {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([595, 842]); // A4

    const lines = body.split('\n');
    let y = 780;
    page.drawText(title, { x: 50, y, size: 14, font, color: rgb(0, 0, 0) });
    y -= 30;

    for (const line of lines) {
      page.drawText(line, { x: 50, y, size: 10, font, color: rgb(0.1, 0.1, 0.1) });
      y -= 15;
      if (y < 60) {
        // New page if we run out of space.
        const newPage = doc.addPage([595, 842]);
        y = 780;
        // Continue drawing on the new page — simplified for now.
        // TODO: carry page reference through loop.
        void newPage;
        break;
      }
    }

    const bytes = await doc.save();
    return Buffer.from(bytes);
  }
}
