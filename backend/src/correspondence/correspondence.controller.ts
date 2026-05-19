import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { CorrespondenceService } from './correspondence.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('correspondence')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CorrespondenceController {
  constructor(private svc: CorrespondenceService) {}

  @Get('templates')
  @Roles('admin', 'claims_officer', 'maker_checker', 'fraud_officer', 'finance')
  listTemplates() { return this.svc.listTemplates(); }

  @Post('templates')
  @Roles('admin')
  upsertTemplate(@Body() body: {
    code: string; name: string; subject: string; bodyTemplate: string;
    channel: string; locale: string;
  }) {
    return this.svc.upsertTemplate(body);
  }

  @Post('generate')
  @Roles('admin', 'claims_officer', 'maker_checker', 'finance')
  generate(@Body() body: {
    templateCode: string;
    variables: Record<string, string>;
    claimId?: string;
    recipientEmail?: string;
    send?: boolean;
  }) {
    return this.svc.generateLetter(body.templateCode, body.variables, {
      claimId: body.claimId,
      recipientEmail: body.recipientEmail,
      send: body.send,
    });
  }
}
