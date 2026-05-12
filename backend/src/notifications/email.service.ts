import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

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
      this.logger.log(`Email sent to ${to}: ${info.messageId}`);
      return info;
    } catch (error) {
      this.logger.error(`Failed to send email to ${to}:`, error);
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
}
