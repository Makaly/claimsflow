import { Module } from '@nestjs/common';
import { SystemConfigController } from './system-config.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [SystemConfigController],
})
export class SystemConfigModule {}
