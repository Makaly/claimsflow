import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { TwoFactorService } from './two-factor.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Controller('auth/2fa')
@UseGuards(JwtAuthGuard)
export class TwoFactorController {
  constructor(private readonly twoFactorService: TwoFactorService) {}

  /**
   * Get 2FA status for current user
   */
  @Get('status')
  async getStatus(@Request() req) {
    return this.twoFactorService.get2FAStatus(req.user.userId);
  }

  /**
   * Generate 2FA secret and QR code
   */
  @Post('generate')
  async generateSecret(@Request() req) {
    return this.twoFactorService.generateSecret(req.user.userId);
  }

  /**
   * Enable 2FA after verifying token
   */
  @Post('enable')
  async enable2FA(
    @Request() req,
    @Body() body: { token: string },
  ) {
    return this.twoFactorService.enable2FA(req.user.userId, body.token);
  }

  /**
   * Disable 2FA
   */
  @Post('disable')
  async disable2FA(
    @Request() req,
    @Body() body: { password: string },
  ) {
    return this.twoFactorService.disable2FA(req.user.userId, body.password);
  }

  /**
   * Send SMS code for 2FA
   */
  @Post('sms/send')
  async sendSmsCode(@Request() req) {
    return this.twoFactorService.sendSmsCode(req.user.userId);
  }

  /**
   * Verify SMS code
   */
  @Post('sms/verify')
  async verifySmsCode(
    @Request() req,
    @Body() body: { code: string },
  ) {
    const isValid = await this.twoFactorService.verifySmsCode(
      req.user.userId,
      body.code,
    );

    return {
      valid: isValid,
      message: isValid ? 'Code verified successfully' : 'Invalid or expired code',
    };
  }

  /**
   * Get remaining backup codes
   */
  @Get('backup-codes')
  async getBackupCodes(@Request() req) {
    return this.twoFactorService.getRemainingBackupCodes(req.user.userId);
  }

  /**
   * Regenerate backup codes
   */
  @Post('backup-codes/regenerate')
  async regenerateBackupCodes(@Request() req) {
    return this.twoFactorService.regenerateBackupCodes(req.user.userId);
  }

  /**
   * Verify 2FA token (for testing)
   */
  @Post('verify')
  async verifyToken(
    @Request() req,
    @Body() body: { token: string },
  ) {
    const isValid = await this.twoFactorService.verify2FAToken(
      req.user.userId,
      body.token,
    );

    return {
      valid: isValid,
      message: isValid ? 'Token verified successfully' : 'Invalid token',
    };
  }
}
