import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';
import { ParsedInvoice } from './ocr.service';
import { buildPageContextHints } from './gemini-vision.service';

const SYSTEM_PROMPT = `You are a precise medical-invoice data extractor for CIC Insurance Group (Kenya).

DOCUMENT CONTEXT — Kenyan medical claims:
• Insurers on documents: CIC Insurance, Jubilee Insurance, AAR Insurance, NHIF, Britam, Resolution Insurance, APA Insurance, Minet, UAP Insurance
• Hospitals/clinics: Aga Khan University Hospital, Nairobi Hospital, MP Shah Hospital, Kenyatta National Hospital (KNH), Mater Hospital, Karen Hospital, Gertrude's Children's Hospital, Avenue Healthcare, Metropol Medical Centre, Coptic Hospital, Kikuyu Eye Unit, Nairobi Women's Hospital, Tenwek Hospital
• Currency: Kenyan Shillings — written as KSh, KES, Kshs, or K.Sh. Always return numeric value only (no symbol).
• Membership/policy numbers: CIC member IDs (numeric), NHIF numbers (10 digits), Aga Khan AK-numbers (e.g. AK00565303), employer scheme codes (alphanumeric)
• Invoice numbers: may appear as Nyr/XXXXX, INV-XXXXX, REC-XXXXX, or plain numeric
• Dates: source may show DD/MM/YYYY, DD-Mon-YYYY, or DD.MM.YYYY — convert to YYYY-MM-DD

HANDWRITING: Many fields on claim/membership forms are filled in by hand. Read all handwritten text carefully — patient names, membership numbers, diagnoses, dates, employer names, and signature areas may all be handwritten.

EXTRACTION RULES:
1. Copy values EXACTLY as they appear — no paraphrasing, no guessing, no hallucinating
2. Patient name: search the ENTIRE document — check header, "Patient Name:", "Member:", "Insured:", "Name of Patient:", "Patient's Name:", claim-form fields, and any authorization/signature block. Handwritten names are valid.
3. Patient ID (National ID / patient registration number): search for labels "National ID:", "National ID No.:", "ID No.:", "ID Number:", "Patient ID:", "Pat. ID:", "Reg. No.:", "Registration No.:", "File No.:", "Patient No.", "Passport No." — on Aga Khan forms look near "Patient Address" block or top-right header area. Return ONLY the number, not the label. If the document only shows an AK-number or policy number, leave patientId empty — do NOT duplicate the membership number here.
4. If a field is genuinely absent, return empty string or 0 — NEVER invent or approximate a value
5. Invoice amount: use the TOTAL / GRAND TOTAL / AMOUNT DUE line, not line-item subtotals
6. Diagnosis: look for ICD-10 codes (e.g. E39, J06.9, A09), "Diagnosis:", "Presenting Complaint:", "Assessment:", "Clinical Notes:" — including handwritten entries`;

