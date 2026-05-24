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
import { SlaService } from './sla.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';

@Controller('workflow')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'claims_officer', 'maker_checker', 'fraud_officer', 'finance')
export class WorkflowController {
  constructor(
    private workflowService: WorkflowService,
    private makerCheckerService: MakerCheckerService,
    private completenessService: CompletenessValidationService,
    private assignmentService: AssignmentService,
    private slaService: SlaService,
    private prisma: PrismaService,
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
  @Roles('admin', 'claims_officer', 'maker_checker', 'provider_admin', 'provider_user')
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

  // Claims Officer Operations (final approval gate)
  @Post('claims-officer/approve')
  @Roles('admin', 'claims_officer')
  async claimsOfficerApprove(
    @Body() body: { claimId: string; comments?: string },
    @Request() req,
  ) {
    return this.makerCheckerService.claimsOfficerApprove(
      body.claimId,
      req.user.userId,
      body.comments,
    );
  }

  @Post('claims-officer/reject')
  @Roles('admin', 'claims_officer')
  async claimsOfficerReject(
    @Body() body: { claimId: string; reason: string },
    @Request() req,
  ) {
    return this.makerCheckerService.claimsOfficerReject(
      body.claimId,
      req.user.userId,
      body.reason,
    );
  }

  @Post('claims-officer/return-to-maker-checker')
  @Roles('admin', 'claims_officer')
  async claimsOfficerReturnToMakerChecker(
    @Body() body: { claimId: string; reason: string },
    @Request() req,
  ) {
    return this.makerCheckerService.claimsOfficerReturnToMakerChecker(
      body.claimId,
      req.user.userId,
      body.reason,
    );
  }

  @Post('claims-officer/return-to-provider')
  @Roles('admin', 'claims_officer')
  async claimsOfficerReturnToProvider(
    @Body() body: { claimId: string; reason: string; missingDocuments?: string[] },
    @Request() req,
  ) {
    return this.makerCheckerService.claimsOfficerReturnToProvider(
      body.claimId,
      req.user.userId,
      body.reason,
      body.missingDocuments || [],
    );
  }

  @Post('claims-officer/escalate-to-fraud')
  @Roles('admin', 'claims_officer')
  async claimsOfficerEscalateToFraud(
    @Body() body: { claimId: string; reason: string },
    @Request() req,
  ) {
    return this.makerCheckerService.claimsOfficerEscalateToFraud(
      body.claimId,
      req.user.userId,
      body.reason,
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

  @Post('set-leave')
  async setUserLeave(
    @Body() body: { userId: string; isOnLeave: boolean; relieverId?: string },
    @Request() req: any,
  ) {
    return this.makerCheckerService.setUserLeave(
      body.userId,
      body.isOnLeave,
      body.relieverId,
      req?.user?.userId,
    );
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

  @Get('maker-checker-workload')
  async getMakerCheckerWorkload() {
    return this.assignmentService.getMakerCheckerWorkload();
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

  // SLA endpoints
  @Get('sla/summary')
  async getSlaSummary() {
    return this.slaService.getSlaSummary();
  }

  @Get('sla/aging')
  async getAgingReport() {
    return this.slaService.getAgingReport();
  }

  // Bulk actions
  @Post('bulk/assign')
  @Roles('admin', 'claims_officer')
  async bulkAssign(@Body() body: { claimIds: string[]; assigneeId: string }, @Request() req) {
    const results: any[] = [];
    for (const claimId of body.claimIds) {
      try {
        const result = await this.makerCheckerService.assignToMaker(claimId, body.assigneeId, req.user.userId);
        results.push({ claimId, success: true, claim: result });
      } catch (e: any) {
        results.push({ claimId, success: false, error: e.message });
      }
    }
    return { results, succeeded: results.filter(r => r.success).length, failed: results.filter(r => !r.success).length };
  }

  @Post('bulk/approve-maker')
  @Roles('admin', 'claims_officer', 'maker_checker')
  async bulkMakerApprove(@Body() body: { claimIds: string[]; comments?: string }, @Request() req) {
    const results: any[] = [];
    for (const claimId of body.claimIds) {
      try {
        const result = await this.makerCheckerService.makerApprove(claimId, req.user.userId, body.comments);
        results.push({ claimId, success: true, claim: result });
      } catch (e: any) {
        results.push({ claimId, success: false, error: e.message });
      }
    }
    return { results, succeeded: results.filter(r => r.success).length, failed: results.filter(r => !r.success).length };
  }

  @Post('bulk/approve-checker')
  @Roles('admin', 'maker_checker')
  async bulkCheckerApprove(@Body() body: { claimIds: string[]; comments?: string }, @Request() req) {
    const results: any[] = [];
    for (const claimId of body.claimIds) {
      try {
        const result = await this.makerCheckerService.checkerApprove(claimId, req.user.userId, body.comments);
        results.push({ claimId, success: true, claim: result });
      } catch (e: any) {
        results.push({ claimId, success: false, error: e.message });
      }
    }
    return { results, succeeded: results.filter(r => r.success).length, failed: results.filter(r => !r.success).length };
  }

  /**
   * Smart bulk approve for the maker-checker queue.
   * Per claim: tries makerApprove (if assigned to caller), falls back to
   * checkerApprove (for unassigned claims awaiting second-level sign-off).
   */
  @Post('bulk/approve-auto')
  @Roles('admin', 'claims_officer', 'maker_checker')
  async bulkApproveAuto(@Body() body: { claimIds: string[]; comments?: string }, @Request() req) {
    const results: any[] = [];
    for (const claimId of body.claimIds) {
      try {
        const claim = await this.prisma.claim.findUnique({
          where: { id: claimId },
          select: { assignedTo: true },
        });
        let result: any;
        if (claim?.assignedTo === req.user.userId) {
          result = await this.makerCheckerService.makerApprove(claimId, req.user.userId, body.comments);
        } else {
          result = await this.makerCheckerService.checkerApprove(claimId, req.user.userId, body.comments);
        }
        results.push({ claimId, success: true, claim: result });
      } catch (e: any) {
        results.push({ claimId, success: false, error: e.message });
      }
    }
    return { results, succeeded: results.filter(r => r.success).length, failed: results.filter(r => !r.success).length };
  }

  /** Bulk approve for claims officer queue. */
  @Post('bulk/approve-claims-officer')
  @Roles('admin', 'claims_officer')
  async bulkClaimsOfficerApprove(@Body() body: { claimIds: string[]; comments?: string }, @Request() req) {
    const results: any[] = [];
    for (const claimId of body.claimIds) {
      try {
        const result = await this.makerCheckerService.claimsOfficerApprove(claimId, req.user.userId, body.comments);
        results.push({ claimId, success: true, claim: result });
      } catch (e: any) {
        results.push({ claimId, success: false, error: e.message });
      }
    }
    return { results, succeeded: results.filter(r => r.success).length, failed: results.filter(r => !r.success).length };
  }

  @Post('bulk/reject')
  @Roles('admin', 'claims_officer', 'maker_checker')
  async bulkReject(@Body() body: { claimIds: string[]; reason: string; stage: 'maker_checker' | 'claims_officer' }, @Request() req) {
    const results: any[] = [];
    for (const claimId of body.claimIds) {
      try {
        let result: any;
        if (body.stage === 'claims_officer') {
          result = await this.makerCheckerService.claimsOfficerReject(claimId, req.user.userId, body.reason);
        } else {
          // Smart: try makerReject (assigned) first, fall back to checkerReject
          const claim = await this.prisma.claim.findUnique({
            where: { id: claimId },
            select: { assignedTo: true },
          });
          if (claim?.assignedTo === req.user.userId) {
            result = await this.makerCheckerService.makerReject(claimId, req.user.userId, body.reason);
          } else {
            result = await this.makerCheckerService.checkerReject(claimId, req.user.userId, body.reason);
          }
        }
        results.push({ claimId, success: true, claim: result });
      } catch (e: any) {
        results.push({ claimId, success: false, error: e.message });
      }
    }
    return { results, succeeded: results.filter(r => r.success).length, failed: results.filter(r => !r.success).length };
  }

  @Post('bulk/assign-to-me')
  @Roles('admin', 'claims_officer', 'maker_checker')
  async bulkAssignToMe(@Body() body: { claimIds: string[] }, @Request() req) {
    const updates = await this.prisma.claim.updateMany({
      where: {
        id: { in: body.claimIds },
        workflowStage: 'maker_checker_review',
      },
      data: {
        assignedTo: req.user.userId,
        status: 'under_review',
      },
    });
    return { assigned: updates.count };
  }
}
