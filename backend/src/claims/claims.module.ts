import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ClaimsService } from './claims.service';
import { ClaimsController } from './claims.controller';
import { ClaimsProcessor } from './claims.processor';
import { EligibilityService } from './eligibility.service';
import { AnomalyScoringService } from './anomaly-scoring.service';
import { ClaimLabelsService } from './claim-labels.service';
import { ClaimLabelsController } from './claim-labels.controller';
import { OcrModule } from '../ocr/ocr.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { DocumentsModule } from '../documents/documents.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'claims' }),
    OcrModule,
    NotificationsModule,
    DocumentsModule,
  ],
  controllers: [ClaimsController, ClaimLabelsController],
  providers: [ClaimsService, ClaimsProcessor, EligibilityService, AnomalyScoringService, ClaimLabelsService],
  exports: [ClaimsService, ClaimLabelsService],
})
export class ClaimsModule {}
