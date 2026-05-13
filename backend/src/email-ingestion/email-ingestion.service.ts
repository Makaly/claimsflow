import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { Cron, CronExpression } from '@nestjs/schedule';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { redactEmail } from '../common/services/pii-redaction';

/**
 * Email Ingestion Service
 *
 * Polls a configured Gmail or Outlook mailbox via OAuth 2.0 and extracts
 * PDF attachments to create batch submissions automatically.
 *
 * Environment variables:
 *   EMAIL_INGESTION_ENABLED       = true/false
 *   EMAIL_PROVIDER                = gmail | outlook
 *   EMAIL_OAUTH_CLIENT_ID
 *   EMAIL_OAUTH_CLIENT_SECRET
 *   EMAIL_OAUTH_REFRESH_TOKEN
 *   EMAIL_INBOX_USER              = mailbox to poll (e.g. claims@cic.co.ke)
 *   EMAIL_SUBJECT_FILTER          = optional subject keyword filter
 */
@Injectable()
export class EmailIngestionService {
  private readonly logger = new Logger(EmailIngestionService.name);
  private readonly enabled: boolean;
  private readonly provider: 'gmail' | 'outlook';
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly refreshToken: string;
  private readonly inboxUser: string;
  private readonly subjectFilter: string;
  private accessToken: string | null = null;
  private tokenExpiresAt: number = 0;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {
    this.enabled = this.configService.get('EMAIL_INGESTION_ENABLED') === 'true';
    this.provider = (this.configService.get('EMAIL_PROVIDER') || 'gmail') as any;
    this.clientId = this.configService.get('EMAIL_OAUTH_CLIENT_ID') || '';
    this.clientSecret = this.configService.get('EMAIL_OAUTH_CLIENT_SECRET') || '';
    this.refreshToken = this.configService.get('EMAIL_OAUTH_REFRESH_TOKEN') || '';
    this.inboxUser = this.configService.get('EMAIL_INBOX_USER') || '';
    this.subjectFilter = this.configService.get('EMAIL_SUBJECT_FILTER') || 'claim';

    if (this.enabled) {
      this.logger.log(`Email ingestion enabled (${this.provider}) – polling ${redactEmail(this.inboxUser)}`);
    } else {
      this.logger.log('Email ingestion disabled – set EMAIL_INGESTION_ENABLED=true to enable');
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Scheduled polling (every 5 minutes)
  // ─────────────────────────────────────────────────────────────

  @Cron(CronExpression.EVERY_5_MINUTES)
  async pollMailbox() {
    if (!this.enabled) return;

    try {
      this.logger.log('Email ingestion: polling mailbox…');
      const messages = await this.fetchUnreadMessages();
      this.logger.log(`Email ingestion: ${messages.length} unread message(s) found`);

      let processed = 0;
      let skipped = 0;

      for (const message of messages) {
        try {
          const result = await this.processMessage(message);
          if (result.attachmentsFound > 0) {
            processed++;
          } else {
            skipped++;
          }
          await this.markAsRead(message.id);
        } catch (err: any) {
          this.logger.error(`Failed to process email ${message.id}: ${err?.message}`);
        }
      }

      this.logger.log(`Email ingestion: processed=${processed}, skipped=${skipped}`);
    } catch (err: any) {
      this.logger.error(`Email polling failed: ${err?.message}`);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // OAuth 2.0 token management
  // ─────────────────────────────────────────────────────────────

  async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 60_000) {
      return this.accessToken;
    }

    const tokenUrl = this.provider === 'gmail'
      ? 'https://oauth2.googleapis.com/token'
      : 'https://login.microsoftonline.com/common/oauth2/v2.0/token';

    const params = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: this.refreshToken,
      grant_type: 'refresh_token',
    });

    if (this.provider === 'gmail') {
      params.set('scope', 'https://www.googleapis.com/auth/gmail.modify');
    }

    const response = await axios.post(tokenUrl, params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    this.accessToken = response.data.access_token;
    this.tokenExpiresAt = Date.now() + (response.data.expires_in || 3600) * 1000;
    return this.accessToken!;
  }

  // ─────────────────────────────────────────────────────────────
  // Message fetching
  // ─────────────────────────────────────────────────────────────

  private async fetchUnreadMessages(): Promise<any[]> {
    const token = await this.getAccessToken();

    if (this.provider === 'gmail') {
      return this.fetchGmailMessages(token);
    } else {
      return this.fetchOutlookMessages(token);
    }
  }

  private async fetchGmailMessages(token: string): Promise<any[]> {
    const query = `is:unread has:attachment subject:${this.subjectFilter}`;
    const listRes = await axios.get(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=20`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    const messages = listRes.data.messages || [];
    const full: any[] = [];

    for (const msg of messages) {
      const detail = await axios.get(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      full.push({ id: msg.id, raw: detail.data, provider: 'gmail' });
    }

    return full;
  }

  private async fetchOutlookMessages(token: string): Promise<any[]> {
    const filter = `isRead eq false and hasAttachments eq true and contains(subject,'${this.subjectFilter}')`;
    const res = await axios.get(
      `https://graph.microsoft.com/v1.0/users/${this.inboxUser}/messages?$filter=${encodeURIComponent(filter)}&$top=20`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    return (res.data.value || []).map((m: any) => ({ id: m.id, raw: m, provider: 'outlook' }));
  }

  // ─────────────────────────────────────────────────────────────
  // Message processing
  // ─────────────────────────────────────────────────────────────

  private async processMessage(message: any): Promise<{ attachmentsFound: number }> {
    const token = await this.getAccessToken();
    const attachments = message.provider === 'gmail'
      ? await this.extractGmailAttachments(message, token)
      : await this.extractOutlookAttachments(message, token);

    const pdfAttachments = attachments.filter((a) =>
      a.filename.toLowerCase().endsWith('.pdf') || a.mimeType === 'application/pdf',
    );

    if (pdfAttachments.length === 0) return { attachmentsFound: 0 };

    // Save PDFs to disk and create a batch submission record
    const uploadDir = path.join(process.cwd(), 'uploads', 'email-ingestion');
    fs.mkdirSync(uploadDir, { recursive: true });

    const senderEmail = this.getSenderEmail(message);
    const subject = this.getSubject(message);

    // Try to find provider by email
    const provider = await this.prisma.provider.findFirst({
      where: { email: senderEmail, status: 'approved' },
    });

    const batchDate = new Date();
    const batchNumber = `CIC-EMAIL-${batchDate.toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(Math.random() * 9000) + 1000}`;

    const savedPaths: string[] = [];
    for (const att of pdfAttachments) {
      const filename = `${Date.now()}_${att.filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const filepath = path.join(uploadDir, filename);
      fs.writeFileSync(filepath, att.data);
      savedPaths.push(filepath);
    }

    // Create a batch submission if provider is known
    if (provider) {
      const batch = await this.prisma.batchSubmission.create({
        data: {
          batchNumber,
          providerId: provider.id,
          submissionMethod: 'email',
          totalClaims: pdfAttachments.length,
          status: 'processing',
          uploadedBy: senderEmail,
        },
      });

      // Create a document record for each PDF
      for (let i = 0; i < savedPaths.length; i++) {
        await this.prisma.document.create({
          data: {
            filename: path.basename(savedPaths[i]),
            originalName: pdfAttachments[i].filename,
            mimetype: 'application/pdf',
            size: fs.statSync(savedPaths[i]).size,
            path: savedPaths[i],
            batchNumber,
          },
        });
      }

      // Update batch to completed
      await this.prisma.batchSubmission.update({
        where: { id: batch.id },
        data: { status: 'completed', completedAt: new Date() },
      });

      this.logger.log(`Email batch ${batchNumber} created from ${redactEmail(senderEmail)}: ${pdfAttachments.length} PDF(s)`);
    } else {
      // Provider not found – save docs as orphaned with a note for manual assignment
      this.logger.warn(`Email from unknown sender ${redactEmail(senderEmail)} – documents saved for manual assignment`);
      for (let i = 0; i < savedPaths.length; i++) {
        await this.prisma.document.create({
          data: {
            filename: path.basename(savedPaths[i]),
            originalName: pdfAttachments[i].filename,
            mimetype: 'application/pdf',
            size: fs.statSync(savedPaths[i]).size,
            path: savedPaths[i],
            batchNumber,
            metadata: { source: 'email', senderEmail, subject, requiresManualAssignment: true },
          },
        });
      }
    }

    return { attachmentsFound: pdfAttachments.length };
  }

  private async extractGmailAttachments(message: any, token: string) {
    const parts = this.flattenParts(message.raw.payload?.parts || []);
    const attachments: any[] = [];

    for (const part of parts) {
      if (part.filename && part.body?.attachmentId) {
        const attRes = await axios.get(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${message.id}/attachments/${part.body.attachmentId}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        const data = Buffer.from(attRes.data.data, 'base64');
        attachments.push({
          filename: part.filename,
          mimeType: part.mimeType,
          data,
        });
      } else if (part.filename && part.body?.data) {
        const data = Buffer.from(part.body.data, 'base64');
        attachments.push({ filename: part.filename, mimeType: part.mimeType, data });
      }
    }

    return attachments;
  }

  private async extractOutlookAttachments(message: any, token: string) {
    const res = await axios.get(
      `https://graph.microsoft.com/v1.0/users/${this.inboxUser}/messages/${message.id}/attachments`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    return (res.data.value || []).map((att: any) => ({
      filename: att.name,
      mimeType: att.contentType,
      data: Buffer.from(att.contentBytes, 'base64'),
    }));
  }

