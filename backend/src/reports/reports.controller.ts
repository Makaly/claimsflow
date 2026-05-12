import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ReportsService } from './reports.service';

@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'supervisor')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('claims-volume')
  getClaimsVolume(
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('groupBy') groupBy?: string,
  ) {
    return this.reportsService.getClaimsVolume(dateFrom, dateTo, groupBy);
  }

  @Get('uploads-summary')
  getUploadsSummary(
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.reportsService.getUploadsSummary(dateFrom, dateTo);
  }

  @Get('approvals-rejections')
  getApprovalsRejections(
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.reportsService.getApprovalsRejections(dateFrom, dateTo);
  }

  @Get('audit-trail')
  getAuditTrail(
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('action') action?: string,
    @Query('entity') entity?: string,
    @Query('userId') userId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.reportsService.getAuditTrail({
      dateFrom,
      dateTo,
      action,
      entity,
      userId,
      limit: limit ? parseInt(limit) : undefined,
      offset: offset ? parseInt(offset) : undefined,
    });
  }

  @Get('error-omission-rates')
  getErrorOmissionRates(
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.reportsService.getErrorOmissionRates(dateFrom, dateTo);
  }

  @Get('provider-performance')
  getProviderPerformance(
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.reportsService.getProviderPerformance(dateFrom, dateTo);
  }

  @Get('provider-scorecard')
  getProviderScorecard(
    @Query('providerId') providerId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.reportsService.getProviderScorecard(providerId, dateFrom, dateTo);
  }

  @Get('aging')
  getAgingReport(@Query('stage') stage?: string) {
    return this.reportsService.getAgingReport(stage);
  }

  @Get('cross-provider-duplicates')
  getCrossProviderDuplicates(
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.reportsService.getCrossProviderDuplicates(dateFrom, dateTo);
  }

  @Get('fraud-summary')
  getFraudSummary(
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.reportsService.getFraudSummary(dateFrom, dateTo);
  }

  @Get('processing-time')
  getProcessingTime(
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.reportsService.getProcessingTime(dateFrom, dateTo);
  }
}