const EXTRACT_TOOL: Anthropic.Tool = {
  name: 'record_invoice_fields',
  description: 'Record the extracted fields from the medical invoice / claim document.',
  input_schema: {
    type: 'object',
    properties: {
      patientName:      { type: 'string', description: 'Full name of the patient / member' },
      patientId:        { type: 'string', description: 'Patient National ID, Passport number, or hospital registration/file number. Look for labels: "National ID:", "ID No.", "Reg. No.", "File No.", "Patient No.". Do NOT put AK-numbers or insurance policy numbers here.' },
      membershipNumber: { type: 'string', description: 'Insurance membership number, AK number (e.g. AK00565303), NHIF number, or policy number' },
      providerName:     { type: 'string', description: 'Name of the hospital, clinic, or medical provider' },
      invoiceNumber:    { type: 'string', description: 'Invoice or receipt number' },
      invoiceDate:      { type: 'string', description: 'Invoice date as YYYY-MM-DD' },
      invoiceAmount:    { type: 'number', description: 'Total amount on the invoice, as a number (no currency symbol)' },
      serviceDate:      { type: 'string', description: 'Date service was rendered as YYYY-MM-DD (if different from invoice date)' },
      diagnosis:        { type: 'string', description: 'Primary diagnosis text' },
      diagnosisCode:    { type: 'string', description: 'ICD-10 code (e.g. A09, J06.9)' },
      procedureCode:    { type: 'string', description: 'CPT / HCPCS procedure code if present' },
      treatment:        { type: 'string', description: 'Treatment / procedure description' },
      insuranceCompany: { type: 'string', description: 'Insurance company name' },
      accountName:      { type: 'string', description: 'Employer / account / scheme name if shown' },
      lineItems: {
        type: 'array',
        description: 'Every billed line item visible in the invoice table. Extract ALL rows from the billing table.',
        items: {
          type: 'object',
          properties: {
            description:   { type: 'string', description: 'Service or item description exactly as printed' },
            quantity:      { type: 'number', description: 'Quantity or units billed (1 if not shown)' },
            unitPrice:     { type: 'number', description: 'Unit price / rate per item (KES numeric)' },
            totalPrice:    { type: 'number', description: 'Line total = quantity × unit price (KES numeric)' },
            taxAmount:     { type: 'number', description: 'VAT or tax on this line item if shown' },
            discount:      { type: 'number', description: 'Discount applied to this line if shown' },
            procedureCode: { type: 'string', description: 'CPT / ICD / procedure code for this line if printed' },
            serviceDate:   { type: 'string', description: 'Date this specific service was rendered YYYY-MM-DD' },
            confidence:    { type: 'number', description: 'Confidence 0.0-1.0 for this line item extraction' },
          },
          required: ['description', 'totalPrice'],
        },
      },
      confidence:       { type: 'number', description: 'Your confidence 0.0-1.0 that the extraction above is correct and complete' },
    },
    required: ['patientName', 'providerName', 'invoiceAmount', 'confidence'],
  },
};

// ── Multi-claim extraction ────────────────────────────────────────────────────
// Sends the whole PDF once and asks Claude to identify ALL claim packets in it.
// Each claim packet = one MCF (Medical Claim Form) paired with its invoice(s)
// and any attached supporting documents.

const MULTI_EXTRACT_TOOL: Anthropic.Tool = {
  name: 'record_all_claims',
  description: 'Record ALL distinct insurance claim packets found in this document. Each claim packet is anchored by either a Medical Claim Form OR an invoice with a unique invoice number. One entry per claim/invoice.',
  input_schema: {
    type: 'object' as const,
    properties: {
      claims: {
        type: 'array',
        description: 'One entry per distinct claim packet in the document',
        items: {
          type: 'object',
          properties: {
            pageRange:        { type: 'string',  description: 'Page range for this entire claim packet (all pages including MCF, invoice, and supporting docs), e.g. "1-2" or "15-26". Required — no overlaps.' },
            membershipNumber: { type: 'string',  description: 'Insurance membership / AK / policy number' },
            patientName:      { type: 'string' },
            patientId:        { type: 'string',  description: 'Patient National ID, Passport, or hospital registration/file number. Do NOT put AK/policy numbers here.' },
            providerName:     { type: 'string',  description: 'Hospital or clinic name from the invoice letterhead' },
            invoiceNumber:    { type: 'string',  description: 'Invoice number from the invoice page (not the MCF claim number)' },
            invoiceDate:      { type: 'string',  description: 'YYYY-MM-DD' },
            invoiceAmount:    { type: 'number',  description: 'Sponsor Coverage amount or Grand Total on the invoice (KES, numeric only). For inpatient, use Sponsor Coverage line, not patient co-pay.' },
            serviceDate:      { type: 'string',  description: 'YYYY-MM-DD date of service/visit/admission' },
            diagnosis:        { type: 'string',  description: 'Diagnosis text — prefer the MCF Diagnosis field or Discharge Diagnosis; fall back to invoice Diagnosis section' },
            diagnosisCode:    { type: 'string',  description: 'ICD-10 code, e.g. K29.0, J06.9' },
            procedureCode:    { type: 'string',  description: 'CPT or HCPCS code if present' },
            treatment:        { type: 'string',  description: 'Treatment / procedure description from MCF Management Plan or invoice line items' },
            insuranceCompany: { type: 'string' },
            accountName:      { type: 'string',  description: 'Employer / scheme name (from MCF or auth letter)' },
            lineItems: {
              type: 'array',
              description: 'Every billed line item from the invoice table for this claim packet. Extract ALL rows.',
              items: {
                type: 'object',
                properties: {
                  description:   { type: 'string', description: 'Service or item description exactly as printed' },
                  quantity:      { type: 'number', description: 'Quantity or units billed' },
                  unitPrice:     { type: 'number', description: 'Unit price per item (KES numeric)' },
                  totalPrice:    { type: 'number', description: 'Line total (KES numeric)' },
                  taxAmount:     { type: 'number', description: 'VAT / tax on this line if shown' },
                  discount:      { type: 'number', description: 'Discount on this line if shown' },
                  procedureCode: { type: 'string', description: 'CPT / ICD / procedure code for this line' },
                  serviceDate:   { type: 'string', description: 'Service date YYYY-MM-DD for this line' },
                  confidence:    { type: 'number', description: 'Confidence 0.0-1.0 for this line extraction' },
                },
                required: ['description', 'totalPrice'],
              },
            },
            documentPages: {
              type: 'array',
              description: 'Per-page classification for every page in this claim packet',
              items: {
                type: 'object',
                properties: {
                  pageNumber:    { type: 'number', description: 'Absolute page number in the PDF (1-based)' },
                  category:      { type: 'string', enum: ['invoice', 'claim_form', 'inpatient_invoice', 'discharge_summary', 'authorization_letter', 'lab_result', 'prescription', 'supporting'] },
                  categoryLabel: { type: 'string', description: 'Human-readable label, e.g. "Detailed Invoice", "Medical Claim Form"' },
                  confidence:    { type: 'number' },
                  summary:       { type: 'string', description: 'One-line summary of this page, e.g. "Zion Medical Centre invoice ZMC2024/023573 – KES 3,489.55"' },
                },
                required: ['pageNumber', 'category', 'categoryLabel'],
              },
            },
            confidence: { type: 'number', description: 'Extraction confidence 0.0-1.0' },
          },
          required: ['patientName', 'providerName', 'invoiceAmount', 'pageRange', 'confidence'],
        },
      },
    },
    required: ['claims'],
  },
};

