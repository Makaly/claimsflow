import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WhatsAppAdapter, SendMessageOptions } from './whatsapp-adapter.interface';

// TODO(prod): replace stub with real Meta Cloud API calls
// POST https://graph.facebook.com/v18.0/{WHATSAPP_PHONE_NUMBER_ID}/messages
// Authorization: Bearer {WHATSAPP_ACCESS_TOKEN}
// Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/messages

@Injectable()
export class MetaWhatsAppAdapter implements WhatsAppAdapter {
  private readonly logger = new Logger(MetaWhatsAppAdapter.name);
  private readonly phoneNumberId: string;
  private readonly accessToken: string;

  constructor(private readonly config: ConfigService) {
    this.phoneNumberId = config.getOrThrow('WHATSAPP_PHONE_NUMBER_ID');
    this.accessToken = config.getOrThrow('WHATSAPP_ACCESS_TOKEN');
  }

  async sendText(opts: SendMessageOptions): Promise<void> {
    // TODO(prod): implement real HTTP call
    this.logger.warn(`MetaWhatsAppAdapter.sendText stub — to=${opts.to}`);
    void this.phoneNumberId;
    void this.accessToken;
  }

  async sendImage(opts: SendMessageOptions & { imageUrl: string }): Promise<void> {
    // TODO(prod): implement real HTTP call
    this.logger.warn(`MetaWhatsAppAdapter.sendImage stub — to=${opts.to}`);
  }
}
