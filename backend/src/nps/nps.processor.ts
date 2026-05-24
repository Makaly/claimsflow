import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

// BullMQ delayed job: enqueued 24h after a claim reaches a terminal state.
// Sends an NPS prompt via the member's preferred channel.
// TODO(prod): implement actual notification dispatch (SMS/WhatsApp/email)
@Processor('nps')
export class NpsProcessor extends WorkerHost {
  private readonly logger = new Logger(NpsProcessor.name);

  async process(job: Job): Promise<void> {
    const { claimId, memberId, channel } = job.data as {
      claimId: string;
      memberId: string;
      channel: string;
    };
    this.logger.log(`NPS prompt — claimId=${claimId} memberId=${memberId} channel=${channel}`);
    // TODO(prod): send NPS prompt via NotificationsService
  }
}
