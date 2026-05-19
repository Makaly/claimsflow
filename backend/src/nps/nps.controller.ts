import { Controller, Post, Get, Body, Query, UseGuards } from '@nestjs/common';
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

  @Get('dashboard')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'claims_officer', 'finance')
  dashboard(@Query('from') from?: string, @Query('to') to?: string) {
    return this.nps.dashboard({ from, to });
  }
}
