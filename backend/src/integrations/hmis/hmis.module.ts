import { Module } from '@nestjs/common';
import { FhirService } from './fhir.service';
import { HmisController } from './hmis.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [HmisController],
  providers: [FhirService],
  exports: [FhirService],
})
export class HmisModule {}
