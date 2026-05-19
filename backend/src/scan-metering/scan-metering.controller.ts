import {
  Controller, Get, Patch, Post, Body, Param, Req, UseGuards,
  ForbiddenException, BadRequestException,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ScanMeteringService } from './scan-metering.service';

interface AuthedRequest extends Request {
  user: {
    userId: string;
    email: string;
    role: string;
    providerId: string | null;
    branchId: string | null;
    name: string;
  };
}

class UpdateSettingsDto {
  enabled?: boolean;
  costPerScan?: number;
  currency?: string;
}

class RecordEventDto {
  deviceClass!: 'desktop' | 'mobile' | 'camera';
  os?: string;
  machineHostname?: string;
  scannerName?: string;
  resolution?: number;
  mode?: string;
  pages?: number;
  success?: boolean;
  errorMessage?: string;
}

@Controller('scan-metering')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ScanMeteringController {
  constructor(private readonly service: ScanMeteringService) {}

  /** Cheap pre-flight check the frontend hits to know whether to show the
   *  scan button or a "disabled" banner. */
  @Get('check')
  @Roles('admin', 'finance', 'claims_officer', 'maker_checker', 'fraud_officer', 'provider_admin', 'provider_user')
  async check(@Req() req: AuthedRequest) {
    return this.service.checkForUser(req.user);
  }

  /** Admin/finance: list all provider settings. */
  @Get('settings')
  @Roles('admin', 'finance')
  async listSettings() {
    return { settings: await this.service.listAllSettings() };
  }

  /** Admin only: toggle enabled / change price / currency for one org. */
  @Patch('settings/:providerId')
  @Roles('admin')
  async updateSettings(
    @Param('providerId') providerId: string,
    @Body() body: UpdateSettingsDto,
    @Req() req: AuthedRequest,
  ) {
    if (body.costPerScan !== undefined && (body.costPerScan < 0 || body.costPerScan > 100000)) {
      throw new BadRequestException('costPerScan must be between 0 and 100000');
    }
    if (body.currency !== undefined && !/^[A-Z]{3}$/.test(body.currency)) {
      throw new BadRequestException('currency must be a 3-letter ISO code');
    }
    return this.service.updateSettings(providerId, { userId: req.user.userId }, body);
  }

  /** Records a scan event. Called by the frontend after each successful
   *  (or failed) scan via the local agent OR the camera fallback. */
  @Post('events')
  @Roles('admin', 'finance', 'claims_officer', 'maker_checker', 'fraud_officer', 'provider_admin', 'provider_user')
  async recordEvent(@Body() body: RecordEventDto, @Req() req: AuthedRequest) {
    if (!['desktop', 'mobile', 'camera'].includes(body.deviceClass)) {
      throw new BadRequestException('deviceClass must be one of: desktop, mobile, camera');
    }
    const userAgent = req.headers['user-agent'] ?? null;
    const event = await this.service.recordEvent({
      userId: req.user.userId,
      providerId: req.user.providerId,
      branchId: req.user.branchId,
      deviceClass: body.deviceClass,
      os: body.os ?? null,
      machineHostname: body.machineHostname ?? null,
      userAgent: typeof userAgent === 'string' ? userAgent : null,
      scannerName: body.scannerName ?? null,
      resolution: body.resolution ?? null,
      mode: body.mode ?? null,
      pages: body.pages ?? null,
      success: body.success ?? true,
      errorMessage: body.errorMessage ?? null,
    });
    return { id: event.id, costAtScan: Number(event.costAtScan), currency: event.currency };
  }

  /** Aggregate dashboard data. Admin/finance see all orgs; everyone else is
   *  restricted to their own provider scope. */
  @Get('dashboard')
  @Roles('admin', 'finance', 'provider_admin', 'claims_officer', 'maker_checker', 'fraud_officer')
  async dashboard(@Req() req: AuthedRequest) {
    const isCrossOrg = req.user.role === 'admin' || req.user.role === 'finance';
    if (!isCrossOrg && !req.user.providerId) {
      throw new ForbiddenException('No provider scope — contact your administrator.');
    }
    const scope = isCrossOrg ? null : req.user.providerId;
    return this.service.dashboard(scope);
  }
}
