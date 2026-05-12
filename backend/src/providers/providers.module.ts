import { Module } from '@nestjs/common';
import { ProvidersService } from './providers.service';
import { ProvidersController } from './providers.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { DocumentsModule } from '../documents/documents.module';

@Module({
  imports: [NotificationsModule, DocumentsModule],
  controllers: [ProvidersController],
  providers: [ProvidersService],
  exports: [ProvidersService],
})
export class ProvidersModule {}
