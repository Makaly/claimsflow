import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { WorkflowService } from './workflow.service';
import { MakerCheckerService } from './maker-checker.service';
import { CompletenessValidationService } from './completeness-validation.service';
import { AssignmentService } from './assignment.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('workflow')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'supervisor', 'claims_officer', 'checker', 'fraud_officer')
export class WorkflowController {
  constructor(
    private workflowService: WorkflowService,
    private makerCheckerService: MakerCheckerService,
    private completenessService: CompletenessValidationService,
    private assignmentService: AssignmentService,
  ) {}

  // Workflow Statistics
  @Get('statistics')
  async getStatistics() {
    return this.workflowService.getWorkflowStatistics();
  }

  // Get claims by stage
  @Get('claims/:stage')
  async getClaimsByStage(
    @Param('stage') stage: string,
    @Request() req: any,
    @Query('assignedTo') assignedTo?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.workflowService.getClaimsByStage(
      stage,
      assignedTo,
      limit ? parseInt(limit, 10) : undefined,
      offset ? parseInt(offset, 10) : undefined,
      req?.user
        ? { userId: req.user.userId, role: req.user.role }
        : undefined,
    );
  }

  // Maker-Checker Operations
  @Post('maker/assign')
  async assignToMaker(
    @Body() body: { claimId: string; makerId: string },
    @Request() req,
  ) {
    return this.makerCheckerService.assignToMaker(
      body.claimId,
      body.makerId,
      req.user.userId,
    );
  }

  @Post('maker/approve')
  async makerApprove(
    @Body() body: { claimId: string; comments?: string },
    @Request() req,
  ) {
    return this.makerCheckerService.makerApprove(
      body.claimId,
      req.user.userId,
      body.comments,
    );
  }

  @Post('maker/reject')
  async makerReject(
    @Body() body: { claimId: string; reason: string },
    @Request() req,
  ) {
    return this.makerCheckerService.makerReject(
      body.claimId,
      req.user.userId,
      body.reason,
    );
  }

  @Post('checker/assign')
  async assignToChecker(
    @Body() body: { claimId: string; checkerId: string },
    @Request() req,
  ) {
    return this.makerCheckerService.assignToChecker(
      body.claimId,
      body.checkerId,
      req.user.userId,
    );
  }

  @Post('checker/approve')
  async checkerApprove(
    @Body() body: { claimId: string; comments?: string },
    @Request() req,
  ) {
    return this.makerCheckerService.checkerApprove(
      body.claimId,
      req.user.userId,
      body.comments,
    );
  }

  @Post('checker/reject')
  async checkerReject(
    @Body() body: { claimId: string; reason: string },
    @Request() req,
  ) {
    return this.makerCheckerService.checkerReject(
      body.claimId,
      req.user.userId,
      body.reason,
    );
  }

  @Post('checker/return')
  async returnToMaker(
    @Body() body: { claimId: string; reason: string },
    @Request() req,
  ) {
    return this.makerCheckerService.returnToMaker(
      body.claimId,
      req.user.userId,
      body.reason,
    );
  }

  @Post('checker/return-to-provider')
  async returnToProvider(
    @Body() body: { claimId: string; reason: string; missingDocuments?: string[] },
    @Request() req,
  ) {
    return this.makerCheckerService.returnToProvider(
      body.claimId,
      req.user.userId,
      body.reason,
      body.missingDocuments || [],
    );
  }

  @Post('provider/resubmit')
  @Roles('admin', 'supervisor', 'claims_officer', 'provider_admin', 'provider_user')
  async providerResubmit(
    @Body() body: { claimId: string; notes?: string },
    @Request() req,
  ) {
    return this.makerCheckerService.providerResubmit(
      body.claimId,
      req.user.userId,
      body.notes,
    );
  }

  @Get('approval-history/:claimId')
  async getApprovalHistory(@Param('claimId') claimId: string) {
    return this.makerCheckerService.getApprovalHistory(claimId);
  }

  /**
   * Sweep orphaned claims (submitted + unassigned) into the Maker Queue.
   * Useful for back-filling claims created before auto-assign was wired.
   */
  @Post('reroute-orphans')
  async rerouteOrphans(@Request() req: any) {
    return this.makerCheckerService.rerouteOrphans(req?.user?.userId);
  }

  // Completeness Validation
  @Post('validate-completeness/:claimId')
  async validateCompleteness(@Param('claimId') claimId: string) {
    return this.completenessService.validateClaimCompleteness(claimId);
  }

  @Post('validate-all-submitted')
  async validateAllSubmitted() {
    return this.completenessService.validateAllSubmittedClaims();
  }

  @Post('mark-incomplete')
  async markIncomplete(
    @Body() body: { claimId: string; missingDocuments: string[]; reason: string },
  ) {
    return this.completenessService.markAsIncomplete(
      body.claimId,
      body.missingDocuments,
      body.reason,
    );
  }

  // Assignment
  @Post('assign-claims')
  async assignClaims(
    @Body() body: {
      claimIds: string[];
      reviewerIds: string[];
      strategy?: 'fifo' | 'workload' | 'region' | 'provider' | 'random';
    },
  ) {
    return this.assignmentService.assignClaims(
      body.claimIds,
      body.reviewerIds,
      body.strategy || 'fifo',
    );
  }

  @Get('reviewer-workload')
  async getReviewerWorkload(@Query('reviewerId') reviewerId?: string) {
    return this.assignmentService.getReviewerWorkload(reviewerId);
  }

  @Get('pending-assignment')
  async getPendingAssignment(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.workflowService.getClaimsPendingAssignment(
      limit ? parseInt(limit, 10) : undefined,
      offset ? parseInt(offset, 10) : undefined,
    );
  }
}
