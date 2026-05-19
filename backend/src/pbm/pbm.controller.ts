import { Controller, Post, Get, Body, Query, UseGuards } from '@nestjs/common';
import { PbmService } from './pbm.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('pbm')
@UseGuards(JwtAuthGuard)
export class PbmController {
  constructor(private service: PbmService) {}

  @Post('eligibility')
  checkEligibility(@Body('drugCodes') drugCodes: string[]) {
    return this.service.checkEligibility(drugCodes);
  }

  @Get('formulary')
  getFormulary(@Query('tier') tier?: string) {
    return this.service.getFormulary(tier ? parseInt(tier) : undefined);
  }
}
