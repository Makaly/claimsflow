import { Module } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { DocumentsController } from './documents.controller';
import { OcrModule } from '../ocr/ocr.module';
import { SearchablePdfService } from '../ocr/searchable-pdf.service';
import { ImagePreprocessorService } from '../ocr/image-preprocessor.service';

@Module({
  imports: [OcrModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, SearchablePdfService, ImagePreprocessorService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
