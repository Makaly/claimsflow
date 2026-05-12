import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { getRedisConnection } from './config/redis.config';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CommonModule } from './common/common.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { ClaimsModule } from './claims/claims.module';
import { ProvidersModule } from './providers/providers.module';
import { DocumentsModule } from './documents/documents.module';
import { OcrModule } from './ocr/ocr.module';
import { NotificationsModule } from './notifications/notifications.module';
import { BatchSubmissionModule } from './batch-submission/batch-submission.module';
import { WorkflowModule } from './workflow/workflow.module';
import { ActivityLoggingInterceptor } from './common/interceptors/activity-logging.interceptor';
import { ScheduleModule } from '@nestjs/schedule';
import { EmailIngestionModule } from './email-ingestion/email-ingestion.module';
import { ActivityLogsModule } from './activity-logs/activity-logs.module';
import { BranchesModule } from './branches/branches.module';
import { ReportsModule } from './reports/reports.module';
import { RbacModule } from './rbac/rbac.module';
import { DocumentClassifierModule } from './document-classifier/document-classifier.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ScheduleModule.forRoot(),
    BullModule.forRoot({
      connection: getRedisConnection(),
      defaultJobOptions: {
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 200 },
      },
    }),
    CommonModule,
    PrismaModule,
    AuthModule,
    ProvidersModule,
    ClaimsModule,
    DocumentsModule,
    OcrModule,
    NotificationsModule,
    BatchSubmissionModule,
    WorkflowModule,
    EmailIngestionModule,
    ActivityLogsModule,
    BranchesModule,
    ReportsModule,
    RbacModule,
    DocumentClassifierModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_INTERCEPTOR,
      useClass: ActivityLoggingInterceptor,
    },
  ],
})
export class AppModule {}
