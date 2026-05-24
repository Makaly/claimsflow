import { Controller, Get, Post, Body, Query, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ErpService } from './erp.service';

@Controller('erp')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'finance')
export class ErpController {
  constructor(private readonly erp: ErpService) {}

  @Get('coa')
  getCoaMappings() {
    return this.erp.getCoaMappings();
  }

  @Post('coa')
  upsertCoa(@Body() body: { claimType: string; accountCode: string; accountName: string }) {
    return this.erp.upsertCoa(body.claimType, body.accountCode, body.accountName);
  }

  @Get('posting-logs')
  getPostingLogs(@Query('take') take?: string) {
    return this.erp.getPostingLogs(take ? parseInt(take, 10) : 30);
  }

  @Post('posting/run')
  @HttpCode(HttpStatus.OK)
  runPosting(@Body() body: { date?: string }) {
    const date = body.date ?? new Date().toISOString().slice(0, 10);
    return this.erp.postForDate(date);
  }
}
