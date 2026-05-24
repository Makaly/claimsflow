import { Module } from '@nestjs/common';
import { TelemedicineService } from './telemedicine.service';
import { TelemedicineController } from './telemedicine.controller';
import { MockTelemedicineAdapter } from './adapters/mock.adapter';
import { DoctolibAdapter } from './adapters/doctolib.adapter';
import { TeladocAdapter } from './adapters/teladoc.adapter';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [TelemedicineController],
  providers: [
    TelemedicineService,
    MockTelemedicineAdapter,
    DoctolibAdapter,
    TeladocAdapter,
  ],
  exports: [TelemedicineService],
})
export class TelemedicineModule {}
