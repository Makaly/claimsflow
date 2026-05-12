import { Global, Module } from '@nestjs/common';
import { BarcodeService } from './services/barcode.service';
import { PdfWatermarkService } from './services/pdf-watermark.service';
import { TiffConverterService } from './services/tiff-converter.service';
import { PdfOperationsService } from './services/pdf-operations.service';
import { EdmsIntegrationService } from './services/edms-integration.service';
import { EoxegenIntegrationService } from './services/eoxegen-integration.service';
import { AuditService } from './services/audit.service';

@Global()
@Module({
  providers: [
    BarcodeService,
    PdfWatermarkService,
    TiffConverterService,
    PdfOperationsService,
    EdmsIntegrationService,
    EoxegenIntegrationService,
    AuditService,
  ],
  exports: [
    BarcodeService,
    PdfWatermarkService,
    TiffConverterService,
    PdfOperationsService,
    EdmsIntegrationService,
    EoxegenIntegrationService,
    AuditService,
  ],
})
export class CommonModule {}
