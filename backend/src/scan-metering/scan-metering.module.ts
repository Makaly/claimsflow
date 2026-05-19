import { Module } from '@nestjs/common';
import { ScanMeteringController } from './scan-metering.controller';
import { ScanMeteringService } from './scan-metering.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [ScanMeteringController],
  providers: [ScanMeteringService],
  exports: [ScanMeteringService],
})
export class ScanMeteringModule {}
