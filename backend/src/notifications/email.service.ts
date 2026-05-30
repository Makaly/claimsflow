import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { redactEmail } from '../common/services/pii-redaction';

export interface WorkflowEmailDto {
  recipientEmail: string;
  subject: string;
  badgeText: string;
  badgeStyle: 'green' | 'blue' | 'amber' | 'red' | 'purple' | 'cyan';
  title: string;
  subtitle?: string;
  claimNumber: string;
  providerName: string;
  invoiceAmount?: number;
  greeting?: string;
  bodyLines: string[];
  reasonLabel?: string;
  reasonText?: string;
  missingDocuments?: string[];
  ctaText?: string;
  ctaUrl?: string;
  nextNote?: string;
}

export interface BatchClaimRow {
  claimNumber: string;
  barcode: string;
  patientName: string;
  providerName: string;
  invoiceNumber: string;
  invoiceDate: string;
  invoiceAmount: number;
  diagnosis?: string; // kept in DTO for completeness but not rendered in email
}

export interface BatchConfirmationDto {
  recipientEmail: string;
  submittedBy: string;
  batchNumber: string;
  totalClaims: number;
  totalAmount: number;
  claims: BatchClaimRow[];
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter;

  constructor(private configService: ConfigService) {
    this.transporter = nodemailer.createTransport({
      host: this.configService.get('SMTP_HOST'),
      port: parseInt(this.configService.get('SMTP_PORT') || '587'),
      secure: this.configService.get('SMTP_SECURE') === 'true',
      auth: {
        user: this.configService.get('SMTP_USER'),
        pass: this.configService.get('SMTP_PASSWORD'),
      },
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 10000,
    });
  }

  async sendEmail(
    to: string,
    subject: string,
    text: string,
    html?: string,
    attachments?: { filename: string; path?: string; content?: string; encoding?: string }[],
  ) {
    const mailOptions: nodemailer.SendMailOptions = {
      from: `"CIC Medical Claims" <${this.configService.get('SMTP_FROM')}>`,
      to,
      subject,
      text,
      html: html || text,
      ...(attachments?.length ? { attachments } : {}),
    };

    try {
      const info = await this.transporter.sendMail(mailOptions);
      this.logger.log(`Email sent to ${redactEmail(to)}: ${info.messageId}`);
      return info;
    } catch (error) {
      this.logger.error(`Failed to send email to ${redactEmail(to)}:`, error);
      throw error;
    }
  }

  // ─── Batch Submission Confirmation ────────────────────────────────────────

