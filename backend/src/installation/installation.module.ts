import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from '../prisma/prisma.module';
import { LicensingModule } from '../licensing/licensing.module';
import { InstallationService } from './installation.service';
import { InstallationHeartbeatService } from './installation-heartbeat.service';
import { InstallationGuard } from './installation.guard';
import { InstallationController } from './installation.controller';

/**
 * Installation CLIENT module (E8). Provides the local identity/lease service,
 * the phone-home heartbeat cron, and registers the lockout guard GLOBALLY
 * (APP_GUARD). The global registration shares the same instance the controller
 * injects (useExisting) so activation/heartbeat can clear its cache and lift the
 * lock immediately. No-op on standalone nodes (LICENSE_SERVER_URL unset).
 */
@Module({
  imports: [PrismaModule, ConfigModule, LicensingModule],
  controllers: [InstallationController],
  providers: [
    InstallationService,
    InstallationHeartbeatService,
    InstallationGuard,
    { provide: APP_GUARD, useExisting: InstallationGuard },
  ],
  exports: [InstallationService],
})
export class InstallationModule {}
