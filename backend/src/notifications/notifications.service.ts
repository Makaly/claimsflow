import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { SmsService } from './sms.service';
import { EventsGateway } from './events.gateway';

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

/** Category understood by the mobile inbox tabs. */
export type NotifyCategory = 'claim' | 'appeal' | 'payment' | 'system';

interface NotifyInput {
  recipientId: string;
  category: NotifyCategory;
  title: string;
  body: string;
  claimId?: string;
  providerId?: string;
  /** Mobile route hint, e.g. "claims/<id>". */
  deepLink?: string;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private prisma: PrismaService,
    private smsService: SmsService,
    private readonly events: EventsGateway,
    @InjectQueue('notifications') private notificationsQueue: Queue,
  ) {}

  /**
   * Create an in-app notification for one user and push it live over the
   * WebSocket so the inbox + bell badge update immediately. Never throws — a
   * notification failure must not break the workflow action that triggered it.
   * Email/SMS continue to be sent separately by the workflow services.
   */
  async notify(input: NotifyInput): Promise<void> {
    try {
      const row = await this.prisma.notification.create({
        data: {
          type: input.category,
          channel: 'in_app',
          recipientId: input.recipientId,
          subject: input.title,
          message: input.body,
          claimId: input.claimId ?? null,
          providerId: input.providerId ?? null,
          status: 'unread',
          templateData: input.deepLink ? { deepLink: input.deepLink } : undefined,
        },
      });
      // Live fan-out (best-effort). The mobile decodes a `notification` event.
      this.events.emitToUser(input.recipientId, 'notification', {
        id: row.id,
        category: input.category,
        title: input.title,
        body: input.body,
        createdAt: row.createdAt.toISOString(),
        read: false,
        deepLink: input.deepLink ?? null,
      });
    } catch (e) {
      this.logger.warn(`notify() failed for user ${input.recipientId}: ${(e as Error)?.message}`);
    }
  }

  /** Fan a notification out to every active user holding a given role. */
  async notifyRole(role: string, input: Omit<NotifyInput, 'recipientId'>): Promise<void> {
    const users = await this.prisma.user.findMany({
      where: { role, isActive: true },
      select: { id: true },
    }).catch(() => [] as { id: string }[]);
    await Promise.all(users.map((u) => this.notify({ ...input, recipientId: u.id })));
  }

  /** Fan a notification out to every active user belonging to a provider. */
  async notifyProvider(providerId: string | null | undefined, input: Omit<NotifyInput, 'recipientId'>): Promise<void> {
    if (!providerId) return;
    const users = await this.prisma.user.findMany({
      where: { providerId, isActive: true, role: { in: ['provider_admin', 'provider_user'] } },
      select: { id: true },
    }).catch(() => [] as { id: string }[]);
    await Promise.all(users.map((u) => this.notify({ ...input, recipientId: u.id, providerId })));
  }

  /** Inbox list for the signed-in user, newest first, with unread count. */
  async listForUser(userId: string, cursor?: string, limit = 25) {
    const take = Math.min(Math.max(limit, 1), 100);
    const where = { recipientId: userId };
    const rows = await this.prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    const unreadCount = await this.prisma.notification.count({
      where: { recipientId: userId, status: { not: 'read' } },
    });
    return {
      items: page.map((n) => ({
        id: n.id,
        category: n.type,
        title: n.subject ?? '',
        body: n.message,
        createdAt: n.createdAt.toISOString(),
        read: n.status === 'read',
        deepLink: (n.templateData as any)?.deepLink ?? null,
      })),
      nextCursor: hasMore ? page[page.length - 1].id : null,
      unreadCount,
    };
  }

  async markRead(userId: string, id: string) {
    await this.prisma.notification.updateMany({
      where: { id, recipientId: userId },
      data: { status: 'read', readAt: new Date() },
    });
    return { ok: true };
  }

  async markAllRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { recipientId: userId, status: { not: 'read' } },
      data: { status: 'read', readAt: new Date() },
    });
    return { ok: true };
  }

  // ── Preferences (quiet hours persist; per-channel toggles are a follow-up
  //    once NotificationPreference gains email/sms/push columns) ─────────────
  private minToHHMM(min?: number | null): string | null {
    if (min === null || min === undefined) return null;
    const h = Math.floor(min / 60) % 24;
    return `${String(h).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
  }
  private hhmmToMin(s?: string | null): number | null {
    if (!s) return null;
    const [h, m] = s.split(':').map((x) => parseInt(x, 10));
    if (Number.isNaN(h) || Number.isNaN(m)) return null;
    return (h % 24) * 60 + (m % 60);
  }

  async getPreferences(userId: string) {
    const pref = await this.prisma.notificationPreference.findUnique({ where: { userId } });
    return {
      email: true,
      sms: false,
      inApp: true,
      push: true,
      quietHoursStart: this.minToHHMM(pref?.quietStart),
      quietHoursEnd: this.minToHHMM(pref?.quietEnd),
    };
  }

  async updatePreferences(
    userId: string,
    body: { quietHoursStart?: string | null; quietHoursEnd?: string | null },
  ) {
    const quietStart = this.hhmmToMin(body.quietHoursStart);
    const quietEnd = this.hhmmToMin(body.quietHoursEnd);
    await this.prisma.notificationPreference.upsert({
      where: { userId },
      create: { userId, quietStart, quietEnd },
      update: { quietStart, quietEnd },
    });
    return this.getPreferences(userId);
  }

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