  async sendBatchConfirmation(dto: BatchConfirmationDto): Promise<void> {
    const { recipientEmail, submittedBy, batchNumber, totalClaims, totalAmount, claims } = dto;
    const submittedAt = new Date().toLocaleString('en-KE', {
      timeZone: 'Africa/Nairobi',
      dateStyle: 'full',
      timeStyle: 'short',
    });

    const fmt = (n: number) =>
      'KES ' + n.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    // ── Inline SVG icons (Lucide-style, 16×16) ──────────────────────────────
    const iconCheck = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle"><polyline points="20 6 9 17 4 12"/></svg>`;
    const iconFiles = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
    const iconCoin  = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
    const iconTag   = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>`;
    const iconArrow = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#71717a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>`;
    const iconShield = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;
    const iconGear  = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fb923c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
    const iconMoney = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>`;

    const claimRows = claims.map((c, i) => `
      <tr style="background:${i % 2 === 0 ? '#18181b' : '#1c1c1f'}">
        <td style="padding:10px 12px;border-bottom:1px solid #27272a;font-size:11px;color:#a1a1aa;font-family:'Courier New',monospace;white-space:nowrap">${c.barcode}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #27272a;font-size:12px;color:#e4e4e7;font-weight:500">${c.patientName || '—'}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #27272a;font-size:12px;color:#a1a1aa">${c.providerName || '—'}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #27272a;font-size:11px;color:#71717a;font-family:'Courier New',monospace">${c.invoiceNumber || '—'}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #27272a;font-size:11px;color:#71717a;white-space:nowrap">${c.invoiceDate || '—'}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #27272a;font-size:12px;color:#34d399;font-weight:700;text-align:right;white-space:nowrap">${fmt(c.invoiceAmount)}</td>
      </tr>`).join('');

    const html = `
<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="color-scheme" content="dark" />
  <meta name="supported-color-schemes" content="dark" />
  <title>Batch Submission Confirmation — CIC</title>
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#09090b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Helvetica Neue',Arial,sans-serif;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%">

  <!-- ════════════════════════════════════════════════════════
       OUTER WRAPPER
  ════════════════════════════════════════════════════════ -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
         style="background-color:#09090b;min-height:100vh;padding:32px 12px">
    <tr><td align="center" valign="top">

    <!-- Card -->
    <table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0"
           style="max-width:640px;width:100%;border-radius:16px;overflow:hidden;border:1px solid #27272a">

      <!-- ══ TOP ACCENT LINE ══════════════════════════════════ -->
      <tr>
        <td style="background:linear-gradient(90deg,#10b981 0%,#06b6d4 50%,#6366f1 100%);height:3px;font-size:0;line-height:0">&nbsp;</td>
      </tr>

      <!-- ══ HEADER ══════════════════════════════════════════ -->
      <tr>
        <td style="background-color:#111113;padding:32px 36px 28px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td valign="middle">
                <!-- Brand pill -->
                <div style="display:inline-block;background:#1c1c1f;border:1px solid #3f3f46;border-radius:8px;padding:5px 12px;margin-bottom:16px">
                  <span style="color:#71717a;font-size:10px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase">CIC Insurance Group</span>
                </div>
                <h1 style="margin:0 0 8px;color:#fafafa;font-size:24px;font-weight:700;letter-spacing:-0.5px;line-height:1.2">
                  Batch Submitted Successfully
                </h1>
                <p style="margin:0;color:#71717a;font-size:13px;line-height:1.5">${submittedAt} &nbsp;·&nbsp; Submitted by <span style="color:#a1a1aa;font-weight:500">${submittedBy}</span></p>
              </td>
              <td valign="middle" align="right" style="padding-left:20px;min-width:64px">
                <!-- Check circle badge -->
                <div style="width:56px;height:56px;background:linear-gradient(135deg,#052e16,#064e3b);border:1.5px solid #059669;border-radius:50%;text-align:center;line-height:56px">
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-top:14px"><polyline points="20 6 9 17 4 12"/></svg>
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- ══ STATUS BAR ═══════════════════════════════════════ -->
      <tr>
        <td style="background-color:#0d1117;border-top:1px solid #27272a;border-bottom:1px solid #27272a;padding:12px 36px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td>
                <span style="display:inline-block;background:#052e16;border:1px solid #166534;border-radius:20px;padding:4px 12px;font-size:11px;color:#4ade80;font-weight:600;letter-spacing:0.5px;text-transform:uppercase">
                  ${iconCheck} &nbsp;Processing Queued
                </span>
              </td>
              <td align="right">
                <span style="font-size:12px;color:#52525b">Batch Ref: &nbsp;</span>
                <span style="font-size:12px;color:#a78bfa;font-family:'Courier New',monospace;font-weight:600">${batchNumber}</span>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- ══ BODY ═════════════════════════════════════════════ -->
      <tr>
        <td style="background-color:#0f0f11;padding:28px 36px">

          <!-- Greeting -->
          <p style="margin:0 0 28px;color:#a1a1aa;font-size:14px;line-height:1.7">
            Dear <strong style="color:#e4e4e7">${submittedBy}</strong>, your batch of medical claims has been
            <strong style="color:#10b981">successfully submitted</strong> to the CIC Medical Claims system
            and is now queued for Maker-Checker review.
          </p>

          <!-- ── KPI CARDS ─────────────────────────────────── -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:28px">
            <tr>
              <!-- Claims Submitted -->
              <td width="31%" valign="top" style="padding-right:8px">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                       style="background:#18181b;border:1px solid #27272a;border-radius:12px;overflow:hidden">
                  <tr><td style="padding:4px 0 0;background:linear-gradient(90deg,#1d4ed8,#3b82f6);height:2px;font-size:0">&nbsp;</td></tr>
                  <tr>
                    <td style="padding:16px 16px 18px;text-align:center">
                      <div style="margin-bottom:8px">${iconFiles}</div>
                      <div style="font-size:30px;font-weight:800;color:#60a5fa;line-height:1;letter-spacing:-1px">${totalClaims}</div>
                      <div style="font-size:10px;color:#3b82f6;font-weight:600;text-transform:uppercase;letter-spacing:1.2px;margin-top:6px">Claims</div>
                    </td>
                  </tr>
                </table>
              </td>
              <!-- Total Amount -->
              <td width="38%" valign="top" style="padding:0 4px">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                       style="background:#18181b;border:1px solid #27272a;border-radius:12px;overflow:hidden">
                  <tr><td style="padding:4px 0 0;background:linear-gradient(90deg,#065f46,#10b981);height:2px;font-size:0">&nbsp;</td></tr>
                  <tr>
                    <td style="padding:16px 12px 18px;text-align:center">
                      <div style="margin-bottom:8px">${iconCoin}</div>
                      <div style="font-size:16px;font-weight:800;color:#34d399;line-height:1.15;letter-spacing:-0.3px">${fmt(totalAmount)}</div>
                      <div style="font-size:10px;color:#10b981;font-weight:600;text-transform:uppercase;letter-spacing:1.2px;margin-top:6px">Total Value</div>
                    </td>
                  </tr>
                </table>
              </td>
              <!-- Batch Ref -->
              <td width="31%" valign="top" style="padding-left:8px">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                       style="background:#18181b;border:1px solid #27272a;border-radius:12px;overflow:hidden">
                  <tr><td style="padding:4px 0 0;background:linear-gradient(90deg,#4c1d95,#7c3aed);height:2px;font-size:0">&nbsp;</td></tr>
                  <tr>
                    <td style="padding:16px 10px 18px;text-align:center">
                      <div style="margin-bottom:8px">${iconTag}</div>
                      <div style="font-size:12px;font-weight:700;color:#a78bfa;line-height:1.3;font-family:'Courier New',monospace;word-break:break-all">${batchNumber}</div>
                      <div style="font-size:10px;color:#7c3aed;font-weight:600;text-transform:uppercase;letter-spacing:1.2px;margin-top:6px">Batch Ref</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>

          <!-- ── SECTION LABEL ─────────────────────────────── -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:10px">
            <tr>
              <td style="border-left:3px solid #10b981;padding-left:12px">
                <span style="font-size:13px;font-weight:700;color:#e4e4e7;text-transform:uppercase;letter-spacing:0.8px">Submitted Claims</span>
                <span style="font-size:12px;color:#52525b;margin-left:8px">${iconArrow} ${totalClaims} records</span>
              </td>
            </tr>
          </table>

          <!-- ── CLAIMS TABLE ──────────────────────────────── -->
          <div style="border-radius:10px;overflow:hidden;border:1px solid #27272a">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <!-- thead -->
              <tr style="background:#1c1c1f">
                <th style="padding:10px 12px;font-size:10px;color:#52525b;font-weight:600;text-align:left;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #27272a">Barcode</th>
                <th style="padding:10px 12px;font-size:10px;color:#52525b;font-weight:600;text-align:left;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #27272a">Patient</th>
                <th style="padding:10px 12px;font-size:10px;color:#52525b;font-weight:600;text-align:left;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #27272a">Provider</th>
                <th style="padding:10px 12px;font-size:10px;color:#52525b;font-weight:600;text-align:left;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #27272a">Inv. No.</th>
                <th style="padding:10px 12px;font-size:10px;color:#52525b;font-weight:600;text-align:left;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #27272a">Date</th>
                <th style="padding:10px 12px;font-size:10px;color:#52525b;font-weight:600;text-align:right;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #27272a">Amount</th>
              </tr>
              <!-- rows -->
              ${claimRows}
              <!-- tfoot -->
              <tr style="background:#18181b">
                <td colspan="5" style="padding:12px 14px;font-size:12px;color:#52525b;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;border-top:1px solid #27272a">
                  Total &nbsp;<span style="color:#3f3f46;font-weight:400">(${totalClaims} claims)</span>
                </td>
                <td style="padding:12px 14px;font-size:14px;color:#34d399;font-weight:800;text-align:right;border-top:1px solid #27272a">${fmt(totalAmount)}</td>
              </tr>
            </table>
          </div>

          <!-- ── WHAT HAPPENS NEXT ──────────────────────────── -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                 style="background:#18181b;border:1px solid #27272a;border-radius:12px;margin-top:24px;overflow:hidden">
            <tr>
              <td style="padding:20px 20px 4px">
                <p style="margin:0 0 16px;font-size:12px;font-weight:700;color:#71717a;text-transform:uppercase;letter-spacing:1.5px">What Happens Next</p>
              </td>
            </tr>
            <!-- Step 1 -->
            <tr>
              <td style="padding:8px 20px">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td valign="top" style="padding-right:14px;padding-top:2px">
                      <div style="width:28px;height:28px;background:#0c1524;border:1px solid #1d4ed8;border-radius:8px;text-align:center;line-height:28px">
                        ${iconShield}
                      </div>
                    </td>
                    <td valign="top">
                      <p style="margin:0 0 2px;font-size:13px;font-weight:600;color:#e4e4e7">Maker Review</p>
                      <p style="margin:0;font-size:12px;color:#71717a;line-height:1.5">A claims officer verifies each submission for completeness and medical accuracy.</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr><td style="padding:0 20px"><div style="border-top:1px dashed #27272a"></div></td></tr>
            <!-- Step 2 -->
            <tr>
              <td style="padding:8px 20px">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td valign="top" style="padding-right:14px;padding-top:2px">
                      <div style="width:28px;height:28px;background:#1a0a00;border:1px solid #ea580c;border-radius:8px;text-align:center;line-height:28px">
                        ${iconGear}
                      </div>
                    </td>
                    <td valign="top">
                      <p style="margin:0 0 2px;font-size:13px;font-weight:600;color:#e4e4e7">Checker Approval</p>
                      <p style="margin:0;font-size:12px;color:#71717a;line-height:1.5">A senior officer performs second-level review and authorises payment release.</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr><td style="padding:0 20px"><div style="border-top:1px dashed #27272a"></div></td></tr>
            <!-- Step 3 -->
            <tr>
              <td style="padding:8px 20px 20px">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td valign="top" style="padding-right:14px;padding-top:2px">
                      <div style="width:28px;height:28px;background:#052e16;border:1px solid #16a34a;border-radius:8px;text-align:center;line-height:28px">
                        ${iconMoney}
                      </div>
                    </td>
                    <td valign="top">
                      <p style="margin:0 0 2px;font-size:13px;font-weight:600;color:#e4e4e7">Payment Processing</p>
                      <p style="margin:0;font-size:12px;color:#71717a;line-height:1.5">Approved claims are forwarded to Finance for settlement within the agreed SLA.</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>

          <!-- Reference note -->
          <p style="margin:20px 0 0;font-size:12px;color:#52525b;line-height:1.6;background:#18181b;border:1px solid #27272a;border-radius:8px;padding:12px 16px">
            For queries about this submission, quote batch reference
            <strong style="color:#a78bfa;font-family:'Courier New',monospace">${batchNumber}</strong>
            when contacting the Claims Department.
          </p>

        </td>
      </tr>

      <!-- ══ FOOTER ════════════════════════════════════════════ -->
      <tr>
        <td style="background-color:#111113;border-top:1px solid #27272a;padding:24px 36px;text-align:center">
          <!-- Accent line -->
          <div style="width:40px;height:2px;background:linear-gradient(90deg,#10b981,#06b6d4);margin:0 auto 16px;border-radius:2px"></div>
          <p style="margin:0 0 4px;color:#52525b;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:1px">CIC Insurance Group</p>
          <p style="margin:0 0 4px;color:#3f3f46;font-size:11px">Medical Claims Division</p>
          <p style="margin:0 0 14px;color:#3f3f46;font-size:11px">P.O. Box 59485-00200, Nairobi &nbsp;·&nbsp; claims@cic.co.ke &nbsp;·&nbsp; +254 703 099 000</p>
          <p style="margin:0;color:#27272a;font-size:10px">This is an automated message — please do not reply &nbsp;·&nbsp; © ${new Date().getFullYear()} CIC Insurance Group</p>
        </td>
      </tr>

      <!-- ══ BOTTOM ACCENT LINE ════════════════════════════════ -->
      <tr>
        <td style="background:linear-gradient(90deg,#6366f1 0%,#06b6d4 50%,#10b981 100%);height:3px;font-size:0;line-height:0">&nbsp;</td>
      </tr>

    </table>
    <!-- /Card -->

    </td></tr>
  </table>
</body>
</html>`;

    const text = `CIC Medical Claims — Batch Submission Confirmation\n\nBatch: ${batchNumber}\nSubmitted by: ${submittedBy}\nDate: ${submittedAt}\nTotal Claims: ${totalClaims}\nTotal Amount: ${fmt(totalAmount)}\n\nClaims:\n${claims.map(c => `  ${c.barcode} | ${c.patientName} | ${c.providerName} | ${fmt(c.invoiceAmount)}`).join('\n')}`;

    await this.sendEmail(
      recipientEmail,
      `Batch Submitted · ${batchNumber} · ${totalClaims} claim${totalClaims !== 1 ? 's' : ''} · ${fmt(totalAmount)}`,
      text,
      html,
    );
  }

  // ─── Provider Welcome Email ───────────────────────────────────────────────

  async sendProviderWelcomeEmail(dto: {
    adminEmail: string;
    adminName: string;
    providerName: string;
    loginUrl: string;
  }): Promise<void> {
    const { adminEmail, adminName, providerName, loginUrl } = dto;

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Welcome to ClaimsFlow — CIC Insurance</title>
</head>
<body style="margin:0;padding:0;background:#09090b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
         style="background:#09090b;padding:32px 12px">
    <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
           style="max-width:600px;width:100%;border-radius:16px;overflow:hidden;border:1px solid #27272a">

      <!-- Top accent -->
      <tr><td style="background:linear-gradient(90deg,#10b981 0%,#06b6d4 50%,#6366f1 100%);height:3px;font-size:0">&nbsp;</td></tr>

      <!-- Header -->
      <tr>
        <td style="background:#111113;padding:32px 36px 24px">
          <div style="display:inline-block;background:#1c1c1f;border:1px solid #3f3f46;border-radius:8px;padding:5px 12px;margin-bottom:16px">
            <span style="color:#71717a;font-size:10px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase">CIC Insurance Group</span>
          </div>
          <h1 style="margin:0 0 8px;color:#fafafa;font-size:24px;font-weight:700;letter-spacing:-0.5px">
            Welcome to ClaimsFlow!
          </h1>
          <p style="margin:0;color:#71717a;font-size:13px">Your provider account has been created and is pending review.</p>
        </td>
      </tr>

      <!-- Body -->
      <tr>
        <td style="background:#0f0f11;padding:28px 36px">
          <p style="margin:0 0 20px;color:#a1a1aa;font-size:14px;line-height:1.7">
            Dear <strong style="color:#e4e4e7">${adminName}</strong>,<br/><br/>
            Your provider account for <strong style="color:#10b981">${providerName}</strong> has been
            successfully created on the CIC Medical Claims portal.
          </p>

          <!-- Steps box -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                 style="background:#18181b;border:1px solid #27272a;border-radius:12px;margin-bottom:24px">
            <tr><td style="padding:20px 24px 8px">
              <p style="margin:0 0 16px;font-size:11px;font-weight:700;color:#71717a;text-transform:uppercase;letter-spacing:1.5px">Complete your setup — 2 steps</p>
            </td></tr>

            <!-- Step 1 -->
            <tr><td style="padding:8px 24px">
              <table cellpadding="0" cellspacing="0" border="0"><tr>
                <td valign="top" style="padding-right:14px;padding-top:2px">
                  <div style="width:28px;height:28px;background:#0c1524;border:1.5px solid #3b82f6;border-radius:50%;text-align:center;line-height:28px;font-size:13px;font-weight:700;color:#60a5fa">1</div>
                </td>
                <td valign="top">
                  <p style="margin:0 0 2px;font-size:13px;font-weight:600;color:#e4e4e7">Log in to ClaimsFlow</p>
                  <p style="margin:0;font-size:12px;color:#71717a;line-height:1.5">Use the email and password you registered with.</p>
                </td>
              </tr></table>
            </td></tr>

            <tr><td style="padding:0 24px"><div style="border-top:1px dashed #27272a"></div></td></tr>

            <!-- Step 2 -->
            <tr><td style="padding:8px 24px 20px">
              <table cellpadding="0" cellspacing="0" border="0"><tr>
                <td valign="top" style="padding-right:14px;padding-top:2px">
                  <div style="width:28px;height:28px;background:#052e16;border:1.5px solid #16a34a;border-radius:50%;text-align:center;line-height:28px;font-size:13px;font-weight:700;color:#4ade80">2</div>
                </td>
                <td valign="top">
                  <p style="margin:0 0 2px;font-size:13px;font-weight:600;color:#e4e4e7">Upload your proof document</p>
                  <p style="margin:0;font-size:12px;color:#71717a;line-height:1.5">
                    Upload your business registration certificate, KRA PIN, or licence.
                    Your account will be activated by CIC staff once reviewed — usually within <strong style="color:#a1a1aa">1–2 business days</strong>.
                  </p>
                </td>
              </tr></table>
            </td></tr>
          </table>

          <!-- CTA -->
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px">
            <tr>
              <td style="background:linear-gradient(135deg,#059669,#0891b2);border-radius:10px;padding:14px 28px;text-align:center">
                <a href="${loginUrl}" style="color:#fff;font-size:14px;font-weight:700;text-decoration:none;letter-spacing:0.3px">
                  Log in &amp; complete setup →
                </a>
              </td>
            </tr>
          </table>

          <p style="margin:0;font-size:12px;color:#52525b;background:#18181b;border:1px solid #27272a;border-radius:8px;padding:12px 16px;line-height:1.6">
            If you did not create this account, please contact us immediately at
            <a href="mailto:claims@cic.co.ke" style="color:#60a5fa">claims@cic.co.ke</a>.
          </p>
        </td>
      </tr>

      <!-- Footer -->
      <tr>
        <td style="background:#111113;border-top:1px solid #27272a;padding:20px 36px;text-align:center">
          <p style="margin:0 0 4px;color:#52525b;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px">CIC Insurance Group · Medical Claims Division</p>
          <p style="margin:0;color:#3f3f46;font-size:10px">P.O. Box 59485-00200, Nairobi &nbsp;·&nbsp; claims@cic.co.ke &nbsp;·&nbsp; © ${new Date().getFullYear()} CIC Insurance Group</p>
        </td>
      </tr>

      <!-- Bottom accent -->
      <tr><td style="background:linear-gradient(90deg,#6366f1 0%,#06b6d4 50%,#10b981 100%);height:3px;font-size:0">&nbsp;</td></tr>

    </table>
    </td></tr>
  </table>
</body>
</html>`;

    const text = `Welcome to ClaimsFlow — CIC Insurance Group\n\nDear ${adminName},\n\nYour provider account for "${providerName}" has been created.\n\nNext steps:\n1. Log in at ${loginUrl}\n2. Upload your proof document (business registration / KRA PIN / licence)\n\nYour account will be activated by CIC staff within 1–2 business days after document review.\n\nIf you did not create this account, contact claims@cic.co.ke immediately.\n\nCIC Insurance Group — Medical Claims Division`;

    await this.sendEmail(
      adminEmail,
      `Welcome to ClaimsFlow — complete your ${providerName} account setup`,
      text,
      html,
    );
  }

