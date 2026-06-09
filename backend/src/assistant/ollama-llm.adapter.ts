import { Injectable, Logger } from '@nestjs/common';
import { LlmAdapter, LlmGenerateOptions } from './llm.types';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';

/**
 * Local Ollama text + multimodal adapter (private, no network egress).
 *
 * Routes to the Ollama `/api/chat` endpoint. Vision models (llama3.2-vision,
 * moondream, llava) accept inline `images` on the user message, so the same
 * endpoint serves both the text and the image path. There is no quota — a
 * failure here means Ollama is not running or the model is not pulled, which is
 * surfaced as a plain error so the UI can suggest a cloud model instead.
 */
@Injectable()
export class OllamaLlmAdapter implements LlmAdapter {
  private readonly logger = new Logger(OllamaLlmAdapter.name);

  private defaultModel(): string {
    return process.env.OLLAMA_LLM_MODEL || 'llama3.2';
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2_000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async generate(systemPrompt: string, userMessage: string, options?: LlmGenerateOptions): Promise<string> {
    return this.chat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      options,
    );
  }

  async generateFromImage(
    systemPrompt: string,
    userMessage: string,
    fileBase64: string,
    _mimeType: string,
    options?: LlmGenerateOptions,
  ): Promise<string> {
    // Ollama vision models read raw image bytes; PDFs are not supported, so the
    // caller is expected to fall back to a cloud model for PDF documents.
    return this.chat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage, images: [fileBase64] },
      ],
      options,
    );
  }

  private async chat(
    messages: Array<{ role: string; content: string; images?: string[] }>,
    options?: LlmGenerateOptions,
  ): Promise<string> {
    const model = options?.model || this.defaultModel();
    try {
      const res = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages,
          stream: false,
          keep_alive: '15m',
          ...(options?.json ? { format: 'json' } : {}),
          options: {
            ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
            ...(options?.maxOutputTokens !== undefined ? { num_predict: options.maxOutputTokens } : {}),
          },
        }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Ollama ${res.status}: ${body.slice(0, 200)}`);
      }
      const json = (await res.json()) as any;
      return String(json?.message?.content ?? '').trim();
    } catch (e: any) {
      const message = e?.message ?? 'unknown error';
      this.logger.error(`Ollama (${model}) error: ${String(message).slice(0, 200)}`);
      const err: any = new Error(`Ollama model "${model}" unavailable: ${message}`);
      err.status = 503;
      throw err;
    }
  }
}