const MULTI_USER_PROMPT = `This PDF is a merged batch of Kenyan insurance claim documents. Each claim packet must be identified and split correctly.

━━━ SPLITTING RULES (apply in order) ━━━

RULE 1 — "Page X of Y" sequences are NEVER split:
  If you see "Page 2 of 9", "Page 3 of 9" etc., all those pages are ONE invoice. Keep them together no matter what.

RULE 2 — Medical Claim Form (MCF) always belongs with its invoice — NEVER a standalone claim:
  Any page whose header reads "MEDICAL CLAIM FORM" (AAR Insurance form with sections A: PATIENT INFORMATION and B: CLINICAL INFORMATION) belongs to the SAME claim packet as the invoice immediately before or after it.
  NEVER create a separate claim entry for an MCF alone. The MCF is a supporting document, not a new claim.
  Invoice + MCF = ONE claim entry. Invoice + MCF + letter = ONE claim entry. Invoice + MCF + lab results = ONE claim entry.
  The fact that the MCF header shows "AAR Insurance Kenya Ltd" (the insurer) while the invoice shows a clinic name does NOT make them separate claims — they are the same claim.
  Two consecutive MCFs with no invoice between them = two separate claims (each MCF still needs its own invoice).

RULE 3 — Each distinct invoice number is its own claim:
  Every unique invoice number = one claim entry. Two invoices from the SAME provider and even the SAME patient but with DIFFERENT invoice numbers are TWO separate claims — never merge them.
  Same provider name does NOT prevent a split. Same patient name does NOT prevent a split. Only identical invoice numbers belong together.

RULE 3b — SCANNED page immediately before a "Page 1 of N" sequence:
  If the pre-scan shows a SCANNED/IMAGE page at position P, and page P+1 starts a "Page 1 of N" multi-page invoice, inspect the scanned page visually.
  If it shows a DIFFERENT provider or invoice number than the multi-page sequence, it is a SEPARATE claim — do NOT attach it as a supporting document to the multi-page invoice.
  Scanned outpatient invoices (Zion, Nomad Dental) are always separate claims from Aga Khan inpatient invoices.

RULE 4 — Supporting documents attach to the NEAREST preceding invoice:
  Discharge summaries, lab results, authorization letters, prescription pages → attach to the claim packet whose invoice immediately precedes them.
  Do NOT create a separate claim entry for these pages.

━━━ DOCUMENT TYPE RECOGNITION ━━━

• Medical Claim Form (claim_form): page heading "MEDICAL CLAIM FORM", "AAR Insurance", sections "A: PATIENT INFORMATION" and "B: CLINICAL INFORMATION", handwritten diagnoses and management plan
• Outpatient invoice (invoice): provider letterhead, "Invoice No." or "Invoice #", itemized services table, "Total" / "Balance Due" line — typically 1 page
• Detailed inpatient invoice (inpatient_invoice): "DETAILED INVOICE" or Aga Khan format with numbered charge categories (Bed Charges, Laboratory, Pharmacy…), "Page X of Y" pagination — can be 5-13 pages
• Discharge summary (discharge_summary): "Discharge Summary Signed", "DS: Diagnosis", "DS: Hospital Course", vital signs table
• Authorization letter (authorization_letter): "PRIVATE & CONFIDENTIAL", "MEMBER NO:", "ADMISSION DATE:", "HEALTH PLAN:", signed by Care Manager
• Lab results (lab_result): "Laboratory Tests" table with blood panel values, dates, and reference ranges

━━━ FIELD EXTRACTION ━━━

For each claim packet:
• invoiceAmount: use Sponsor Coverage line (inpatient) or Grand Total / Balance Due (outpatient) — NOT the patient co-pay or "Your Amount Due: 0.00"
• diagnosis: prefer MCF "Diagnosis:" field (handwritten) → discharge summary "Discharge Diagnosis" → invoice "Diagnosis" section
• patientName: check MCF "Name:" field (may be handwritten) and invoice header
• membershipNumber: MCF "Membership No." field, invoice "HMN NO." or "AK Number", auth letter "MEMBER NO:"
• invoiceNumber: from invoice page only (e.g. Nyr/13277, ZMC2024/024329, UH283003051_3)
• lineItems: extract EVERY billed row from the invoice table — description, quantity, unit price, and total. Leave empty if no billing table is visible.

For documentPages, classify EVERY page in the packet with its absolute PDF page number (1-based).

Record pageRange as "start-end" (e.g. "1-2") covering ALL pages in the packet. Ranges must not overlap.
Call record_all_claims with one entry per claim. Never merge two different patients' invoices into one entry.`;