  // ─── Email OTP (Provider + User registration verification) ────────────────

  async sendEmailVerificationOtp(dto: { email: string; name: string; code: string }): Promise<void> {
    const { email, name, code } = dto;
    // Render the 6-digit code as six big spaced boxes — easier to read on
    // mobile + matches every other "enter the code" UX users have seen.
    const digits = code.split('').map(d => `
      <td style="padding:0 4px">
        <div style="width:42px;height:54px;background:#18181b;border:1px solid #27272a;border-radius:10px;text-align:center;line-height:54px;font-size:26px;font-weight:800;color:#fafafa;font-family:'Courier New',monospace;letter-spacing:0">${d}</div>
      </td>`).join('');

    const html = `<!DOCTYPE html>
<html lang="en"><head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <meta name="color-scheme" content="dark"/>
  <title>Your ClaimsFlow verification code</title>
</head>
<body style="margin:0;padding:0;background:#09090b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#09090b;padding:32px 12px">
    <tr><td align="center">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;border-radius:16px;overflow:hidden;border:1px solid #27272a">

      <tr><td style="background:linear-gradient(90deg,#10b981 0%,#06b6d4 50%,#6366f1 100%);height:3px;font-size:0">&nbsp;</td></tr>

      <tr>
        <td style="background:#111113;padding:32px 36px 24px">
          <div style="display:inline-block;background:#1c1c1f;border:1px solid #3f3f46;border-radius:8px;padding:5px 12px;margin-bottom:16px">
            <span style="color:#71717a;font-size:10px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase">CIC Insurance Group</span>
          </div>
          <h1 style="margin:0 0 8px;color:#fafafa;font-size:24px;font-weight:700;letter-spacing:-0.5px">Verify your email</h1>
          <p style="margin:0;color:#71717a;font-size:13px">One step before we activate your ClaimsFlow account.</p>
        </td>
      </tr>

      <tr>
        <td style="background:#0f0f11;padding:28px 36px">
          <p style="margin:0 0 24px;color:#a1a1aa;font-size:14px;line-height:1.7">
            Hi <strong style="color:#e4e4e7">${name}</strong>, enter the code below in ClaimsFlow to confirm
            <strong style="color:#e4e4e7">${email}</strong> belongs to you.
          </p>

          <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto 24px">
            <tr>${digits}</tr>
          </table>

          <p style="margin:0 0 14px;text-align:center;font-size:12px;color:#71717a">
            This code expires in <strong style="color:#a1a1aa">10 minutes</strong>.
          </p>

          <p style="margin:20px 0 0;font-size:12px;color:#52525b;background:#18181b;border:1px solid #27272a;border-radius:8px;padding:12px 16px;line-height:1.6">
            Didn't request this? You can safely ignore this email — without the code, nobody can sign in.
          </p>
        </td>
      </tr>

      <tr>
        <td style="background:#111113;border-top:1px solid #27272a;padding:20px 36px;text-align:center">
          <p style="margin:0 0 4px;color:#52525b;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px">CIC Insurance Group · Medical Claims Division</p>
          <p style="margin:0;color:#3f3f46;font-size:10px">P.O. Box 59485-00200, Nairobi &nbsp;·&nbsp; claims@cic.co.ke &nbsp;·&nbsp; © ${new Date().getFullYear()} CIC Insurance Group</p>
        </td>
      </tr>

      <tr><td style="background:linear-gradient(90deg,#6366f1 0%,#06b6d4 50%,#10b981 100%);height:3px;font-size:0">&nbsp;</td></tr>

    </table>
    </td></tr>
  </table>
</body></html>`;

    const text = `Hi ${name},\n\nYour ClaimsFlow verification code is: ${code}\n\nThis code expires in 10 minutes.\n\nIf you didn't request this, ignore this email.\n\nCIC Insurance Group — Medical Claims Division`;
    await this.sendEmail(email, `Your ClaimsFlow verification code: ${code}`, text, html);
  }

