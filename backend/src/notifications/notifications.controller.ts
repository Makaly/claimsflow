import { Controller, Get, Post, Patch, Put, Body, Param, Query, Request, UseGuards } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { EmailService, BatchConfirmationDto } from './email.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly emailService: EmailService,
  ) {}

  @Post('batch-confirmation')
  async sendBatchConfirmation(@Body() dto: BatchConfirmationDto) {
    await this.emailService.sendBatchConfirmation(dto);
    return { success: true };
  }

  @Post('send-email')
  sendEmail(
    @Body() emailDto: { recipient: string; subject: string; message: string },
  ) {
    return this.notificationsService.sendEmail(emailDto);
  }

  /** The signed-in user's own inbox: { items, nextCursor, unreadCount }. */
  @Get()
  findAll(
    @Request() req: any,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.notificationsService.listForUser(
      req.user.userId,
      cursor,
      limit ? parseInt(limit, 10) : undefined,
    );
  }

  @Patch(':id/read')
  markRead(@Request() req: any, @Param('id') id: string) {
    return this.notificationsService.markRead(req.user.userId, id);
  }

  @Post('read-all')
  markAllRead(@Request() req: any) {
    return this.notificationsService.markAllRead(req.user.userId);
  }

  @Get('preferences')
  getPreferences(@Request() req: any) {
    return this.notificationsService.getPreferences(req.user.userId);
  }

  @Put('preferences')
  updatePreferences(
    @Request() req: any,
    @Body() body: { quietHoursStart?: string | null; quietHoursEnd?: string | null },
  ) {
    return this.notificationsService.updatePreferences(req.user.userId, body);
  }

  @Get('statistics')
  getStatistics() {
    return this.notificationsService.getStatistics();
  }

  /**
   * Mobile push-token registration endpoint. The mobile shared module calls
   * this from `App.kt`'s LaunchedEffect after the user authenticates — see
   * `NotificationsRepository.registerDevice` in the mobile tree. Idempotent
   * by token (upserts on the unique token column).
   */
  @Post('devices')
  async registerDevice(
    @Request() req: any,
    @Body() body: { token: string; platform: 'android' | 'ios' },
  ) {
    const userId = req.user.userId;
    await this.notificationsService.registerDeviceToken(userId, body.token, body.platform);
    return { success: true };
  }
}
