import { Injectable, Logger } from '@nestjs/common';
import { WhatsAppAdapter, SendMessageOptions } from './whatsapp-adapter.interface';

@Injectable()
export class MockWhatsAppAdapter implements WhatsAppAdapter {
  private readonly logger = new Logger(MockWhatsAppAdapter.name);

  async sendText(opts: SendMessageOptions): Promise<void> {
    this.logger.log(`[MOCK] sendText to=${opts.to} body="${opts.body}"`);
  }

  async sendImage(opts: SendMessageOptions & { imageUrl: string }): Promise<void> {
    this.logger.log(`[MOCK] sendImage to=${opts.to} url=${opts.imageUrl} caption="${opts.body}"`);
  }
}
