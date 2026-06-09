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
    this.llmModel = config.get('ASSISTANT_LLM_MODEL', 'gemini-flash-latest');
    this.apiKey = config.get<string>('GEMINI_API_KEY');
  }

  isAvailable(): boolean {
    return !!this.apiKey;
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

  /**
   * @param options.temperature  0 = deterministic (use for extraction/structured
   *                              tasks so the same invoice yields the same items).
   * @param options.json         true forces responseMimeType application/json so
   *                              Gemini returns pure JSON (no markdown/prose) —
   *                              dramatically more reliable to parse.
   * @param options.maxOutputTokens  cap the response length.
   */
  async generate(
    systemPrompt: string,
    userMessage: string,
    options?: { temperature?: number; json?: boolean; maxOutputTokens?: number; model?: string },
  ): Promise<string> {
    if (!this.apiKey) {
      this.logger.warn('GEMINI_API_KEY not set — returning stub answer');
      return 'Stub answer: configure GEMINI_API_KEY to enable live responses.';
    }
    return this.callGenerate(
      [{ text: `${systemPrompt}\n\n${userMessage}` }],
      options,
    );
  }

  private buildGenerationConfig(options?: { temperature?: number; json?: boolean; maxOutputTokens?: number }) {
    const generationConfig: Record<string, any> = {};
    if (options?.temperature !== undefined) generationConfig.temperature = options.temperature;
    if (options?.maxOutputTokens !== undefined) generationConfig.maxOutputTokens = options.maxOutputTokens;
    if (options?.json) generationConfig.responseMimeType = 'application/json';
    return generationConfig;
  }

  /**
   * Shared request path. THROWS on API errors (quota/billing/auth/safety) so
   * callers can distinguish "the AI failed" from "the AI found nothing" — the
   * previous behaviour silently returned "No answer generated.", which made a
   * quota outage look like an empty/low-quality document.
   */
  private async callGenerate(
    parts: any[],
    options?: { temperature?: number; json?: boolean; maxOutputTokens?: number; model?: string },
  ): Promise<string> {
    const generationConfig = this.buildGenerationConfig(options);
    const model = options?.model || this.llmModel;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        ...(Object.keys(generationConfig).length ? { generationConfig } : {}),
      }),
    });

    const json = (await res.json().catch(() => ({}))) as any;

    if (!res.ok || json?.error) {
      const code = json?.error?.code ?? res.status;
      const status = json?.error?.status ?? '';
      const message = json?.error?.message ?? res.statusText ?? 'unknown error';
      const isQuota = code === 429 || /quota|rate.?limit|RESOURCE_EXHAUSTED/i.test(`${status} ${message}`);
      this.logger.error(`Gemini API error ${code} ${status}: ${String(message).slice(0, 200)}`);
      const err: any = new Error(isQuota
        ? `Gemini quota exceeded (${code}): ${message}`
        : `Gemini API error ${code}: ${message}`);
      err.isQuota = isQuota;
      err.status = code;
      throw err;
    }

    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (text == null) {
      const block = json?.promptFeedback?.blockReason ?? json?.candidates?.[0]?.finishReason;
      if (block) this.logger.warn(`Gemini returned no text (reason: ${block})`);
      return '';
    }
    return text;
  }

  /**
   * Multimodal generate — sends a document/image inline so the model reads the
   * actual page instead of (possibly garbled) OCR text. Used as a billing-audit
   * fallback when text extraction can't find the invoice's line items.
   * @param fileBase64  base64-encoded file bytes (no data: prefix).
   * @param mimeType    e.g. image/png, image/jpeg, application/pdf.
   */
  async generateFromImage(
    systemPrompt: string,
    userMessage: string,
    fileBase64: string,
    mimeType: string,
    options?: { temperature?: number; json?: boolean; maxOutputTokens?: number; model?: string },
  ): Promise<string> {
    if (!this.apiKey) {
      this.logger.warn('GEMINI_API_KEY not set — returning stub answer');
      return 'Stub answer: configure GEMINI_API_KEY to enable live responses.';
    }
    return this.callGenerate(
      [
        { text: `${systemPrompt}\n\n${userMessage}` },
        { inline_data: { mime_type: mimeType, data: fileBase64 } },
      ],
      options,
    );
  }
}
