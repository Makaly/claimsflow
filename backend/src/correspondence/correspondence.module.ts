import { Module } from '@nestjs/common';
import { CorrespondenceService } from './correspondence.service';
import { CorrespondenceController } from './correspondence.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [CorrespondenceController],
  providers: [CorrespondenceService],
  exports: [CorrespondenceService],
})
export class CorrespondenceModule {}