const USER_PROMPT = `Extract every field visible in this Kenyan medical claim document.

PRIORITY — search the entire document for these fields:
• patientName: look in the document header, "Patient:", "Patient Name:", "Member Name:", "Insured:", "Name:", "Name of Patient:", claim-form sections, and signature/authorization blocks. Never return "Unknown".
• invoiceNumber: look near "Invoice No.", "Invoice #", "Receipt No.", "Ref No.", "Nyr/", or the top-right of the document
• invoiceAmount: the GRAND TOTAL or AMOUNT DUE — the largest "total" figure on the page
• diagnosis: look for "Diagnosis:", "Presenting Complaint:", "Assessment:", "Clinical Impression:", or ICD-10 codes (letter + 2-3 digits, e.g. E39, J06.9)
• membershipNumber: look near "Member No.", "Policy No.", "NHIF No.", "AK No.", "Scheme No."
• lineItems: extract EVERY row from the billing / charges table — description, quantity, unit price, and line total. If no billing table exists, leave lineItems empty.

Copy all values character-for-character. Leave fields empty if genuinely absent — never guess or approximate.
Rate your confidence 0.0–1.0 on how clearly all priority fields were visible. Call record_invoice_fields with your results.`;

// Document-type strings that sometimes bleed into diagnosis when Claude reads
// section headings on Zion/Nomad invoices.
const DIAGNOSIS_NOISE = /\b(DETAILED\s+)?INVOICE\b|\bDETAILED\b|\bMEDICAL CLAIM FORM\b|\bCLAIM FORM\b|\bDISCHARGE SUMMARY\b|\bAUTHORIZATION LETTER\b/gi;

@Injectable()
export class ClaudeVisionService {
  private readonly logger = new Logger(ClaudeVisionService.name);
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

