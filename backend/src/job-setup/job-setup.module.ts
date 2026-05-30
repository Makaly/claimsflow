import { Module } from '@nestjs/common';
import { JobSetupService } from './job-setup.service';
import { JobSetupKnowledgeService } from './job-setup-knowledge.service';
import { JobSetupController } from './job-setup.controller';
import { LookupModule } from '../lookup/lookup.module';

@Module({
  imports: [LookupModule],
  controllers: [JobSetupController],
  providers: [JobSetupService, JobSetupKnowledgeService],
  exports: [JobSetupService],
})
export class JobSetupModule {}