  // ─── Admin: New provider awaiting approval ────────────────────────────────

  async sendAdminNewProviderAlert(dto: {
    adminEmail: string;
    adminName?: string;
    providerName: string;
    providerType: string;
    contactPerson: string;
    contactEmail: string;
    reviewUrl: string;
  }): Promise<void> {
    const { adminEmail, adminName, providerName, providerType, contactPerson, contactEmail, reviewUrl } = dto;
    const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="color-scheme" content="dark"/><title>New provider awaiting approval</title></head>
<body style="margin:0;padding:0;background:#09090b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#09090b;padding:32px 12px">
    <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;border-radius:16px;overflow:hidden;border:1px solid #27272a">

      <tr><td style="background:linear-gradient(90deg,#78350f 0%,#d97706 50%,#fbbf24 100%);height:3px;font-size:0">&nbsp;</td></tr>

      <tr><td style="background:#111113;padding:28px 36px 24px">
        <div style="display:inline-block;background:#1c1c1f;border:1px solid #3f3f46;border-radius:8px;padding:5px 12px;margin-bottom:12px">
          <span style="color:#71717a;font-size:10px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase">CIC Insurance Group</span>
        </div><br/>
        <span style="display:inline-block;background:#1a0e00;border:1px solid #b45309;border-radius:20px;padding:3px 11px;font-size:10px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:#fbbf24;margin-bottom:14px">Action required</span>
        <h1 style="margin:0 0 6px;color:#fafafa;font-size:22px;font-weight:700;letter-spacing:-0.3px">New provider awaiting approval</h1>
        <p style="margin:4px 0 0;color:#71717a;font-size:13px">A provider has submitted their onboarding packet for review.</p>
      </td></tr>

      <tr><td style="background:#0f0f11;padding:24px 36px">
        ${adminName ? `<p style="margin:0 0 16px;color:#a1a1aa;font-size:14px">Hi <strong style="color:#e4e4e7">${adminName}</strong>,</p>` : ''}

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#18181b;border:1px solid #27272a;border-radius:12px;margin-bottom:20px">
          <tr><td style="padding:18px 20px">
            <p style="margin:0 0 6px;font-size:10px;font-weight:700;color:#71717a;text-transform:uppercase;letter-spacing:1.5px">Provider</p>
            <p style="margin:0 0 14px;font-size:16px;font-weight:700;color:#fafafa">${providerName}</p>
            <p style="margin:0 0 6px;font-size:10px;font-weight:700;color:#71717a;text-transform:uppercase;letter-spacing:1.5px">Type</p>
            <p style="margin:0 0 14px;font-size:13px;color:#e4e4e7;text-transform:capitalize">${providerType}</p>
            <p style="margin:0 0 6px;font-size:10px;font-weight:700;color:#71717a;text-transform:uppercase;letter-spacing:1.5px">Contact</p>
            <p style="margin:0;font-size:13px;color:#e4e4e7">${contactPerson} &nbsp;·&nbsp; <span style="color:#60a5fa">${contactEmail}</span></p>
          </td></tr>
        </table>

        <p style="margin:0 0 18px;color:#a1a1aa;font-size:13px;line-height:1.7">
          Review the packet — company profile, certifications, references, program of works — and approve or reject with a comment.
          You must scroll through every page of every uploaded document before approval is enabled.
        </p>

        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr><td style="background:linear-gradient(135deg,#d97706,#b45309);border-radius:10px;padding:13px 26px">
            <a href="${reviewUrl}" style="color:#fff;font-size:13px;font-weight:700;text-decoration:none;letter-spacing:0.3px">Open review queue →</a>
          </td></tr>
        </table>
      </td></tr>

      <tr><td style="background:#111113;border-top:1px solid #27272a;padding:20px 36px;text-align:center">
        <p style="margin:0 0 4px;color:#52525b;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px">CIC Insurance Group · Medical Claims Division</p>
        <p style="margin:0;color:#3f3f46;font-size:10px">P.O. Box 59485-00200, Nairobi &nbsp;·&nbsp; claims@cic.co.ke &nbsp;·&nbsp; © ${new Date().getFullYear()} CIC Insurance Group</p>
      </td></tr>

      <tr><td style="background:linear-gradient(90deg,#fbbf24 0%,#d97706 50%,#78350f 100%);height:3px;font-size:0">&nbsp;</td></tr>

    </table></td></tr>
  </table>
</body></html>`;

    const text = `${adminName ? `Hi ${adminName},\n\n` : ''}A new provider is awaiting approval on ClaimsFlow.\n\nProvider: ${providerName}\nType: ${providerType}\nContact: ${contactPerson} (${contactEmail})\n\nReview at: ${reviewUrl}\n\nCIC Insurance Group — Medical Claims Division`;
    await this.sendEmail(adminEmail, `Action required: ${providerName} awaiting approval`, text, html);
  }

  // ─── Provider: approval decision ──────────────────────────────────────────

  async sendProviderApprovalDecision(dto: {
    recipientEmail: string;
    recipientName: string;
    providerName: string;
    decision: 'approved' | 'rejected';
    comment?: string;
    rejectionReason?: string;
    loginUrl: string;
  }): Promise<void> {
    const { recipientEmail, recipientName, providerName, decision, comment, rejectionReason, loginUrl } = dto;
    const approved = decision === 'approved';
    const accent = approved ? '#10b981' : '#dc2626';
    const accentDim = approved ? '#065f46' : '#7f1d1d';
    const badgeBg = approved ? '#052e16' : '#1a0404';
    const badgeBorder = approved ? '#166534' : '#991b1b';
    const badgeText = approved ? '#4ade80' : '#f87171';
    const headline = approved ? 'Your provider account is approved' : 'Your provider application was not approved';
    const ctaLabel = approved ? 'Sign in to ClaimsFlow' : 'Update your application';

    const commentBlock = (comment || rejectionReason)
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
              style="background:#18181b;border:1px solid #27272a;border-left:3px solid ${badgeBorder};border-radius:8px;margin:16px 0">
           <tr><td style="padding:14px 16px">
             <p style="margin:0 0 5px;font-size:10px;font-weight:700;color:#71717a;text-transform:uppercase;letter-spacing:1px">${approved ? 'Reviewer note' : 'Reason'}</p>
             <p style="margin:0;font-size:13px;color:#e4e4e7;line-height:1.6">${(rejectionReason ?? comment ?? '').replace(/\n/g, '<br/>')}</p>
             ${rejectionReason && comment ? `<p style="margin:10px 0 0;font-size:12px;color:#a1a1aa"><em>Additional note:</em> ${comment.replace(/\n/g, '<br/>')}</p>` : ''}
           </td></tr>
         </table>`
      : '';

    const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="color-scheme" content="dark"/><title>${headline}</title></head>
<body style="margin:0;padding:0;background:#09090b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#09090b;padding:32px 12px">
    <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;border-radius:16px;overflow:hidden;border:1px solid #27272a">

      <tr><td style="background:linear-gradient(90deg,${accentDim} 0%,${accent} 100%);height:3px;font-size:0">&nbsp;</td></tr>

      <tr><td style="background:#111113;padding:28px 36px 24px">
        <div style="display:inline-block;background:#1c1c1f;border:1px solid #3f3f46;border-radius:8px;padding:5px 12px;margin-bottom:12px">
          <span style="color:#71717a;font-size:10px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase">CIC Insurance Group</span>
        </div><br/>
        <span style="display:inline-block;background:${badgeBg};border:1px solid ${badgeBorder};border-radius:20px;padding:3px 11px;font-size:10px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:${badgeText};margin-bottom:14px">${approved ? 'Approved' : 'Rejected'}</span>
        <h1 style="margin:0 0 6px;color:#fafafa;font-size:22px;font-weight:700;letter-spacing:-0.3px;line-height:1.25">${headline}</h1>
        <p style="margin:4px 0 0;color:#71717a;font-size:13px">${providerName}</p>
      </td></tr>

      <tr><td style="background:#0f0f11;padding:24px 36px">
        <p style="margin:0 0 14px;color:#a1a1aa;font-size:14px;line-height:1.7">
          Hi <strong style="color:#e4e4e7">${recipientName}</strong>,
        </p>
        <p style="margin:0 0 14px;color:#a1a1aa;font-size:14px;line-height:1.7">
          ${approved
            ? `Your provider account for <strong style="color:#10b981">${providerName}</strong> has been approved by CIC. You can now sign in and start submitting claims.`
            : `After review, your provider application for <strong style="color:#e4e4e7">${providerName}</strong> could not be approved as submitted. Please address the issue below and re-submit your packet.`}
        </p>

        ${commentBlock}

        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0 4px">
          <tr><td style="background:linear-gradient(135deg,${accent},${accentDim});border-radius:10px;padding:13px 26px">
            <a href="${loginUrl}" style="color:#fff;font-size:13px;font-weight:700;text-decoration:none;letter-spacing:0.3px">${ctaLabel} →</a>
          </td></tr>
        </table>
      </td></tr>

      <tr><td style="background:#111113;border-top:1px solid #27272a;padding:20px 36px;text-align:center">
        <p style="margin:0 0 4px;color:#52525b;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px">CIC Insurance Group · Medical Claims Division</p>
        <p style="margin:0;color:#3f3f46;font-size:10px">P.O. Box 59485-00200, Nairobi &nbsp;·&nbsp; claims@cic.co.ke &nbsp;·&nbsp; © ${new Date().getFullYear()} CIC Insurance Group</p>
      </td></tr>

      <tr><td style="background:linear-gradient(90deg,${accent} 0%,${accentDim} 100%);height:3px;font-size:0">&nbsp;</td></tr>

    </table></td></tr>
  </table>
</body></html>`;

    const text = `Hi ${recipientName},\n\n${approved
      ? `Your provider account for "${providerName}" has been approved. Sign in at ${loginUrl}.`
      : `Your provider application for "${providerName}" was not approved.\nReason: ${rejectionReason || comment || '(no reason supplied)'}\n\nUpdate your application at ${loginUrl}.`}\n\nCIC Insurance Group — Medical Claims Division`;

    await this.sendEmail(
      recipientEmail,
      approved ? `Approved · ${providerName}` : `Application not approved · ${providerName}`,
      text,
      html,
    );
  }

  // ─── PR2: Provider admin — new user awaiting approval ──────────────────────

  async sendProviderUserPendingAlert(dto: {
    adminEmail: string;
    adminName?: string;
    providerName: string;
    userName: string;
    userEmail: string;
    reviewUrl: string;
  }): Promise<void> {
    const { adminEmail, adminName, providerName, userName, userEmail, reviewUrl } = dto;
    const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="color-scheme" content="dark"/><title>New user awaiting approval</title></head>
<body style="margin:0;padding:0;background:#09090b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#09090b;padding:32px 12px">
    <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;border-radius:16px;overflow:hidden;border:1px solid #27272a">
      <tr><td style="background:linear-gradient(90deg,#1e3a8a 0%,#3b82f6 50%,#06b6d4 100%);height:3px;font-size:0">&nbsp;</td></tr>
      <tr><td style="background:#111113;padding:28px 36px 24px">
        <div style="display:inline-block;background:#1c1c1f;border:1px solid #3f3f46;border-radius:8px;padding:5px 12px;margin-bottom:12px">
          <span style="color:#71717a;font-size:10px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase">CIC Insurance Group</span>
        </div><br/>
        <span style="display:inline-block;background:#0c1524;border:1px solid #1d4ed8;border-radius:20px;padding:3px 11px;font-size:10px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:#60a5fa;margin-bottom:14px">User approval needed</span>
        <h1 style="margin:0 0 6px;color:#fafafa;font-size:22px;font-weight:700;letter-spacing:-0.3px">A new user wants to join ${providerName}</h1>
        <p style="margin:4px 0 0;color:#71717a;font-size:13px">Verify the request and grant or deny access.</p>
      </td></tr>

      <tr><td style="background:#0f0f11;padding:24px 36px">
        ${adminName ? `<p style="margin:0 0 16px;color:#a1a1aa;font-size:14px">Hi <strong style="color:#e4e4e7">${adminName}</strong>,</p>` : ''}
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#18181b;border:1px solid #27272a;border-radius:12px;margin-bottom:20px">
          <tr><td style="padding:18px 20px">
            <p style="margin:0 0 6px;font-size:10px;font-weight:700;color:#71717a;text-transform:uppercase;letter-spacing:1.5px">Applicant</p>
            <p style="margin:0 0 12px;font-size:15px;font-weight:600;color:#fafafa">${userName}</p>
            <p style="margin:0 0 6px;font-size:10px;font-weight:700;color:#71717a;text-transform:uppercase;letter-spacing:1.5px">Email</p>
            <p style="margin:0;font-size:13px;color:#60a5fa">${userEmail}</p>
          </td></tr>
        </table>
        <p style="margin:0 0 18px;color:#a1a1aa;font-size:13px;line-height:1.7">
          The user has verified their email address. They will only be able to sign in once you approve them under <strong style="color:#e4e4e7">${providerName}</strong>.
        </p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr><td style="background:linear-gradient(135deg,#1d4ed8,#06b6d4);border-radius:10px;padding:13px 26px">
            <a href="${reviewUrl}" style="color:#fff;font-size:13px;font-weight:700;text-decoration:none;letter-spacing:0.3px">Review and decide →</a>
          </td></tr>
        </table>
      </td></tr>

      <tr><td style="background:#111113;border-top:1px solid #27272a;padding:20px 36px;text-align:center">
        <p style="margin:0 0 4px;color:#52525b;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px">CIC Insurance Group · Medical Claims Division</p>
        <p style="margin:0;color:#3f3f46;font-size:10px">P.O. Box 59485-00200, Nairobi &nbsp;·&nbsp; claims@cic.co.ke &nbsp;·&nbsp; © ${new Date().getFullYear()} CIC Insurance Group</p>
      </td></tr>
      <tr><td style="background:linear-gradient(90deg,#06b6d4 0%,#3b82f6 50%,#1e3a8a 100%);height:3px;font-size:0">&nbsp;</td></tr>
    </table></td></tr>
  </table>
</body></html>`;

    const text = `${adminName ? `Hi ${adminName},\n\n` : ''}${userName} (${userEmail}) requested access to ${providerName} on ClaimsFlow. Approve or reject at: ${reviewUrl}\n\nCIC Insurance Group — Medical Claims Division`;
    await this.sendEmail(adminEmail, `${userName} requested access to ${providerName}`, text, html);
  }

