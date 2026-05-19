import { Module } from '@nestjs/common';
import { PbmService } from './pbm.service';
import { PbmController } from './pbm.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [PbmController],
  providers: [PbmService],
  exports: [PbmService],
})
export class PbmModule {}
