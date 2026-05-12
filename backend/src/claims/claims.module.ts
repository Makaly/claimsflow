import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ClaimsService } from './claims.service';
import { ClaimsController } from './claims.controller';
import { ClaimsProcessor } from './claims.processor';
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
  controllers: [ClaimsController],
  providers: [ClaimsService, ClaimsProcessor],
  exports: [ClaimsService],
})
export class ClaimsModule {}
