import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { ParsedInvoice } from './ocr.service';
import {
  INVOICE_NUMBER_PATTERNS, INVOICE_DATE_PATTERNS, TOTAL_AMOUNT_PATTERNS,
  PATIENT_NAME_PATTERNS, PATIENT_ID_PATTERNS, MEMBERSHIP_PATTERNS,
  PROVIDER_PATTERNS, DIAGNOSIS_PATTERNS, SERVICE_DATE_PATTERNS,
  extractMedicalCodes,
} from './invoice-patterns';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
// Default to moondream — a 1B vision model that runs fast on CPU. Larger
// models (llama3.2-vision, llava) need a GPU to respond in reasonable time;
// override via OLLAMA_VISION_MODEL=llama3.2-vision when running on GPU.
const VISION_MODEL = process.env.OLLAMA_VISION_MODEL || 'moondream';

// Preferred models in order — first one that loads successfully wins
// CPU-friendly first: moondream (1B) is ~10x faster than llama3.2-vision (11B)
// on CPU, so prefer it unless a GPU-class model is explicitly configured.
const MODEL_PRIORITY = ['moondream', 'llava', 'llama3.2-vision', 'llava:13b'];

const EXTRACT_PROMPT = `You are reading a Kenyan medical insurance invoice. Extract every field visible. Look carefully at headers, labels, and tables.

Return these values exactly as printed:
1. Patient full name (look for "Patient:", "Patient Name:", "Bill To:", "Name:", or the name at the top after the provider)
2. Patient registration / hospital number (look for "Patient No.", "Reg No.", "OP No.", "Account Number:", "IP No.")
3. AK / membership / HMN number (look for "AK Number:", "HMN NO.", "Membership No.", "Member No.", any code starting with AK followed by digits)
4. Provider / hospital name (usually the largest text at the very top)
5. Invoice or receipt number (look for "Invoice No.", "Receipt No.", "Inv#", or codes like Nyr/13277)
6. Invoice date
7. Total amount billed to insurance / sponsor (look for "Sponsor Coverage", "Amount Due", "Grand Total")
8. Service or visit date
9. Diagnosis or reason for visit (look for "Diagnosis:", "Reason for Visit:", "Complaint:", ICD-10 codes like E39)
10. Treatment or procedure performed

Be specific. Use exact text from the document. Empty string if not found.`;


@Injectable()
export class OllamaOcrService implements OnModuleInit {
  private readonly logger = new Logger(OllamaOcrService.name);

  private activeModel: string | null = null;
  private consecutiveTimeouts = 0;
  private cooledUntil = 0;

