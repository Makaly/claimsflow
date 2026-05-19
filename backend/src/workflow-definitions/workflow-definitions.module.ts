import { Module } from '@nestjs/common';
import { WorkflowDefinitionsService } from './workflow-definitions.service';
import { WorkflowDefinitionsController } from './workflow-definitions.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [WorkflowDefinitionsController],
  providers: [WorkflowDefinitionsService],
  exports: [WorkflowDefinitionsService],
})
export class WorkflowDefinitionsModule {}
