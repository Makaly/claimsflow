import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { BatchSubmissionService } from './batch-submission.service';
import { BatchSubmissionController } from './batch-submission.controller';
import { BatchSubmissionProcessor } from './batch-submission.processor';
import { BarcodeService } from '../common/services/barcode.service';
import { PdfWatermarkService } from '../common/services/pdf-watermark.service';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'batch-processing',
    }),
  ],
  controllers: [BatchSubmissionController],
  providers: [
    BatchSubmissionService,
    BatchSubmissionProcessor,
    BarcodeService,
    PdfWatermarkService,
  ],
  exports: [BatchSubmissionService],
})
export class BatchSubmissionModule {}
