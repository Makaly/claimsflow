import { Module } from '@nestjs/common';
import { LookupService } from './lookup.service';
import { LookupController } from './lookup.controller';

@Module({
  controllers: [LookupController],
  providers: [LookupService],
  exports: [LookupService],
})
export class LookupModule {}
