import { Module } from '@nestjs/common';
import { AssistantService } from './assistant.service';
import { AssistantController } from './assistant.controller';
import { GeminiLlmAdapter } from './gemini-llm.adapter';
import { ClaudeLlmAdapter } from './claude-llm.adapter';
import { OllamaLlmAdapter } from './ollama-llm.adapter';
import { LlmRouterService } from './llm-router.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AssistantController],
  providers: [
    AssistantService,
    GeminiLlmAdapter,
    ClaudeLlmAdapter,
    OllamaLlmAdapter,
    LlmRouterService,
  ],
  exports: [AssistantService, GeminiLlmAdapter, LlmRouterService],
})
export class AssistantModule {}
