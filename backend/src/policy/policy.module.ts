import { Module } from '@nestjs/common';
import { PolicyService } from './policy.service';
import { PolicyController } from './policy.controller';
import { AdjudicationService } from './adjudication.service';

@Module({
  controllers: [PolicyController],
  providers: [PolicyService, AdjudicationService],
  exports: [PolicyService, AdjudicationService],
})
export class PolicyModule {}
