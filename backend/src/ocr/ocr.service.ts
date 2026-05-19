import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { createWorker, OEM } from 'tesseract.js';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
  INVOICE_NUMBER_PATTERNS, INVOICE_DATE_PATTERNS, TOTAL_AMOUNT_PATTERNS,
  LINE_ITEM_PATTERNS, PATIENT_NAME_PATTERNS, PATIENT_ID_PATTERNS,
  MEMBERSHIP_PATTERNS, PROVIDER_PATTERNS, DIAGNOSIS_PATTERNS, icd10Label,
  SERVICE_DATE_PATTERNS, INSURANCE_PATTERNS, ACCOUNT_PATTERNS,
  extractMedicalCodes,
} from './invoice-patterns';
import { OllamaOcrService } from './ollama-ocr.service';
import { VisionRouterService } from './vision-router.service';
import { DocumentClassifierService } from '../document-classifier/document-classifier.service';
import { buildPageHintsMap, PageHintEntry } from './gemini-vision.service';

export interface ExtractedLineItem {
  description: string
  itemName?: string
  category?: string
  quantity?: number
  unitPrice?: number
  totalPrice?: number
  taxAmount?: number
  discount?: number
  currency: string
  serviceDate?: string
  procedureCode?: string
  ocrConfidence?: number
  layoutConfidence?: number
  semanticConfidence?: number
  overallConfidence?: number
  fraudRisk?: 'low' | 'medium' | 'high'
  fraudRiskScore?: number
  fraudFlags?: string[]
  arithmeticValid?: boolean
  lineNumber?: number
  rawText?: string
}

export interface DocumentPage {
  pageNumber: number;
  category: 'invoice' | 'claim_form' | 'prescription' | 'lab_result' | 'medical_report' | 'discharge_summary' | 'referral' | 'pre_auth' | 'supporting' | 'unknown';
  categoryLabel: string;
  confidence: number;
  summary: string;
}

export interface ParsedInvoice {
  patientName: string;
  patientId: string;
  providerName: string;
  membershipNumber: string;
  invoiceNumber: string;
  invoiceDate: string;
  invoiceAmount: number;
  serviceDate: string;
  diagnosis: string;
  diagnosisCode: string;
  procedureCode: string;
  cptCodes: string[];
  icd10Codes: string[];
  hcpcsCodes: string[];
  allMedicalCodes: string[];
  treatment: string;
  insuranceCompany: string;
  accountName: string;
  confidence: number;
  rawText: string;
  pageRange: string;
  documentPages: DocumentPage[];
  lineItems?: ExtractedLineItem[];
  /**
   * Structural warnings raised during post-extraction validation
   * (line-item sum mismatch, future-dated invoice, missing fields, etc.).
   * Populated by validateExtraction(); empty/undefined when the result
   * passes all structural checks. Surface these in the review UI.
   */
  validationWarnings?: string[];
}

