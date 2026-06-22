import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { LicensingModule } from '../licensing/licensing.module';
import { InstallationRegistryService } from './installation-registry.service';
import { LicenseServerController } from './license-server.controller';

/**
 * Central LICENSE-SERVER module (E8). Runs on the CIC-hosted node that holds
 * LICENSE_PRIVATE_KEY. Mints activation keys, activates installations, issues
 * signed leases on heartbeat, and exposes the admin fleet view. Imported app-
 * wide; harmless on customer installs (its admin endpoints just won't be used).
 */
@Module({
  imports: [PrismaModule, ConfigModule, LicensingModule],
  controllers: [LicenseServerController],
  providers: [InstallationRegistryService],
  exports: [InstallationRegistryService],
})
export class LicenseServerModule {}
