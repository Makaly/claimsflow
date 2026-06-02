import { Module } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { DocumentsController } from './documents.controller';
import { OcrModule } from '../ocr/ocr.module';
import { SearchablePdfService } from '../ocr/searchable-pdf.service';
import { ImagePreprocessorService } from '../ocr/image-preprocessor.service';
import { BarcodeService } from '../common/services/barcode.service';
import { PdfWatermarkService } from '../common/services/pdf-watermark.service';

@Module({
  imports: [OcrModule],
  controllers: [DocumentsController],
  providers: [
    DocumentsService,
    SearchablePdfService,
    ImagePreprocessorService,
    BarcodeService,
    PdfWatermarkService,
  ],
  exports: [DocumentsService],
})
export class DocumentsModule {}
