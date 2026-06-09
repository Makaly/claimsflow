import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { LlmAdapter, LlmGenerateOptions } from './llm.types';

/**
 * Anthropic (Claude) text + multimodal adapter.
 *
 * Mirrors GeminiLlmAdapter's surface so the LlmRouterService can swap providers
 * transparently. Like Gemini, it THROWS on API errors (quota / billing / auth)
 * with `isQuota` + `status` tagged so the billing-audit UI can show the
 * "AI over quota — pick another model" panel instead of a misleading empty
 * result.
 */
@Injectable()
export class ClaudeLlmAdapter implements LlmAdapter {
  private readonly logger = new Logger(ClaudeLlmAdapter.name);
  private client: Anthropic | null = null;

  private getClient(): Anthropic | null {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) return null;
    if (!this.client) this.client = new Anthropic({ apiKey: key });
    return this.client;
  }

  isAvailable(): boolean {
    return !!process.env.ANTHROPIC_API_KEY;
  }

  private defaultModel(): string {
    return process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
  }

  async generate(systemPrompt: string, userMessage: string, options?: LlmGenerateOptions): Promise<string> {
    return this.call(systemPrompt, [{ type: 'text', text: userMessage }], options);
  }

  async generateFromImage(
    systemPrompt: string,
    userMessage: string,
    fileBase64: string,
    mimeType: string,
    options?: LlmGenerateOptions,
  ): Promise<string> {
    const isPdf = mimeType === 'application/pdf';
    const doc: Anthropic.ContentBlockParam = isPdf
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: fileBase64 } }
      : { type: 'image', source: { type: 'base64', media_type: (mimeType as any) || 'image/png', data: fileBase64 } };
    return this.call(systemPrompt, [doc, { type: 'text', text: userMessage }], options);
  }

  private async call(
    systemPrompt: string,
    content: Anthropic.ContentBlockParam[],
    options?: LlmGenerateOptions,
  ): Promise<string> {
    const client = this.getClient();
    if (!client) {
      this.logger.warn('ANTHROPIC_API_KEY not set — returning stub answer');
      return 'Stub answer: configure ANTHROPIC_API_KEY to enable live responses.';
    }
    // Claude has no responseMimeType; steer it to raw JSON via the system prompt.
    // The downstream parser already strips ``` fences and slices the {…}/[…],
    // so this only needs to discourage prose, not guarantee a bare value.
    const system = options?.json
      ? `${systemPrompt}\n\nReturn ONLY valid JSON. Do not wrap it in markdown code fences or add any commentary.`
      : systemPrompt;

    try {
      const res = await client.messages.create({
        model: options?.model || this.defaultModel(),
        max_tokens: options?.maxOutputTokens ?? 4096,
        ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
        system,
        messages: [{ role: 'user', content }],
      });
      return res.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map(b => b.text)
        .join('')
        .trim();
    } catch (e: any) {
      const code = e?.status ?? e?.statusCode ?? 0;
      const message = e?.message ?? 'unknown error';
      const isQuota = code === 429 || /quota|rate.?limit|overloaded|credit|billing/i.test(String(message));
      this.logger.error(`Claude API error ${code}: ${String(message).slice(0, 200)}`);
      const err: any = new Error(isQuota
        ? `Claude quota exceeded (${code}): ${message}`
        : `Claude API error ${code}: ${message}`);
      err.isQuota = isQuota;
      err.status = code;
      throw err;
    }
  }
}
