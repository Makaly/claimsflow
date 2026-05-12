import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { BatchSubmissionService } from './batch-submission.service';
import { BarcodeService } from '../common/services/barcode.service';

// concurrency: 1 — batches process files sequentially; parallel batches would race on the same PDFs
@Processor({ name: 'batch-processing' }, { concurrency: 1 })
export class BatchSubmissionProcessor extends WorkerHost {
  private readonly logger = new Logger(BatchSubmissionProcessor.name);

  constructor(
    private batchSubmissionService: BatchSubmissionService,
    private barcodeService: BarcodeService,
  ) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    switch (job.name) {
      case 'process-batch':
        return this.handleBatchProcessing(job);
      default:
        this.logger.warn(`Unknown job name: ${job.name}`);
    }
  }

  private async handleBatchProcessing(job: Job) {
    const { batchId, files } = job.data;
    this.logger.log(`Processing batch: ${batchId} with ${files.length} files`);

    let processedCount = 0;
    let failedCount = 0;

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const folioNumber = this.barcodeService.generateFolioNumber(i + 1);

        try {
          await this.batchSubmissionService.processClaimFile(batchId, file, folioNumber);
          processedCount++;
          await job.updateProgress(Math.round((processedCount / files.length) * 100));
        } catch (error) {
          this.logger.error(`Failed to process file ${file.originalName}:`, error);
          failedCount++;
        }
      }

      await this.batchSubmissionService.updateBatchStatus(
        batchId,
        'completed',
        processedCount,
        failedCount,
      );

      this.logger.log(`Batch ${batchId} done: ${processedCount} processed, ${failedCount} failed`);
      return { batchId, processedCount, failedCount, status: 'completed' };
    } catch (error) {
      this.logger.error(`Batch ${batchId} failed:`, error);
      await this.batchSubmissionService.updateBatchStatus(batchId, 'failed', processedCount, failedCount);
      throw error;
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    this.logger.error(`Batch job ${job.id} failed: ${error.message}`);
  }
}
