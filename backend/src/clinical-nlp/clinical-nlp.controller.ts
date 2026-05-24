import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ClinicalNlpService } from './clinical-nlp.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('clinical-nlp')
@UseGuards(JwtAuthGuard)
export class ClinicalNlpController {
  constructor(private service: ClinicalNlpService) {}

  @Get('claims/:claimId/analyze')
  analyze(@Param('claimId') claimId: string) {
    return this.service.analyzeClaimById(claimId);
  }
}