  // ─── PR4: Provider — whole packet returned for correction ────────────────

  async sendProviderReturnedForCorrection(dto: {
    recipientEmail: string;
    recipientName: string;
    providerName: string;
    comment: string;
    resubmitUrl: string;
  }): Promise<void> {
    const { recipientEmail, recipientName, providerName, comment, resubmitUrl } = dto;
    const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="color-scheme" content="dark"/><title>Application returned for correction</title></head>
<body style="margin:0;padding:0;background:#09090b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#09090b;padding:32px 12px">
    <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;border-radius:16px;overflow:hidden;border:1px solid #27272a">
      <tr><td style="background:linear-gradient(90deg,#78350f 0%,#d97706 50%,#fbbf24 100%);height:3px;font-size:0">&nbsp;</td></tr>

      <tr><td style="background:#111113;padding:28px 36px 24px">
        <div style="display:inline-block;background:#1c1c1f;border:1px solid #3f3f46;border-radius:8px;padding:5px 12px;margin-bottom:12px">
          <span style="color:#71717a;font-size:10px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase">CIC Insurance Group</span>
        </div><br/>
        <span style="display:inline-block;background:#1a0e00;border:1px solid #b45309;border-radius:20px;padding:3px 11px;font-size:10px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:#fbbf24;margin-bottom:14px">Action needed</span>
        <h1 style="margin:0 0 6px;color:#fafafa;font-size:22px;font-weight:700;letter-spacing:-0.3px">Your application needs a few corrections</h1>
        <p style="margin:4px 0 0;color:#71717a;font-size:13px">${providerName}</p>
      </td></tr>

      <tr><td style="background:#0f0f11;padding:24px 36px">
        <p style="margin:0 0 14px;color:#a1a1aa;font-size:14px;line-height:1.7">Hi <strong style="color:#e4e4e7">${recipientName}</strong>,</p>
        <p style="margin:0 0 14px;color:#a1a1aa;font-size:14px;line-height:1.7">
          The reviewer at CIC has sent your provider application for
          <strong style="color:#e4e4e7">${providerName}</strong> back to you for revisions.
          Your application is <strong style="color:#fbbf24">not declined</strong> — once you
          update the items below and re-submit, the review picks up where it left off.
        </p>

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
               style="background:#18181b;border:1px solid #27272a;border-left:3px solid #b45309;border-radius:8px;margin:16px 0">
          <tr><td style="padding:14px 16px">
            <p style="margin:0 0 5px;font-size:10px;font-weight:700;color:#fbbf24;text-transform:uppercase;letter-spacing:1px">Reviewer's note</p>
            <p style="margin:0;font-size:13px;color:#e4e4e7;line-height:1.6">${comment.replace(/\n/g, '<br/>')}</p>
          </td></tr>
        </table>

        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0 4px">
          <tr><td style="background:linear-gradient(135deg,#d97706,#b45309);border-radius:10px;padding:13px 26px">
            <a href="${resubmitUrl}" style="color:#fff;font-size:13px;font-weight:700;text-decoration:none;letter-spacing:0.3px">Open my application →</a>
          </td></tr>
        </table>

        <p style="margin:18px 0 0;font-size:11px;color:#71717a;line-height:1.6">
          If you have questions about what to change, reply to this email or contact
          <a href="mailto:claims@cic.co.ke" style="color:#60a5fa">claims@cic.co.ke</a>.
        </p>
      </td></tr>

      <tr><td style="background:#111113;border-top:1px solid #27272a;padding:20px 36px;text-align:center">
        <p style="margin:0 0 4px;color:#52525b;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px">CIC Insurance Group · Medical Claims Division</p>
        <p style="margin:0;color:#3f3f46;font-size:10px">P.O. Box 59485-00200, Nairobi &nbsp;·&nbsp; claims@cic.co.ke &nbsp;·&nbsp; © ${new Date().getFullYear()} CIC Insurance Group</p>
      </td></tr>
      <tr><td style="background:linear-gradient(90deg,#fbbf24 0%,#d97706 50%,#78350f 100%);height:3px;font-size:0">&nbsp;</td></tr>
    </table></td></tr>
  </table>
</body></html>`;

    const text = `Hi ${recipientName},\n\nYour provider application for "${providerName}" has been returned for correction by CIC. Your application is NOT declined — update what they asked for and re-submit to continue the review.\n\nReviewer's note:\n${comment}\n\nOpen your application: ${resubmitUrl}\n\nCIC Insurance Group — Medical Claims Division`;

    await this.sendEmail(
      recipientEmail,
      `Action needed: please revise ${providerName}`,
      text,
      html,
    );
  }