  // Trigger a model load on boot so the first user upload doesn't pay the
  // cold-start cost (30–90 s). Failure is non-fatal — the OCR pipeline still
  // works, the user just eats that cost on first request.
  async onModuleInit() {
    try {
      const available = await this.isAvailable();
      if (!available) {
        this.logger.log('Ollama vision model not available — will use Tesseract fallback');
        return;
      }
      const model = this.activeModel!;
      this.logger.log(`Pre-loading Ollama vision model: ${model}`);
      await fetch(`${OLLAMA_URL}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt: 'ok', stream: false, keep_alive: '15m' }),
        signal: AbortSignal.timeout(90_000),
      }).then(() => this.logger.log(`Ollama vision model ${model} is hot`))
        .catch(err => this.logger.warn(`Ollama warm-up failed: ${err?.message || err}`));
    } catch (err) {
      this.logger.warn(`Ollama warm-up threw: ${err}`);
    }
  }

  async isAvailable(): Promise<boolean> {
    // Back off after consecutive inference timeouts so we don't burn the
    // whole request budget waiting for an overloaded Ollama instance.
    if (Date.now() < this.cooledUntil) return false;
    try {
      // Short probe — if Ollama isn't up we don't want to wait for the OS
      // socket timeout before falling back to Tesseract.
      const res = await fetch(`${OLLAMA_URL}/api/tags`, {
        signal: AbortSignal.timeout(2_000),
      });
      if (!res.ok) return false;
      const data = await res.json() as { models?: Array<{ name: string }> };
      const installed = data.models?.map(m => m.name) ?? [];

      // Pick best available model
      const preferred = [VISION_MODEL, ...MODEL_PRIORITY];
      for (const m of preferred) {
        if (installed.some(n => n.startsWith(m.split(':')[0]))) {
          this.activeModel = installed.find(n => n.startsWith(m.split(':')[0])) ?? m;
          return true;
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  /** Convert PDF page to base64 PNG using pdftoppm (poppler) */
  private async pdfPageToBase64(pdfPath: string, page = 1): Promise<string> {
    const tmpOut = `/tmp/ocr_page_${Date.now()}`;
    try {
      spawnSync('pdftoppm', ['-r', '300', '-f', String(page), '-l', String(page), '-png', pdfPath, tmpOut], { stdio: 'pipe' });
      const files = fs.readdirSync('/tmp').filter(f => f.startsWith(path.basename(tmpOut)));
      if (!files.length) throw new Error('pdftoppm produced no output');
      const imgPath = `/tmp/${files[0]}`;
      const b64 = fs.readFileSync(imgPath).toString('base64');
      fs.unlinkSync(imgPath);
      return b64;
    } catch {
      // fallback: read raw PDF bytes as base64 (Ollama can handle PDFs directly in some builds)
      return fs.readFileSync(pdfPath).toString('base64');
    }
  }

  /** Extract invoice fields from a single image (base64 PNG) */
  private async extractFromImage(imageBase64: string, modelOverride?: string): Promise<Partial<ParsedInvoice>> {
    const model = modelOverride || this.activeModel || VISION_MODEL;
    const prompt = `You are reading a Kenyan medical insurance invoice. Extract every visible field. For Aga Khan invoices look for "Patient Name:", "Bill To:", "AK Number:", "HMN NO.", "Account Number:", "Sponsor Coverage", "Diagnosis:".
Return ONLY valid JSON with no extra text:
{"patientName":"","patientId":"","membershipNumber":"","providerName":"","invoiceNumber":"","invoiceDate":"","invoiceAmount":0,"serviceDate":"","diagnosis":"","treatment":"","insuranceCompany":"","accountName":"","confidence":0.9}`;

    // llama3.2-vision requires the /api/chat endpoint
    const isLlama32 = model.startsWith('llama3.2-vision');
    const endpoint = isLlama32 ? `${OLLAMA_URL}/api/chat` : `${OLLAMA_URL}/api/generate`;

    // `keep_alive` tells Ollama to keep the model resident in memory for 15
    // minutes after each call. Without it the model is unloaded after ~5 min
    // idle, forcing a 30–90 s reload on the next request.
    const body = isLlama32
      ? { model, messages: [{ role: 'user', content: prompt, images: [imageBase64] }], stream: false, keep_alive: '15m', options: { temperature: 0.1 } }
      : { model, prompt: EXTRACT_PROMPT, images: [imageBase64], stream: false, keep_alive: '15m', options: { temperature: 0.1 } };

    // Per-page timeout: 40 s keeps two pages well within the 180 s frontend
    // budget (2×40 + ~10 s Tesseract fallback = ~90 s total).
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(40_000),
    }).catch(err => {
      // Track consecutive timeouts; after 2 back-to-back, cool off for 5 min
      // so subsequent requests skip straight to Tesseract fallback.
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
        this.consecutiveTimeouts++;
        if (this.consecutiveTimeouts >= 2) {
          this.cooledUntil = Date.now() + 5 * 60 * 1000;
          this.logger.warn(`Ollama timed out ${this.consecutiveTimeouts}× — cooling off for 5 min`);
        }
      }
      throw err;
    });

    if (!res.ok) {
      const err = await res.text();
      // If out of memory, mark model unavailable and throw so Tesseract fallback kicks in
      if (err.includes('memory')) {
        this.logger.warn(`${model} out of memory — falling back to Tesseract`);
        this.activeModel = null;
      }
      throw new Error(`Ollama ${res.status}: ${err}`);
    }

    // Successful response — reset the timeout backoff counter
    this.consecutiveTimeouts = 0;

    const data = await res.json() as any;
    const text = (isLlama32 ? data?.message?.content : data?.response)?.trim() ?? '';

    if (!text) return { confidence: 0 };

    // Try JSON parse first, then regex fallback
    try {
      const m = text.match(/\{[\s\S]*\}/);
      if (m) {
        const json = JSON.parse(m[0]);
        return {
          patientName:      json.patientName      || '',
          patientId:        json.patientId        || '',
          membershipNumber: json.membershipNumber || '',
          providerName:     json.providerName     || '',
          invoiceNumber:    json.invoiceNumber    || '',
          invoiceDate:      json.invoiceDate      || '',
          invoiceAmount:    parseFloat(json.invoiceAmount) || 0,
          serviceDate:      json.serviceDate      || '',
          diagnosis:        json.diagnosis        || '',
          treatment:        json.treatment        || json.diagnosis || '',
          insuranceCompany: json.insuranceCompany || '',
          accountName:      json.accountName      || '',
          confidence:       parseFloat(json.confidence) || 0.85,
        };
      }
    } catch { /* fall through to regex */ }

    return this.parseTextToFields(text);
  }

  /** Parse llama3.2-vision bullet-point or free-text output into structured fields */
  private parseTextToFields(text: string): Partial<ParsedInvoice> {
    const find = (patterns: RegExp[]): string => {
      for (const p of patterns) {
        const m = text.match(p)
        const val = m?.[1]?.trim()
        if (val && val.toLowerCase() !== 'not specified' && val.toLowerCase() !== 'not provided') return val
      }
      return ''
    }

    const patientName = find([
      /patient[^:]*:\s*\*?\*?([^*\n]+)/i,
      /client[^:]*:\s*\*?\*?([^*\n]+)/i,
      /name[^:]*:\s*\*?\*?([A-Z][a-zA-Z\s]{2,40})/i,
    ])

    const providerName = find([
      /provider[^:]*:\s*\*?\*?([^*\n]+)/i,
      /clinic[^:]*:\s*\*?\*?([^*\n]+)/i,
      /hospital[^:]*:\s*\*?\*?([^*\n]+)/i,
    ])

    const invoiceNumber = find([
      /invoice[^:]*number[^:]*:\s*\*?\*?([^*\n]+)/i,
      /receipt[^:]*number[^:]*:\s*\*?\*?([^*\n]+)/i,
      /invoice[^:]*:\s*\*?\*?([A-Z0-9\-\/]{3,20})/i,
    ])

    const dateStr = find([
      /date[^:]*:\s*\*?\*?([^*\n]+)/i,
    ])

    const amountStr = find([
      /(?:total|amount)[^:]*:\s*\*?\*?([^*\n]+)/i,
    ])
    const invoiceAmount = parseFloat(amountStr.replace(/[^0-9.]/g, '')) || 0

    const diagnosis = find([
      /diagnosis[^:]*:\s*\*?\*?([^*\n]+)/i,
      /treatment[^:]*:\s*\*?\*?([^*\n]+)/i,
    ])

    const membershipNumber = find([
      /member[^:]*:\s*\*?\*?([^*\n]+)/i,
      /policy[^:]*:\s*\*?\*?([^*\n]+)/i,
    ])

    const found = [patientName, providerName, invoiceNumber, invoiceAmount > 0, dateStr].filter(Boolean).length
    const confidence = Math.min(0.5 + found * 0.1, 0.95)

    return { patientName, providerName, invoiceNumber, invoiceDate: dateStr, invoiceAmount, serviceDate: dateStr, diagnosis, membershipNumber, confidence }
  }

  /**
   * Extract fields from the PDF's digital text layer using regex patterns.
   * For digitally-generated invoices (Aga Khan, Zion, etc.) this is far more
   * reliable than asking a small vision model to read the images.
   * Returns an empty object if the PDF has no usable text (scanned-only).
   */
  private async extractFromTextLayer(filePath: string): Promise<Partial<ParsedInvoice>> {
    try {
      const pdfParse = await import('pdf-parse');
      const buffer = fs.readFileSync(filePath);
      const { text } = await pdfParse.default(buffer);
      if (!text || text.trim().length < 50) return {};

      const first = (patterns: RegExp[]): string => {
        for (const p of patterns) {
          const m = text.match(p);
          const v = m?.[1]?.trim();
          if (v) return v;
        }
        return '';
      };

      const invoiceNumber = first(INVOICE_NUMBER_PATTERNS);

      // Amount: try each pattern; pick the largest value found (guards against
      // picking up a line-item sub-total smaller than the grand total).
      let invoiceAmount = 0;
      for (const p of TOTAL_AMOUNT_PATTERNS) {
        const m = text.match(p);
        if (m?.[1]) {
          const v = parseFloat(m[1].replace(/,/g, ''));
          if (!isNaN(v) && v > invoiceAmount) invoiceAmount = v;
        }
      }

      const invoiceDate  = first(INVOICE_DATE_PATTERNS);
      const serviceDate  = first(SERVICE_DATE_PATTERNS) || invoiceDate;
      const patientName  = first(PATIENT_NAME_PATTERNS);
      const patientId    = first(PATIENT_ID_PATTERNS);
      const membershipNumber = first(MEMBERSHIP_PATTERNS);
      const providerName = first(PROVIDER_PATTERNS);
      const diagnosis    = first(DIAGNOSIS_PATTERNS);
      const { cptCodes, icd10Codes, hcpcsCodes, allCodes } = extractMedicalCodes(text);

      const fieldsFound = [invoiceNumber, invoiceDate, providerName, membershipNumber]
        .filter(Boolean).length + (invoiceAmount > 0 ? 1 : 0);

      if (fieldsFound < 2) return {};

      // Confidence proportional to how many core fields we found (max 0.92 —
      // leave room for a cloud model to beat it if credits are restored).
      const confidence = Math.min(0.6 + fieldsFound * 0.07, 0.92);

      this.logger.log(
        `Text-layer extraction: invoice=${invoiceNumber || '?'}, amount=${invoiceAmount}, ` +
        `patient=${patientName || '?'}, confidence=${confidence.toFixed(2)}`,
      );

      return {
        invoiceNumber, invoiceDate, invoiceAmount, serviceDate,
        patientName, patientId, membershipNumber, providerName, diagnosis,
        cptCodes, icd10Codes, hcpcsCodes,
        allMedicalCodes: allCodes,
        diagnosisCode: icd10Codes[0] || '',
        procedureCode: cptCodes[0] || '',
        confidence,
      };
    } catch (err: any) {
      this.logger.warn(`Text-layer extraction failed: ${err?.message || err}`);
      return {};
    }
  }

  async extractFromPdf(filePath: string, modelOverride?: string): Promise<ParsedInvoice> {
    // Get page count
    let pageCount = 1;
    try {
      const res = spawnSync('pdfinfo', [filePath], { stdio: 'pipe', timeout: 10_000 });
      const match = (res.stdout?.toString() || '').match(/Pages:\s+(\d+)/);
      pageCount = match ? parseInt(match[1]) : 1;
    } catch { /* use 1 */ }

    // Step 1: text-layer extraction (fast, no network, works for digitally-generated PDFs).
    const textLayerResult = await this.extractFromTextLayer(filePath);
    const textLayerConfidence = Number(textLayerResult.confidence) || 0;

    // If the text layer gave us the key fields we need, skip Ollama entirely
    // and return immediately. This avoids ~2–8 min of moondream inference
    // on PDFs like Aga Khan inpatient invoices where all data is in the text layer.
    const textLayerComplete =
      textLayerConfidence >= 0.75 &&
      !!(textLayerResult.invoiceNumber && textLayerResult.invoiceAmount && textLayerResult.invoiceAmount > 0);

    // Step 2 (optional): visual extraction via Ollama for fields missing from the text layer.
    // Cap pages — each costs ~5–15 s on CPU; only scan pages needed to fill gaps.
    const perPage: Partial<ParsedInvoice>[] = [];

    if (!textLayerComplete) {
      const maxPages = Math.min(pageCount, 8);
      this.logger.log(`Ollama processing ${maxPages}/${pageCount} page(s)`);

      for (let p = 1; p <= maxPages; p++) {
        if (Date.now() < this.cooledUntil) {
          this.logger.warn(`Ollama cooled off — aborting remaining pages (${p}–${maxPages})`);
          break;
        }
        try {
          const imageB64 = await this.pdfPageToBase64(filePath, p);
          const extracted = await this.extractFromImage(imageB64, modelOverride);
          perPage.push(extracted);
        } catch (err: any) {
          this.logger.warn(`Ollama page ${p} failed: ${err?.message || err}`);
        }
      }

      if (perPage.length === 0 && !textLayerResult.invoiceNumber) {
        throw new Error('Ollama extracted no usable pages');
      }
    } else {
      this.logger.log('Text layer produced complete result — skipping Ollama visual pass');
    }

    // Merge: text-layer fields win over Ollama visual output (more reliable for
    // digitally-generated PDFs). Ollama visual output fills gaps only.
    const firstOf = (key: keyof ParsedInvoice): string => {
      const textVal = (textLayerResult as any)[key];
      if (typeof textVal === 'string' && textVal.trim()) return textVal.trim();
      for (const pg of perPage) {
        const v = (pg as any)[key];
        if (typeof v === 'string' && v.trim()) return v.trim();
      }
      return '';
    };

    const textAmount = Number(textLayerResult.invoiceAmount) || 0;
    const ollamaMaxAmount = perPage.reduce((acc, pg) => {
      const v = Number(pg.invoiceAmount || 0);
      return v > acc ? v : acc;
    }, 0);
    // Text layer wins for amount — it uses "Sponsor Coverage" regex which correctly
    // targets the insurer-paid amount, not patient co-pay or individual line items.
    const invoiceAmount = textAmount > 0 ? textAmount : ollamaMaxAmount;

    const ollamaMaxConfidence = perPage.reduce((acc, pg) => {
      const v = Number(pg.confidence || 0);
      return v > acc ? v : acc;
    }, 0);
    const confidence = Math.max(textLayerConfidence, ollamaMaxConfidence) || 0.5;

    const cptCodes    = (textLayerResult.cptCodes?.length    ? textLayerResult.cptCodes    : []);
    const icd10Codes  = (textLayerResult.icd10Codes?.length  ? textLayerResult.icd10Codes  : []);
    const hcpcsCodes  = (textLayerResult.hcpcsCodes?.length  ? textLayerResult.hcpcsCodes  : []);

    return {
      patientName:      firstOf('patientName'),
      patientId:        firstOf('patientId'),
      membershipNumber: firstOf('membershipNumber'),
      providerName:     firstOf('providerName'),
      invoiceNumber:    firstOf('invoiceNumber'),
      invoiceDate:      firstOf('invoiceDate'),
      invoiceAmount,
      serviceDate:      firstOf('serviceDate'),
      diagnosis:        firstOf('diagnosis'),
      diagnosisCode:    firstOf('diagnosisCode') || icd10Codes[0] || '',
      procedureCode:    firstOf('procedureCode') || cptCodes[0] || '',
      cptCodes,
      icd10Codes,
      hcpcsCodes,
      allMedicalCodes:  textLayerResult.allMedicalCodes ?? [],
      treatment:        firstOf('treatment'),
      insuranceCompany: '',
      accountName:      '',
      confidence,
      rawText:          '',
      pageRange:        `1-${pageCount}`,
      documentPages:    [],
    };
  }

  async extractFromImageFile(imagePath: string, modelOverride?: string): Promise<ParsedInvoice> {
    const b64 = fs.readFileSync(imagePath).toString('base64');
    const extracted = await this.extractFromImage(b64, modelOverride);
    return {
      patientName: '', patientId: '', membershipNumber: '', providerName: '',
      invoiceNumber: '', invoiceDate: '', invoiceAmount: 0, serviceDate: '',
      diagnosis: '', diagnosisCode: '', procedureCode: '', cptCodes: [],
      icd10Codes: [], hcpcsCodes: [], allMedicalCodes: [], treatment: '',
      insuranceCompany: '', accountName: '', rawText: '', pageRange: '1',
      documentPages: [], confidence: 0.5,
      ...extracted,
    };
  }
}
