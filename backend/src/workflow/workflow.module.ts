import { Module } from '@nestjs/common';
import { WorkflowService } from './workflow.service';
import { MakerCheckerService } from './maker-checker.service';
import { CompletenessValidationService } from './completeness-validation.service';
import { AssignmentService } from './assignment.service';
import { SlaService } from './sla.service';
import { WorkflowController } from './workflow.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [NotificationsModule, PrismaModule],
  controllers: [WorkflowController],
  providers: [
    WorkflowService,
    MakerCheckerService,
    CompletenessValidationService,
    AssignmentService,
    SlaService,
  ],
  exports: [WorkflowService, MakerCheckerService, SlaService],
})
export class WorkflowModule {}
