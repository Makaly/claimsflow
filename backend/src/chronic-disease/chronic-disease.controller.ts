import { Controller, Get, Post, Query, Param, UseGuards } from '@nestjs/common';
import { ChronicDiseaseService } from './chronic-disease.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('chronic-disease')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ChronicDiseaseController {
  constructor(private service: ChronicDiseaseService) {}

  @Get('conditions')
  @Roles('admin', 'claims_officer', 'fraud_officer')
  getConditions() {
    return this.service.getConditions();
  }

  @Get('cohort')
  @Roles('admin', 'claims_officer', 'fraud_officer')
  getCohort(
    @Query('conditionCode') conditionCode?: string,
    @Query('status') status?: string,
  ) {
    return this.service.getCohort(conditionCode, status);
  }

  @Get('members/:memberNumber')
  @Roles('admin', 'claims_officer', 'fraud_officer')
  getMemberStatus(@Param('memberNumber') memberNumber: string) {
    return this.service.getMemberStatus(memberNumber);
  }

  @Get('care-gaps')
  @Roles('admin', 'claims_officer')
  detectCareGaps(@Query('conditionCode') conditionCode?: string): Promise<any> {
    return this.service.detectCareGaps(conditionCode);
  }

  @Get('summary')
  @Roles('admin', 'claims_officer', 'fraud_officer')
  getSummary() {
    return this.service.getSummary();
  }

  @Post('scan')
  @Roles('admin')
  runScan() {
    return this.service.runDailyCohortScan();
  }
}