  // ─── PR4: Provider — single onboarding document needs revision ───────────

  async sendOnboardingDocumentRejected(dto: {
    recipientEmail: string;
    recipientName: string;
    providerName: string;
    fileName: string;
    category: string;
    reason: string;
    resubmitUrl: string;
  }): Promise<void> {
    const { recipientEmail, recipientName, providerName, fileName, category, reason, resubmitUrl } = dto;
    const niceCategory = ({
      company_profile: 'Company profile (item a)',
      experience_evidence: 'Experience evidence (item b)',
      firm_certifications: 'Firm certifications (item d)',
      staff_certifications: 'Staff certifications (item d)',
      program_of_works: 'Program of works (item f)',
      other: 'Supporting documents',
    } as Record<string, string>)[category] ?? category;

    const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="color-scheme" content="dark"/><title>Document needs revision</title></head>
<body style="margin:0;padding:0;background:#09090b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#09090b;padding:32px 12px">
    <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;border-radius:16px;overflow:hidden;border:1px solid #27272a">
      <tr><td style="background:linear-gradient(90deg,#78350f 0%,#d97706 50%,#fbbf24 100%);height:3px;font-size:0">&nbsp;</td></tr>

      <tr><td style="background:#111113;padding:28px 36px 24px">
        <div style="display:inline-block;background:#1c1c1f;border:1px solid #3f3f46;border-radius:8px;padding:5px 12px;margin-bottom:12px">
          <span style="color:#71717a;font-size:10px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase">CIC Insurance Group</span>
        </div><br/>
        <span style="display:inline-block;background:#1a0e00;border:1px solid #b45309;border-radius:20px;padding:3px 11px;font-size:10px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:#fbbf24;margin-bottom:14px">Revision needed</span>
        <h1 style="margin:0 0 6px;color:#fafafa;font-size:22px;font-weight:700;letter-spacing:-0.3px">One of your documents needs an update</h1>
        <p style="margin:4px 0 0;color:#71717a;font-size:13px">${providerName}</p>
      </td></tr>

      <tr><td style="background:#0f0f11;padding:24px 36px">
        <p style="margin:0 0 14px;color:#a1a1aa;font-size:14px;line-height:1.7">Hi <strong style="color:#e4e4e7">${recipientName}</strong>,</p>
        <p style="margin:0 0 14px;color:#a1a1aa;font-size:14px;line-height:1.7">
          A reviewer at CIC could not approve one of the documents you uploaded
          for <strong style="color:#e4e4e7">${providerName}</strong>. Please address the issue
          below and upload a corrected version — the earlier file stays on record
          as version&nbsp;1 and the corrected one will become version&nbsp;2.
        </p>

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#18181b;border:1px solid #27272a;border-radius:12px;margin-bottom:16px">
          <tr><td style="padding:16px 20px">
            <p style="margin:0 0 6px;font-size:10px;font-weight:700;color:#71717a;text-transform:uppercase;letter-spacing:1.5px">Section</p>
            <p style="margin:0 0 12px;font-size:14px;color:#fafafa">${niceCategory}</p>
            <p style="margin:0 0 6px;font-size:10px;font-weight:700;color:#71717a;text-transform:uppercase;letter-spacing:1.5px">File</p>
            <p style="margin:0;font-size:13px;color:#e4e4e7;font-family:'Courier New',monospace">${fileName}</p>
          </td></tr>
        </table>

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
               style="background:#18181b;border:1px solid #27272a;border-left:3px solid #b45309;border-radius:8px;margin-bottom:18px">
          <tr><td style="padding:14px 16px">
            <p style="margin:0 0 5px;font-size:10px;font-weight:700;color:#fbbf24;text-transform:uppercase;letter-spacing:1px">Reason</p>
            <p style="margin:0;font-size:13px;color:#e4e4e7;line-height:1.6">${reason.replace(/\n/g, '<br/>')}</p>
          </td></tr>
        </table>

        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr><td style="background:linear-gradient(135deg,#d97706,#b45309);border-radius:10px;padding:13px 26px">
            <a href="${resubmitUrl}" style="color:#fff;font-size:13px;font-weight:700;text-decoration:none;letter-spacing:0.3px">Upload corrected version →</a>
          </td></tr>
        </table>
      </td></tr>

      <tr><td style="background:#111113;border-top:1px solid #27272a;padding:20px 36px;text-align:center">
        <p style="margin:0 0 4px;color:#52525b;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px">CIC Insurance Group · Medical Claims Division</p>
        <p style="margin:0;color:#3f3f46;font-size:10px">P.O. Box 59485-00200, Nairobi &nbsp;·&nbsp; claims@cic.co.ke &nbsp;·&nbsp; © ${new Date().getFullYear()} CIC Insurance Group</p>
      </td></tr>
      <tr><td style="background:linear-gradient(90deg,#fbbf24 0%,#d97706 50%,#78350f 100%);height:3px;font-size:0">&nbsp;</td></tr>
    </table></td></tr>
  </table>
</body></html>`;

    const text = `Hi ${recipientName},\n\nOne of your onboarding documents for "${providerName}" was not approved and needs a corrected version.\n\nSection: ${niceCategory}\nFile: ${fileName}\nReason: ${reason}\n\nUpload a corrected version at: ${resubmitUrl}\n\nCIC Insurance Group — Medical Claims Division`;

    await this.sendEmail(recipientEmail, `Revision needed: ${fileName}`, text, html);
  }

  // ─── PR2: User — provider approval decision ───────────────────────────────

  async sendUserApprovalDecision(dto: {
    recipientEmail: string;
    recipientName: string;
    providerName: string;
    decision: 'approved' | 'rejected';
    comment?: string;
    rejectionReason?: string;
    loginUrl: string;
  }): Promise<void> {
    const { recipientEmail, recipientName, providerName, decision, comment, rejectionReason, loginUrl } = dto;
    const approved = decision === 'approved';
    const accent = approved ? '#10b981' : '#dc2626';
    const accentDim = approved ? '#065f46' : '#7f1d1d';
    const badgeBg = approved ? '#052e16' : '#1a0404';
    const badgeBorder = approved ? '#166534' : '#991b1b';
    const badgeText = approved ? '#4ade80' : '#f87171';
    const headline = approved
      ? `${providerName} approved your access`
      : `Access to ${providerName} was not approved`;

    const note = (rejectionReason ?? comment ?? '').trim();
    const noteBlock = note
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
              style="background:#18181b;border:1px solid #27272a;border-left:3px solid ${badgeBorder};border-radius:8px;margin:16px 0">
           <tr><td style="padding:14px 16px">
             <p style="margin:0 0 5px;font-size:10px;font-weight:700;color:#71717a;text-transform:uppercase;letter-spacing:1px">${approved ? 'Reviewer note' : 'Reason'}</p>
             <p style="margin:0;font-size:13px;color:#e4e4e7;line-height:1.6">${note.replace(/\n/g, '<br/>')}</p>
           </td></tr>
         </table>`
      : '';

    const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="color-scheme" content="dark"/><title>${headline}</title></head>
<body style="margin:0;padding:0;background:#09090b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#09090b;padding:32px 12px">
    <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;border-radius:16px;overflow:hidden;border:1px solid #27272a">
      <tr><td style="background:linear-gradient(90deg,${accentDim} 0%,${accent} 100%);height:3px;font-size:0">&nbsp;</td></tr>
      <tr><td style="background:#111113;padding:28px 36px 24px">
        <div style="display:inline-block;background:#1c1c1f;border:1px solid #3f3f46;border-radius:8px;padding:5px 12px;margin-bottom:12px">
          <span style="color:#71717a;font-size:10px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase">CIC Insurance Group</span>
        </div><br/>
        <span style="display:inline-block;background:${badgeBg};border:1px solid ${badgeBorder};border-radius:20px;padding:3px 11px;font-size:10px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:${badgeText};margin-bottom:14px">${approved ? 'Approved' : 'Not approved'}</span>
        <h1 style="margin:0 0 6px;color:#fafafa;font-size:22px;font-weight:700;letter-spacing:-0.3px;line-height:1.25">${headline}</h1>
        <p style="margin:4px 0 0;color:#71717a;font-size:13px">${providerName}</p>
      </td></tr>

      <tr><td style="background:#0f0f11;padding:24px 36px">
        <p style="margin:0 0 14px;color:#a1a1aa;font-size:14px;line-height:1.7">Hi <strong style="color:#e4e4e7">${recipientName}</strong>,</p>
        <p style="margin:0 0 14px;color:#a1a1aa;font-size:14px;line-height:1.7">
          ${approved
            ? `Your account has been approved by an admin at <strong style="color:#10b981">${providerName}</strong>. You can now sign in to ClaimsFlow.`
            : `An admin at <strong style="color:#e4e4e7">${providerName}</strong> has not approved your access. If you believe this was a mistake, contact your provider directly.`}
        </p>
        ${noteBlock}
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0 4px">
          <tr><td style="background:linear-gradient(135deg,${accent},${accentDim});border-radius:10px;padding:13px 26px">
            <a href="${loginUrl}" style="color:#fff;font-size:13px;font-weight:700;text-decoration:none;letter-spacing:0.3px">${approved ? 'Sign in to ClaimsFlow' : 'Back to ClaimsFlow'} →</a>
          </td></tr>
        </table>
      </td></tr>

      <tr><td style="background:#111113;border-top:1px solid #27272a;padding:20px 36px;text-align:center">
        <p style="margin:0 0 4px;color:#52525b;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px">CIC Insurance Group · Medical Claims Division</p>
        <p style="margin:0;color:#3f3f46;font-size:10px">P.O. Box 59485-00200, Nairobi &nbsp;·&nbsp; claims@cic.co.ke &nbsp;·&nbsp; © ${new Date().getFullYear()} CIC Insurance Group</p>
      </td></tr>
      <tr><td style="background:linear-gradient(90deg,${accent} 0%,${accentDim} 100%);height:3px;font-size:0">&nbsp;</td></tr>
    </table></td></tr>
  </table>
</body></html>`;

    const text = `Hi ${recipientName},\n\n${approved
      ? `Your access to ${providerName} has been approved. Sign in at ${loginUrl}.`
      : `Your access to ${providerName} was not approved.\nReason: ${rejectionReason || comment || '(none supplied)'}.`}\n\nCIC Insurance Group — Medical Claims Division`;
    await this.sendEmail(
      recipientEmail,
      approved ? `Approved · ${providerName}` : `Access not approved · ${providerName}`,
      text,
      html,
    );
  }

  // ─── Workflow Notification Emails ────────────────────────────────────────────

  async sendWorkflowEmail(dto: WorkflowEmailDto): Promise<void> {
    const {
      recipientEmail, subject, badgeText, badgeStyle,
      title, subtitle, claimNumber, providerName, invoiceAmount,
      greeting, bodyLines, reasonLabel, reasonText, missingDocuments,
      ctaText, ctaUrl, nextNote,
    } = dto;

    const THEMES: Record<WorkflowEmailDto['badgeStyle'], {
      gradA: string; gradB: string; badgeBg: string;
      badgeBorder: string; badgeTextColor: string; ctaA: string; ctaB: string;
    }> = {
      green:  { gradA: '#065f46', gradB: '#10b981', badgeBg: '#052e16', badgeBorder: '#166534', badgeTextColor: '#4ade80', ctaA: '#059669', ctaB: '#0891b2' },
      blue:   { gradA: '#1e3a8a', gradB: '#3b82f6', badgeBg: '#0c1524', badgeBorder: '#1d4ed8', badgeTextColor: '#60a5fa', ctaA: '#1d4ed8', ctaB: '#4338ca' },
      amber:  { gradA: '#78350f', gradB: '#d97706', badgeBg: '#1a0e00', badgeBorder: '#b45309', badgeTextColor: '#fbbf24', ctaA: '#d97706', ctaB: '#b45309' },
      red:    { gradA: '#7f1d1d', gradB: '#dc2626', badgeBg: '#1a0404', badgeBorder: '#991b1b', badgeTextColor: '#f87171', ctaA: '#dc2626', ctaB: '#991b1b' },
      purple: { gradA: '#4c1d95', gradB: '#7c3aed', badgeBg: '#130a1f', badgeBorder: '#6d28d9', badgeTextColor: '#a78bfa', ctaA: '#7c3aed', ctaB: '#6d28d9' },
      cyan:   { gradA: '#164e63', gradB: '#0ea5e9', badgeBg: '#00131a', badgeBorder: '#0284c7', badgeTextColor: '#22d3ee', ctaA: '#0ea5e9', ctaB: '#0284c7' },
    };

    const t = THEMES[badgeStyle];
    const fmt = (n: number) =>
      'KES ' + n.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const subtitleHtml = subtitle
      ? `<p style="margin:4px 0 0;color:#71717a;font-size:12px;line-height:1.5">${subtitle}</p>`
      : '';
    const greetingHtml = greeting
      ? `<p style="margin:0 0 14px;color:#e4e4e7;font-size:14px;font-weight:600">${greeting}</p>`
      : '';
    const bodyHtml = bodyLines
      .map(l => `<p style="margin:0 0 12px;color:#a1a1aa;font-size:13px;line-height:1.7">${l}</p>`)
      .join('');
    const missingListHtml = missingDocuments?.length
      ? `<ul style="margin:8px 0 0;padding-left:18px">${missingDocuments.map(d => `<li style="color:#e4e4e7;font-size:13px;margin-bottom:4px">${d}</li>`).join('')}</ul>`
      : '';
    const reasonHtml = reasonText
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
               style="background:#18181b;border:1px solid #27272a;border-left:3px solid ${t.badgeBorder};border-radius:8px;margin:16px 0;overflow:hidden">
           <tr><td style="padding:14px 16px">
             <p style="margin:0 0 5px;font-size:10px;font-weight:700;color:#71717a;text-transform:uppercase;letter-spacing:1px">${reasonLabel || 'Reason'}</p>
             <p style="margin:0;font-size:13px;color:#e4e4e7;line-height:1.6">${reasonText}</p>
             ${missingListHtml}
           </td></tr>
         </table>`
      : '';
    const amountCell = invoiceAmount !== undefined
      ? `<td align="right" style="white-space:nowrap"><span style="font-size:14px;color:#34d399;font-weight:700">${fmt(invoiceAmount)}</span></td>`
      : '';
    const ctaHtml = ctaText && ctaUrl
      ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 4px">
           <tr>
             <td style="background:linear-gradient(135deg,${t.ctaA},${t.ctaB});border-radius:10px;padding:13px 26px">
               <a href="${ctaUrl}" style="color:#fff;font-size:13px;font-weight:700;text-decoration:none;letter-spacing:0.3px">${ctaText} &rarr;</a>
             </td>
           </tr>
         </table>`
      : '';
    const nextNoteHtml = nextNote
      ? `<p style="margin:16px 0 0;font-size:12px;color:#52525b;background:#18181b;border:1px solid #27272a;border-radius:8px;padding:12px 16px;line-height:1.6">${nextNote}</p>`
      : '';

    const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <meta name="color-scheme" content="dark"/>
  <meta name="supported-color-schemes" content="dark"/>
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background-color:#09090b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Helvetica Neue',Arial,sans-serif;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
         style="background-color:#09090b;min-height:100vh;padding:32px 12px">
    <tr><td align="center" valign="top">
    <table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0"
           style="max-width:640px;width:100%;border-radius:16px;overflow:hidden;border:1px solid #27272a">

      <tr><td style="background:linear-gradient(90deg,${t.gradA} 0%,${t.gradB} 100%);height:3px;font-size:0;line-height:0">&nbsp;</td></tr>

      <tr>
        <td style="background-color:#111113;padding:28px 36px 24px">
          <div style="display:inline-block;background:#1c1c1f;border:1px solid #3f3f46;border-radius:8px;padding:4px 12px;margin-bottom:12px">
            <span style="color:#71717a;font-size:10px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase">CIC Insurance Group</span>
          </div><br/>
          <span style="display:inline-block;background:${t.badgeBg};border:1px solid ${t.badgeBorder};border-radius:20px;padding:3px 11px;font-size:10px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:${t.badgeTextColor};margin-bottom:14px">${badgeText}</span>
          <h1 style="margin:0 0 6px;color:#fafafa;font-size:22px;font-weight:700;letter-spacing:-0.3px;line-height:1.25">${title}</h1>
          ${subtitleHtml}
        </td>
      </tr>

      <tr>
        <td style="background-color:#0d1117;border-top:1px solid #27272a;border-bottom:1px solid #27272a;padding:10px 36px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td>
                <span style="font-size:11px;color:#52525b;font-weight:500">Ref&nbsp;</span>
                <span style="font-size:12px;color:#a78bfa;font-family:'Courier New',monospace;font-weight:700">${claimNumber}</span>
                <span style="font-size:11px;color:#3f3f46"> &nbsp;&bull;&nbsp; </span>
                <span style="font-size:12px;color:#a1a1aa">${providerName}</span>
              </td>
              ${amountCell}
            </tr>
          </table>
        </td>
      </tr>

      <tr>
        <td style="background-color:#0f0f11;padding:26px 36px">
          ${greetingHtml}
          ${bodyHtml}
          ${reasonHtml}
          ${ctaHtml}
          ${nextNoteHtml}
        </td>
      </tr>

      <tr>
        <td style="background-color:#111113;border-top:1px solid #27272a;padding:20px 36px;text-align:center">
          <div style="width:40px;height:2px;background:linear-gradient(90deg,#10b981,#06b6d4);margin:0 auto 14px;border-radius:2px"></div>
          <p style="margin:0 0 3px;color:#52525b;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px">CIC Insurance Group</p>
          <p style="margin:0 0 3px;color:#3f3f46;font-size:10px">Medical Claims Division</p>
          <p style="margin:0 0 12px;color:#3f3f46;font-size:10px">P.O. Box 59485-00200, Nairobi &nbsp;&bull;&nbsp; claims@cic.co.ke &nbsp;&bull;&nbsp; +254 703 099 000</p>
          <p style="margin:0;color:#27272a;font-size:10px">This is an automated message — please do not reply &nbsp;&bull;&nbsp; &copy; ${new Date().getFullYear()} CIC Insurance Group</p>
        </td>
      </tr>

      <tr><td style="background:linear-gradient(90deg,${t.gradB} 0%,${t.gradA} 100%);height:3px;font-size:0;line-height:0">&nbsp;</td></tr>

    </table>
    </td></tr>
  </table>
</body>
</html>`;

    const text = [
      `CIC Insurance Group — ${title}`,
      '',
      claimNumber ? `Ref: ${claimNumber}${providerName ? ` · ${providerName}` : ''}` : '',
      invoiceAmount !== undefined ? `Amount: ${fmt(invoiceAmount)}` : '',
      '',
      ...bodyLines,
      reasonText ? `\n${reasonLabel || 'Reason'}: ${reasonText}` : '',
      missingDocuments?.length
        ? `Required documents:\n${missingDocuments.map(d => `  • ${d}`).join('\n')}`
        : '',
      ctaText && ctaUrl ? `\n${ctaText}: ${ctaUrl}` : '',
      nextNote ? `\n${nextNote}` : '',
      '',
      'CIC Insurance Group — Medical Claims Division',
      'claims@cic.co.ke | +254 703 099 000',
    ].filter(Boolean).join('\n');

    await this.sendEmail(recipientEmail, subject, text, html);
  }

