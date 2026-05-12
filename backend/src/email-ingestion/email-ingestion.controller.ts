import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { EmailIngestionService } from './email-ingestion.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('email-ingestion')
@UseGuards(JwtAuthGuard)
export class EmailIngestionController {
  constructor(private readonly emailIngestionService: EmailIngestionService) {}

  @Get('status')
  getStatus() {
    return this.emailIngestionService.getStatus();
  }

  @Post('trigger-poll')
  triggerManualPoll() {
    return this.emailIngestionService.triggerManualPoll();
  }

  @Get('oauth/authorize')
  getAuthorizationUrl(@Query('redirect_uri') redirectUri: string) {
    return this.emailIngestionService.getOAuthAuthorizationUrl(
      redirectUri || `${process.env.BACKEND_URL || 'http://localhost:4000'}/api/email-ingestion/oauth/callback`,
    );
  }

  @Post('oauth/exchange')
  exchangeCode(
    @Body() body: { code: string; redirect_uri: string },
  ) {
    return this.emailIngestionService.exchangeCodeForTokens(body.code, body.redirect_uri);
  }
}
