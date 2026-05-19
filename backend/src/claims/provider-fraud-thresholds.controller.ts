import { Controller, Get, Put, Param, Body, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ProviderFraudThresholdsService } from './provider-fraud-thresholds.service';

@Controller('fraud-thresholds')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProviderFraudThresholdsController {
  constructor(private readonly svc: ProviderFraudThresholdsService) {}

  @Get()
  @Roles('admin', 'fraud_officer')
  findAll() {
    return this.svc.findAll();
  }

  @Get(':providerId')
  @Roles('admin', 'fraud_officer')
  findOne(@Param('providerId') providerId: string) {
    return this.svc.findByProvider(providerId);
  }

  @Put(':providerId')
  @Roles('admin')
  upsert(
    @Param('providerId') providerId: string,
    @Body() body: { threshold: number },
    @Request() req: any,
  ) {
    return this.svc.upsert(providerId, body.threshold, req.user.userId);
  }
}