  // ─── Existing methods ─────────────────────────────────────────────────────

  async sendClaimApprovalEmail(email: string, claimNumber: string, amount: number) {
    const subject = 'Claim Approved — CIC Medical Claims';
    const text = `Your claim ${claimNumber} for KES ${amount.toLocaleString()} has been approved.`;
    return this.sendEmail(email, subject, text);
  }

  async sendClaimRejectionEmail(email: string, claimNumber: string, reason: string) {
    const subject = 'Claim Rejected — CIC Medical Claims';
    const text = `Your claim ${claimNumber} has been rejected. Reason: ${reason}`;
    return this.sendEmail(email, subject, text);
  }

  async sendPasswordResetEmail(dto: { email: string; name: string; resetUrl: string }) {
    const { email, name, resetUrl } = dto;
    const subject = 'Reset your ClaimsFlow password';
    const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f9fafb;padding:32px">
      <div style="max-width:480px;margin:0 auto;background:white;border-radius:12px;padding:32px;border:1px solid #e5e7eb">
        <h2 style="color:#1a56db;margin-bottom:8px">Password Reset</h2>
        <p style="color:#374151">Hi ${name},</p>
        <p style="color:#374151">We received a request to reset your ClaimsFlow password. Click the button below — this link expires in 1 hour.</p>
        <a href="${resetUrl}" style="display:inline-block;background:#1a56db;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin:16px 0">Reset Password</a>
        <p style="color:#6b7280;font-size:12px">If you did not request a password reset, ignore this email. Your password will not change.</p>
        <p style="color:#6b7280;font-size:12px">CIC Insurance Group — Medical Claims Division</p>
      </div></body></html>`;
    const text = `Hi ${name},\n\nReset your password: ${resetUrl}\n\nThis link expires in 1 hour.\n\nCIC Insurance Group`;
    return this.sendEmail(email, subject, text, html);
  }

  async sendSlaBreachAlert(dto: { email: string; name: string; claimNumber: string; stage: string; hoursElapsed: number }) {
    const { email, name, claimNumber, stage, hoursElapsed } = dto;
    const subject = `⚠ SLA Breach — Claim ${claimNumber} overdue`;
    const text = `Hi ${name},\n\nClaim ${claimNumber} has been in "${stage}" for ${hoursElapsed} hours, exceeding the SLA threshold. Please action it immediately.\n\nCIC Claims System`;
    return this.sendEmail(email, subject, text);
  }

  async sendAppealNotification(dto: { email: string; name: string; claimNumber: string; action: 'filed' | 'adjudicated'; outcome?: string }) {
    const { email, name, claimNumber, action, outcome } = dto;
    const subject = action === 'filed' ? `Appeal Received — Claim ${claimNumber}` : `Appeal Decision — Claim ${claimNumber}`;
    const text = action === 'filed'
      ? `Hi ${name},\n\nYour appeal for claim ${claimNumber} has been received and is under review by CIC.\n\nCIC Insurance Group`
      : `Hi ${name},\n\nYour appeal for claim ${claimNumber} has been reviewed.\nOutcome: ${outcome}\n\nCIC Insurance Group`;
    return this.sendEmail(email, subject, text);
  }
}

