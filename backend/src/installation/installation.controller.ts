import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { InstallationService } from './installation.service';
import { InstallationGuard } from './installation.guard';

/**
 * Installation client API (E8). `GET /installation/status` is intentionally
 * open (it's on the lockout allowlist) so the reactivation screen renders even
 * when the app is locked. Activation requires admin.
 */
@Controller('installation')
export class InstallationController {
  constructor(
    private readonly installation: InstallationService,
    private readonly guard: InstallationGuard,
  ) {}

  /** Current lock/licence state for this installation. Open (needed by the lock screen). */
  @Get('status')
  status() {
    return this.installation.status();
  }

  /** Activate this installation with an online key. Admin only. */
  @Post('activate')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async activate(@Body() body: { activationKey: string; label?: string }) {
    const res = await this.installation.activate(body.activationKey, body.label);
    this.guard.invalidate();
    return res;
  }

  /** Force an immediate heartbeat/lease refresh. Admin only. */
  @Post('heartbeat-now')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async heartbeatNow() {
    const r = await this.installation.heartbeat();
    this.guard.invalidate();
    return { ...r, status: await this.installation.status() };
  }
}
