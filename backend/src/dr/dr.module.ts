import { Module } from '@nestjs/common';
import { DrService } from './dr.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [DrService],
  exports: [DrService],
})
export class DrModule {}
