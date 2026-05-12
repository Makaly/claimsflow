import { Injectable, Logger } from '@nestjs/common';
import { ClaudeVisionService } from './claude-vision.service';
import { GeminiVisionService } from './gemini-vision.service';
import { OllamaOcrService } from './ollama-ocr.service';
import { ParsedInvoice } from './ocr.service';

export type VisionProvider = 'claude' | 'gemini' | 'ollama' | 'tesseract';

export interface VisionModelOption {
  id: string;              // e.g. "claude:claude-opus-4-7"
  label: string;           // user-facing label
  provider: VisionProvider;
  model?: string;          // provider-specific model id
  available: boolean;      // true if API key / local service is reachable
  tier: 'best' | 'recommended' | 'fast' | 'local' | 'fallback';
  description: string;
}

// How long to skip a provider after a quota/credit failure (ms).
const CIRCUIT_OPEN_MS = 5 * 60 * 1000; // 5 minutes

// HTTP status codes / error message patterns that indicate a quota or billing
// problem rather than a transient network error. These trip the circuit breaker.
function isQuotaOrBillingError(err: any): boolean {
  const msg: string = err?.message || err?.toString() || '';
  const status: number = err?.status ?? err?.statusCode ?? 0;
  return (
    status === 429 ||
    (status === 400 && /credit balance is too low/i.test(msg)) ||
    /quota exceeded|rate.?limit|billing/i.test(msg)
  );
}

@Injectable()
export class VisionRouterService {
  private readonly logger = new Logger(VisionRouterService.name);

  // Circuit breaker: maps provider → timestamp when it becomes available again.
  private readonly circuitOpenUntil = new Map<VisionProvider, number>();

  constructor(
    private readonly claude: ClaudeVisionService,
    private readonly gemini: GeminiVisionService,
    private readonly ollama: OllamaOcrService,
  ) {}

  /** Returns true when a provider's circuit is open (i.e. it is being skipped). */
  private isCircuitOpen(provider: VisionProvider): boolean {
    const openUntil = this.circuitOpenUntil.get(provider) ?? 0;
    return Date.now() < openUntil;
  }

  /** Trip the circuit for a provider after a quota/billing failure. */
  private tripCircuit(provider: VisionProvider): void {
    const openUntil = Date.now() + CIRCUIT_OPEN_MS;
    this.circuitOpenUntil.set(provider, openUntil);
    const resetAt = new Date(openUntil).toISOString();
    this.logger.warn(`Circuit OPEN for ${provider} until ${resetAt} (quota/billing error)`);
  }

  async listModels(): Promise<VisionModelOption[]> {
    const [ollamaUp, geminiUp] = await Promise.all([
      this.ollama.isAvailable().catch(() => false),
      this.gemini.isReachable().catch(() => false),
    ]);

    const models: VisionModelOption[] = [
      {
        id: 'claude:claude-opus-4-7',
        label: 'Claude Opus 4.7 — highest accuracy',
        provider: 'claude',
        model: 'claude-opus-4-7',
        available: this.claude.isAvailable(),
        tier: 'best',
        description: 'Anthropic’s flagship vision model. Best on complex / handwritten invoices.',
      },
      {
        id: 'claude:claude-sonnet-4-6',
        label: 'Claude Sonnet 4.6 — recommended',
        provider: 'claude',
        model: 'claude-sonnet-4-6',
        available: this.claude.isAvailable(),
        tier: 'recommended',
        description: 'Excellent accuracy, faster and cheaper than Opus. Default choice.',
      },
      {
        id: 'claude:claude-haiku-4-5',
        label: 'Claude Haiku 4.5 — fast',
        provider: 'claude',
        model: 'claude-haiku-4-5',
        available: this.claude.isAvailable(),
        tier: 'fast',
        description: 'Fastest Claude model. Good for clean, printed invoices.',
      },
      {
        id: 'gemini:gemini-2.5-pro',
        label: 'Gemini 2.5 Pro',
        provider: 'gemini',
        model: 'gemini-2.5-pro',
        available: geminiUp,
        tier: 'recommended',
        description: 'Google’s high-accuracy vision model. Strong on document OCR.',
      },
      {
        id: 'gemini:gemini-2.5-flash',
        label: 'Gemini 2.5 Flash',
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        available: geminiUp,
        tier: 'fast',
        description: 'Fast Gemini model. Generous free tier, good accuracy.',
      },
      {
        id: 'gemini:gemini-2.0-flash',
        label: 'Gemini 2.0 Flash',
        provider: 'gemini',
        model: 'gemini-2.0-flash',
        available: geminiUp,
        tier: 'fast',
        description: 'Cheapest Gemini tier. OK for clean printed invoices.',
      },
      {
        id: 'ollama:llama3.2-vision',
        label: 'Llama 3.2 Vision 11B — local',
        provider: 'ollama',
        model: 'llama3.2-vision',
        available: ollamaUp,
        tier: 'local',
        description: 'Runs locally via Ollama. Private, no network. Requires GPU for reasonable speed.',
      },
      {
        id: 'ollama:moondream',
        label: 'Moondream 1B — local (fast)',
        provider: 'ollama',
        model: 'moondream',
        available: ollamaUp,
        tier: 'local',
        description: 'Tiny local vision model. Fast on CPU but lower accuracy.',
      },
      {
        id: 'tesseract',
        label: 'Tesseract OCR — regex fallback',
        provider: 'tesseract',
        available: true,
        tier: 'fallback',
        description: 'No AI. Pure OCR with regex patterns tuned for Kenyan invoices.',
      },
    ];

    return models;
  }

