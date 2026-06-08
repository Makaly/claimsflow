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
import { DiagnosisBillingService } from './diagnosis-billing.service';
import { RetrainService } from './retrain.service';
import { ProviderFraudThresholdsService } from './provider-fraud-thresholds.service';
import { ProviderFraudThresholdsController } from './provider-fraud-thresholds.controller';
import { SignalLiftController } from './signal-lift.controller';
import { ClaimTypeConfigService } from './claim-type-config.service';
import { OcrModule } from '../ocr/ocr.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { DocumentsModule } from '../documents/documents.module';
import { AssignmentModule } from '../assignment/assignment.module';
import { DocumentClassifierModule } from '../document-classifier/document-classifier.module';
import { AssistantModule } from '../assistant/assistant.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'claims' }),
    OcrModule,
    NotificationsModule,
    DocumentsModule,
    AssignmentModule,
    DocumentClassifierModule,
    AssistantModule,
  ],
  controllers: [ClaimsController, ClaimLabelsController, ProviderFraudThresholdsController, SignalLiftController],
  providers: [
    ClaimsService, ClaimsProcessor, EligibilityService, AnomalyScoringService,
    ClaimLabelsService, MlScoringService, LineItemFraudService, DiagnosisBillingService,
    RetrainService, ProviderFraudThresholdsService, ClaimTypeConfigService,
  ],
  exports: [ClaimsService, ClaimLabelsService, MlScoringService, LineItemFraudService, DiagnosisBillingService, RetrainService],
})
export class ClaimsModule {}
