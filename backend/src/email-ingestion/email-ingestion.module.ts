import { Module } from '@nestjs/common';
import { EmailIngestionService } from './email-ingestion.service';
import { EmailIngestionController } from './email-ingestion.controller';

@Module({
  controllers: [EmailIngestionController],
  providers: [EmailIngestionService],
  exports: [EmailIngestionService],
})
export class EmailIngestionModule {}
