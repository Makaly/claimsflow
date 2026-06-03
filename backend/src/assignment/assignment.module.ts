import { Module } from '@nestjs/common';
import { AssignmentResolverService } from './assignment-resolver.service';
import { AssignmentRulesController } from './assignment-rules.controller';

/**
 * Self-contained assignment module. Depends only on the global PrismaService,
 * so it can be imported by both ClaimsModule and WorkflowModule without
 * creating a module cycle. Exports the shared resolver used across all stages.
 */
@Module({
  controllers: [AssignmentRulesController],
  providers: [AssignmentResolverService],
  exports: [AssignmentResolverService],
})
export class AssignmentModule {}
