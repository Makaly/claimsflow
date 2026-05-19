// Structured extraction schema constants for the Gemini vision prompt (T1.1).
// All confidence values are 0.0–1.0 fractions.

export interface FieldWithConfidence {
  value:      string;
  confidence: number;
}

export interface LineItemExtraction {
  lineNumber?:    number;
  description:    string;
  category?:      string;
  quantity?:      number;
  unitPrice?:     number;
  totalPrice?:    number;
  taxAmount?:     number;
  discount?:      number;
  currency:       string;
  serviceDate?:   string;
  procedureCode?: string;
  // Row-level confidence — used by T1.4 gating.
  confidence:     number;
}

export interface InvoiceHeader {
  patientName:      FieldWithConfidence;
  patientId:        FieldWithConfidence;
  membershipNumber: FieldWithConfidence;
  providerName:     FieldWithConfidence;
  invoiceNumber:    FieldWithConfidence;
  invoiceDate:      FieldWithConfidence;
  serviceDate:      FieldWithConfidence;
  insuranceCompany: FieldWithConfidence;
  accountName:      FieldWithConfidence;
}

export interface InvoiceTotals {
  subtotal?:        number;
  taxTotal?:        number;
  discountTotal?:   number;
  invoiceAmount:    number;
  currency:         string;
  sponsorCoverage?: number;
  patientPayable?:  number;
}

export interface InvoiceDiagnosis {
  diagnosis:     FieldWithConfidence;
  diagnosisCode: FieldWithConfidence;
  procedureCode: FieldWithConfidence;
  treatment:     FieldWithConfidence;
}

export interface StructuredExtractionResult {
  header:     InvoiceHeader;
  lineItems:  LineItemExtraction[];
  totals:     InvoiceTotals;
  diagnosis:  InvoiceDiagnosis;
  confidence: number;
}

// ── Gemini responseSchema objects ─────────────────────────────────────────────
// Used as generationConfig.responseSchema with responseMimeType='application/json'.

const GEMINI_FIELD_SCHEMA = {
  type: 'OBJECT',
  properties: {
    value:      { type: 'STRING' },
    confidence: { type: 'NUMBER' },
  },
  required: ['value', 'confidence'],
};

export const GEMINI_LINE_ITEM_SCHEMA = {
  type: 'OBJECT',
  properties: {
    lineNumber:    { type: 'NUMBER' },
    description:   { type: 'STRING' },
    category:      { type: 'STRING' },
    quantity:      { type: 'NUMBER' },
    unitPrice:     { type: 'NUMBER' },
    totalPrice:    { type: 'NUMBER' },
    taxAmount:     { type: 'NUMBER' },
    discount:      { type: 'NUMBER' },
    currency:      { type: 'STRING' },
    serviceDate:   { type: 'STRING' },
    procedureCode: { type: 'STRING' },
    confidence:    { type: 'NUMBER' },
  },
  required: ['description', 'confidence'],
};

export const GEMINI_EXTRACTION_SCHEMA = {
  type: 'OBJECT',
  properties: {
    header: {
      type: 'OBJECT',
      properties: {
        patientName:      GEMINI_FIELD_SCHEMA,
        patientId:        GEMINI_FIELD_SCHEMA,
        membershipNumber: GEMINI_FIELD_SCHEMA,
        providerName:     GEMINI_FIELD_SCHEMA,
        invoiceNumber:    GEMINI_FIELD_SCHEMA,
        invoiceDate:      GEMINI_FIELD_SCHEMA,
        serviceDate:      GEMINI_FIELD_SCHEMA,
        insuranceCompany: GEMINI_FIELD_SCHEMA,
        accountName:      GEMINI_FIELD_SCHEMA,
      },
      required: ['patientName', 'providerName', 'invoiceNumber', 'invoiceDate'],
    },
    lineItems: {
      type: 'ARRAY',
      items: GEMINI_LINE_ITEM_SCHEMA,
    },
    totals: {
      type: 'OBJECT',
      properties: {
        subtotal:        { type: 'NUMBER' },
        taxTotal:        { type: 'NUMBER' },
        discountTotal:   { type: 'NUMBER' },
        invoiceAmount:   { type: 'NUMBER' },
        currency:        { type: 'STRING' },
        sponsorCoverage: { type: 'NUMBER' },
        patientPayable:  { type: 'NUMBER' },
      },
      required: ['invoiceAmount'],
    },
    diagnosis: {
      type: 'OBJECT',
      properties: {
        diagnosis:     GEMINI_FIELD_SCHEMA,
        diagnosisCode: GEMINI_FIELD_SCHEMA,
        procedureCode: GEMINI_FIELD_SCHEMA,
        treatment:     GEMINI_FIELD_SCHEMA,
      },
      required: ['diagnosis'],
    },
    confidence: { type: 'NUMBER' },
  },
  required: ['header', 'totals', 'confidence'],
};

// Prompt for the structured single-invoice extraction pass.
export const GEMINI_EXTRACTION_PROMPT = `Extract every visible field from this Kenyan medical insurance claim document.

RULES:
- Copy text EXACTLY as printed. Never invent or guess values.
- Dates must be YYYY-MM-DD or empty string.
- Currency default is KES. Amounts are plain numbers (no symbols or commas).
- For invoiceAmount use: Sponsor Coverage (inpatient) OR Grand Total / Balance Due (outpatient). NOT the patient co-pay.
- For each header field, set confidence 0.0–1.0: 1.0 = clearly printed, 0.5 = partially legible, 0.0 = not found.
- For each line item row, set confidence 0.0–1.0 reflecting how clearly you can read that row.
- Leave value as empty string (confidence 0.0) when a field is absent.
- Return all visible line items. Include procedure/service codes where printed.`;

// Threshold below which a field is considered uncertain and may trigger a
// second-pass via Ollama (T1.2) or row-level review flagging (T1.4).
// Configurable via GEMINI_FIELD_CONFIDENCE_THRESHOLD env var.
export const FIELD_CONFIDENCE_THRESHOLD = parseFloat(
  process.env.GEMINI_FIELD_CONFIDENCE_THRESHOLD ?? '0.65',
);

// Threshold for image quality below which preprocessing is applied (T1.3).
export const IMAGE_QUALITY_PREPROCESS_THRESHOLD = parseFloat(
  process.env.IMAGE_QUALITY_PREPROCESS_THRESHOLD ?? '0.70',
);

// Threshold for row-level line-item confidence gating (T1.4).
export const LINE_ITEM_CONFIDENCE_THRESHOLD = parseFloat(
  process.env.LINE_ITEM_CONFIDENCE_THRESHOLD ?? '0.65',
);

// Arbitration tolerance: when Gemini and Ollama disagree on a numeric field
// by more than this fraction, mark for manual review (T1.2).
export const ARBITRATION_TOLERANCE = parseFloat(
  process.env.OCR_ARBITRATION_TOLERANCE ?? '0.10',
);
