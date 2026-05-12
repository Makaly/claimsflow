import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Processor({ name: 'claims' }, { concurrency: 3 })
export class ClaimsProcessor extends WorkerHost {
  private readonly logger = new Logger(ClaimsProcessor.name);

  constructor(private prisma: PrismaService) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    switch (job.name) {
      case 'process-claim':
        return this.handleClaimProcessing(job);
      default:
        this.logger.warn(`Unknown job name: ${job.name}`);
    }
  }

  private async handleClaimProcessing(job: Job) {
    const { claimId } = job.data;
    this.logger.log(`Processing claim: ${claimId}`);

    await this.prisma.claim.update({
      where: { id: claimId },
      data: { status: 'processing' },
    });

    await new Promise((resolve) => setTimeout(resolve, 2000));

    await this.prisma.claim.update({
      where: { id: claimId },
      data: { status: 'approved' },
    });

    this.logger.log(`Claim ${claimId} processed`);
    return { claimId, status: 'approved' };
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    this.logger.error(`Claim job ${job.id} failed after ${job.attemptsMade} attempts: ${error.message}`);
  }
}
