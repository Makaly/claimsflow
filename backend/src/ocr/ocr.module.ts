import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { OcrService } from './ocr.service';
import { OcrProcessor } from './ocr.processor';
import { OcrController } from './ocr.controller';
import { OllamaOcrService } from './ollama-ocr.service';
import { ClaudeVisionService } from './claude-vision.service';
import { GeminiVisionService } from './gemini-vision.service';
import { VisionRouterService } from './vision-router.service';
import { DocumentClassifierModule } from '../document-classifier/document-classifier.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ImagePreprocessService } from './image-preprocess.service';
import { AnomalyScoringService } from '../claims/anomaly-scoring.service';
import { ProviderFraudThresholdsService } from '../claims/provider-fraud-thresholds.service';
import { LineItemFraudService } from '../claims/line-item-fraud.service';
import { DiagnosisBillingService } from '../claims/diagnosis-billing.service';
import { ClaimTypeConfigService } from '../claims/claim-type-config.service';
import { InvoiceFanoutService } from './invoice-fanout.service';
import { AssistantModule } from '../assistant/assistant.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'ocr' }),
    DocumentClassifierModule,
    PrismaModule,
    AssistantModule,
  ],
  controllers: [OcrController],
  providers: [
    OcrService,
    OcrProcessor,
    OllamaOcrService,
    ClaudeVisionService,
    GeminiVisionService,
    VisionRouterService,
    ImagePreprocessService,
    AnomalyScoringService,
    ProviderFraudThresholdsService,
    LineItemFraudService,
    DiagnosisBillingService,
    ClaimTypeConfigService,
    InvoiceFanoutService,
  ],
  exports: [OcrService, OllamaOcrService, VisionRouterService, ImagePreprocessService],
})
export class OcrModule {}
