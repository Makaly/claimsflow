import {
  Controller, Get, Post, Body, Res, UseGuards, BadRequestException,
} from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ScannerService } from './scanner.service';

const VALID_RESOLUTIONS = [75, 150, 300, 600] as const;
const VALID_MODES = ['Color', 'Gray', 'Lineart'] as const;

class ScanDto {
  deviceId: string;
  resolution?: number;
  mode?: string;
}

@Controller('scanner')
@UseGuards(JwtAuthGuard)
export class ScannerController {
  constructor(private readonly scannerService: ScannerService) {}

  @Get('devices')
  listDevices() {
    return this.scannerService.listDevices();
  }

  @Post('scan')
  async scan(@Body() dto: ScanDto, @Res() res: Response) {
    if (!dto.deviceId?.trim()) {
      throw new BadRequestException('deviceId is required');
    }

    // Validate resolution and mode against allowlists — never pass raw user input to shell
    const resolution = VALID_RESOLUTIONS.includes(dto.resolution as any) ? dto.resolution : 300;
    const mode = VALID_MODES.includes(dto.mode as any) ? dto.mode : 'Color';

    // Ensure the requested device is one we actually discovered (prevents injection)
    const { devices } = await this.scannerService.listDevices();
    if (!devices.some((d) => d.id === dto.deviceId)) {
      throw new BadRequestException('Unknown scanner device');
    }

    const pdf = await this.scannerService.scan(dto.deviceId, resolution, mode);
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="scan-${ts}.pdf"`,
      'Content-Length': pdf.length,
    });
    res.send(pdf);
  }
}
