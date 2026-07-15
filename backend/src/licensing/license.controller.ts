import { Body, Controller, Get, NotFoundException, Param, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { LicenseService } from './license.service';
import { MeteringService } from './metering.service';
import { LicenseCryptoService } from './license-crypto.service';
import { LicensePdfService } from './license-pdf.service';
import { LicenseEmailService } from './license-email.service';
import { LicenseReminderService } from './license-reminder.service';
import { LicensePauseService } from './license-pause.service';
import { LicenseBillingService } from './license-billing.service';
import { PrismaService } from '../prisma/prisma.service';
import { LicenseType, PlanId, planForLicenseType, PLANS } from './plans';

/**
 * Licence admin + self-service API (mirrors helpdesk `/api/licenses`). All
 * routes require auth; mutating/overview routes additionally require the admin
 * role. The current-tenant read routes (`/me`, `/status`, `/tiers`) are open to
 * any authenticated user so the UI can render plan/usage everywhere.
 */
@Controller('licenses')
@UseGuards(JwtAuthGuard, RolesGuard)
export class LicenseController {
  constructor(
    private readonly licenses: LicenseService,
    private readonly metering: MeteringService,
    private readonly crypto: LicenseCryptoService,
    private readonly pdf: LicensePdfService,
    private readonly mailer: LicenseEmailService,
    private readonly reminders: LicenseReminderService,
    private readonly pauses: LicensePauseService,
    private readonly billing: LicenseBillingService,
    private readonly prisma: PrismaService,
  ) {}

  // ─── Self-service (any authenticated user) ───────────────────────────────

  /** Marketing/feature tier manifest (price, caps, feature lists). */
  @Get('tiers')
  tiers() {
    return { tiers: this.licenses.tierMatrix() };
  }

  /** Current tenant's licence info + live usage-vs-limits. */
  @Get('me')
  async me(@Req() req: any) {
    const tenantId = req.user?.tenantId ?? null;
    const usage = await this.metering.usageSummary(tenantId);
    const info = tenantId ? await this.licenses.getLicenseInfo(tenantId).catch(() => null) : null;
    return { info, usage };
  }

  /** Alias of /me — kept for guard-allowlist / status-poll parity. */
  @Get('status')
  status(@Req() req: any) {
    return this.me(req);
  }

  /** Verify an arbitrary signed token and return its decoded plan/features. */
  @Post('verify')
  verify(@Body() body: { token: string }) {
    const v = this.crypto.verify(body?.token ?? '');
    if (!v.valid || !v.payload) return { valid: false, reason: v.reason };
    const { lic, tenantId, issuedTo, plan, licenseType, enforcement, exp, features } = v.payload;
    return { valid: true, lic, tenantId, issuedTo, plan, licenseType, enforcement, expiresAt: exp ? new Date(exp * 1000) : null, features };
  }

  // ─── Admin / overview ────────────────────────────────────────────────────

  /** All tenants' licence state. */
  @Get('all')
  @Roles('admin')
  all() {
    return this.licenses.getAllLicenses();
  }

  /** Aggregate licence analytics (totals, by-status, by-plan, expiring-soon). */
  @Get('dashboard')
  @Roles('admin')
  dashboard() {
    return this.licenses.dashboard();
  }

  /** Signed-token history rows. ?tenantId=null scopes to the internal tenant. */
  @Get('history')
  @Roles('admin')
  history(@Query('tenantId') tenantId?: string) {
    if (tenantId === undefined) return this.metering.listLicenses();
    return this.metering.listLicenses(tenantId === 'null' ? null : tenantId);
  }

  /** One tenant's full licence info. (Namespaced under /tenant to avoid
   *  shadowing sibling routes like /pause-requests and /billing-invoices.) */
  @Get('tenant/:tenantId')
  @Roles('admin')
  forTenant(@Param('tenantId') tenantId: string) {
    return this.licenses.getLicenseInfo(tenantId);
  }

  // ─── Admin / lifecycle mutations ─────────────────────────────────────────

  /** Generate a cosmetic licence key, and optionally apply it to a tenant. */
  @Post('generate')
  @Roles('admin')
  async generate(@Body() body: { licenseType: LicenseType; tenantId?: string; durationDays?: number; issuedTo?: string }) {
    const key = this.licenses.generateLicenseKey(body.licenseType);
    if (body.tenantId) {
      const info = await this.licenses.applyLicense(body.tenantId, {
        licenseType: body.licenseType,
        licenseKey: key,
        durationDays: body.durationDays,
        issuedTo: body.issuedTo,
      });
      return { key, applied: true, info };
    }
    return { key, applied: false, plan: planForLicenseType(body.licenseType), features: PLANS[planForLicenseType(body.licenseType)].features };
  }

  /** Apply/renew a licence on a tenant. */
  @Post('apply/:tenantId')
  @Roles('admin')
  apply(
    @Param('tenantId') tenantId: string,
    @Body() body: { licenseType: LicenseType; licenseKey?: string; durationDays?: number; issuedTo?: string },
  ) {
    return this.licenses.applyLicense(tenantId, body);
  }

  /** Install/activate a signed token (paste from the mint CLI). */
  @Post('install')
  @Roles('admin')
  install(@Body() body: { token: string }) {
    return this.metering.installToken(body.token);
  }

  /** Revoke a signed-token licence row by id. */
  @Post('revoke')
  @Roles('admin')
  async revoke(@Body() body: { licenseId: string }) {
    await this.metering.revoke(body.licenseId);
    return { ok: true };
  }

  /** Extend a tenant's TRIAL by N days (max 365). */
  @Post('extend-trial/:tenantId')
  @Roles('admin')
  extendTrial(@Param('tenantId') tenantId: string, @Body() body: { days: number }) {
    return this.licenses.extendTrial(tenantId, body.days);
  }

  /** Hard-revoke a tenant's live licence (sets licenseStatus=REVOKED). */
  @Post('revoke-tenant/:tenantId')
  @Roles('admin')
  revokeTenant(@Param('tenantId') tenantId: string) {
    return this.licenses.revokeLicense(tenantId);
  }

  // ─── PDF certificate & lifecycle email ───────────────────────────────────

  /** Stream the branded PDF licence certificate inline. */
  @Get('preview-pdf/:tenantId')
  @Roles('admin')
  async previewPdf(@Param('tenantId') tenantId: string, @Res() res: Response) {
    const info = await this.licenses.getLicenseInfo(tenantId);
    const buf = await this.pdf.generate(info);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="ClaimsFlow-Licence-${tenantId}.pdf"`,
      'Content-Length': String(buf.length),
    });
    res.end(buf);
  }

  /** Rendered activation-email HTML (admin preview). */
  @Get('email-preview/:tenantId')
  @Roles('admin')
  async emailPreview(@Param('tenantId') tenantId: string) {
    const info = await this.licenses.getLicenseInfo(tenantId);
    return { html: this.mailer.buildActivationHtml(info), info };
  }

  /** (Re)send the activation certificate email. Recipient defaults to the tenant admin. */
  @Post('resend-email/:tenantId')
  @Roles('admin')
  async resendEmail(@Param('tenantId') tenantId: string, @Body() body: { recipientEmail?: string }) {
    const info = await this.licenses.getLicenseInfo(tenantId);
    const to = body?.recipientEmail ?? (await this.adminEmail(tenantId));
    if (!to) throw new NotFoundException('No recipient email — pass recipientEmail or set a tenant admin');
    await this.mailer.sendActivationEmail(info, to);
    return { ok: true, sentTo: to };
  }

  /** Manually run the expiry-reminder sweep (normally a daily cron). */
  @Post('run-reminders')
  @Roles('admin')
  runReminders() {
    return this.reminders.dailySweep();
  }

  // ─── Pause / resume workflow ─────────────────────────────────────────────

  /** Raise a PAUSE/RESUME request. autoApprove (default true for admins) executes it now. */
  @Post('pause-request/:tenantId')
  @Roles('admin')
  pauseRequest(
    @Param('tenantId') tenantId: string,
    @Req() req: any,
    @Body() body: { type: 'PAUSE' | 'RESUME'; reason?: string; proofUrl?: string; ticketRef?: string; autoApprove?: boolean },
  ) {
    const autoApprove = body.autoApprove ?? true;
    return this.pauses.createRequest(tenantId, body, req.user?.userId, autoApprove);
  }

  /** List pause/resume requests (?status, ?tenantId). */
  @Get('pause-requests')
  @Roles('admin')
  pauseRequests(@Query('status') status?: string, @Query('tenantId') tenantId?: string) {
    return this.pauses.list({ status, tenantId });
  }

  /** Approve a pending pause/resume request (executes the transition). */
  @Patch('pause-requests/:requestId/approve')
  @Roles('admin')
  approvePause(@Param('requestId') requestId: string, @Req() req: any) {
    return this.pauses.approve(requestId, req.user?.userId);
  }

  /** Reject a pending pause/resume request. */
  @Patch('pause-requests/:requestId/reject')
  @Roles('admin')
  rejectPause(@Param('requestId') requestId: string, @Req() req: any, @Body() body: { reason?: string }) {
    return this.pauses.reject(requestId, req.user?.userId, body?.reason);
  }

  // ─── Billing invoices ────────────────────────────────────────────────────

  /** Create a subscription invoice (per-seat priced, VAT-inclusive). */
  @Post('billing-invoices')
  @Roles('admin')
  createInvoice(
    @Req() req: any,
    @Body() body: { tenantId: string; plan: PlanId; seats: number; unitPrice: number; vatRate?: number; periodFrom: string; periodTo: string; currency?: string; issuedTo?: string; notes?: string },
  ) {
    const { tenantId, ...rest } = body;
    return this.billing.createInvoice(tenantId, rest, req.user?.userId);
  }

  /** List invoices (?tenantId), newest first, with payments. */
  @Get('billing-invoices')
  @Roles('admin')
  invoices(@Query('tenantId') tenantId?: string) {
    return this.billing.list(tenantId);
  }

  /** Mark an invoice as SENT. */
  @Post('billing-invoices/:id/sent')
  @Roles('admin')
  markSent(@Param('id') id: string) {
    return this.billing.markSent(id);
  }

  /** Record a (full or partial) payment; applies the licence when fully paid. */
  @Post('billing-invoices/:id/payments')
  @Roles('admin')
  recordPayment(@Param('id') id: string, @Req() req: any, @Body() body: { amount: number; method?: string; reference?: string }) {
    return this.billing.recordPayment(id, body, req.user?.userId);
  }

  /** Payment ledger for an invoice. */
  @Get('billing-invoices/:id/payments')
  @Roles('admin')
  invoicePayments(@Param('id') id: string) {
    return this.billing.getPayments(id);
  }

  /** Void an unpaid invoice. */
  @Post('billing-invoices/:id/void')
  @Roles('admin')
  voidInvoice(@Param('id') id: string) {
    return this.billing.voidInvoice(id);
  }

  private async adminEmail(tenantId: string): Promise<string | null> {
    const u = await this.prisma.user.findFirst({
      where: { tenantId, role: 'admin', isActive: true },
      select: { email: true },
    });
    return u?.email ?? null;
  }
}
