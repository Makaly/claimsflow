import { Module } from '@nestjs/common';
import { TenantContextService } from './tenant-context.service';
import { TenantMiddleware } from './tenant.middleware';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [TenantContextService, TenantMiddleware],
  exports: [TenantContextService, TenantMiddleware],
})
export class TenantModule {}
