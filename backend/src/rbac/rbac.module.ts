import { Global, Module } from '@nestjs/common';
import { RbacService } from './rbac.service';
import { RbacController } from './rbac.controller';
import { PermissionsGuard } from './guards/permissions.guard';

@Global()
@Module({
  providers: [RbacService, PermissionsGuard],
  controllers: [RbacController],
  exports: [RbacService, PermissionsGuard],
})
export class RbacModule {}
