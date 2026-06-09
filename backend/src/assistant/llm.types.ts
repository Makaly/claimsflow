/**
 * Shared contract for the pluggable LLM adapters (Gemini / Claude / Ollama).
 *
 * Every adapter exposes the same two calls so the LlmRouterService can pick a
 * provider at runtime from a `provider:model` id without the callers (e.g. the
 * diagnosis-billing audit) caring which vendor answers.
 */
export interface LlmGenerateOptions {
  /** 0 = deterministic. Use for extraction / structured tasks. */
  temperature?: number;
  /** Ask the model for pure JSON (no markdown / prose) where supported. */
  json?: boolean;
  /** Cap the response length. */
  maxOutputTokens?: number;
  /** Concrete model name for the provider, e.g. `claude-opus-4-7`. */
  model?: string;
}

export interface LlmAdapter {
  /** True when the provider has the credentials / runtime it needs. */
  isAvailable(): boolean | Promise<boolean>;
  /** Plain text → text. */
  generate(systemPrompt: string, userMessage: string, options?: LlmGenerateOptions): Promise<string>;
  /** Multimodal: a base64 document/image + text → text. */
  generateFromImage(
    systemPrompt: string,
    userMessage: string,
    fileBase64: string,
    mimeType: string,
    options?: LlmGenerateOptions,
  ): Promise<string>;
}
