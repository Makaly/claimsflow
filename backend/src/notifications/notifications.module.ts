import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsProcessor } from './notifications.processor';
import { EmailService } from './email.service';
import { SmsService } from './sms.service';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'notifications',
    }),
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationsProcessor,
    EmailService,
    SmsService,
  ],
  exports: [NotificationsService, EmailService],
})
export class NotificationsModule {}
