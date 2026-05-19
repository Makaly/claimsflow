import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { NpsService } from './nps.service';
import { NpsController } from './nps.controller';
import { NpsProcessor } from './nps.processor';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    BullModule.registerQueue({ name: 'nps' }),
  ],
  controllers: [NpsController],
  providers: [NpsService, NpsProcessor],
  exports: [NpsService],
})
export class NpsModule {}
