import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { LicenseCryptoService } from './license-crypto.service';
import { LicenseService } from './license.service';
import { MeteringService } from './metering.service';
import { EntitlementGuard } from './entitlement.guard';
import { LicenseGuard } from './license.guard';
import { UsageMeterInterceptor } from './usage-meter.interceptor';
import { LicensePdfService } from './license-pdf.service';
import { LicenseEmailService } from './license-email.service';
import { LicenseReminderService } from './license-reminder.service';
import { LicensePauseService } from './license-pause.service';
import { LicenseBillingService } from './license-billing.service';
import { LicenseController } from './license.controller';

/**
 * Licensing module (E7 rebuild) — the rich, helpdesk-parity licence model for
 * ClaimsFlow. Bundles cryptographic token verification (LicenseCryptoService),
 * lifecycle/admin (LicenseService), usage metering (MeteringService), the
 * declarative enforcement guards/interceptor, the branded PDF certificate +
 * lifecycle emails + daily expiry-reminder cron, and the admin API.
 */
@Module({
  imports: [PrismaModule, ConfigModule, NotificationsModule],
  controllers: [LicenseController],
  providers: [
    LicenseCryptoService,
    LicenseService,
    MeteringService,
    EntitlementGuard,
    LicenseGuard,
    UsageMeterInterceptor,
    LicensePdfService,
    LicenseEmailService,
    LicenseReminderService,
    LicensePauseService,
    LicenseBillingService,
  ],
  exports: [
    LicenseCryptoService,
    LicenseService,
    MeteringService,
    EntitlementGuard,
    LicenseGuard,
    UsageMeterInterceptor,
    LicensePdfService,
    LicenseEmailService,
  ],
})
export class LicensingModule {}
