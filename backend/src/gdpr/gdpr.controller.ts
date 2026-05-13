import { Body, Controller, Delete, Get, Post, Request, Response, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GdprService } from './gdpr.service';

/**
 * Exposes the data subject endpoints required by GDPR Art. 15-22 and the
 * Kenya Data Protection Act ss. 26-38. All routes require the standard JWT
 * cookie session — only the data subject themselves can act on their data.
 */
@Controller('gdpr')
@UseGuards(JwtAuthGuard)
export class GdprController {
  constructor(private gdpr: GdprService) {}

  @Get('consents')
  async listConsents(@Request() req) {
    const [history, current] = await Promise.all([
      this.gdpr.listConsents(req.user.userId),
      this.gdpr.currentConsents(req.user.userId),
    ]);
    return { current, history };
  }

  @Post('consents/withdraw')
  async withdrawConsent(@Request() req, @Body() body: { purpose: string }) {
    return this.gdpr.withdrawConsent(req.user.userId, body.purpose, {
      ipAddress: req.ip,
      userAgent: req.headers?.['user-agent'],
    });
  }

  @Post('consents/grant')
  async grantConsent(@Request() req, @Body() body: { purpose: string; version?: string }) {
    return this.gdpr.recordConsent({
      userId: req.user.userId,
      purpose: body.purpose,
      action: 'granted',
      version: body.version,
      source: 'consent_page',
      ipAddress: req.ip,
      userAgent: req.headers?.['user-agent'],
    });
  }

  @Get('export')
  async exportMyData(@Request() req, @Response({ passthrough: true }) res: any) {
    const payload = await this.gdpr.exportPersonalData(req.user.userId, {
      ipAddress: req.ip,
      userAgent: req.headers?.['user-agent'],
    });
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="claimsflow-export-${req.user.userId}.json"`);
    return payload;
  }

  @Delete('account')
  async eraseAccount(@Request() req, @Body() body: { confirmation: string }, @Response({ passthrough: true }) res: any) {
    const result = await this.gdpr.eraseAccount(req.user.userId, body?.confirmation);
    // Cookie attributes must match the ones set by /auth/login or the browser
    // ignores the clear.
    const isProduction = process.env.NODE_ENV === 'production';
    res.clearCookie('access_token', {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      path: '/',
    });
    return result;
  }

  @Post('decision-review')
  async requestDecisionReview(
    @Request() req,
    @Body() body: { claimId?: string; decisionType: string; reason: string },
  ) {
    return this.gdpr.requestDecisionReview({
      userId: req.user.userId,
      claimId: body.claimId,
      decisionType: body.decisionType,
      reason: body.reason,
    });
  }

  @Get('decision-review')
  async listMyDecisionReviews(@Request() req) {
    return this.gdpr.listDecisionReviews(req.user.userId);
  }
}
