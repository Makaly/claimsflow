/**
 * Gemini-backed implementations of the three document-classifier AI operations:
 *   suggestZones, ocrZone, classifyAndExtract
 *
 * Uses @google/generative-ai structured-JSON output (no tool-use API needed).
 */
import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import * as fs from 'fs';
import * as path from 'path';

const TIMEOUT_MS = 60_000;

@Injectable()
export class GeminiClassifierService {
  private readonly logger = new Logger(GeminiClassifierService.name);
  private client: GoogleGenerativeAI | null = null;

  private getClient() {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new ServiceUnavailableException('GEMINI_API_KEY is not set');
    if (!this.client) this.client = new GoogleGenerativeAI(key);
    return this.client;
  }

  get isAvailable() { return !!process.env.GEMINI_API_KEY; }

  private static readonly FALLBACK_MODELS = ['gemini-2.0-flash', 'gemini-1.5-flash'];

  private model(schema: any, modelId: string) {
    return this.getClient().getGenerativeModel({
      model: modelId,
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: schema,
        temperature: 0.1,
      },
    });
  }

  private async run<T>(schema: any, parts: any[], context: string): Promise<T> {
    const primary = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const candidates = [primary, ...GeminiClassifierService.FALLBACK_MODELS.filter((m) => m !== primary)];

    let lastErr: any;
    for (const modelId of candidates) {
      const timeout = new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error(`Gemini call timed out (${TIMEOUT_MS / 1000}s)`)), TIMEOUT_MS)
      );
      try {
        const result = await Promise.race([
          this.model(schema, modelId).generateContent(parts),
          timeout,
        ]);
        if (modelId !== primary) {
          this.logger.warn(`${context}: fell back to ${modelId} (primary ${primary} unavailable)`);
        }
        return JSON.parse(result.response.text()) as T;
      } catch (err: any) {
        const msg: string = err?.message ?? String(err);
        const is503 = msg.includes('503') || msg.includes('Service Unavailable') || msg.includes('high demand');
        if (is503) {
          this.logger.warn(`${context}: ${modelId} returned 503 — trying next model`);
          lastErr = err;
          continue;
        }
        this.logger.error(`${context}: ${msg}`);
        if (msg.includes('quota') || msg.includes('billing') || msg.includes('limit') || msg.includes('429')) {
          throw new ServiceUnavailableException(
            'Gemini API quota exceeded. Please switch to Claude (Anthropic) using the model selector, or check your Google AI quota at https://ai.dev/rate-limits.'
          );
        }
        // Strip raw JSON / long stack from user-facing message
        const shortMsg = msg.split('\n')[0].substring(0, 200);
        throw new ServiceUnavailableException(`Gemini error: ${shortMsg}`);
      }
    }

    this.logger.error(`${context}: all Gemini models returned quota/503 errors`);
    throw new ServiceUnavailableException(
      'Gemini API quota exceeded on all available models. Please switch to Claude (Anthropic) using the ◆ Claude button in the toolbar.'
    );
  }

  private inlineData(filePath: string) {
    const b64 = fs.readFileSync(filePath).toString('base64');
    const ext = path.extname(filePath).toLowerCase();
    const mimeType = ext === '.pdf' ? 'application/pdf'
      : ext === '.png' ? 'image/png' : 'image/jpeg';
    return { inlineData: { mimeType, data: b64 } };
  }

  // ── Zone OCR ──────────────────────────────────────────────────────────────────

  async ocrZone(params: {
    filePath: string;
    fieldLabel: string;
    xPercent: number; yPercent: number;
    widthPercent: number; heightPercent: number;
    searchPhrase?: string | null;
    description?: string | null;
  }): Promise<{ text: string; confidence: number; reasoning: string }> {
    const schema = {
      type: SchemaType.OBJECT,
      properties: {
        value:      { type: SchemaType.STRING },
        confidence: { type: SchemaType.NUMBER },
        reasoning:  { type: SchemaType.STRING },
      },
      required: ['value', 'confidence', 'reasoning'],
    };

    const prompt = `Extract the "${params.fieldLabel}" field from this document.

Zone location (% of page):
  Left: ${params.xPercent.toFixed(1)}%  Top: ${params.yPercent.toFixed(1)}%
  Width: ${params.widthPercent.toFixed(1)}%  Height: ${params.heightPercent.toFixed(1)}%
${params.searchPhrase ? `Look near or matching: "${params.searchPhrase}"` : ''}
${params.description ? `Hint: ${params.description}` : ''}

Return the raw value only (no labels). Empty string if not found. Score confidence honestly (0.0-1.0).`;

    const out = await this.run<{ value: string; confidence: number; reasoning: string }>(
      schema, [this.inlineData(params.filePath), { text: prompt }], 'ocrZone'
    );

    return {
      text:       String(out.value ?? '').trim(),
      confidence: Math.min(1, Math.max(0, Number(out.confidence ?? 0))),
      reasoning:  String(out.reasoning ?? ''),
    };
  }

  // ── Auto-suggest zones ────────────────────────────────────────────────────────

  async suggestZones(params: {
    filePath: string;
    templateName: string;
    documentType: string;
    existingFieldNames: string[];
  }) {
    const schema = {
      type: SchemaType.OBJECT,
      properties: {
        zones: {
          type: SchemaType.ARRAY,
          items: {
            type: SchemaType.OBJECT,
            properties: {
              fieldName:      { type: SchemaType.STRING },
              fieldLabel:     { type: SchemaType.STRING },
              description:    { type: SchemaType.STRING },
              searchPhrase:   { type: SchemaType.STRING },
              extractedValue: { type: SchemaType.STRING },
              pageNumber:     { type: SchemaType.NUMBER },
              xPercent:       { type: SchemaType.NUMBER },
              yPercent:       { type: SchemaType.NUMBER },
              widthPercent:   { type: SchemaType.NUMBER },
              heightPercent:  { type: SchemaType.NUMBER },
              confidence:     { type: SchemaType.NUMBER },
            },
            required: ['fieldName','fieldLabel','xPercent','yPercent','widthPercent','heightPercent','confidence'],
          },
        },
      },
      required: ['zones'],
    };

    const skipNote = params.existingFieldNames.length
      ? `\nAlready defined (skip): ${params.existingFieldNames.join(', ')}`
      : '';

    const prompt = `You are analysing a "${params.templateName}" (${params.documentType}) medical insurance document.${skipNote}

This may be a multi-page document. Scan ALL pages and identify every extractable data field.
For each:
- fieldName: snake_case key (patient_name, invoice_number, total_amount, diagnosis_code, sponsor_coverage, …)
- fieldLabel: human label for the UI
- description: one-sentence extraction hint
- searchPhrase: the label text printed on the document near this value
- extractedValue: the ACTUAL text/value you can read at this location right now (e.g. "John Doe", "INV-00123", "KES 4,500.00")
- pageNumber: which page this field appears on (1-based integer, e.g. 1, 2, 3…)
- xPercent/yPercent: top-left corner of the VALUE (not label) zone, 0-100% of the page it appears on
- widthPercent/heightPercent: size of the value zone
- confidence: 1.0 clearly visible, 0.5 estimated

IMPORTANT for provider_name: look for the hospital/clinic letterhead or logo text at the very TOP of the first page (e.g. "THE AGA KHAN UNIVERSITY HOSPITAL"). Extract ONLY the institution name without the city/branch suffix.
For provider_branch: extract the city or branch from the same letterhead line (e.g. "Nairobi" from "THE AGA KHAN UNIVERSITY HOSPITAL, Nairobi"). Do NOT use a "Provider:" field lower on the page — use the institutional header.

Also extract:
- sponsor_coverage: the amount the insurer/sponsor covers (e.g. "Sponsor Coverage: AKA Corporate 500,000.00")
- total_billed: the total amount billed before deductions
- patient_payable: any amount the patient owes

Focus on: invoice numbers, dates, amounts, patient demographics, provider info, diagnosis/procedure codes, totals, coverage amounts. Up to 25 zones.`;

    const out = await this.run<{ zones: any[] }>(
      schema, [this.inlineData(params.filePath), { text: prompt }], 'suggestZones'
    );

    this.logger.log(`Gemini suggested ${out.zones?.length ?? 0} zone(s) for "${params.templateName}"`);
    return out.zones ?? [];
  }

  // ── Classify + Extract ────────────────────────────────────────────────────────

  async classifyAndExtract(params: {
    filePath: string;
    templates: Array<{
      id: string; name: string; documentType: string;
      specificProvider?: string | null; description?: string | null;
      zones: Array<{ fieldName: string; fieldLabel: string; description?: string | null; xPercent: number; yPercent: number; searchPhrase?: string | null }>;
    }>;
  }) {
    // Step 1: classify
    const classifySchema = {
      type: SchemaType.OBJECT,
      properties: {
        templateId:  { type: SchemaType.STRING },
        confidence:  { type: SchemaType.NUMBER },
        reasoning:   { type: SchemaType.STRING },
      },
      required: ['templateId', 'confidence'],
    };

    const templateList = params.templates.map((t) =>
      `- ID: ${t.id} | "${t.name}" | ${t.documentType}${t.specificProvider ? ` | ${t.specificProvider}` : ''}${t.description ? ` | ${t.description}` : ''}`
    ).join('\n');

    const classifyOut = await this.run<{ templateId: string; confidence: number; reasoning?: string }>(
      classifySchema,
      [this.inlineData(params.filePath), { text:
        `You are a document classifier for a medical insurance claims system.\n\nAvailable templates:\n${templateList}\n\nMatch this document to the best template. Return "none" if no match. Consider layout, provider logo, header, structure.` }],
      'classifyAndExtract/classify',
    );

    const matchedId = classifyOut.templateId && classifyOut.templateId !== 'none'
      ? classifyOut.templateId : null;

    if (!matchedId) return null;

    const matchedTemplate = params.templates.find((t) => t.id === matchedId);
    if (!matchedTemplate || !matchedTemplate.zones.length) {
      return { templateId: matchedId, templateName: matchedTemplate?.name, fields: {}, confidence: {}, validation: [] };
    }

    // Step 2: extract with per-field schema
    const fieldProps: Record<string, any> = {};
    for (const z of matchedTemplate.zones) {
      fieldProps[z.fieldName] = {
        type: SchemaType.OBJECT,
        properties: {
          value:      { type: SchemaType.STRING },
          confidence: { type: SchemaType.NUMBER },
        },
        required: ['value', 'confidence'],
      };
    }

    const extractSchema = {
      type: SchemaType.OBJECT,
      properties: fieldProps,
      required: [],
    };

    const zoneDescriptions = matchedTemplate.zones.map((z) =>
      `- ${z.fieldLabel} (${z.fieldName}): ${z.description || `~${z.xPercent.toFixed(0)}% left, ~${z.yPercent.toFixed(0)}% top`}${z.searchPhrase ? ` — near "${z.searchPhrase}"` : ''}`
    ).join('\n');

    const extractOut = await this.run<Record<string, { value: string; confidence: number }>>(
      extractSchema,
      [this.inlineData(params.filePath), { text:
        `This is a "${matchedTemplate.name}" (${matchedTemplate.documentType}) document. It may have multiple pages — scan ALL pages.\n\nExtract these fields with confidence:\n\n${zoneDescriptions}\n\nFor provider_name: institution name only from the letterhead at top of page 1 (no city suffix).\nFor provider_branch: city/branch from the same letterhead line (e.g. "Nairobi").\nCopy exactly. Empty string + 0 confidence if not found.` }],
      'classifyAndExtract/extract',
    );

    const fields: Record<string, string>    = {};
    const confidence: Record<string, number> = {};
    for (const [k, v] of Object.entries(extractOut ?? {})) {
      if (v && typeof v === 'object') {
        fields[k]     = String(v.value ?? '').trim();
        confidence[k] = Math.min(1, Math.max(0, Number(v.confidence ?? 0)));
      }
    }

    // Step 3: validate
    const validation = await this.validateFields(params.filePath, fields);

    this.logger.log(`Gemini extracted ${Object.keys(fields).length} field(s) from "${matchedTemplate.name}"`);
    return { templateId: matchedId, templateName: matchedTemplate.name, fields, confidence, validation };
  }

  // ── Validation ────────────────────────────────────────────────────────────────

  async validateFields(filePath: string, fields: Record<string, string>) {
    if (!Object.keys(fields).length) return [];

    const issueSchema = {
      type: SchemaType.OBJECT,
      properties: {
        issues: {
          type: SchemaType.ARRAY,
          items: {
            type: SchemaType.OBJECT,
            properties: {
              field:    { type: SchemaType.STRING },
              issue:    { type: SchemaType.STRING },
              severity: { type: SchemaType.STRING },
            },
            required: ['field','issue','severity'],
          },
        },
      },
      required: ['issues'],
    };

    const fieldList = Object.entries(fields).filter(([,v]) => v)
      .map(([k,v]) => `- ${k}: "${v}"`).join('\n');

    const out = await this.run<{ issues: any[] }>(
      issueSchema,
      [this.inlineData(filePath), { text:
        `Validate these extracted medical insurance claim fields for logical consistency:\n\n${fieldList}\n\nCheck: date ordering (discharge after admission), amounts consistent, missing critical fields (invoice_number, invoice_amount). Return empty array if all OK.` }],
      'validateFields',
    ).catch(() => ({ issues: [] }));

    return (out.issues ?? []).map((i: any) => ({
      field:    String(i.field ?? 'general'),
      issue:    String(i.issue ?? ''),
      severity: (['error','warning','info'].includes(i.severity) ? i.severity : 'info') as 'error' | 'warning' | 'info',
    }));
  }
}
