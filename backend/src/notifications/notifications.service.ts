import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { SmsService } from './sms.service';

interface SendEmailDto {
  recipient: string;
  subject: string;
  message: string;
  html?: string;
}

interface SendSmsDto {
  phoneNumber: string;
  message: string;
}

@Injectable()
export class NotificationsService {
  constructor(
    private prisma: PrismaService,
    private smsService: SmsService,
    @InjectQueue('notifications') private notificationsQueue: Queue,
  ) {}

  async sendEmail(emailDto: SendEmailDto) {
    const notification = await this.prisma.notification.create({
      data: {
        type: 'email',
        channel: 'email',
        recipientEmail: emailDto.recipient,
        subject: emailDto.subject,
        message: emailDto.message,
        htmlContent: emailDto.html ?? null,
      },
    });

    this.notificationsQueue.add('send-email', {
      notificationId: notification.id,
      recipient: emailDto.recipient,
      subject: emailDto.subject,
      message: emailDto.message,
      html: emailDto.html,
    }, { attempts: 3, backoff: { type: 'exponential', delay: 2_000 } }).catch(() => {});

    return notification;
  }

  async sendClaimStatusNotification(
    claimId: string,
    recipientEmail: string,
    status: string,
  ) {
    const subject = `Claim Status Update: ${status.toUpperCase()}`;
    const message = `Your claim ${claimId} has been ${status}.`;

    return this.sendEmail({
      recipient: recipientEmail,
      subject,
      message,
    });
  }

  /**
   * Send SMS notification
   */
  async sendSms(smsDto: SendSmsDto) {
    const notification = await this.prisma.notification.create({
      data: {
        type: 'sms',
        channel: 'sms',
        recipientPhone: smsDto.phoneNumber,
        message: smsDto.message,
      },
    });

    this.notificationsQueue.add('send-sms', {
      notificationId: notification.id,
      ...smsDto,
    }, { attempts: 3, backoff: { type: 'exponential', delay: 2_000 } }).catch(() => {});

    return notification;
  }

  /**
   * Send both email and SMS notification
   */
  async sendMultiChannelNotification(
    email: string,
    phoneNumber: string,
    subject: string,
    message: string,
  ) {
    const results = await Promise.allSettled([
      this.sendEmail({ recipient: email, subject, message }),
      this.sendSms({ phoneNumber, message: `${subject}: ${message}` }),
    ]);

    return {
      email: results[0].status === 'fulfilled' ? results[0].value : null,
      sms: results[1].status === 'fulfilled' ? results[1].value : null,
    };
  }

  /**
   * Send claim approval SMS
   */
  async sendClaimApprovalSms(
    claimNumber: string,
    phoneNumber: string,
  ) {
    const message = `CIC Claims: Your claim ${claimNumber} has been APPROVED and will be processed for payment.`;
    return this.sendSms({ phoneNumber, message });
  }

  /**
   * Send claim rejection SMS
   */
  async sendClaimRejectionSms(
    claimNumber: string,
    phoneNumber: string,
    reason?: string,
  ) {
    let message = `CIC Claims: Your claim ${claimNumber} has been REJECTED.`;
    if (reason) {
      message += ` Reason: ${reason}`;
    }
    message += ' Contact support for details.';
    return this.sendSms({ phoneNumber, message });
  }

  /**
   * Send claim assignment SMS to reviewer
   */
  async sendClaimAssignmentSms(
    claimNumber: string,
    phoneNumber: string,
    reviewerName: string,
  ) {
    const message = `CIC Claims: New claim ${claimNumber} assigned to ${reviewerName} for review.`;
    return this.sendSms({ phoneNumber, message });
  }

  /**
   * Send provider approval SMS
   */
  async sendProviderApprovalSms(
    providerName: string,
    phoneNumber: string,
  ) {
    const message = `CIC Claims: Your provider registration for ${providerName} has been APPROVED. You can now submit claims.`;
    return this.sendSms({ phoneNumber, message });
  }

  /**
   * Send 2FA code via SMS
   */
  async send2FACode(phoneNumber: string, code: string) {
    const message = `CIC Claims: Your verification code is ${code}. Valid for 5 minutes. Do not share this code.`;
    return this.sendSms({ phoneNumber, message });
  }

  async findAll(limit: number = 50, offset: number = 0) {
    const [notifications, total] = await Promise.all([
      this.prisma.notification.findMany({
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.notification.count(),
    ]);
    return { notifications, total };
  }

  async findOne(id: string) {
    return this.prisma.notification.findUnique({
      where: { id },
    });
  }

  async getStatistics() {
    const total = await this.prisma.notification.count();
    const sent = await this.prisma.notification.count({
      where: { status: 'sent' },
    });
    const pending = await this.prisma.notification.count({
      where: { status: 'pending' },
    });
    const failed = await this.prisma.notification.count({
      where: { status: 'failed' },
    });

    return { total, sent, pending, failed };
  }
}
