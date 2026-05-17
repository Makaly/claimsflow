import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { EmailService } from './email.service';
import { SmsService } from './sms.service';
import { PrismaService } from '../prisma/prisma.service';
import { redactEmail, redactPhone } from '../common/services/pii-redaction';

@Processor({ name: 'notifications' }, { concurrency: 5 })
export class NotificationsProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsProcessor.name);

  constructor(
    private emailService: EmailService,
    private smsService: SmsService,
    private prisma: PrismaService,
  ) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    switch (job.name) {
      case 'send-email':
        return this.handleSendEmail(job);
      case 'send-sms':
        return this.handleSendSms(job);
      default:
        this.logger.warn(`Unknown job name: ${job.name}`);
    }
  }

  private async handleSendEmail(job: Job) {
    const { notificationId, recipient, subject, message, html } = job.data;
    const safeRecipient = redactEmail(recipient);
    this.logger.log(`Sending email to: ${safeRecipient}`);

    try {
      await this.emailService.sendEmail(recipient, subject, message, html || undefined);
      await this.prisma.notification.update({
        where: { id: notificationId },
        data: { status: 'sent', sentAt: new Date() },
      });
      this.logger.log(`Email sent to: ${safeRecipient}`);
      return { notificationId, status: 'sent' };
    } catch (error) {
      this.logger.error(`Failed to send email to ${safeRecipient}:`, error);
      await this.prisma.notification.update({
        where: { id: notificationId },
        data: { status: 'failed', error: error.message },
      });
      throw error;
    }
  }

  private async handleSendSms(job: Job) {
    const { notificationId, phoneNumber, message } = job.data;
    const safePhone = redactPhone(phoneNumber);
    this.logger.log(`Sending SMS to: ${safePhone}`);

    try {
      const result = await this.smsService.sendSms({ phoneNumber, message });
      if (!result.success) throw new Error(result.error || 'Failed to send SMS');

      await this.prisma.notification.update({
        where: { id: notificationId },
        data: {
          status: 'sent',
          sentAt: new Date(),
          templateData: { messageId: result.messageId, provider: result.provider },
        },
      });
      this.logger.log(`SMS sent to ${safePhone} via ${result.provider}`);
      return { notificationId, status: 'sent', result };
    } catch (error) {
      this.logger.error(`Failed to send SMS to ${safePhone}:`, error);
      await this.prisma.notification.update({
        where: { id: notificationId },
        data: { status: 'failed', error: error.message },
      });
      throw error;
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    this.logger.error(`Job ${job.id} (${job.name}) failed after ${job.attemptsMade} attempts: ${error.message}`);
  }
}