  /** @deprecated Use the shared buildPageContextHints from gemini-vision.service.ts */
  private async _unused_buildPageContextHints(pdfPath: string): Promise<string> {
    try {
      const dataBuffer = fs.readFileSync(pdfPath);
      const pdfParse = await import('pdf-parse');
      const pageTexts: string[] = [];

      await pdfParse.default(dataBuffer, {
        pagerender: async (pageData: any) => {
          try {
            const content = await pageData.getTextContent({ normalizeWhitespace: true });
            const text = (content.items as any[]).map((it: any) => it.str).join(' ');
            pageTexts.push(text);
            return text;
          } catch {
            pageTexts.push('');
            return '';
          }
        },
      });

      if (pageTexts.length === 0) return '';

      // Strip our stamped barcodes (C + 13-20 digits) before classifying
      const BARCODE_RE = /\bC\d{13,20}\b/g;

      // ── First pass: classify each page ───────────────────────────────────────
      interface PageInfo { pg: number; type: string; details: string[]; totalInSeq?: number }
      const classified: PageInfo[] = pageTexts.map((text, idx) => {
        const pg = idx + 1;
        const stripped = text.replace(BARCODE_RE, '').replace(/\s+/g, ' ').trim();

        if (stripped.length < 25) {
          return { pg, type: 'SCANNED/IMAGE', details: ['visually inspect — treat as NEW claim if different provider from adjacent pages'] };
        }

        const t = stripped;
        const details: string[] = [];
        let type = 'OTHER';

        // "Page X of Y" — detect even with mild OCR noise (digit-only proximity)
        const pageOfY = t.match(/Page\s+(\d+)\s+of\s+(\d+)/i);
        const pageNum  = pageOfY ? parseInt(pageOfY[1]) : 0;
        const totalPgs = pageOfY ? parseInt(pageOfY[2]) : 0;
        if (pageOfY) details.push(`[Page ${pageNum} of ${totalPgs} — DO NOT SPLIT]`);

        // Continuation pages (Page X of Y where X > 1)
        if (pageOfY && pageNum > 1) {
          type = `INVOICE CONTINUATION (page ${pageNum} of ${totalPgs})`;
        }
        // Discharge summary — checked BEFORE AKH invoice (discharge summaries contain AKH letterhead)
        else if (/Discharge\s+Summary|DS:\s*Diagnosis|DS:\s*Hospital/i.test(t)) {
          type = 'DISCHARGE SUMMARY (attach to nearest preceding invoice)';
          const mr = t.match(/MR#[:\s]+(\S+)/i);
          if (mr) details.push(`MR#: ${mr[1]}`);
        }
        // Auth letter — checked before AKH (auth letters also have AKH address)
        else if (/PRIVATE\s+&\s+CONFIDENTIAL|ADMISSION\s+DATE|MEMBER\s+NO:/i.test(t)) {
          type = 'AUTHORIZATION LETTER (attach to nearest preceding invoice)';
          const mem = t.match(/MEMBER\s+NO[:\s]+(\S+)/i);
          if (mem) details.push(`Member: ${mem[1]}`);
        }
        // MCF
        else if (/MEDICAL\s+CLAIM\s+FORM/i.test(t)) {
          type = '*** MEDICAL CLAIM FORM (SPLIT BOUNDARY) ***';
          const mem = t.match(/Membership\s+No[.:)]*\s*([A-Z0-9\-]{4,20})/i);
          if (mem) details.push(`Membership: ${mem[1]}`);
        }
        // AKH — flexible pattern to handle OCR noise: "AGA I(HAN", "AGA XHAN", etc.
        // Only matches invoice pages (not discharge summaries, already caught above)
        else if (/AGA\s+.{0,6}HAN\s+UNIVERSITY|UNIVERSITY\s+HOSPITAL.{0,30}NAIROBI|Invoice\s+[#*]\s*UH\d/i.test(t)) {
          type = pageNum === 1
            ? 'INPATIENT INVOICE (Aga Khan) *** NEW CLAIM SPLIT BOUNDARY ***'
            : `INVOICE CONTINUATION (page ${pageNum} of ${totalPgs})`;
          const inv = t.match(/Invoice\s+[#*]\s*(UH\S+)/i) || t.match(/Invoice\s+[#*]\S*\s+(UH\S+)/i);
          if (inv) details.push(`Invoice: ${inv[1]}`);
          const ak = t.match(/AK\s+(?:Number)?[:\s]+(\S+)/i);
          if (ak) details.push(`AK: ${ak[1]}`);
          if (totalPgs > 1) return { pg, type, details, totalInSeq: totalPgs };
        }
        // Dental (Nomad)
        else if (/NOMAD\s+DENTAL|DENTAL\s+CENTRE/i.test(t)) {
          type = 'OUTPATIENT INVOICE (Dental) *** NEW CLAIM SPLIT BOUNDARY ***';
          const inv = t.match(/Invoice\s+No\s+(\S+)/i);
          if (inv) details.push(`Invoice: ${inv[1]}`);
          const hmn = t.match(/HMN\s+NO[.:\s]+([A-Z0-9\-]+)/i);
          if (hmn) details.push(`HMN: ${hmn[1]}`);
        }
        // Zion
        else if (/ZION\s+MEDICAL|ZION\s+CENTRE/i.test(t) || /DETAILED\s+INVOICE/i.test(t)) {
          type = 'OUTPATIENT INVOICE (Zion) *** NEW CLAIM SPLIT BOUNDARY ***';
          const inv = t.match(/Invoice\s+No[:\s]+([A-Z0-9\/]+)/i);
          if (inv) details.push(`Invoice: ${inv[1]}`);
          const reg = t.match(/Reg\s+No[:\s]+([A-Z0-9\-]+)/i);
          if (reg) details.push(`Reg: ${reg[1]}`);
        }
        // Lab results
        else if (/Laboratory\s+Tests|Lab\s+Results|WBC|Haemoglobin/i.test(t)) {
          type = 'LAB RESULTS (attach to nearest preceding invoice)';
        }

        return { pg, type, details };
      });

      // ── Second pass: fill-forward multi-page invoice sequences ───────────────
      // When we know "Page 1 of N", override the next N-1 pages as continuations
      // even if their OCR was too garbled to detect "Page X of Y" directly.
      let fillRemaining = 0;
      let fillTotal = 0;
      let fillIdx = 1;
      for (const info of classified) {
        if (fillRemaining > 0 && (info.type === 'OTHER' || info.type.startsWith('INVOICE CONTINUATION'))) {
          info.type = `INVOICE CONTINUATION (page ${fillIdx} of ${fillTotal} — DO NOT SPLIT)`;
          info.details = [];
          fillRemaining--;
          fillIdx++;
        } else {
          // Check if this page starts a multi-page sequence
          const m = info.details.join(' ').match(/\[Page 1 of (\d+)/);
          if (m) {
            fillTotal = parseInt(m[1]);
            fillRemaining = fillTotal - 1;
            fillIdx = 2;
          } else {
            fillRemaining = 0;
          }
        }
      }

      const lines: string[] = ['=== PAGE PRE-SCAN (digital text layer — use as authoritative split map) ==='];
      for (const info of classified) {
        lines.push(`Page ${info.pg}: ${info.type}${info.details.length ? ' — ' + info.details.join(', ') : ''}`);
      }

      lines.push('=== END PAGE PRE-SCAN ===');
      return lines.join('\n');
    } catch (err) {
      this.logger.warn(`Page pre-scan failed: ${err}`);
      return '';
    }
  }

  /**
   * Extract ALL claim packets from a multi-claim PDF in one API call.
   * Prepends a page pre-scan table to the prompt so Claude has an authoritative
   * split map before reading the document visually.
   */
  async extractMulti(filePath: string, mimetype: string, modelOverride?: string): Promise<ParsedInvoice[]> {
    const client = this.getClient();
    if (!client) throw new Error('ANTHROPIC_API_KEY not set');

    const model = modelOverride || process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
    const isPdf = mimetype === 'application/pdf' || filePath.endsWith('.pdf');
    const b64 = fs.readFileSync(filePath).toString('base64');

    const document: Anthropic.ContentBlockParam = isPdf
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }
      : { type: 'image', source: { type: 'base64', media_type: (mimetype as any) || 'image/png', data: b64 } };

    // Build page-type roadmap from the digital text layer (shared utility)
    const pageHints = isPdf ? await buildPageContextHints(filePath) : '';
    const fullUserPrompt = pageHints
      ? `${pageHints}\n\n${MULTI_USER_PROMPT}`
      : MULTI_USER_PROMPT;

    this.logger.log(`Claude multi-claim extract with model=${model} (${isPdf ? 'pdf' : 'image'}, pageHints=${pageHints ? 'yes' : 'no'})`);

    const response = await client.messages.create({
      model,
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      tools: [MULTI_EXTRACT_TOOL],
      tool_choice: { type: 'tool', name: MULTI_EXTRACT_TOOL.name },
      messages: [{ role: 'user', content: [document, { type: 'text', text: fullUserPrompt }] }],
    });

    const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    if (!toolUse) throw new Error('Claude returned no tool_use block for multi-claim extraction');

    const { claims } = toolUse.input as { claims: any[] };
    if (!claims?.length) return [];

    this.logger.log(`Claude identified ${claims.length} claim packet(s) in the document`);

    return claims.map((c: any): ParsedInvoice => {
      const confidence = Math.max(0, Math.min(1, Number(c.confidence) || 0.8));

      // Prefer per-page documentPages array (new schema); fall back to legacy documentTypes list
      let documentPages: ParsedInvoice['documentPages'] = [];
      if (Array.isArray(c.documentPages) && c.documentPages.length > 0) {
        documentPages = c.documentPages.map((p: any) => ({
          pageNumber:    Number(p.pageNumber) || 1,
          category:      p.category || 'supporting',
          categoryLabel: p.categoryLabel || (p.category || 'supporting').replace(/_/g, ' ').replace(/\b\w/g, (ch: string) => ch.toUpperCase()),
          confidence:    Number(p.confidence) || 0.85,
          summary:       p.summary || '',
        }));
      } else if (Array.isArray(c.documentTypes)) {
        // Legacy fallback: enumerate document types without real page numbers
        documentPages = (c.documentTypes as string[]).map((dt, idx) => ({
          pageNumber:    idx + 1,
          category:      dt as any,
          categoryLabel: dt.replace(/_/g, ' ').replace(/\b\w/g, (ch: string) => ch.toUpperCase()),
          confidence:    0.85,
          summary:       dt.replace(/_/g, ' '),
        }));
      }

      // Strip document-type header strings that bleed into diagnosis
      const rawDiagnosis = (c.diagnosis || '').replace(DIAGNOSIS_NOISE, '').replace(/\s{2,}/g, ' ').trim();

      const lineItems = Array.isArray(c.lineItems)
        ? c.lineItems.map((item: any, idx: number) => ({
            description:   String(item.description || ''),
            quantity:      item.quantity != null ? Number(item.quantity) : undefined,
            unitPrice:     item.unitPrice != null ? Number(item.unitPrice) : undefined,
            totalPrice:    item.totalPrice != null ? Number(item.totalPrice) : undefined,
            taxAmount:     item.taxAmount != null ? Number(item.taxAmount) : undefined,
            discount:      item.discount != null ? Number(item.discount) : undefined,
            procedureCode: item.procedureCode || undefined,
            serviceDate:   item.serviceDate || undefined,
            ocrConfidence: item.confidence != null ? Number(item.confidence) : confidence,
            currency:      'KES',
            lineNumber:    idx + 1,
          }))
        : undefined;

      return {
        patientName:      c.patientName      || '',
        patientId:        c.patientId        || '',
        membershipNumber: c.membershipNumber || '',
        providerName:     c.providerName     || '',
        invoiceNumber:    c.invoiceNumber    || '',
        invoiceDate:      c.invoiceDate      || '',
        invoiceAmount:    Number(c.invoiceAmount) || 0,
        serviceDate:      c.serviceDate      || c.invoiceDate || '',
        diagnosis:        rawDiagnosis,
        diagnosisCode:    c.diagnosisCode    || '',
        procedureCode:    c.procedureCode    || '',
        cptCodes:         [],
        icd10Codes:       c.diagnosisCode ? [c.diagnosisCode] : [],
        hcpcsCodes:       [],
        allMedicalCodes:  [c.diagnosisCode, c.procedureCode].filter(Boolean),
        treatment:        c.treatment        || '',
        insuranceCompany: c.insuranceCompany || '',
        accountName:      c.accountName      || '',
        confidence,
        rawText:          '',
        pageRange:        c.pageRange || '1',
        documentPages,
        lineItems,
      };
    });
  }

  async extract(filePath: string, mimetype: string, modelOverride?: string): Promise<ParsedInvoice> {
    const client = this.getClient();
    if (!client) throw new Error('ANTHROPIC_API_KEY not set');

    const model = modelOverride || process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
    const isPdf = mimetype === 'application/pdf' || filePath.endsWith('.pdf');
    const b64 = fs.readFileSync(filePath).toString('base64');

    const document: Anthropic.ContentBlockParam = isPdf
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }
      : {
          type: 'image',
          source: {
            type: 'base64',
            media_type: (mimetype as any) || 'image/png',
            data: b64,
          },
        };

    this.logger.log(`Claude extracting with model=${model} (${isPdf ? 'pdf' : 'image'})`);

    const response = await client.messages.create({
      model,
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      tools: [EXTRACT_TOOL],
      tool_choice: { type: 'tool', name: EXTRACT_TOOL.name },
      messages: [
        {
          role: 'user',
          content: [document, { type: 'text', text: USER_PROMPT }],
        },
      ],
    });

    const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    if (!toolUse) {
      const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
      throw new Error(`Claude returned no tool_use block. Text: ${textBlock?.text?.slice(0, 200) || '(empty)'}`);
    }

    const fields = toolUse.input as Record<string, any>;
    const confidence = Math.max(0, Math.min(1, Number(fields.confidence) || 0.9));

    // Auto-retry with Opus when Sonnet/Haiku returns low confidence
    if (confidence < 0.70 && model !== 'claude-opus-4-7') {
      this.logger.log(`Low confidence (${confidence.toFixed(2)}) from ${model} — retrying with claude-opus-4-7`);
      try {
        return await this.extract(filePath, mimetype, 'claude-opus-4-7');
      } catch (opusErr: any) {
        this.logger.warn(`Opus retry failed: ${opusErr?.message} — keeping original result`);
      }
    }

    const lineItems = Array.isArray(fields.lineItems)
      ? fields.lineItems.map((item: any, idx: number) => ({
          description:   String(item.description || ''),
          quantity:      item.quantity != null ? Number(item.quantity) : undefined,
          unitPrice:     item.unitPrice != null ? Number(item.unitPrice) : undefined,
          totalPrice:    item.totalPrice != null ? Number(item.totalPrice) : undefined,
          taxAmount:     item.taxAmount != null ? Number(item.taxAmount) : undefined,
          discount:      item.discount != null ? Number(item.discount) : undefined,
          procedureCode: item.procedureCode || undefined,
          serviceDate:   item.serviceDate || undefined,
          ocrConfidence: item.confidence != null ? Number(item.confidence) : confidence,
          currency:      'KES',
          lineNumber:    idx + 1,
        }))
      : undefined;

    return {
      patientName:      fields.patientName      || '',
      patientId:        fields.patientId        || '',
      membershipNumber: fields.membershipNumber || '',
      providerName:     fields.providerName     || '',
      invoiceNumber:    fields.invoiceNumber    || '',
      invoiceDate:      fields.invoiceDate      || '',
      invoiceAmount:    Number(fields.invoiceAmount) || 0,
      serviceDate:      fields.serviceDate      || fields.invoiceDate || '',
      diagnosis:        fields.diagnosis        || '',
      diagnosisCode:    fields.diagnosisCode    || '',
      procedureCode:    fields.procedureCode    || '',
      cptCodes:         [],
      icd10Codes:       fields.diagnosisCode ? [fields.diagnosisCode] : [],
      hcpcsCodes:       [],
      allMedicalCodes:  [fields.diagnosisCode, fields.procedureCode].filter(Boolean),
      treatment:        fields.treatment        || '',
      insuranceCompany: fields.insuranceCompany || '',
      accountName:      fields.accountName      || '',
      confidence,
      rawText:          '',
      pageRange:        '1',
      documentPages:    [],
      lineItems,
    };
  }
}
