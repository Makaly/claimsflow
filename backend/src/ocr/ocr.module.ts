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
import { LineItemFraudService } from '../claims/line-item-fraud.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'ocr' }),
    DocumentClassifierModule,
    PrismaModule,
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
    LineItemFraudService,
  ],
  exports: [OcrService, OllamaOcrService, VisionRouterService, ImagePreprocessService],
})
export class OcrModule {}
