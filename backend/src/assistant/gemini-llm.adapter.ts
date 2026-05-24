import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface EmbeddingResult {
  embedding: number[];
}

export interface LlmAnswer {
  answer: string;
}

/**
 * Thin adapter around Google Gemini APIs.
 * TODO: swap stub HTTP calls for the official @google/generative-ai SDK once
 * credentials are provisioned. Set GEMINI_API_KEY in .env.
 */
@Injectable()
export class GeminiLlmAdapter {
  private readonly logger = new Logger(GeminiLlmAdapter.name);
  private readonly embeddingModel: string;
  private readonly llmModel: string;
  private readonly apiKey: string | undefined;

  constructor(private config: ConfigService) {
    this.embeddingModel = config.get('ASSISTANT_EMBEDDING_MODEL', 'text-embedding-004');
    this.llmModel = config.get('ASSISTANT_LLM_MODEL', 'gemini-1.5-flash');
    this.apiKey = config.get<string>('GEMINI_API_KEY');
  }

  async embed(text: string): Promise<number[]> {
    if (!this.apiKey) {
      // Stub: return deterministic zero vector so unit tests work offline.
      this.logger.warn('GEMINI_API_KEY not set — returning stub embedding');
      return new Array(1536).fill(0);
    }
    // TODO: call https://generativelanguage.googleapis.com/v1beta/models/{model}:embedContent
    // Real implementation: POST with { content: { parts: [{ text }] } }
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.embeddingModel}:embedContent?key=${this.apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: { parts: [{ text }] } }),
    });
    const json = (await res.json()) as any;
    return json?.embedding?.values ?? new Array(1536).fill(0);
  }

  async generate(systemPrompt: string, userMessage: string): Promise<string> {
    if (!this.apiKey) {
      this.logger.warn('GEMINI_API_KEY not set — returning stub answer');
      return 'Stub answer: configure GEMINI_API_KEY to enable live responses.';
    }
    // TODO: call Gemini generateContent
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.llmModel}:generateContent?key=${this.apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          { role: 'user', parts: [{ text: `${systemPrompt}\n\n${userMessage}` }] },
        ],
      }),
    });
    const json = (await res.json()) as any;
    return json?.candidates?.[0]?.content?.parts?.[0]?.text ?? 'No answer generated.';
  }
}
