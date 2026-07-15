import { Controller, Post, Get, Body, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { NpsService, SubmitNpsDto } from './nps.service';

@Controller('nps')
export class NpsController {
  constructor(private readonly nps: NpsService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  submit(@Body() dto: SubmitNpsDto) {
    return this.nps.submit(dto);
  }

  /** Has this claim already been rated? Lets the prompt show exactly once. */
  @Get('status')
  @UseGuards(JwtAuthGuard)
  async status(@Query('claimId') claimId: string, @Query('memberId') memberId?: string) {
    if (!claimId) return { responded: false };
    return { responded: await this.nps.hasResponded(claimId, memberId) };
  }

  @Get('dashboard')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'claims_officer', 'finance')
  dashboard(@Query('from') from?: string, @Query('to') to?: string) {
    return this.nps.dashboard({ from, to });
  }

  @Get('export')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'claims_officer', 'finance')
  async export(@Res() res: Response, @Query('from') from?: string, @Query('to') to?: string) {
    const csv = await this.nps.exportCsv({ from, to });
    const stamp = new Date().toISOString().slice(0, 10);
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="nps-responses-${stamp}.csv"`,
    });
    res.send(csv);
  }
}
