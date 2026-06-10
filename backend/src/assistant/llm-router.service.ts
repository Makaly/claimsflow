import { Injectable, Logger } from '@nestjs/common';
import { GeminiLlmAdapter } from './gemini-llm.adapter';
import { ClaudeLlmAdapter } from './claude-llm.adapter';
import { OllamaLlmAdapter } from './ollama-llm.adapter';
import { LlmAdapter, LlmGenerateOptions } from './llm.types';

type Provider = 'gemini' | 'claude' | 'ollama';

/**
 * Routes an LLM call to the right provider based on a model id, mirroring the
 * OCR VisionRouterService so the diagnosis-billing audit can offer the SAME
 * model menu as batch upload (Claude / Gemini / local Ollama).
 *
 * The model id matches the ids served by GET /ocr/models — either the
 * namespaced `provider:model` form (`claude:claude-opus-4-7`,
 * `gemini:gemini-2.5-pro`, `ollama:moondream`) or a bare model name, whose
 * provider is inferred from its prefix. A missing id falls back to Gemini's
 * configured default, preserving the previous Gemini-only behaviour.
 */
@Injectable()
export class LlmRouterService {
  private readonly logger = new Logger(LlmRouterService.name);

  constructor(
    private readonly gemini: GeminiLlmAdapter,
    private readonly claude: ClaudeLlmAdapter,
    private readonly ollama: OllamaLlmAdapter,
  ) {}

  /** Split a model id into a provider + bare model name. Exposed for tests. */
  parse(modelId?: string): { provider: Provider; model?: string } {
    if (!modelId) return { provider: 'gemini' };
    if (modelId.includes(':')) {
      const [p, m] = modelId.split(':', 2);
      if (p === 'claude' || p === 'gemini' || p === 'ollama') return { provider: p, model: m };
      // tesseract / unknown prefix → Gemini default (Tesseract can't reason).
      return { provider: 'gemini' };
    }
    const lower = modelId.toLowerCase();
    if (lower === 'tesseract') return { provider: 'gemini' };   // OCR only — can't reason
    if (lower.startsWith('claude')) return { provider: 'claude', model: modelId };
    if (lower.startsWith('llama') || lower.startsWith('moondream') || lower.startsWith('llava'))
      return { provider: 'ollama', model: modelId };
    // gemini-*, flash-latest, gemini-flash-latest, bare → Gemini.
    return { provider: 'gemini', model: modelId };
  }

  private adapter(provider: Provider): LlmAdapter {
    switch (provider) {
      case 'claude': return this.claude;
      case 'ollama': return this.ollama;
      default: return this.gemini;
    }
  }

  async generate(systemPrompt: string, userMessage: string, options?: LlmGenerateOptions): Promise<string> {
    const { provider, model } = this.parse(options?.model);
    this.logger.log(`LLM generate via ${provider}${model ? ` (${model})` : ''}`);
    return this.adapter(provider).generate(systemPrompt, userMessage, { ...options, model });
  }

  async generateFromImage(
    systemPrompt: string,
    userMessage: string,
    fileBase64: string,
    mimeType: string,
    options?: LlmGenerateOptions,
  ): Promise<string> {
    const { provider, model } = this.parse(options?.model);
    this.logger.log(`LLM vision via ${provider}${model ? ` (${model})` : ''}`);
    return this.adapter(provider).generateFromImage(systemPrompt, userMessage, fileBase64, mimeType, { ...options, model });
  }

  // ── Resilient fallback ─────────────────────────────────────────────────────
  // Cloud reasoning models in preference order. Ollama is intentionally excluded:
  // local vision models cannot read PDFs and are too slow for clinical reasoning,
  // so they make a poor automatic fallback for the billing audit.
  private static readonly CLOUD_FALLBACK = [
    'gemini:gemini-2.5-flash-lite',
    'claude:claude-haiku-4-5',
    'gemini:gemini-2.5-flash',
    'claude:claude-sonnet-4-6',
    'gemini:gemini-flash-latest',
  ];

  /** Ordered, de-duplicated list of available cloud model ids — the caller's
   *  preferred model first (unless it is an Ollama model). */
  private async cloudChain(preferred?: string): Promise<string[]> {
    const ids: string[] = [];
    if (preferred) {
      const { provider } = this.parse(preferred);
      if (provider !== 'ollama') ids.push(preferred);
    }
    for (const id of LlmRouterService.CLOUD_FALLBACK) if (!ids.includes(id)) ids.push(id);

    const available: string[] = [];
    for (const id of ids) {
      const { provider } = this.parse(id);
      try {
        if (await Promise.resolve(this.adapter(provider).isAvailable())) available.push(id);
      } catch { /* treat as unavailable */ }
    }
    // If nothing reports available (e.g. isAvailable only checks reachability),
    // still attempt the chain — a configured key may work despite the probe.
    return available.length ? available : ids;
  }

  /** Try each candidate provider in turn; return the first non-empty answer.
   *  Throws only when every candidate failed — tagging `isQuota` when they were
   *  ALL quota/billing failures so the caller can show an accurate notice. */
  private async withFallback(
    label: string,
    options: LlmGenerateOptions | undefined,
    call: (model: string, provider: Provider) => Promise<string>,
  ): Promise<string> {
    const chain = await this.cloudChain(options?.model);
    let lastErr: any = null;
    let allQuota = true;
    for (const id of chain) {
      const { provider, model } = this.parse(id);
      try {
        const out = await call(model ?? id, provider);
        if (out && out.trim()) {
          this.logger.log(`LLM ${label} succeeded via ${provider} (${model ?? id})`);
          return out;
        }
        allQuota = false; // empty but no error
      } catch (err: any) {
        lastErr = err;
        if (!err?.isQuota) allQuota = false;
        this.logger.warn(`LLM ${label} via ${provider} (${model ?? id}) failed: ${err?.message}`);
      }
    }
    if (lastErr) {
      if (allQuota) lastErr.isQuota = true;
      throw lastErr;
    }
    return ''; // every candidate returned empty
  }

  /** generate() with automatic provider fallback. */
  async generateWithFallback(systemPrompt: string, userMessage: string, options?: LlmGenerateOptions): Promise<string> {
    return this.withFallback('generate', options, (model, provider) =>
      this.adapter(provider).generate(systemPrompt, userMessage, { ...options, model }));
  }

  /** generateFromImage() with automatic provider fallback. */
  async generateFromImageWithFallback(
    systemPrompt: string,
    userMessage: string,
    fileBase64: string,
    mimeType: string,
    options?: LlmGenerateOptions,
  ): Promise<string> {
    return this.withFallback('vision', options, (model, provider) =>
      this.adapter(provider).generateFromImage(systemPrompt, userMessage, fileBase64, mimeType, { ...options, model }));
  }
}
