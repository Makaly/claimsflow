import { Body, Controller, Get, Headers, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { InstallationRegistryService } from './installation-registry.service';
import { PlanId } from '../licensing/plans';

/**
 * Central LICENSE-SERVER API (E8). Two audiences:
 *  - Machine endpoints (no JWT): `/activate` + `/heartbeat`, called by deployed
 *    installations over the internet. Authenticated by the activation key
 *    (activate) and the per-install secret header (heartbeat).
 *  - Admin endpoints (JWT + admin): mint/list/revoke activation keys, list and
 *    suspend/resume/revoke installations, and the fleet dashboard.
 */
@Controller('license-server')
export class LicenseServerController {
  constructor(private readonly registry: InstallationRegistryService) {}

  private ip(req: Request): string | undefined {
    return (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip;
  }

  // ── Machine endpoints (open) ──────────────────────────────────────────────

  /** Activate an installation with an online key. Returns a signed lease + one-time secret. */
  @Post('activate')
  activate(
    @Req() req: Request,
    @Body() body: { activationKey: string; installationId: string; hostname?: string; version?: string; label?: string },
  ) {
    return this.registry.activate({ ...body, ip: this.ip(req) });
  }

  /** Refresh the lease. Called on a schedule by each install; auth via x-installation-secret. */
  @Post('heartbeat')
  heartbeat(
    @Req() req: Request,
    @Headers('x-installation-secret') secret: string,
    @Body() body: { installationId: string; version?: string },
  ) {
    return this.registry.heartbeat({ installationId: body.installationId, secret, version: body.version, ip: this.ip(req) });
  }

  // ── Admin endpoints (JWT + admin) ─────────────────────────────────────────

  @Post('keys')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  generateKeys(
    @Req() req: any,
    @Body() body: { plan?: PlanId; count?: number; termDays?: number; maxActivations?: number; issuedTo?: string; expiresAt?: string },
  ) {
    return this.registry.generateKeys(body, req.user?.userId);
  }

  @Get('keys')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  listKeys() {
    return this.registry.listKeys();
  }

  @Post('keys/:id/revoke')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  revokeKey(@Param('id') id: string) {
    return this.registry.revokeKey(id);
  }

  @Get('installations')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  installations() {
    return this.registry.listInstallations();
  }

  @Get('dashboard')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  dashboard() {
    return this.registry.dashboard();
  }

  @Get('installations/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  installation(@Param('id') id: string) {
    return this.registry.getInstallation(id);
  }

  @Post('installations/:id/suspend')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  suspend(@Param('id') id: string) {
    return this.registry.setStatus(id, 'SUSPENDED');
  }

  @Post('installations/:id/resume')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  resume(@Param('id') id: string) {
    return this.registry.setStatus(id, 'ACTIVE');
  }

  @Post('installations/:id/revoke')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  revoke(@Param('id') id: string) {
    return this.registry.setStatus(id, 'REVOKED');
  }
}
