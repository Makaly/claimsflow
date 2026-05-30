import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
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

  @Get()
  findAll(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.notificationsService.findAll(
      limit ? parseInt(limit, 10) : undefined,
      offset ? parseInt(offset, 10) : undefined,
    );
  }

  @Get('statistics')
  getStatistics() {
    return this.notificationsService.getStatistics();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.notificationsService.findOne(id);
  }

  /**
   * Mobile push-token registration endpoint. The mobile shared module calls
   * this from `App.kt`'s LaunchedEffect after the user authenticates — see
   * `NotificationsRepository.registerDevice` in the mobile tree. Idempotent
   * by `(userId, platform, token)`; the service layer should upsert and
   * delete superseded tokens for the same device.
   */
  @Post('devices')
  registerDevice(
    @Body() body: { token: string; platform: 'android' | 'ios' },
  ) {
    // Stub — wire into NotificationsService.registerDevice once the
    // ProviderDevice / MemberDevice schema is in Prisma. Tracked as part of
    // INTEGRATION_PLATFORM_PUSH.md (mobile side).
    return {
      success: true,
      token: body.token,
      platform: body.platform,
      note: 'stub — service-side persistence pending',
    };
  }
}
