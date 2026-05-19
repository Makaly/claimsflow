import { Module } from '@nestjs/common';
import { ScannerController } from './scanner.controller';
import { ScannerService } from './scanner.service';
import { ScanMeteringModule } from '../scan-metering/scan-metering.module';

@Module({
  imports: [ScanMeteringModule],
  controllers: [ScannerController],
  providers: [ScannerService],
})
export class ScannerModule {}
