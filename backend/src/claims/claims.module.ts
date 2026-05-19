import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ClaimsService } from './claims.service';
import { ClaimsController } from './claims.controller';
import { ClaimsProcessor } from './claims.processor';
import { EligibilityService } from './eligibility.service';
import { AnomalyScoringService } from './anomaly-scoring.service';
import { ClaimLabelsService } from './claim-labels.service';
import { ClaimLabelsController } from './claim-labels.controller';
import { MlScoringService } from './ml-scoring.service';
import { LineItemFraudService } from './line-item-fraud.service';
import { RetrainService } from './retrain.service';
import { ProviderFraudThresholdsService } from './provider-fraud-thresholds.service';
import { ProviderFraudThresholdsController } from './provider-fraud-thresholds.controller';
import { SignalLiftController } from './signal-lift.controller';
import { ClaimTypeConfigService } from './claim-type-config.service';
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
  controllers: [ClaimsController, ClaimLabelsController, ProviderFraudThresholdsController, SignalLiftController],
  providers: [
    ClaimsService, ClaimsProcessor, EligibilityService, AnomalyScoringService,
    ClaimLabelsService, MlScoringService, LineItemFraudService,
    RetrainService, ProviderFraudThresholdsService, ClaimTypeConfigService,
  ],
  exports: [ClaimsService, ClaimLabelsService, MlScoringService, LineItemFraudService, RetrainService],
})
export class ClaimsModule {}
