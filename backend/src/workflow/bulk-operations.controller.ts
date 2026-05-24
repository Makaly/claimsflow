import {
  Controller, Post, Body, UseGuards, Request, BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { MakerCheckerService } from './maker-checker.service';

interface BulkResult {
  claimId: string;
  success: boolean;
  error?: string;
  makerMismatch?: boolean;
}

/**
 * Dedicated bulk-operations controller per F3 spec.
 * All endpoints are claims_officer-only.
 * Maker-checker separation: bulk-approve only acts on checker-queue items
 * and the actor must NOT be the maker (the user who submitted to the checker queue).
 */
@Controller('workflow/bulk')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'claims_officer')
export class BulkOperationsController {
  constructor(
    private prisma: PrismaService,
    private makerChecker: MakerCheckerService,
  ) {}

  @Post('approve')
  async bulkApprove(
    @Body() body: { claimIds: string[]; comments?: string },
    @Request() req: any,
  ) {
    if (!body.claimIds?.length) throw new BadRequestException('claimIds required');
    const actorId = req.user.userId;
    const results: BulkResult[] = [];

    for (const claimId of body.claimIds) {
      try {
        const claim = await this.prisma.claim.findUnique({
          where: { id: claimId },
          select: { workflowStage: true, assignedTo: true },
        });

        // Maker-checker separation: actor must not be the maker.
        if (claim?.assignedTo === actorId) {
          results.push({ claimId, success: false, makerMismatch: true,
            error: 'Actor is the maker — maker-checker separation violated' });
          continue;
        }

        await this.makerChecker.checkerApprove(claimId, actorId, body.comments);
        results.push({ claimId, success: true });
      } catch (e: any) {
        results.push({ claimId, success: false, error: e.message });
      }
    }

    const count = results.filter((r) => r.success).length;
    const mismatches = results.filter((r) => r.makerMismatch).length;

    // Persist audit log for the bulk operation.
    await this.prisma.activityLog.create({
      data: {
        userId: actorId,
        action: 'BULK_APPROVE',
        entity: 'Claim',
        status: 'success',
        metadata: { count, mismatches, claimIds: body.claimIds },
      },
    });

    return { results, succeeded: count, failed: results.filter((r) => !r.success).length, mismatches };
  }

  @Post('reassign')
  async bulkReassign(
    @Body() body: { claimIds: string[]; assigneeId: string },
    @Request() req: any,
  ) {
    if (!body.claimIds?.length) throw new BadRequestException('claimIds required');
    if (!body.assigneeId) throw new BadRequestException('assigneeId required');

    const actorId = req.user.userId;
    const updated = await this.prisma.claim.updateMany({
      where: { id: { in: body.claimIds } },
      data: { assignedTo: body.assigneeId },
    });

    await this.prisma.activityLog.create({
      data: {
        userId: actorId,
        action: 'BULK_REASSIGN',
        entity: 'Claim',
        status: 'success',
        metadata: { count: updated.count, assigneeId: body.assigneeId, claimIds: body.claimIds },
      },
    });

    return { assigned: updated.count };
  }

  @Post('export')
  async bulkExport(
    @Body() body: { claimIds: string[]; format?: 'csv' | 'json' },
    @Request() req: any,
  ) {
    if (!body.claimIds?.length) throw new BadRequestException('claimIds required');
    const actorId = req.user.userId;

    const claims = await this.prisma.claim.findMany({
      where: { id: { in: body.claimIds } },
      select: {
        id: true, claimNumber: true, status: true, workflowStage: true,
        memberName: true, invoiceAmount: true, submittedAt: true,
        provider: { select: { name: true } },
      },
    });

    await this.prisma.activityLog.create({
      data: {
        userId: actorId,
        action: 'BULK_EXPORT',
        entity: 'Claim',
        status: 'success',
        metadata: { count: claims.length, format: body.format ?? 'json', claimIds: body.claimIds },
      },
    });

    if (body.format === 'csv') {
      const header = 'claimNumber,status,workflowStage,memberName,invoiceAmount,provider,submittedAt';
      const rows = claims.map((c) =>
        [c.claimNumber, c.status, c.workflowStage, c.memberName ?? '', c.invoiceAmount ?? '',
          c.provider?.name ?? '', c.submittedAt.toISOString()].join(','),
      );
      return { csv: [header, ...rows].join('\n'), count: claims.length };
    }

    return { data: claims, count: claims.length };
  }
}
