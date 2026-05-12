import { Module } from '@nestjs/common';
import { WorkflowService } from './workflow.service';
import { MakerCheckerService } from './maker-checker.service';
import { CompletenessValidationService } from './completeness-validation.service';
import { AssignmentService } from './assignment.service';
import { WorkflowController } from './workflow.controller';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [WorkflowController],
  providers: [
    WorkflowService,
    MakerCheckerService,
    CompletenessValidationService,
    AssignmentService,
  ],
  exports: [WorkflowService, MakerCheckerService],
})
export class WorkflowModule {}
