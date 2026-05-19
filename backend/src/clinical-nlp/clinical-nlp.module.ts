import { Module } from '@nestjs/common';
import { ClinicalNlpService } from './clinical-nlp.service';
import { ClinicalNlpController } from './clinical-nlp.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AssistantModule } from '../assistant/assistant.module';

@Module({
  imports: [PrismaModule, AssistantModule],
  controllers: [ClinicalNlpController],
  providers: [ClinicalNlpService],
  exports: [ClinicalNlpService],
})
export class ClinicalNlpModule {}
