import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { PolicyService } from './policy.service';
import { AdjudicationService } from './adjudication.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('policy')
@UseGuards(JwtAuthGuard)
export class PolicyController {
  constructor(
    private readonly policyService: PolicyService,
    private readonly adjudicationService: AdjudicationService,
  ) {}

  // ── Plans ──
  @Get('plans')
  getPlans(@Query('isActive') isActive?: string) {
    return this.policyService.getPlans({
      isActive: isActive === undefined ? undefined : isActive === 'true',
    });
  }

  @Post('plans')
  @UseGuards(RolesGuard)
  @Roles('admin', 'claims_officer')
  createPlan(@Body() body: any) {
    return this.policyService.createPlan(body);
  }

  @Patch('plans/:id')
  @UseGuards(RolesGuard)
  @Roles('admin', 'claims_officer')
  updatePlan(@Param('id') id: string, @Body() body: any) {
    return this.policyService.updatePlan(id, body);
  }

  @Patch('plans/:id/deactivate')
  @UseGuards(RolesGuard)
  @Roles('admin', 'claims_officer')
  deactivatePlan(@Param('id') id: string) {
    return this.policyService.deactivatePlan(id);
  }

  // ── Members ──
  @Get('members')
  getMembers(
    @Query('search') search?: string,
    @Query('planId') planId?: string,
    @Query('isActive') isActive?: string,
  ) {
    return this.policyService.getMembers({
      search,
      planId,
      isActive: isActive === undefined ? undefined : isActive === 'true',
    });
  }

  @Get('members/by-number/:memberNumber')
  getMemberByNumber(@Param('memberNumber') memberNumber: string) {
    return this.policyService.getMemberByNumber(memberNumber);
  }

  @Post('members')
  @UseGuards(RolesGuard)
  @Roles('admin', 'claims_officer')
  createMember(@Body() body: any) {
    return this.policyService.createMember(body);
  }

  @Patch('members/:id')
  @UseGuards(RolesGuard)
  @Roles('admin', 'claims_officer')
  updateMember(@Param('id') id: string, @Body() body: any) {
    return this.policyService.updateMember(id, body);
  }

  // ── Adjudication ──
  @Post('adjudicate')
  adjudicate(
    @Body()
    body: {
      memberNumber?: string;
      invoiceAmount: number;
      claimType?: 'inpatient' | 'outpatient' | 'dental' | 'optical' | 'maternity';
      dateOfService?: string;
    },
  ) {
    return this.adjudicationService.adjudicate(body);
  }
}
