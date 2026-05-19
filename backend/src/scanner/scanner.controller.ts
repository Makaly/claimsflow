import {
  Controller, Get, Post, Body, Res, Req, UseGuards, BadRequestException, ForbiddenException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ScannerService } from './scanner.service';
import { ScanMeteringService } from '../scan-metering/scan-metering.service';

const VALID_RESOLUTIONS = [75, 150, 300, 600] as const;
const VALID_MODES = ['Color', 'Gray', 'Lineart'] as const;

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

class ScanDto {
  deviceId: string;
  resolution?: number;
  mode?: string;
  // Optional client-supplied machine context — surfaced on the dashboard.
  machineHostname?: string;
  os?: string;
}

@Controller('scanner')
@UseGuards(JwtAuthGuard)
export class ScannerController {
  constructor(
    private readonly scannerService: ScannerService,
    private readonly metering: ScanMeteringService,
  ) {}

  @Get('devices')
  listDevices() {
    return this.scannerService.listDevices();
  }

  @Post('scan')
  async scan(@Body() dto: ScanDto, @Req() req: AuthedRequest, @Res() res: Response) {
    if (!dto.deviceId?.trim()) {
      throw new BadRequestException('deviceId is required');
    }

    // ── Metering gate: refuse the scan if the user's provider is disabled ──
    const check = await this.metering.checkForUser(req.user);
    if (!check.enabled) {
      throw new ForbiddenException(
        'Scanning is disabled for your organization. Contact your administrator.',
      );
    }

    // Validate resolution and mode against allowlists — never pass raw user input to shell
    const resolution = VALID_RESOLUTIONS.includes(dto.resolution as any) ? dto.resolution : 300;
    const mode = VALID_MODES.includes(dto.mode as any) ? dto.mode : 'Color';

    // Ensure the requested device is one we actually discovered (prevents injection)
    const { devices } = await this.scannerService.listDevices();
    const device = devices.find((d) => d.id === dto.deviceId);
    if (!device) {
      throw new BadRequestException('Unknown scanner device');
    }

    let pdf: Buffer;
    try {
      pdf = await this.scannerService.scan(dto.deviceId, resolution, mode);
    } catch (err) {
      // Record the failed attempt so the dashboard reflects real-world reliability.
      const userAgent = req.headers['user-agent'];
      await this.metering.recordEvent({
        userId: req.user.userId,
        providerId: req.user.providerId,
        branchId: req.user.branchId,
        deviceClass: 'desktop',
        os: dto.os ?? null,
        machineHostname: dto.machineHostname ?? null,
        userAgent: typeof userAgent === 'string' ? userAgent : null,
        scannerName: device.name ?? device.id,
        resolution,
        mode,
        success: false,
        errorMessage: err instanceof Error ? err.message : String(err),
      }).catch(() => {}); // never let metering kill the user's response
      throw err;
    }

    // ── Success: stamp a billable event ──
    const userAgent = req.headers['user-agent'];
    await this.metering.recordEvent({
      userId: req.user.userId,
      providerId: req.user.providerId,
      branchId: req.user.branchId,
      deviceClass: 'desktop',
      os: dto.os ?? null,
      machineHostname: dto.machineHostname ?? null,
      userAgent: typeof userAgent === 'string' ? userAgent : null,
      scannerName: device.name ?? device.id,
      resolution,
      mode,
      success: true,
    }).catch(() => {}); // never block the PDF return on metering failure

    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="scan-${ts}.pdf"`,
      'Content-Length': pdf.length,
    });
    res.send(pdf);
  }
}
