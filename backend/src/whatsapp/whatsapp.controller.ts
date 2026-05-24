import {
  Controller, Get, Post, Query, Body, Res, HttpCode, HttpStatus, Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { WhatsAppSessionService } from './whatsapp-session.service';

interface MetaWebhookBody {
  object?: string;
  entry?: Array<{
    changes?: Array<{
      value?: {
        messages?: Array<{
          from?: string;
          type?: string;
          text?: { body?: string };
          image?: { id?: string; mime_type?: string };
        }>;
      };
    }>;
  }>;
}

@Controller('whatsapp')
export class WhatsAppController {
  private readonly logger = new Logger(WhatsAppController.name);

  constructor(
    private readonly config: ConfigService,
    private readonly sessions: WhatsAppSessionService,
  ) {}

  /** Meta webhook verification handshake (GET). */
  @Get('webhook')
  verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ) {
    const expected = this.config.get<string>('WHATSAPP_VERIFY_TOKEN');
    if (mode === 'subscribe' && token === expected) {
      res.status(HttpStatus.OK).send(challenge);
    } else {
      res.status(HttpStatus.FORBIDDEN).send('Forbidden');
    }
  }

  /** Inbound messages from Meta (POST). */
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async inbound(@Body() body: MetaWebhookBody) {
    if (body.object !== 'whatsapp_business_account') return;
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        for (const msg of change.value?.messages ?? []) {
          const phone = msg.from;
          if (!phone) continue;
          const text = msg.text?.body ?? '';
          const imageUrl = msg.image?.id
            ? `https://graph.facebook.com/v18.0/${msg.image.id}` // TODO(prod): resolve to actual URL via Media API
            : undefined;
          try {
            await this.sessions.handle(phone, text, imageUrl);
          } catch (err) {
            this.logger.error(`session handle error phone=${phone}`, err);
          }
        }
      }
    }
  }
}