  private flattenParts(parts: any[]): any[] {
    const flat: any[] = [];
    for (const part of parts) {
      flat.push(part);
      if (part.parts) flat.push(...this.flattenParts(part.parts));
    }
    return flat;
  }

  private getSenderEmail(message: any): string {
    if (message.provider === 'gmail') {
      const headers = message.raw.payload?.headers || [];
      const from = headers.find((h: any) => h.name === 'From')?.value || '';
      const match = from.match(/<(.+?)>/) || from.match(/[\w.+-]+@[\w-]+\.\w+/);
      return match ? (match[1] || match[0]) : from;
    }
    return message.raw.from?.emailAddress?.address || '';
  }

  private getSubject(message: any): string {
    if (message.provider === 'gmail') {
      const headers = message.raw.payload?.headers || [];
      return headers.find((h: any) => h.name === 'Subject')?.value || '';
    }
    return message.raw.subject || '';
  }

  private async markAsRead(messageId: string) {
    const token = await this.getAccessToken();

    if (this.provider === 'gmail') {
      await axios.post(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`,
        { removeLabelIds: ['UNREAD'] },
        { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } },
      );
    } else {
      await axios.patch(
        `https://graph.microsoft.com/v1.0/users/${this.inboxUser}/messages/${messageId}`,
        { isRead: true },
        { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } },
      );
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Manual trigger & status
  // ─────────────────────────────────────────────────────────────

  async triggerManualPoll() {
    if (!this.enabled) {
      return { success: false, message: 'Email ingestion is not enabled' };
    }
    await this.pollMailbox();
    return { success: true, message: 'Manual poll triggered' };
  }

  getStatus() {
    return {
      enabled: this.enabled,
      provider: this.provider,
      inboxUser: this.inboxUser,
      subjectFilter: this.subjectFilter,
      configured: !!(this.clientId && this.clientSecret && this.refreshToken),
    };
  }

  async getOAuthAuthorizationUrl(redirectUri: string) {
    if (this.provider === 'gmail') {
      const params = new URLSearchParams({
        client_id: this.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'https://www.googleapis.com/auth/gmail.modify',
        access_type: 'offline',
        prompt: 'consent',
      });
      return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
    } else {
      const params = new URLSearchParams({
        client_id: this.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'https://graph.microsoft.com/Mail.ReadWrite offline_access',
      });
      return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params}`;
    }
  }

  async exchangeCodeForTokens(code: string, redirectUri: string) {
    const tokenUrl = this.provider === 'gmail'
      ? 'https://oauth2.googleapis.com/token'
      : 'https://login.microsoftonline.com/common/oauth2/v2.0/token';

    const params = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    });

    const response = await axios.post(tokenUrl, params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    return {
      access_token: response.data.access_token,
      refresh_token: response.data.refresh_token,
      expires_in: response.data.expires_in,
    };
  }
}
