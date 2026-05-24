import { Module } from '@nestjs/common';
import { AssistantService } from './assistant.service';
import { AssistantController } from './assistant.controller';
import { GeminiLlmAdapter } from './gemini-llm.adapter';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AssistantController],
  providers: [AssistantService, GeminiLlmAdapter],
  exports: [AssistantService, GeminiLlmAdapter],
})
export class AssistantModule {}