@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name);

  constructor(
    @InjectQueue('ocr') private ocrQueue: Queue,
    private readonly ollamaOcr: OllamaOcrService,
    private readonly visionRouter: VisionRouterService,
    private readonly documentClassifier: DocumentClassifierService,
  ) {}

  async processDocument(documentId: string, filePath: string, mimetype: string) {
    this.ocrQueue.add('extract-text', { documentId, filePath, mimetype }, {
      attempts: 2,
      backoff: { type: 'fixed', delay: 5_000 },
    }).catch(() => {});
    return { message: 'Document queued for OCR processing' };
  }

  /**
   * Extract text from a single image using Tesseract
   */
  async extractTextFromImage(imagePath: string): Promise<string> {
    const worker = await createWorker('eng', OEM.LSTM_ONLY);
    try {
      const { data } = await worker.recognize(imagePath);
      return data.text;
    } finally {
      await worker.terminate();
    }
  }

  /**
   * Render every page of `filePath` to PNG and run Tesseract in hOCR mode so
   * callers can compose a searchable PDF (image + invisible text layer).
   * Returns one entry per page; caller owns the temp files and must clean up.
   */
  async extractHocrPages(
    filePath: string,
    mimetype: string,
    dpi = 300,
  ): Promise<Array<{
    pageNumber: number;
    imagePath: string;
    imageMime: 'image/png';
    hocrXml: string;
    widthPx: number;
    heightPx: number;
    dpi: number;
  }>> {
    const isPdf = mimetype === 'application/pdf' || filePath.toLowerCase().endsWith('.pdf');
    const tmpDir = path.join(process.cwd(), 'uploads', 'ocr-temp', `hocr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    const pageImages: string[] = [];

    if (isPdf) {
      const result = spawnSync(
        'pdftoppm',
        ['-png', '-r', String(dpi), filePath, path.join(tmpDir, 'page')],
        { timeout: 300_000, stdio: 'pipe' },
      );
      if (result.status !== 0) {
        this.logger.warn(`pdftoppm failed during hOCR rendering: ${result.stderr?.toString()?.slice(0, 200)}`);
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
        return [];
      }
      const files = fs.readdirSync(tmpDir).filter(f => f.endsWith('.png')).sort();
      for (const f of files) pageImages.push(path.join(tmpDir, f));
    } else {
      const ext = path.extname(filePath).toLowerCase() || '.png';
      const dest = path.join(tmpDir, `page-1${ext}`);
      fs.copyFileSync(filePath, dest);
      pageImages.push(dest);
    }

    if (pageImages.length === 0) return [];

    const sharp = (await import('sharp')).default;
    const worker = await createWorker('eng', OEM.LSTM_ONLY);
    const out: Array<{
      pageNumber: number; imagePath: string; imageMime: 'image/png';
      hocrXml: string; widthPx: number; heightPx: number; dpi: number;
    }> = [];

    try {
      for (let i = 0; i < pageImages.length; i++) {
        const imagePath = pageImages[i];
        const meta = await sharp(imagePath).metadata();
        const widthPx = meta.width ?? 0;
        const heightPx = meta.height ?? 0;
        if (widthPx === 0 || heightPx === 0) continue;
        const { data } = await worker.recognize(imagePath, {}, { hocr: true } as any);
        out.push({
          pageNumber: i + 1, imagePath, imageMime: 'image/png',
          hocrXml: (data as any).hocr ?? '', widthPx, heightPx, dpi,
        });
      }
    } finally {
      await worker.terminate();
    }

    return out;
  }

  cleanupHocrPages(pages: Array<{ imagePath: string }>): void {
    const dirs = new Set<string>();
    for (const p of pages) {
      if (p.imagePath) dirs.add(path.dirname(p.imagePath));
    }
    for (const d of dirs) {
      try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }

  /**
   * Extract text from a PDF by converting pages to images, then OCR.
   * Handles both digital and scanned PDFs.
   */
  async extractTextFromPDF(pdfPath: string): Promise<{ pages: string[]; pageCount: number }> {
    const dataBuffer = fs.readFileSync(pdfPath);

    // ── Step 1: per-page digital text via pdf-parse ───────────────────────────
    // Collect text for every page. Pages that are scanned images will return
    // empty strings — we will back-fill those with Tesseract in Step 2.
    let perPageTexts: string[] = [];
    let pdfPageCount = 0;

    try {
      const pdfParse = await import('pdf-parse');
      await pdfParse.default(dataBuffer, {
        pagerender: async (pageData: any) => {
          try {
            const content = await pageData.getTextContent({ normalizeWhitespace: true });
            const text = (content.items as any[]).map((it: any) => it.str).join(' ');
            perPageTexts.push(text);
            return text;
          } catch {
            perPageTexts.push('');
            return '';
          }
        },
      });
      pdfPageCount = perPageTexts.length;
    } catch {
      this.logger.warn('pdf-parse failed — falling back to full Tesseract');
    }

    // ── Step 2: OCR any pages that returned no digital text ───────────────────
    // This handles merged PDFs where some pages are scanned (e.g. ZION invoices
    // mixed with digital AGA KHAN invoices).
    const emptyPageIndices = perPageTexts
      .map((t, i) => (t.trim().length < 20 ? i : -1))
      .filter(i => i >= 0);

    if (emptyPageIndices.length > 0) {
      this.logger.log(`Scanned PDF detected, running Tesseract OCR...`);
      const { spawnSync } = await import('child_process');
      const tmpDir = path.join(process.cwd(), 'uploads', 'ocr-temp', `pages-${Date.now()}`);
      fs.mkdirSync(tmpDir, { recursive: true });
      const worker = await createWorker('eng', OEM.LSTM_ONLY);

      try {
        for (const idx of emptyPageIndices) {
          const pageNum = idx + 1;
          const tmpPrefix = path.join(tmpDir, `page-${String(pageNum).padStart(4, '0')}`);
          try {
            spawnSync(
              'pdftoppm',
              ['-png', '-r', '300', '-f', String(pageNum), '-l', String(pageNum), pdfPath, tmpPrefix],
              { timeout: 300_000, stdio: 'pipe' },
            );
            const files = fs.readdirSync(tmpDir).filter(f => f.startsWith(path.basename(tmpPrefix)));
            if (files.length > 0) {
              const imgPath = path.join(tmpDir, files[0]);
              this.logger.log(`OCR processing page ${pageNum}: ${files[0]}`);
              const { data } = await worker.recognize(imgPath);
              perPageTexts[idx] = data.text || '';
              fs.unlinkSync(imgPath);
            }
          } catch {
            // page stays empty — non-fatal
          }
        }
      } finally {
        await worker.terminate();
        try { fs.rmdirSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
      }

      const totalChars = perPageTexts.reduce((s, t) => s + t.length, 0);
      this.logger.log(`Hybrid extraction: ${totalChars} chars across ${perPageTexts.length} pages (${emptyPageIndices.length} OCR'd)`);
    }

    if (perPageTexts.length > 0) {
      return { pages: perPageTexts, pageCount: pdfPageCount || perPageTexts.length };
    }

    // ── Full Tesseract fallback (no digital text at all) ──────────────────────
    this.logger.log('Scanned PDF detected, running Tesseract OCR...');

    const { PDFDocument } = await import('pdf-lib');
    const pdfDoc = await PDFDocument.load(dataBuffer);
    const pageCount = pdfDoc.getPageCount();

    // OCR pages - limit to first 3 pages for efficiency (invoice data is on page 1)
    // Process remaining pages with lighter scan just for categorization
    const maxOcrPages = Math.min(pageCount, 3);
    const pages: string[] = [];
    const worker = await createWorker('eng', OEM.LSTM_ONLY);

    try {
      const { spawnSync } = await import('child_process');
      const tmpDir = path.join(process.cwd(), 'uploads', 'ocr-temp', `pages-${Date.now()}`);
      fs.mkdirSync(tmpDir, { recursive: true });

      try {
        // Only render pages we need at high res, rest at lower res for categorization
        spawnSync('pdftoppm', ['-png', '-r', '300', '-f', '1', '-l', String(maxOcrPages), pdfPath, `${tmpDir}/page`], { timeout: 300_000 });

        // If there are more pages, render them at lower res for categorization
        if (pageCount > maxOcrPages) {
          spawnSync('pdftoppm', ['-png', '-r', '150', '-f', String(maxOcrPages + 1), '-l', String(pageCount), pdfPath, `${tmpDir}/page`], { timeout: 300_000 });
        }

        const pageFiles = fs.readdirSync(tmpDir).filter(f => f.endsWith('.png')).sort();

        for (const pageFile of pageFiles) {
          const pagePath = path.join(tmpDir, pageFile);
          this.logger.log(`OCR processing: ${pageFile}`);
          const { data } = await worker.recognize(pagePath);
          pages.push(data.text);
          fs.unlinkSync(pagePath);
        }
        fs.rmdirSync(tmpDir);
      } catch {
        // pdftoppm not available - OCR the whole file directly
        this.logger.warn('pdftoppm not found, OCR-ing PDF directly');
        const { data } = await worker.recognize(pdfPath);
        pages.push(data.text);
        try { fs.rmdirSync(tmpDir); } catch {}
      }
    } finally {
      await worker.terminate();
    }

    return { pages, pageCount };
  }

  /**
   * Main entry: extract text and parse invoice fields.
   * @param modelId Optional vision model id (from /ocr/models). Defaults to
   *                VISION_DEFAULT_PROVIDER env (typically 'claude').
   */
  async extractAndParseInvoice(filePath: string, mimetype: string, modelId?: string): Promise<{
    invoices: ParsedInvoice[];
    pageCount: number;
    modelUsed?: string;
  }> {
    const result = await this._extractAndParseInvoiceRaw(filePath, mimetype, modelId);
    // Run the document classifier in parallel (best-effort) and merge zone-mapped fields
    try {
      const classified = await this.documentClassifier.classifyAndExtract(filePath, mimetype);
      if (classified?.claimFieldMap && Object.keys(classified.claimFieldMap).length > 0) {
        const cmap = classified.claimFieldMap as Record<string, string>;
        result.invoices = result.invoices.map(inv => ({
          ...inv,
          patientId:        cmap['patientId']        || inv.patientId,
          patientName:      cmap['patientName']       || inv.patientName,
          membershipNumber: cmap['memberNumber']      || inv.membershipNumber,
          invoiceNumber:    cmap['invoiceNumber']     || inv.invoiceNumber,
          invoiceDate:      cmap['invoiceDate']       || inv.invoiceDate,
          invoiceAmount:    cmap['invoiceAmount'] ? parseFloat(String(cmap['invoiceAmount']).replace(/[^0-9.]/g, '')) || inv.invoiceAmount : inv.invoiceAmount,
          providerName:     cmap['providerName']      || inv.providerName,
          diagnosis:        cmap['diagnosis']         || inv.diagnosis,
          diagnosisCode:    cmap['diagnosisCode']     || inv.diagnosisCode,
          treatment:        cmap['treatment']         || inv.treatment,
          serviceDate:      cmap['dateOfService']     || cmap['admissionDate'] || inv.serviceDate,
        }));
        this.logger.log(`Classifier enriched extraction with ${Object.keys(cmap).length} zone-mapped fields`);
      }
      // Surface the matched templateId so the frontend can query the knowledge base
      if (classified?.templateId) {
        (result as any).templateId = classified.templateId;
      }
    } catch (err: any) {
      this.logger.warn(`Classifier enrichment skipped: ${err?.message}`);
    }

    // Structural post-validation: catches arithmetic, date and completeness
    // issues that confidence scores miss. Flagged invoices still pass through
    // but the warnings are surfaced for human review.
    result.invoices = result.invoices.map(inv => this.validateExtraction(inv));

    return result;
  }

  /**
   * Run deterministic structural checks against an extracted invoice.
   * Does NOT mutate amounts/fields — only attaches `validationWarnings`.
   * Self-reported model confidence is unreliable on bad scans; these
   * checks catch the failure modes confidence misses.
   */
  validateExtraction(inv: ParsedInvoice): ParsedInvoice {
    const warnings: string[] = [];

    // 1) Line items must sum to the invoice total (±1 KES, or 2% for invoices
    //    over 10k where VAT rounding / sponsor-cover splits push the gap up).
    if (inv.lineItems && inv.lineItems.length > 0 && inv.invoiceAmount > 0) {
      const sum = inv.lineItems.reduce((s, li) => s + (li.totalPrice ?? 0), 0);
      const tolerance = Math.max(1, inv.invoiceAmount * 0.02);
      if (Math.abs(sum - inv.invoiceAmount) > tolerance) {
        warnings.push(
          `Line items sum to KES ${sum.toFixed(2)} but invoice total is KES ${inv.invoiceAmount.toFixed(2)} — possible missing rows or wrong total`,
        );
      }
    }

    // 2) Invoice date should not be in the future and should be a real date.
    if (inv.invoiceDate) {
      const d = new Date(inv.invoiceDate);
      if (Number.isNaN(d.getTime())) {
        warnings.push(`Invoice date "${inv.invoiceDate}" is not parseable as YYYY-MM-DD`);
      } else if (d.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
        warnings.push(`Invoice date ${inv.invoiceDate} is in the future`);
      }
    }

    // 3) Critical fields. Patient name is the worst silent-fail mode — without
    //    it, we have nothing to bill against. Provider next.
    if (!inv.patientName || /^Unknown/i.test(inv.patientName)) {
      warnings.push('Patient name missing or marked Unknown — manual review required');
    }
    if (!inv.providerName || /^Unknown/i.test(inv.providerName)) {
      warnings.push('Provider name missing or marked Unknown');
    }
    if (inv.invoiceAmount <= 0) {
      warnings.push('Invoice amount is 0 — model failed to read the total');
    }

    // 4) High-value claims always go to manual review regardless of confidence.
    //    Anything north of KES 500k should be eyeballed before payout.
    if (inv.invoiceAmount > 500_000) {
      warnings.push(`High-value claim (KES ${inv.invoiceAmount.toFixed(2)}) — manual review required`);
    }

    return warnings.length > 0 ? { ...inv, validationWarnings: warnings } : inv;
  }

  private async _extractAndParseInvoiceRaw(filePath: string, mimetype: string, modelId?: string): Promise<{
    invoices: ParsedInvoice[];
    pageCount: number;
    modelUsed?: string;
  }> {
    const chosen = modelId || process.env.VISION_DEFAULT_PROVIDER || 'claude';

    // ── Multi-claim splitting runs for ALL models including Tesseract ────────
    // Splitting (finding claim boundaries) is handled by the page pre-scan +
    // Gemini/Claude. This is separate from field extraction and must always run
    // so that merged PDFs are correctly split regardless of the chosen model.
    try {
      const multiResults = await this.visionRouter.extractMulti(chosen, filePath, mimetype);
      if (multiResults && multiResults.length > 0) {
        this.logger.log(`Multi-claim extraction returned ${multiResults.length} claim(s) via ${chosen}`);
        const realPageCount = await this.getPdfPageCount(filePath, mimetype);
        return { invoices: multiResults, pageCount: realPageCount, modelUsed: chosen };
      }
      this.logger.warn(`Multi-claim extract returned 0 results for ${chosen}`);
    } catch (err: any) {
      this.logger.warn(`Multi-claim extract failed for ${chosen}: ${err?.message || err}`);
    }

    // ── Single-claim AI extraction (non-tesseract models) ────────────────────
    if (chosen !== 'tesseract') {
      try {
        const result = await this.visionRouter.extract(chosen, filePath, mimetype, true);
        if (result) {
          return { invoices: [result], pageCount: 1, modelUsed: chosen };
        }
        this.logger.warn(`Vision router returned null for ${chosen} — falling back to Tesseract regex pipeline`);
      } catch (err: any) {
        this.logger.warn(`Vision router failed for ${chosen}: ${err?.message || err} — falling back to Tesseract`);
      }
    }

    // ── Tesseract fallback ───────────────────────────────────────────────────
    let pages: string[];
    let pageCount: number;

    if (mimetype === 'application/pdf' || filePath.endsWith('.pdf')) {
      const result = await this.extractTextFromPDF(filePath);
      pages = result.pages;
      pageCount = result.pageCount;
    } else if (mimetype?.startsWith('image/')) {
      const text = await this.extractTextFromImage(filePath);
      pages = [text];
      pageCount = 1;
    } else {
      throw new Error('Unsupported file type: ' + mimetype);
    }

    const fullText = pages.join('\n\n');
    this.logger.log(`Extracted ${fullText.length} chars from ${pageCount} pages`);

    // Step 1 — Page pre-scan: run the master classifier (same rules used by Gemini/Claude)
    // to get authoritative split boundaries even in pure Tesseract mode.
    // Controlled by OCR_USE_PAGE_HINTS env var (default: enabled).
    let pageHints: Map<number, PageHintEntry> | undefined;
    if (process.env.OCR_USE_PAGE_HINTS !== 'false' &&
        (mimetype === 'application/pdf' || filePath.endsWith('.pdf'))) {
      try {
        pageHints = await buildPageHintsMap(filePath);
        this.logger.log(`Page pre-scan: ${pageHints.size} page hints loaded for Tesseract path`);
      } catch (err: any) {
        this.logger.warn(`Page pre-scan unavailable: ${err?.message} — using regex-only classification`);
      }
    }

    // Step 2: classify pages using regex patterns, enhanced by pre-scan hints
    const categorizedPages = this.categorizePages(pages, pageHints);
    this.logger.log(`Page categories: ${categorizedPages.map(p => `pg${p.pageNumber}=${p.category}`).join(', ')}`);

    // Step 3: Group pages into claims - each invoice + its supporting docs = one claim
    const claimGroups = this.groupPagesIntoClaims(categorizedPages, pages, pageHints);
    this.logger.log(`Grouped into ${claimGroups.length} claim(s)`);

    const invoices: ParsedInvoice[] = [];

    for (const group of claimGroups) {
      // Parse invoice data from the invoice page(s) primarily
      const invoicePages = group.pages.filter(p => p.category === 'invoice');
      const invoiceText = invoicePages.length > 0
        ? invoicePages.map(p => pages[p.pageNumber - 1]).join('\n')
        : group.pages.map(p => pages[p.pageNumber - 1]).join('\n');

      // Also include all pages for full context
      const allText = group.pages.map(p => pages[p.pageNumber - 1]).join('\n');
      const parsed = this.parseInvoiceText(invoiceText);

      // If diagnosis/treatment missing from invoice, look in supporting docs
      if (!parsed.diagnosis) {
        const supportText = group.pages
          .filter(p => p.category !== 'invoice')
          .map(p => pages[p.pageNumber - 1]).join('\n');
        const supportParsed = this.parseInvoiceText(supportText);
        if (supportParsed.diagnosis) parsed.diagnosis = supportParsed.diagnosis;
        if (supportParsed.treatment) parsed.treatment = supportParsed.treatment;
        if (supportParsed.diagnosisCode && !parsed.diagnosisCode) parsed.diagnosisCode = supportParsed.diagnosisCode;
      }

      const pageNums = group.pages.map(p => p.pageNumber);
      const pageRange = pageNums.length === 1
        ? `${pageNums[0]}`
        : `${Math.min(...pageNums)}-${Math.max(...pageNums)}`;

      invoices.push({
        ...parsed,
        rawText: allText.substring(0, 1500),
        pageRange,
        documentPages: group.pages,
      });
    }

    if (invoices.length === 0) {
      const parsed = this.parseInvoiceText(fullText);
      invoices.push({
        ...parsed,
        rawText: fullText.substring(0, 1500),
        pageRange: `1-${pageCount}`,
        documentPages: categorizedPages,
      });
    }

    return { invoices, pageCount, modelUsed: 'tesseract' };
  }

  /**
   * Classify each page using regex patterns, optionally enhanced by pre-scan hints.
   *
   * When hints are present (OCR_USE_PAGE_HINTS=true, the default), the pre-scan
   * result takes precedence over the regex patterns for boundary and supporting-doc
   * detection.  The regex path remains fully active as a fallback when hints are
   * absent or inconclusive (e.g. OCR_USE_PAGE_HINTS=false).
   */
  private categorizePages(pages: string[], hints?: Map<number, PageHintEntry>): DocumentPage[] {
    return pages.map((text, i) => {
      const pageNum = i + 1;
      const hint = hints?.get(pageNum);
      const t = text.toLowerCase();
      let category: DocumentPage['category'] = 'unknown';
      let categoryLabel = 'Unknown Document';
      let confidence = 0.5;
      let summary = '';

      // ── Hint-first overrides (authoritative pre-scan) ────────────────────────
      // MCF is checked BEFORE isBoundary: an MCF page is never a split boundary —
      // it always belongs with the preceding invoice as a supporting document.
      if (hint?.isMcf) {
        category = 'claim_form'; categoryLabel = 'Claim Form'; confidence = 0.95;
        summary = 'Medical Claim Form (pre-scan)';
        return { pageNumber: pageNum, category, categoryLabel, confidence, summary };
      }
      if (hint?.isBoundary) {
        // Pre-scan identified this as a new claim invoice start
        category = 'invoice'; categoryLabel = 'Invoice'; confidence = 0.97;
        summary = hint.invoiceNum ? `Invoice ${hint.invoiceNum.toUpperCase()} (pre-scan)` : `Invoice — ${hint.providerHint || 'provider'} (pre-scan)`;
        return { pageNumber: pageNum, category, categoryLabel, confidence, summary };
      }
      if (hint?.isSupporting) {
        // Use a specific category based on what the pre-scan detected
        if (/DISCHARGE SUMMARY/i.test(hint.rawType)) {
          category = 'discharge_summary'; categoryLabel = 'Discharge Summary'; confidence = 0.92;
          summary = 'Discharge Summary (pre-scan)';
        } else if (/LAB RESULTS/i.test(hint.rawType)) {
          category = 'lab_result'; categoryLabel = 'Lab Results'; confidence = 0.92;
          summary = 'Lab Results (pre-scan)';
        } else if (/AUTHORIZATION LETTER/i.test(hint.rawType)) {
          category = 'pre_auth'; categoryLabel = 'Authorization Letter'; confidence = 0.90;
          summary = 'Authorization Letter (pre-scan)';
        } else {
          category = 'supporting'; categoryLabel = 'Supporting Document'; confidence = 0.85;
          summary = 'Supporting Document (pre-scan)';
        }
        return { pageNumber: pageNum, category, categoryLabel, confidence, summary };
      }
      // ── End hint overrides ────────────────────────────────────────────────────

      // MCF check BEFORE invoice regex — MCF pages contain procedure amounts and
      // consultation line items that would otherwise trigger the invoice pattern.
      if (/medical\s*claim\s*form/i.test(text) && /(?:declaration|signature|consent|member|patient)/i.test(text)) {
        category = 'claim_form';
        categoryLabel = 'Claim Form';
        confidence = 0.92;
        summary = 'Medical claim form / declaration';
        return { pageNumber: pageNum, category, categoryLabel, confidence, summary };
      }

      // Invoice detection — broad pattern to catch scanned invoices with partial OCR text
      if (
        (/invoice\s*(?:no|number|date)/i.test(text) && /(?:amount|total|balance|due)/i.test(text)) ||
        (/\b(?:invoice|receipt|bill)\b/i.test(text) && /(?:balance\s*due|total\s*amount|ksh|kes)\s*[\d,]/i.test(text)) ||
        (/(?:consultation|procedure|treatment|tooth|drug|medication)\b/i.test(text) && /(?:\d{1,3},\d{3}|\d+\.\d{2})/i.test(text) && /(?:amount|total|rate|price)/i.test(text)) ||
        // Aga Khan / hospital inpatient invoice.
        // Primary: "Invoice #" + bed/theatre charges or AK Number
        // Fallback: "Account Number: UH..." (unique to AKH, works even when Invoice # is garbled by OCR)
        (/Invoice\s+[#*]\s+[A-Z0-9]/i.test(text) && (/bed\s*charge|charge\s*category|theatre\s*charge|ward.*wing|inpatient/i.test(text) || /AK\s+Number/i.test(text))) ||
        (/Account\s+Number[:\s]+UH[\w_]{4,}/i.test(text) && (/bed\s*charge|charge\s*category|theatre\s*charge|ward.*wing|inpatient|AK\s+Number/i.test(text))) ||
        // Detailed invoice header (Zion format): "DETAILED INVOICE" + amounts
        (/DETAILED\s+INVOICE/i.test(text) && /(?:\d{1,3},\d{3}|\d+\.\d{2})/i.test(text))
      ) {
        category = 'invoice';
        categoryLabel = 'Invoice';
        confidence = 0.95;
        const invNo = text.match(/Invoice\s*(?:No|Number)?\s*[:\-.]?\s*([A-Z0-9][\w\-/.]{2,20})/i);
        summary = invNo ? `Invoice ${invNo[1]}` : 'Invoice document';
      }
      // Claim form
      else if (/claim\s*form|medical\s*claim/i.test(text) && /(?:declaration|signature|consent|member|patient)/i.test(text)) {
        category = 'claim_form';
        categoryLabel = 'Claim Form';
        confidence = 0.90;
        summary = 'Medical claim form / declaration';
      }
      // Prescription
      else if (/prescription|rx|dosage|medication|tablets?|capsules?|syrup/i.test(text) && !/invoice/i.test(text)) {
        category = 'prescription';
        categoryLabel = 'Prescription';
        confidence = 0.85;
        summary = 'Prescription / medication record';
      }
      // Lab results
      else if (/lab\s*(?:results?|report)|laboratory|specimen|blood\s*test|urinalysis|culture/i.test(text)) {
        category = 'lab_result';
        categoryLabel = 'Lab Results';
        confidence = 0.85;
        summary = 'Laboratory test results';
      }
      // Medical report / clinical notes
      else if (/(?:medical|clinical|doctor'?s?)\s*(?:report|notes?|summary)|examination|findings|history/i.test(text) && /(?:diagnosis|complaint|impression)/i.test(text)) {
        category = 'medical_report';
        categoryLabel = 'Medical Report';
        confidence = 0.85;
        summary = 'Clinical notes / medical report';
      }
      // Discharge summary
      else if (/discharge\s*(?:summary|report|note)|discharged|admission/i.test(text)) {
        category = 'discharge_summary';
        categoryLabel = 'Discharge Summary';
        confidence = 0.85;
        summary = 'Discharge summary';
      }
      // Referral
      else if (/referral|refer\s*(?:to|for)|specialist\s*consultation/i.test(text)) {
        category = 'referral';
        categoryLabel = 'Referral Letter';
        confidence = 0.80;
        summary = 'Referral letter';
      }
      // Pre-authorization
      else if (/pre[\-\s]*auth|authorization|pre[\-\s]*approval/i.test(text)) {
        category = 'pre_auth';
        categoryLabel = 'Pre-Authorization';
        confidence = 0.85;
        summary = 'Pre-authorization form';
      }
      // Supporting document (has patient/medical info but not an invoice)
      else if (/(?:patient|member|name|hospital|clinic|medical)/i.test(text) && text.length > 50) {
        category = 'supporting';
        categoryLabel = 'Supporting Document';
        confidence = 0.70;
        summary = 'Supporting medical document';
      }

      return {
        pageNumber: i + 1,
        category,
        categoryLabel,
        confidence,
        summary,
      };
    });
  }

  /**
   * Extract a membership/policy number from page OCR text.
   * Returns a normalised lowercase key, or '' if nothing found.
   */
  private extractMembershipFromText(text: string): string {
    const patterns = [
      /\b(AK\d{4,}(?:-\d{2,})?)\b/,                                               // AK119067-04 (Aga Khan)
      /\b(KE\d{4,}-\d{2,})\b/,                                                     // KE39665-03 (CIC)
      /HMN\s*\.?\s*NO\.?\s*[:\-.]?\s*([A-Z0-9][\w\-/.]{2,20})/i,
      /AK\s*Number\s*[:\-.]?[\s\S]{0,200}?\b(AK[\d\-]{4,20})\b/i,
      /(?:Membership|Member)\s+(?:No|Number|#|ID)\s*[:\-.]?\s*([A-Z0-9][\w\-/.]{2,20})/i,
      /(?:Policy|Scheme|Card|Insurance)\s*(?:No|Number|#)?\s*[:\-.]?\s*([A-Z0-9][\w\-/.]{2,20})/i,
    ];
    for (const pat of patterns) {
      const m = text.match(pat);
      const val = (m?.[1] || m?.[2] || '').trim();
      if (val.length > 3) return val.toLowerCase().replace(/\s+/g, '');
    }
    return '';
  }

  /**
   * Group pages into individual claims.
   *
   * Strategy — applied in order, first match wins:
   * 0. Extract a membership/policy number from every page. A membership change
   *    is the strongest boundary signal — each member's packet stays together.
   * 1. Extract a provider/clinic name from every page. A provider-name change
   *    between consecutive pages signals a new claim (unless same membership).
   * 2. Extract an invoice number from every page. A new invoice number that
   *    hasn't been seen before starts a new claim.
   * 3. Fall back to category-based invoice detection (page marked 'invoice'
   *    after a non-invoice run resets the group).
   *
   * Continuation pages ("Page 3 of 9") suppress Signals 1-3 so that multi-page
   * inpatient invoices (e.g. Aga Khan 9-page) stay in one group.
   */
  private groupPagesIntoClaims(
    categorizedPages: DocumentPage[],
    pageTexts: string[],
    hints?: Map<number, PageHintEntry>,
  ): Array<{ pages: DocumentPage[] }> {
    if (categorizedPages.length <= 1) return [{ pages: categorizedPages }];

    // ── Helpers ──────────────────────────────────────────────────────────────

    const GENERIC_TITLES = /^(medical\s*claim\s*form|claim\s*form|insurance\s*claim|declaration|patient\s*information|clinical\s*information|hospital\s*road|p\.?\s*o\.?\s*box|please\s*fill)/i;

    const extractProvider = (text: string): string => {
      const top = text.substring(0, 600);
      const namedBlock = top.match(
        /^([A-Z][A-Za-z\s&().'-]{3,50}(?:HOSPITAL|CLINIC|CENTRE|CENTER|DISPENSARY|PHARMACY|LABORATORY)(?:[A-Za-z\s,&()-]{0,30})?)/m
      );
      if (namedBlock) {
        const candidate = namedBlock[1].trim().toLowerCase().replace(/\s+/g, ' ');
        if (!GENERIC_TITLES.test(candidate) && candidate.length > 5) return candidate.substring(0, 50);
      }
      const theBlock = top.match(/\bTHE\s+([A-Z][A-Za-z\s&().'-]{5,60}(?:HOSPITAL|UNIVERSITY|CLINIC|CENTRE))/i);
      if (theBlock) {
        const candidate = theBlock[0].trim().toLowerCase().replace(/\s+/g, ' ');
        if (!GENERIC_TITLES.test(candidate)) return candidate.substring(0, 50);
      }
      return '';
    };

    // Words that are never valid invoice numbers (OCR label noise).
    const INV_NOISE = new Set([
      'and','or','the','for','not','date','no','number','amount','total','balance','due',
      'patient','name','member','account','service','company','invoice','receipt','bill',
      'form','claim','medical','aar','kes','ksh','kenya','limited','hospital','batuk',
      'uploaded','registration','summary','plan','that','this','with','from','into',
      'upon','gross','rate','qty','description','location','provider',
    ]);

    const extractInvoiceNum = (text: string): string => {
      // Require explicit separator (No/Number/#/Ref) — bare "Invoice" followed by
      // arbitrary text is NOT a match. Value must contain at least one digit.
      const m = text.match(
        /Invoice\s+(?:No|Number|#|Ref\.?)\s*[:\-.]?\s*([A-Z0-9][\w\-/.]{3,25})/i
      ) || text.match(
        /Receipt\s+(?:No|Number|#)\s*[:\-.]?\s*([A-Z0-9][\w\-/.]{3,25})/i
      ) || text.match(
        // AKH-specific: "Account Number: UH..." is always the invoice number
        /Account\s+Number[:\s]+(UH[\w_]{4,})/i
      );
      if (!m?.[1]) return '';
      const val = m[1].trim().toLowerCase().replace(/\s+/g, '');
      // Must contain at least one digit to be a real invoice number
      if (!/\d/.test(val)) return '';
      if (INV_NOISE.has(val)) return '';
      return val;
    };

    // Detect "Page X of Y" in the first 300 chars — these are continuation pages.
    // When pre-scan hints are available they are authoritative (they handle garbled
    // page markers like "page6ofg" that the regex alone would miss).
    const isContinuationPage = (text: string, pageNum: number): boolean => {
      if (hints?.get(pageNum)?.isContinuation) return true;
      return /\bPage\s+[2-9]\d*\s+of\s+\d+\b/i.test(text.substring(0, 300));
    };

    const features = categorizedPages.map(p => {
      const text = pageTexts[p.pageNumber - 1] ?? '';
      const hint = hints?.get(p.pageNumber);
      // If hint knows the invoice number, prefer it (avoids garbage extractions on garbled OCR)
      const hintInvNum = hint?.invoiceNum || '';
      const regexInvNum = extractInvoiceNum(text);
      return {
        page: p,
        provider: extractProvider(text),
        invoiceNum: hintInvNum || regexInvNum,
        membership: this.extractMembershipFromText(text),
        isContinuation: isContinuationPage(text, p.pageNumber),
        isBoundary: hint?.isBoundary ?? false,
      };
    });

    this.logger.log(
      `Page features: ${features.map(f =>
        `pg${f.page.pageNumber}[cat=${f.page.category},mem="${f.membership}",prov="${f.provider.slice(0, 15)}",inv="${f.invoiceNum}",cont=${f.isContinuation}]`
      ).join(' | ')}`
    );

    // ── Grouping logic ───────────────────────────────────────────────────────

    const groups: Array<{ pages: DocumentPage[] }> = [];
    let currentGroup: DocumentPage[] = [categorizedPages[0]];
    let currentProvider = features[0].provider;
    let currentInvoiceNum = features[0].invoiceNum;
    let currentMembership = features[0].membership;
    const seenInvoiceNums = new Set<string>(currentInvoiceNum ? [currentInvoiceNum] : []);

    for (let i = 1; i < features.length; i++) {
      const f = features[i];
      let startNewGroup = false;
      let reason = '';

      // Continuation pages (Page 3 of 9) stay with the current group always
      if (f.isContinuation) {
        currentGroup.push(f.page);
        if (f.membership && !currentMembership) currentMembership = f.membership;
        continue;
      }

      // Non-invoice pages (claim forms, membership forms, supporting docs, lab results, etc.)
      // ALWAYS belong to the preceding invoice — never start a new group
      const SUPPORTING_CATEGORIES: DocumentPage['category'][] = [
        'claim_form', 'supporting', 'prescription', 'lab_result',
        'medical_report', 'discharge_summary', 'referral', 'pre_auth', 'unknown',
      ];
      if (SUPPORTING_CATEGORIES.includes(f.page.category)) {
        currentGroup.push(f.page);
        if (f.membership && !currentMembership) currentMembership = f.membership;
        continue;
      }

      // From here on we are on an invoice page — apply split signals

      // Signal 0 (PRE-SCAN, strongest): the master classifier explicitly flagged this
      // page as a new claim boundary.  This fires even when provider and invoice number
      // look the same (e.g. same hospital, garbled invoice# on both pages).
      if (f.isBoundary && currentGroup.some(p => p.category === 'invoice')) {
        startNewGroup = true;
        reason = `pre-scan boundary (${hints?.get(f.page.pageNumber)?.rawType?.substring(0, 60) ?? 'hint'})`;
      }

      // Signal 1 (PRIMARY): provider name changed — strongest regex boundary signal
      if (!startNewGroup && f.provider && currentProvider && f.provider !== currentProvider) {
        startNewGroup = true;
        reason = `provider changed "${currentProvider}" → "${f.provider}"`;
      }

      // Signal 2: same provider but a new unique invoice number appeared
      if (!startNewGroup && f.invoiceNum && !seenInvoiceNums.has(f.invoiceNum) && currentInvoiceNum) {
        startNewGroup = true;
        reason = `new invoice# "${f.invoiceNum}" (same provider)`;
      }

      // Signal 3 (content check): invoice page follows another invoice — but only split
      // if this page is NOT a continuation of the same invoice. A page with no invoice
      // number (page 2 of a multi-page invoice that doesn't repeat the header) stays
      // in the current group; only a page with a new or absent-but-provider-headed
      // invoice number triggers a split.
      if (!startNewGroup && currentGroup.some(p => p.category === 'invoice')) {
        const sameInvoice = f.invoiceNum && seenInvoiceNums.has(f.invoiceNum);
        if (!sameInvoice) {
          startNewGroup = true;
          reason = `content check: new invoice page (inv="${f.invoiceNum || 'unknown'}") after existing invoice`;
        }
      }

      if (startNewGroup) {
        this.logger.log(`Split at pg${f.page.pageNumber}: ${reason}`);
        groups.push({ pages: currentGroup });
        currentGroup = [];
        currentProvider = f.provider || currentProvider;
        currentInvoiceNum = f.invoiceNum;
        currentMembership = f.membership || currentMembership;
        seenInvoiceNums.clear();
      }

      currentGroup.push(f.page);
      if (f.provider) currentProvider = f.provider;
      if (f.membership) currentMembership = f.membership;
      if (f.invoiceNum) {
        currentInvoiceNum = f.invoiceNum;
        seenInvoiceNums.add(f.invoiceNum);
      }
    }

    if (currentGroup.length > 0) groups.push({ pages: currentGroup });
    this.logger.log(`Split into ${groups.length} claim(s)`);
    return groups;
  }

  private async getPdfPageCount(filePath: string, mimetype: string): Promise<number> {
    if (mimetype !== 'application/pdf' && !filePath.endsWith('.pdf')) return 1;
    try {
      const pdfParse = await import('pdf-parse');
      const data = await (pdfParse.default || pdfParse)(fs.readFileSync(filePath));
      return data.numpages || 1;
    } catch {
      return 1;
    }
  }

  private splitAtInvoiceBoundaries(
    categorizedPages: DocumentPage[]
  ): Array<{ pages: DocumentPage[] }> {
    const groups: Array<{ pages: DocumentPage[] }> = [];
    let currentGroup: DocumentPage[] = [];
    const hasInvoice = (g: DocumentPage[]) => g.some(p => p.category === 'invoice');

    for (const page of categorizedPages) {
      if (page.category === 'invoice' && hasInvoice(currentGroup)) {
        // New invoice page and current group already has one → flush
        groups.push({ pages: currentGroup });
        currentGroup = [];
      }
      currentGroup.push(page);
    }
    if (currentGroup.length > 0) groups.push({ pages: currentGroup });
    return groups.length > 0 ? groups : [{ pages: categorizedPages }];
  }

  /**
   * Parse OCR text to extract structured invoice fields
   */
  /**
   * Parse invoice text using the knowledge base patterns.
   * Tries each pattern from the knowledge base until a match is found.
   */
  private parseInvoiceText(text: string): Omit<ParsedInvoice, 'rawText' | 'pageRange' | 'documentPages'> {
    const t = text.replace(/[ \t]+/g, ' ');
    const headerText = text.substring(0, 600);
    const result: Record<string, any> = {};

    // Helper: try patterns, return first match group 1
    const tryPatterns = (patterns: RegExp[], source: string): string | null => {
      for (const pat of patterns) {
        const m = source.match(pat);
        if (m && m[1]?.trim().length > 1) return m[1].trim();
      }
      return null;
    };

    // PROVIDER - search header only
    for (const pat of PROVIDER_PATTERNS) {
      const m = headerText.match(pat);
      if (m) {
        let name = m[1].trim().replace(/\s+/g, ' ');
        name = name.replace(/^(?:Description|Quantit|Total|TOTAL|Sub)\s+/i, '');
        if (name.length > 5 && !/^Description|^Quantit|^TOTAL/i.test(name)) {
          result.providerName = name;
          break;
        }
      }
    }

    // Words that are OCR label noise — never valid as a field value
    const NOISE_WORDS = /^(Date|Name|Gender|Male|Female|Age|No|Number|None|Nil|N\/A|Unknown|Patient|Invoice|Reg|Account|Total|Amount|Due|Balance|Gross|Rate|Qty|Description)$/i;

    // Pre-process text for amount extraction: fix OCR digit substitutions and line-split numbers.
    // e.g. "5oo, ooo. \noo" → "500,000.00" (Aga Khan sponsor coverage OCR noise)
    const normaliseAmounts = (s: string): string => {
      // Step 1: join number-like fragments split across lines (allow optional '.' before newline for decimals)
      let r = s.replace(/([\doO,. ]*[\doO]+\.?)\s*\n\s*([\doO,. ]*[\doO]+)/g, '$1$2');
      // Step 2: in any sequence containing a real digit, replace 'o'/'O' with '0' and collapse spaces
      r = r.replace(/[\doO,.\s]{3,}/g, m =>
        /\d/.test(m) && m.length < 25
          ? m.replace(/[oO]/g, '0')
              .replace(/(\d)\s+(\d)/g, '$1$2')   // "000 00" → "00000"
              .replace(/(\d),\s+(\d)/g, '$1,$2') // "500, 000" → "500,000"
              .replace(/(\d)\s+\./g, '$1.')       // "000 .00" → "000.00"
          : m
      );
      return r;
    };
    const tAmounts = normaliseAmounts(t);

    // PATIENT NAME
    for (const pat of PATIENT_NAME_PATTERNS) {
      const m = t.match(pat);
      if (m && m[1]?.trim().length > 3) {
        let name = m[1].trim().replace(/\s{2,}/g, ' ');
        // Strip trailing medical section headers and label words
        name = name.replace(/\s+(?:Additional|Discharge|Summary|Billing|Entitlement|Auth|Admission|Ward|Surgeon|Consultant|Diagnosis|ICD|Procedure|Treatment|Patient|Invoice|Reg|Date|No|Account|Age|Sex|Gender|Visit|Hospital|Male|Female|Mr|Mrs|Ms|Dr|Class|Printed|Signed).*$/i, '').trim();
        // Reject if what's left is just noise or a single character
        // Convert Aga Khan "LAST,FIRST" format → "First Last"
        if (/^[A-Z]{2,},\s*[A-Z]{2,}/.test(name)) {
          const parts = name.split(',').map(s => s.trim().toLowerCase().replace(/\b\w/g, c => c.toUpperCase()));
          name = `${parts[1]} ${parts[0]}`.trim();
        }
        if (name.length > 3 && !NOISE_WORDS.test(name)) { result.patientName = name; break; }
      }
    }

    // PATIENT ID
    const rawPatientId = tryPatterns(PATIENT_ID_PATTERNS, t) || '';
    if (rawPatientId && !NOISE_WORDS.test(rawPatientId)) {
      result.patientId = rawPatientId;
    }

    // MEMBERSHIP
    const mem = tryPatterns(MEMBERSHIP_PATTERNS, t);
    if (mem && mem.length > 2 && !NOISE_WORDS.test(mem) && !/^(Name|No|Number)$/i.test(mem)) {
      // Normalise OCR 'o'/'O' noise in alphanumeric codes (e.g. AKo0565303 → AK00565303)
      result.membershipNumber = mem
        .replace(/([A-Z]+)[oO](\d)/g, '$10$2')
        .replace(/(\d)[oO](\d)/g, '$10$2');
    }

    // INVOICE NUMBER - try all known formats
    result.invoiceNumber = tryPatterns(INVOICE_NUMBER_PATTERNS, t) || '';

    // INVOICE DATE - try all known formats
    result.invoiceDate = tryPatterns(INVOICE_DATE_PATTERNS, t) || '';

    // AMOUNTS - collect ALL pattern matches from normalised text, take the largest
    // (invoice total > sub-totals > co-pays — max wins)
    const allAmounts: number[] = [];
    for (const pat of TOTAL_AMOUNT_PATTERNS) {
      const m = tAmounts.match(pat);
      if (m) {
        const v = parseFloat(m[1].replace(/,/g, ''));
        if (v > 0 && v < 100000000) allAmounts.push(v);
      }
    }
    if (allAmounts.length > 0) result.invoiceAmount = Math.max(...allAmounts);
    // Sum line items if no total found
    if (!result.invoiceAmount) {
      for (const pat of LINE_ITEM_PATTERNS) {
        const items = [...t.matchAll(pat)];
        if (items.length > 0) {
          const sum = items.reduce((s, m) => {
            const v = parseFloat(m[1].replace(/,/g, ''));
            return s + (v > 0 && v < 10000000 ? v : 0);
          }, 0);
          if (sum > 0) { result.invoiceAmount = sum; break; }
        }
      }
    }
    // Fallback: KES amounts
    if (!result.invoiceAmount) {
      const ksh = [...t.matchAll(/(?:KES|Ksh|Kshs?)\s*([\d,]+(?:\.\d{1,2})?)/gi)];
      const vals = ksh.map(m => parseFloat(m[1].replace(/,/g, ''))).filter(n => n > 0);
      if (vals.length > 0) result.invoiceAmount = Math.max(...vals);
    }
    // Last resort: largest decimal number
    if (!result.invoiceAmount) {
      const nums = [...t.matchAll(/([\d,]{3,}\.\d{2})/g)];
      const vals = nums.map(m => parseFloat(m[1].replace(/,/g, ''))).filter(n => n >= 50);
      if (vals.length > 0) result.invoiceAmount = Math.max(...vals);
    }

    // DIAGNOSIS
    // Reject captures that are themselves diagnosis sub-headers ("Discharge
    // Diagnosis", "Final Diagnosis", etc.). The regex sub-header skip in
    // invoice-patterns.ts handles most cases, but when the IP layout has a
    // blank line after the sub-header the regex still falls back to
    // capturing the header itself. This guard makes that capture lose so
    // the next pattern (or the ICD-only fallback) wins.
    const LABEL_ONLY = /^(?:Discharge|Final|Provisional|Working|Admission|Primary|Secondary|Clinical|Differential)\s+Diagnosis\s*[:\-]?\s*$/i;
    for (const pat of DIAGNOSIS_PATTERNS) {
      const m = t.match(pat);
      if (m) {
        let d = (m[1] || m[0] || '').trim().replace(/\s+/g, ' ').replace(/^[\s\-:]+/, '');
        d = d.replace(/ICD\s*Code.*$/i, '').replace(/Detailed\s*Invoice.*$/i, '').trim();
        if (d.length > 2 && !/^ICD\s/i.test(d) && !LABEL_ONLY.test(d)) { result.diagnosis = d; break; }
      }
    }

    // ICD CODE
    const icdM = t.match(/([A-TV-Z]\d{2}(?:\.\d{1,4})?)/g);
    if (icdM) {
      // Filter out codes that are clearly not ICD (like C20 from barcode C20240...)
      const valid = icdM.filter(c => /^[A-TV-Z]\d{2}/.test(c) && !t.includes('C' + c.substring(1) + '0'));
      if (valid.length > 0) result.diagnosisCode = valid[0];
    }

    // SERVICE DATE
    result.serviceDate = tryPatterns(SERVICE_DATE_PATTERNS, t) || '';
    if (result.serviceDate) {
      result.serviceDate = result.serviceDate.replace(/\s+\d{2}:\d{2}.*$/, '').trim();
    }

    // INSURANCE
    for (const pat of INSURANCE_PATTERNS) {
      const m = t.match(pat);
      if (m) {
        let ins = m[1].trim();
        ins = ins.replace(/\s+(?:Referral|Service|Lab|Radiology|Pharmacy|Consultation)\s+Amount.*$/i, '').trim();
        if (ins.length > 3) { result.insuranceCompany = ins; break; }
      }
    }

    // ACCOUNT
    for (const pat of ACCOUNT_PATTERNS) {
      const m = t.match(pat);
      if (m) {
        let acc = m[1].trim();
        const dashIdx = acc.indexOf('-');
        if (dashIdx > 5) acc = acc.substring(0, dashIdx).trim();
        acc = acc.replace(/\s+(?:Lab|Radiology|Pharmacy|Consultation|Service)\s+Amount.*$/i, '').trim();
        if (acc.length > 3) { result.accountName = acc; break; }
      }
    }

    // MEDICAL CODES: CPT, ICD-10, HCPCS
    const medicalCodes = extractMedicalCodes(t);

    // CONFIDENCE - weighted scoring
    const critical = [
      { val: result.patientName, weight: 25 },
      { val: result.providerName, weight: 20 },
      { val: result.invoiceAmount, weight: 25 },
      { val: result.invoiceNumber, weight: 15 },
      { val: result.invoiceDate, weight: 10 },
    ];
    const bonus = [
      { val: result.patientId, weight: 3 },
      { val: result.membershipNumber, weight: 3 },
      { val: result.diagnosis, weight: 2 },
      { val: result.diagnosisCode, weight: 2 },
    ];
    const criticalScore = critical.reduce((s, f) => s + (f.val ? f.weight : 0), 0);
    const bonusScore = bonus.reduce((s, f) => s + (f.val ? f.weight : 0), 0);
    const maxCritical = critical.reduce((s, f) => s + f.weight, 0);
    result.confidence = Math.min(0.99, (criticalScore / maxCritical) * 0.90 + (bonusScore / 100) * 0.10);

    // Use ICD-10 from medical codes if no diagnosis code found yet
    const finalDiagnosisCode = result.diagnosisCode || medicalCodes.icd10Codes[0] || '';
    // Prefer CPT codes from dedicated extraction; fall back to generic procedureCode
    const finalProcedureCode = medicalCodes.cptCodes[0] || (finalDiagnosisCode ? '99214' : '');

    // If no free-text diagnosis was extracted but we have an ICD-10 code, expand it to a
    // human-readable label (e.g. E39 → "Urinary disorder") so the claim card is not blank.
    const finalDiagnosis = result.diagnosis || (finalDiagnosisCode ? icd10Label(finalDiagnosisCode) : '');

    return {
      patientName: result.patientName || 'Unknown Patient',
      patientId: result.patientId || '',
      providerName: result.providerName || 'Unknown Provider',
      membershipNumber: result.membershipNumber || '',
      invoiceNumber: result.invoiceNumber || '',
      invoiceDate: result.invoiceDate || '',
      invoiceAmount: result.invoiceAmount || 0,
      serviceDate: result.serviceDate || result.invoiceDate || '',
      diagnosis: finalDiagnosis,
      diagnosisCode: finalDiagnosisCode,
      procedureCode: finalProcedureCode,
      cptCodes: medicalCodes.cptCodes,
      icd10Codes: medicalCodes.icd10Codes,
      hcpcsCodes: medicalCodes.hcpcsCodes,
      allMedicalCodes: medicalCodes.allCodes,
      treatment: finalDiagnosis,
      insuranceCompany: result.insuranceCompany || '',
      accountName: result.accountName || '',
      confidence: result.confidence,
    };
  }
}
