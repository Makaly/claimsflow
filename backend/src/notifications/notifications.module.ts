import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsProcessor } from './notifications.processor';
import { EmailService } from './email.service';
import { SmsService } from './sms.service';
import { EventsGateway } from './events.gateway';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'notifications' }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get('JWT_SECRET'),
        signOptions: { expiresIn: config.get('JWT_EXPIRES_IN') || '1d' },
      }),
    }),
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsProcessor, EmailService, SmsService, EventsGateway],
  exports: [NotificationsService, EmailService, EventsGateway],
})
export class NotificationsModule {}
