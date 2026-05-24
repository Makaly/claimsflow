import {
  Controller, Get, Post, Patch, Body, Query, Param, Request, UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { BankReconService } from './bank-recon.service';

@Controller('bank-recon')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'finance')
export class BankReconController {
  constructor(private readonly svc: BankReconService) {}

  @Post('ingest')
  ingest(@Body() body: { content: string; format: 'mt940' | 'camt053' | 'csv' }) {
    return this.svc.ingest(body.content, body.format);
  }

  @Get('unreconciled')
  getUnreconciled(@Query('take') take?: string) {
    return this.svc.getUnreconciled(take ? parseInt(take, 10) : 50);
  }

  @Get('summary')
  getSummary() {
    return this.svc.getSummary();
  }

  @Patch(':id/match')
  manualMatch(
    @Param('id') id: string,
    @Body() body: { claimId: string },
    @Request() req: any,
  ) {
    return this.svc.manualMatch(id, body.claimId, req.user.userId);
  }

  @Patch(':id/write-off')
  writeOff(
    @Param('id') id: string,
    @Body() body: { reason: string },
    @Request() req: any,
  ) {
    return this.svc.writeOff(id, body.reason, req.user.userId);
  }
}