  /**
   * Extract ALL claim packets from a PDF in one pass.
   * Splitting rules are model-agnostic: Claude always handles the structural
   * splitting (it has the page pre-scan intelligence). If the selected provider
   * is not Claude, Claude is used as the splitter and the result is returned
   * regardless of which model the user picked for field extraction.
   * Returns [] on failure so callers can fall back to single-claim extract.
   */
  async extractMulti(
    modelId: string,
    filePath: string,
    mimetype: string,
  ): Promise<ParsedInvoice[]> {
    const [provider, model] = modelId.includes(':') ? modelId.split(':', 2) : [modelId, undefined];
    this.logger.log(`VisionRouter.extractMulti — modelId=${modelId}, provider=${provider}, geminiAvail=${this.gemini.isAvailable()}, claudeAvail=${this.claude.isAvailable()}`);

    // Build ordered list of providers to try for multi-claim splitting.
    // Splitting is model-agnostic: we always use the best available vision
    // model (Gemini → Claude) regardless of what model was chosen for extraction.
    const tryOrder: Array<{ p: VisionProvider; fn: () => Promise<ParsedInvoice[]> }> = [];

    // Selected provider first (if it supports multi-extraction)
    if (provider === 'gemini' && this.gemini.isAvailable()) {
      tryOrder.push({ p: 'gemini', fn: () => this.gemini.extractMulti(filePath, mimetype, model) });
    }
    if (provider === 'claude' && this.claude.isAvailable()) {
      tryOrder.push({ p: 'claude', fn: () => this.claude.extractMulti(filePath, mimetype, model) });
    }

    // Always add capable providers as fallbacks, even when Tesseract is selected
    if (provider !== 'gemini' && this.gemini.isAvailable()) {
      tryOrder.push({ p: 'gemini', fn: () => this.gemini.extractMulti(filePath, mimetype) });
    }
    if (provider !== 'claude' && this.claude.isAvailable()) {
      tryOrder.push({ p: 'claude', fn: () => this.claude.extractMulti(filePath, mimetype) });
    }

    for (const { p, fn } of tryOrder) {
      if (this.isCircuitOpen(p)) {
        this.logger.warn(`Skipping ${p} — circuit open (quota/billing cooldown)`);
        continue;
      }
      try {
        const results = await fn();
        if (results && results.length > 0) return results;
      } catch (err: any) {
        if (isQuotaOrBillingError(err)) this.tripCircuit(p);
        this.logger.warn(`extractMulti attempt failed: ${err?.message || err}`);
      }
    }

    return [];
  }

  /**
   * Extract using the requested provider. If extraction fails and allowFallback
   * is true, tries the chain: claude -> gemini -> ollama -> tesseract.
   */
  async extract(
    modelId: string,
    filePath: string,
    mimetype: string,
    allowFallback = true,
  ): Promise<ParsedInvoice | null> {
    const [provider, model] = modelId.includes(':') ? modelId.split(':', 2) : [modelId, undefined];
    const chain = allowFallback
      ? this.fallbackChainFrom(provider as VisionProvider, model)
      : [{ provider: provider as VisionProvider, model }];

    let lastErr: unknown = null;
    for (const step of chain) {
      if (this.isCircuitOpen(step.provider)) {
        this.logger.warn(`Skipping ${step.provider} — circuit open (quota/billing cooldown)`);
        continue;
      }
      try {
        const result = await this.runProvider(step.provider, filePath, mimetype, step.model);
        if (result && this.isUsable(result)) return result;
        this.logger.warn(`${step.provider} returned unusable result, trying next provider`);
      } catch (err: any) {
        if (isQuotaOrBillingError(err)) this.tripCircuit(step.provider);
        lastErr = err;
        this.logger.warn(`${step.provider} failed: ${err?.message || err}`);
      }
    }

    if (lastErr) throw lastErr;
    return null;
  }

  private fallbackChainFrom(
    primary: VisionProvider,
    primaryModel?: string,
  ): Array<{ provider: VisionProvider; model?: string }> {
    const all: VisionProvider[] = ['claude', 'gemini', 'ollama', 'tesseract'];
    const ordered = [primary, ...all.filter(p => p !== primary)];
    return ordered.map(provider => ({
      provider,
      // Only keep the specific model for the primary step; fallbacks use
      // each provider's env default.
      model: provider === primary ? primaryModel : undefined,
    }));
  }

  private async runProvider(
    provider: VisionProvider,
    filePath: string,
    mimetype: string,
    model?: string,
  ): Promise<ParsedInvoice | null> {
    switch (provider) {
      case 'claude':
        if (!this.claude.isAvailable()) return null;
        return this.claude.extract(filePath, mimetype, model);
      case 'gemini':
        if (!this.gemini.isAvailable()) return null;
        if (!(await this.gemini.isReachable())) return null;
        return this.gemini.extract(filePath, mimetype, model);
      case 'ollama':
        if (!(await this.ollama.isAvailable())) return null;
        return (mimetype === 'application/pdf' || filePath.endsWith('.pdf'))
          ? this.ollama.extractFromPdf(filePath, model)
          : this.ollama.extractFromImageFile(filePath, model);
      case 'tesseract':
        // Signal to caller to fall through to OcrService's Tesseract path
        return null;
      default:
        throw new Error(`Unknown vision provider: ${provider}`);
    }
  }

  private isUsable(r: ParsedInvoice): boolean {
    const PLACEHOLDER = /^(Unknown Patient|Unknown Provider|OCR Processing Required|Upload to backend for extraction)$/i;
    const realName = r.patientName && !PLACEHOLDER.test(r.patientName);
    const populated = [
      realName ? r.patientName : '',
      !PLACEHOLDER.test(r.providerName || '') ? r.providerName : '',
      r.invoiceNumber,
      r.invoiceAmount > 0 ? 'x' : '',
    ].filter(Boolean).length;
    return populated >= 2;
  }
}
