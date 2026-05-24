import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppSessionService } from './whatsapp-session.service';
import { MockWhatsAppAdapter } from './mock-whatsapp.adapter';
import { MetaWhatsAppAdapter } from './meta-whatsapp.adapter';
import { WhatsAppAdapter } from './whatsapp-adapter.interface';

// Use META adapter when WHATSAPP_ACCESS_TOKEN is set in the environment.
function adapterFactory(config: ConfigService): WhatsAppAdapter {
  if (config.get<string>('WHATSAPP_ACCESS_TOKEN')) {
    return new MetaWhatsAppAdapter(config);
  }
  return new MockWhatsAppAdapter();
}

@Module({
  imports: [ConfigModule],
  controllers: [WhatsAppController],
  providers: [
    {
      provide: 'WHATSAPP_ADAPTER',
      useFactory: adapterFactory,
      inject: [ConfigService],
    },
    {
      provide: WhatsAppSessionService,
      useFactory: (adapter: WhatsAppAdapter) => new WhatsAppSessionService(adapter),
      inject: ['WHATSAPP_ADAPTER'],
    },
  ],
  exports: [WhatsAppSessionService],
})
export class WhatsAppModule {}
