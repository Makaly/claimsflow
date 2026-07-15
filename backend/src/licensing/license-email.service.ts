import { Injectable, Logger } from '@nestjs/common';
import { EmailService } from '../notifications/email.service';
import { LicensePdfService } from './license-pdf.service';
import { LicenseInfo } from './license.service';
import { UNLIMITED } from './plans';

/**
 * Licence lifecycle emails (mirrors helpdesk's licence mailers): activation
 * certificate (with the PDF attached), milestone expiry reminders, and
 * pause/resume notifications. All HTML follows the ClaimsFlow dark-card style
 * used across the app's transactional mail.
 */
@Injectable()
export class LicenseEmailService {
  private readonly logger = new Logger(LicenseEmailService.name);

  constructor(
    private readonly email: EmailService,
    private readonly pdf: LicensePdfService,
  ) {}

  private cap(n: number): string {
    return n >= UNLIMITED ? 'Unlimited' : n.toLocaleString('en-KE');
  }

  private fmt(d: Date | null): string {
    return d ? d.toLocaleDateString('en-KE', { year: 'numeric', month: 'long', day: 'numeric' }) : 'Perpetual';
  }

  private shell(title: string, subtitle: string, bodyInner: string, accent = '#10b981'): string {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/><meta name="color-scheme" content="dark"/>
<title>${title}</title></head>
<body style="margin:0;padding:0;background:#09090b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#09090b;padding:32px 12px">
    <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;border-radius:16px;overflow:hidden;border:1px solid #27272a">
      <tr><td style="background:linear-gradient(90deg,${accent} 0%,#06b6d4 50%,#6366f1 100%);height:3px;font-size:0">&nbsp;</td></tr>
      <tr><td style="background:#111113;padding:30px 36px 22px">
        <div style="display:inline-block;background:#1c1c1f;border:1px solid #3f3f46;border-radius:8px;padding:5px 12px;margin-bottom:14px">
          <span style="color:#71717a;font-size:10px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase">CIC Insurance Group · ClaimsFlow</span>
        </div>
        <h1 style="margin:0 0 6px;color:#fafafa;font-size:23px;font-weight:700;letter-spacing:-0.4px">${title}</h1>
        <p style="margin:0;color:#71717a;font-size:13px">${subtitle}</p>
      </td></tr>
      <tr><td style="background:#0f0f11;padding:26px 36px">${bodyInner}</td></tr>
      <tr><td style="background:#111113;border-top:1px solid #27272a;padding:20px 36px;text-align:center">
        <p style="margin:0 0 4px;color:#52525b;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px">CIC Insurance Group · ClaimsFlow Licensing</p>
        <p style="margin:0;color:#3f3f46;font-size:10px">P.O. Box 59485-00200, Nairobi &nbsp;·&nbsp; claims@cic.co.ke &nbsp;·&nbsp; © ${new Date().getFullYear()} CIC Insurance Group</p>
      </td></tr>
      <tr><td style="background:linear-gradient(90deg,#6366f1 0%,#06b6d4 50%,${accent} 100%);height:3px;font-size:0">&nbsp;</td></tr>
    </table>
    </td></tr>
  </table>
</body></html>`;
  }

  private detailsTable(info: LicenseInfo): string {
    const row = (k: string, v: string) =>
      `<tr><td style="padding:8px 0;font-size:12px;color:#71717a">${k}</td><td style="padding:8px 0;font-size:12px;color:#e4e4e7;font-weight:600;text-align:right">${v}</td></tr>`;
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#18181b;border:1px solid #27272a;border-radius:12px;margin:8px 0 20px">
      <tr><td style="padding:8px 18px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          ${row('Plan', `${info.plan.toUpperCase()} (${info.licenseType})`)}
          ${row('Licence key', info.licenseKey ?? '—')}
          ${row('Issued', this.fmt(info.licenseStartDate))}
          ${row('Expires', this.fmt(info.licenseExpiryDate))}
          ${row('Seats', this.cap(info.maxSeats))}
          ${row('Claims / month', this.cap(info.maxClaimsPerMonth))}
          ${row('Extractions / month', this.cap(info.maxExtractionsPerMonth))}
        </table>
      </td></tr>
    </table>`;
  }

  /** HTML preview of the activation email (also served by the admin preview route). */
  buildActivationHtml(info: LicenseInfo): string {
    const body = `
      <p style="margin:0 0 18px;color:#a1a1aa;font-size:14px;line-height:1.7">
        The <strong style="color:#10b981">${info.plan.toUpperCase()}</strong> licence for
        <strong style="color:#e4e4e7">${info.tenantName}</strong> is now active. Your signed certificate is attached as a PDF.
      </p>
      ${this.detailsTable(info)}
      <p style="margin:0;font-size:12px;color:#52525b;background:#18181b;border:1px solid #27272a;border-radius:8px;padding:12px 16px;line-height:1.6">
        Keep the attached certificate for your records. For renewals or upgrades, contact your CIC account manager.
      </p>`;
    return this.shell('Your ClaimsFlow licence is active', `${info.tenantName} · ${info.licenseType}`, body);
  }

