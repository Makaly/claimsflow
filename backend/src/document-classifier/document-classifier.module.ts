import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { DocumentClassifierController } from './document-classifier.controller';
import { DocumentClassifierService } from './document-classifier.service';
import { UnknownDocumentController } from './unknown-document.controller';
import { UnknownDocumentService } from './unknown-document.service';
import { GeminiClassifierService } from './gemini-classifier.service';

@Module({
  imports: [
    MulterModule.register({}),
  ],
  controllers: [DocumentClassifierController, UnknownDocumentController],
  providers: [DocumentClassifierService, UnknownDocumentService, GeminiClassifierService],
  exports: [DocumentClassifierService, UnknownDocumentService, GeminiClassifierService],
})
export class DocumentClassifierModule {}
