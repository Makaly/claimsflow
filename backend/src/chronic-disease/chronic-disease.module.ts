import { Module } from '@nestjs/common';
import { ChronicDiseaseService } from './chronic-disease.service';
import { ChronicDiseaseController } from './chronic-disease.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ChronicDiseaseController],
  providers: [ChronicDiseaseService],
  exports: [ChronicDiseaseService],
})
export class ChronicDiseaseModule {}