  /** Activation certificate email with the PDF attached. */
  async sendActivationEmail(info: LicenseInfo, recipientEmail: string): Promise<void> {
    const pdf = await this.pdf.generate(info);
    const html = this.buildActivationHtml(info);
    const text = `Your ClaimsFlow ${info.plan.toUpperCase()} (${info.licenseType}) licence for ${info.tenantName} is active.\nExpires: ${this.fmt(info.licenseExpiryDate)}.\nCertificate attached.`;
    await this.email.sendEmail(
      recipientEmail,
      `ClaimsFlow licence activated · ${info.tenantName}`,
      text,
      html,
      [{ filename: `ClaimsFlow-Licence-${info.tenantName.replace(/\s+/g, '_')}.pdf`, content: pdf.toString('base64'), encoding: 'base64' }],
    );
    this.logger.log(`Activation cert emailed to ${recipientEmail} for tenant ${info.tenantId}`);
  }

  /** Milestone expiry reminder (90/60/30/7/0 days). */
  async sendExpiryReminder(info: LicenseInfo, recipientEmail: string, daysRemaining: number): Promise<void> {
    const urgent = daysRemaining <= 7;
    const accent = urgent ? '#dc2626' : '#d97706';
    const when = daysRemaining <= 0 ? 'today' : `in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}`;
    const body = `
      <p style="margin:0 0 18px;color:#a1a1aa;font-size:14px;line-height:1.7">
        The ClaimsFlow licence for <strong style="color:#e4e4e7">${info.tenantName}</strong> expires
        <strong style="color:${accent}">${when}</strong> (${this.fmt(info.licenseExpiryDate)}).
        Renew before then to avoid moving to read-only access.
      </p>
      ${this.detailsTable(info)}
      <p style="margin:0;font-size:12px;color:#52525b;background:#18181b;border:1px solid #27272a;border-radius:8px;padding:12px 16px;line-height:1.6">
        After expiry you can still view existing data, but creating or editing claims will be blocked until the licence is renewed.
      </p>`;
    const html = this.shell('Your ClaimsFlow licence is expiring', `${info.tenantName} · expires ${when}`, body, accent);
    const text = `The ClaimsFlow licence for ${info.tenantName} expires ${when} (${this.fmt(info.licenseExpiryDate)}). Renew to keep write access.`;
    await this.email.sendEmail(recipientEmail, `Licence expiring ${when} · ${info.tenantName}`, text, html);
    this.logger.log(`Expiry reminder (${daysRemaining}d) emailed to ${recipientEmail} for tenant ${info.tenantId}`);
  }

  /** Subscription paused notification. */
  async sendPauseNotification(info: LicenseInfo, recipientEmail: string): Promise<void> {
    const body = `
      <p style="margin:0 0 18px;color:#a1a1aa;font-size:14px;line-height:1.7">
        The ClaimsFlow subscription for <strong style="color:#e4e4e7">${info.tenantName}</strong> has been
        <strong style="color:#d97706">paused</strong>. Access is suspended until it is resumed; the remaining licence
        time is preserved and will be credited back on resume.
      </p>${this.detailsTable(info)}`;
    const html = this.shell('Your subscription is paused', info.tenantName, body, '#d97706');
    const text = `The ClaimsFlow subscription for ${info.tenantName} has been paused. Remaining time is preserved and credited back on resume.`;
    await this.email.sendEmail(recipientEmail, `Subscription paused · ${info.tenantName}`, text, html);
  }

  /** Subscription resumed notification (with the days credited back). */
  async sendResumeNotification(info: LicenseInfo, recipientEmail: string, daysCredited: number): Promise<void> {
    const body = `
      <p style="margin:0 0 18px;color:#a1a1aa;font-size:14px;line-height:1.7">
        The ClaimsFlow subscription for <strong style="color:#e4e4e7">${info.tenantName}</strong> is
        <strong style="color:#10b981">active again</strong>. We credited
        <strong style="color:#10b981">${daysCredited} day${daysCredited === 1 ? '' : 's'}</strong> back onto your
        expiry for the time it was paused.
      </p>${this.detailsTable(info)}`;
    const html = this.shell('Your subscription is active again', info.tenantName, body);
    const text = `The ClaimsFlow subscription for ${info.tenantName} is active again. ${daysCredited} day(s) credited back. New expiry: ${this.fmt(info.licenseExpiryDate)}.`;
    await this.email.sendEmail(recipientEmail, `Subscription resumed · ${info.tenantName}`, text, html);
  }
}
