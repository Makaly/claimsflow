/**
 * Invoice Pattern Knowledge Base
 *
 * Different healthcare providers use different invoice formats.
 * This knowledge base helps the OCR parser recognize various patterns.
 * Add new patterns as new invoice formats are encountered.
 */

// Invoice number patterns from different providers
export const INVOICE_NUMBER_PATTERNS = [
  // Standard formats
  /Invoice\s*(?:No|Number|#|Ref)?\s*[:\-.]?\s*([A-Z]{2,5}[\-/]\d[\w\-/.]{3,25})/i,     // AAR-INV/2023570583
  /Invoice\s*(?:No|Number|#|Ref)?\s*[:\-.]?\s*(CB[\-/][\d][\w\-/.]{3,20})/i,             // CB-126133-23
  /Invoice\s*(?:No|Number|#|Ref)?\s*[:\-.]?\s*([A-Z]{2,5}\d{4}[\-/]\d{3,10})/i,          // ZMC2024/02432
  /Invoice\s*(?:No|Number|#|Ref)?\s*[:\-.]?\s*([A-Z]{1,5}[\-/][\d][\w\-/.]{2,20})/i,     // Nyr/13277
  /Invoice\s*(?:No|Number|#|Ref)?\s*[:\-.]?\s*(INV[\-/]?\d[\d\-/.]{3,15})/i,              // INV-2024-001
  /Invoice\s*#\s*([A-Z]{1,4}\d{5,}(?:[_\-]\d+)?)/i,                                        // UH283059137_4 or UH283059137 (Aga Khan)
  /Invoice\s*(?:No|Number|#|Ref)?\s*[:\-.]?\s*(\d{4,15})/i,                               // 123456789 (numeric only)
  // Without "Invoice" label - standalone patterns
  /(AAR[\-/]INV[\-/]?\d[\d\-/.]+)/i,
  /(CB[\-/][\d][\d\-/.]+)/i,
  /(ZMC\d{4}[\-/]\d{3,})/i,
  /([A-Z]{2,4}\d{4}[\-/]\d{3,})/i,  // Any 2-4 letter prefix + year + number
  /([A-Z][a-z]{1,4}\/\d{3,})/i,      // Nyr/13277
];

// Invoice date patterns
export const INVOICE_DATE_PATTERNS = [
  /Invoice\s*Date\s*[:\-]?\s*(\d{4}[\-/.]\d{1,2}[\-/.]\d{1,2})/i,                  // 2024-02-19
  /Invoice\s*Date\s*[:\-]?\s*(\d{1,2}[\-/.]\d{1,2}[\-/.]\d{2,4})/i,                // 22/12/2023
  /Invoice\s*Date\s*[:\-]?\s*(\d{1,2}[\-/]\w{3,9}[\-/]\d{2,4})/i,                  // 18/Dec/2023, 02-Mar-2024
  /(?:Bill|Receipt)\s*Date\s*[:\-]?\s*(\d{1,2}[\-/.]\d{1,2}[\-/.]\d{2,4})/i,
  /(?:Bill|Receipt)\s*Date\s*[:\-]?\s*(\d{4}[\-/.]\d{1,2}[\-/.]\d{1,2})/i,
  /(?:Date)\s*[:\-]?\s*(\d{4}[\-/.]\d{1,2}[\-/.]\d{1,2})/i,                         // Date: 2024-02-19
  /(?:Date)\s*[:\-]?\s*(\d{1,2}[\-/]\w{3,9}[\-/]\d{2,4})/i,
  /(?:Date)\s*[:\-]?\s*(\d{1,2}[\-/.]\d{1,2}[\-/.]\d{2,4})/i,
];

// Amount patterns - total/balance/grand total
// NOTE: Aga Khan FIRST — their "Sponsor Coverage" is the insurance amount, NOT "Your Amount Due" (patient co-pay)
// "Grand Total / Amount Due" pattern would otherwise capture the patient's tiny co-pay (e.g. 0.02) instead of 990,000
export const TOTAL_AMOUNT_PATTERNS = [
  // Aga Khan University Hospital: "Sponsor Coverage:\nAAA Corporate   990,000.00"
  // Window widened to 400 chars — IP consolidated bills push the figure
  // behind the corporate code + employer name + columns.
  /Sponsor\s*Coverage[\s\S]{0,400}?([\d,]{3,}\.\d{2})/i,
  /(?:Grand\s*Total|Total\s*Amount|Balance\s*Due|Net\s*(?:Amount|Total|Payable)|Amount\s*(?:Due|Payable)|Total\s*(?:Due|Payable|Bill))\s*[:\-]?\s*(?:KES|Ksh|Kshs?)?\s*[:\-]?\s*([\d,]+(?:\.\d{1,2})?)/i,
  // Bare "Total:" fallback — require at least 3 digit/comma chars before the
  // optional decimal so the integer portion is ≥ 100. Stops the bare label
  // from matching `Total: 1.00` (a rounding line, change due, or per-page
  // sub-total) and winning Math.max against the missing real total.
  /(?:Total)\s*[:\-]?\s*(?:KES|Ksh|Kshs?)?\s*[:\-]?\s*([\d,]{3,}(?:\.\d{1,2})?)/i,
];

// Line item amount patterns (for summing when no total found)
export const LINE_ITEM_PATTERNS = [
  /(?:Consultation|Pharmacy|Lab|Radiology|Referral|Service|Dental|Surgery|Procedure|Theatre|Nursing|Bed|Ward|Drugs?|Medicine|Imaging|X[\-\s]?ray|Ultrasound|MRI|CT\s*Scan|ECG|Dialysis|Physiotherapy|Optical|Outpatient|Inpatient)\s*(?:Amount|Fee|Charge|Cost)?\s*[:\-]?\s*(?:KES|Ksh)?\s*([\d,]+(?:\.\d{1,2})?)/gi,
];

// Patient name patterns
export const PATIENT_NAME_PATTERNS = [
  // Aga Khan discharge summary: "Patient: NYIKA,DAVID" — stops at newline, not word boundary
  /\bPatient\s*:\s*([A-Z][^\n\r]{3,40}?)(?=\s*[\n\r]|\s+DOB|\s+Age|\s+Reg|$)/,
  // "Patient Name:" label (common on Aga Khan outpatient invoices)
  /Patient\s+Name\s*[:\-]\s*([A-Z][A-Za-z\s.'-]{2,40}?)(?:\s*\n|\s+(?:DOB|Age|Sex|Gender|Reg|Date|No[.:\s]))/i,
  /Patient\s+Name\s*[:\-]\s*([A-Z][A-Za-z\s.'-]{2,40})/i,
  // "Bill To:" — used on Aga Khan Nyeri / outpatient receipts
  /Bill\s+To\s*[:\-]?\s*([A-Z][A-Za-z\s.'-]{3,40}?)(?:\s*\n|\s+(?:Address|P\.?O|Box|Account|Tel|Phone))/i,
  /Bill\s+To\s*[:\-]?\s*([A-Z][A-Za-z\s.'-]{3,40})/i,
  // Standard single-line with stop lookahead
  /(?:Patient\s*)?Name\s*[:\-]\s*([A-Z][A-Z\s.'-]{2,40}?)(?:\s*\n|\s+(?:Patient|Invoice|Reg|Date|Visit|No[.:\s]|Age|Sex|Gender))/i,
  /(?:Patient\s*)?Name\s*[:\-]\s*([A-Z][A-Z\s.'-]{2,40})/i,
  // "Client Name:" or "Insured Name:" (Jubilee, AAR formats)
  /(?:Client|Insured|Beneficiary)\s+Name\s*[:\-]\s*([A-Z][A-Za-z\s.'-]{2,40})/i,
  /(?:Mr\.|Mrs\.|Ms\.|Dr\.)\s+([A-Z][a-zA-Z\s.'-]{3,40})/i,
  /Member\s*Name\s*[:\-]\s*([A-Z][a-zA-Z\s.'-]{2,40})/i,
  // Aga Khan: name directly after "To:" on a receipt (no extra label)
  /^To\s*:\s*([A-Z][A-Za-z\s.'-]{3,40})/m,
  // Inpatient column-header layout — "Patient" alone on its own line, value
  // on the immediately following line in ALL CAPS, often comma-separated as
  // "SURNAME, GIVEN" (Aga Khan IP cover, MP Shah, Nairobi Hospital discharge
  // headers). Distinct from "Patient: X" (handled above) and "Patient Name:".
  // The `[A-Z]{2,}` lookahead on the first two chars stops single-letter or
  // mixed-case noise from matching.
  /(?:^|\n)\s*Patient\s*(?:Name|Full\s*Name)?\s*\n+\s*([A-Z]{2,}[A-Z,'.\s\-]{2,40}?)(?=\s*(?:\n|DOB|Age|Sex|M\/F|Gender|Reg|Account))/,
];

// Patient ID / registration number patterns
export const PATIENT_ID_PATTERNS = [
  /Patient\s*No\.?\s*[:\-.]?\s*([A-Z]{2,5}[\-/][\w\-/.]{3,25})/i,     // AAR-PID/50340760
  /Reg\s*(?:No|Number)\.?\s*[:\-.]?\s*([A-Z]{1,3}[\-]?\d[\w\-/.]{1,20})/i,  // GN-157616-23
  /(?:OP|IP)\s*(?:No|Number)\.?\s*[:\-.]?\s*(\d[\w\-/.]{2,15})/i,
  /Patient\s*(?:No|ID)\.?\s*[:\-.]?\s*(\d[\w\-/.]{1,15})/i,
  /(?:Registration)\s*(?:No|Number)?\s*[:\-.]?\s*([A-Z0-9][\w\-/.]{2,20})/i,
  /Account\s*Number\s*[:\-.]?\s*([A-Z]{1,4}\d{6,})/i,                  // Aga Khan: "Account Number: UH283003051"
];

// Membership number patterns
export const MEMBERSHIP_PATTERNS = [
  // Aga Khan / Nomad Dental — "HMN NO." label followed by AK value (e.g. AK119067-04)
  /HMN\s*\.?\s*NO\.?\s*[:\-.]?\s*\n?\s*(AK[\d\-]{4,20})/i,                                  // "HMN NO. AK119067-04" (Nomad Dental Centre)
  /HMN\s*\.?\s*NO\.?\s*[:\-.]?\s*([A-Z0-9][\w\-/.]{2,25})/i,                               // Generic HMN NO. fallback
  // Aga Khan first — value may be many lines after "AK Number:" label (PDF multi-column OCR scramble)
  /AK\s*Number\s*[:\-.]?[\s\S]{0,250}?\b(AK[\d\-]{4,20})\b/i,                              // "AK Number: ... AK00565303" or "AK119067-04"
  // Standalone AK value anywhere in text — catches AK codes with or without dashes
  /\b(AK\d{4,}(?:-\d{2,})?)\b/,
  /(?:Membership|Member)\s+(?:No|Number|#|ID)\s*[:\-.]?\s*([A-Z0-9][\w\-/.]{2,25})/i,    // qualifier required — prevents matching casual "Member" text
  /(?:Scheme|Policy)\s*(?:No|Number|#)?\s*[:\-.]?\s*([A-Z0-9][\w\-/.]{2,25})/i,
  /(?:Card|Insurance)\s*(?:No|Number|#)?\s*[:\-.]?\s*([A-Z0-9][\w\-/.]{2,25})/i,
];

// Provider name patterns - institution keywords to look for in header
export const PROVIDER_PATTERNS = [
  /^([A-Z][A-Z\s&'.,-]+(?:HOSPITAL|CENTRE|CENTER|CLINIC|MEDICAL|DENTAL|PHARMACY|FOUNDATION|HEALTH)(?:\s+(?:LTD|LIMITED|PLC|BUNGOMA|NAIROBI|MOMBASA|KISUMU|ELDORET|NAKURU|THIKA|NYERI|MACHAKOS))?)/mi,
  /([A-Z][A-Za-z\s&'.,-]{3,}(?:Hospital|Centre|Center|Clinic|Medical|Dental\s+Centre|Pharmacy|Foundation|Sikh\s+Hospital|Health\s+Centre)(?:\s+(?:Ltd|Limited|PLC|Bungoma|Nairobi))?)/i,
];

// Diagnosis patterns
// Sub-header trap — Aga Khan inpatient discharge summaries render as:
//   Diagnosis:
//   Discharge Diagnosis
//   H28 Cataract in other diseases…
// The literal value we want is on line 3, but a naive `Diagnosis: \n value`
// regex captures line 2 ("Discharge Diagnosis") because that's just another
// header. The `(?:…Diagnosis)?` sub-header skip below burns past any of the
// known label variants and grabs the real value on the next line.
const DIAGNOSIS_SUBHEADER_SKIP =
  '(?:(?:Discharge|Final|Provisional|Working|Admission|Primary|Secondary|Clinical|Differential)\\s+Diagnosis\\s*[:\\-]?\\s*\\n+\\s*)?';

export const DIAGNOSIS_PATTERNS = [
  /(?:Final\s*Diagnosis|Impression|Clinical\s*(?:Diagnosis|Notes?))\s*[:\-]?\s*\n?\s*(.{3,150}?)(?:\n\s*\n|Detailed|Bill|Treatment|$)/is,
  // "Diagnosis:" or "Dx:" label — line-break between label and value (Aga Khan forms).
  new RegExp(`(?:Diagnosis|Dx)\\s*[:\\-]?\\s*\\n+\\s*${DIAGNOSIS_SUBHEADER_SKIP}(.{3,120}?)(?:\\n|$)`, 'is'),
  new RegExp(`(?:Diagnosis)\\s*[:\\-]?\\s*\\n?\\s*${DIAGNOSIS_SUBHEADER_SKIP}(.{3,150}?)(?:\\n\\s*\\n|Invoice|Bill|$)`, 'is'),
  // "Reason for Visit / Complaint / Presenting Complaint"
  /(?:Reason\s+for\s+(?:Visit|Consultation)|Chief\s+Complaint|Presenting\s+Complaint|Complaint)\s*[:\-]\s*(.{3,120}?)(?:\n|$)/i,
  // "Assessment:" or "Clinical Impression:" (discharge summaries)
  /(?:Assessment|Clinical\s+Impression)\s*[:\-]\s*(.{3,150}?)(?:\n\s*\n|$)/is,
  // Standalone common diseases — catches invoice line-item descriptions
  /\b(CELLULITIS|MALARIA|DIABETES(?:\s+MELLITUS)?|HYPERTENSION|PNEUMONIA|FRACTURE|INFECTION|ULCER|ABDOMINAL\s+PAIN|ABSCESS|DENTAL\s+CARIES|GINGIVITIS|PERIODONTITIS|GASTRITIS|ANAEMIA|APPENDICITIS|TONSILLITIS|BRONCHITIS|ASTHMA|ARTHRITIS|URINARY\s+TRACT\s+INFECTION|UTI|UPPER\s+RESPIRATORY\s+(?:TRACT\s+)?INFECTION|URTI|GASTROENTERITIS|ANTENATAL|DIARRHOEA|FEVER|HYPERTENSIVE|TYPHOID|MALNUTRITION|SEPSIS|TRAUMA)\b[A-Z\s\-]*/i,
];

// Service/visit date patterns
export const SERVICE_DATE_PATTERNS = [
  /(?:OP\s*Visit\s*Date|Visit\s*Date|Service\s*Date|Date\s*of\s*(?:Service|Visit|Admission))\s*[:\-.]?\s*(\d{4}[\-/.]\d{1,2}[\-/.]\d{1,2})/i,
  /(?:OP\s*Visit\s*Date|Visit\s*Date|Service\s*Date|Date\s*of\s*(?:Service|Visit))\s*[:\-.]?\s*(\d{1,2}[\-/.]\d{1,2}[\-/.]\d{2,4})/i,
  /(?:OP\s*Visit\s*Date|Visit\s*Date)\s*[:\-.]?\s*([\d\-/.]{5,20})/i,
];

// Insurance company patterns
export const INSURANCE_PATTERNS = [
  /(?:Insurance\s*(?:Co|Company)?|Insurer|Payer)\s*[:\-]?\s*([A-Z][A-Za-z\s&]{3,60}?)\s*(?:Referral|Service|Lab|Radiology|Pharmacy|Consultation|\n|$)/i,
  /(?:Insurance\s*(?:Co|Company)?)\s*[:\-]?\s*([A-Z][A-Za-z\s&]{3,40}(?:Insurance|Limited|Ltd|PLC|Group|Kenya))/i,
];

// Account/employer patterns
export const ACCOUNT_PATTERNS = [
  /Account\s*[:\-]?\s*([A-Z][A-Za-z\s&().,-]{3,60}?)(?:\s*[\-]\s|\n|Lab|Radiology|$)/i,
  /(?:Employer|Company|Scheme\s*Name)\s*[:\-]?\s*([A-Z][A-Za-z\s&().,-]{3,60})/i,
];

// ─────────────────────────────────────────────────────────────────────────────
// Medical Coding: CPT, ICD-10-CM, HCPCS Level II
// ─────────────────────────────────────────────────────────────────────────────

/**
 * CPT (Current Procedural Terminology) codes: 5-digit numeric codes (10000-99999)
 * and Category II/III codes.  E/M codes: 99201-99499.
 */
export const CPT_CODE_PATTERNS = [
  // Explicit label
  /CPT\s*(?:Code|#|No\.?)?\s*[:\-]?\s*(\d{5})/gi,
  /Procedure\s*(?:Code|#|No\.?)?\s*[:\-]?\s*(\d{5})/gi,
  // Table column: 5-digit followed by description
  /^(\d{5})\s+[A-Z][a-z]/gm,
  // Common E/M visit codes standalone
  /(9920[1-5]|9921[1-5]|9920[3-5]|9921[3-5]|99213|99214|99215|99231|99232|99233)/g,
];

/**
 * ICD-10-CM diagnosis codes: letter + 2 digits + optional decimal + up to 4 chars.
 * Valid categories: A-N, P-Z (exclude O used for ICD-10-PCS).
 */
export const ICD10_CODE_PATTERNS = [
  // Explicit label
  /ICD[\-\s]?10\s*(?:Code|Diagnosis|Dx|CM)?\s*[:\-]?\s*([A-HJ-NP-Z]\d{2}(?:\.\d{1,4})?)/gi,
  /(?:Diagnosis|Dx)\s*(?:Code)?\s*[:\-]?\s*([A-HJ-NP-Z]\d{2}(?:\.\d{1,4})?)/gi,
  // Standalone ICD-10 pattern (letter then 2 digits, optionally dot and up to 4)
  /\b([A-HJ-NP-Z]\d{2}(?:\.\d{1,4})?)\b/g,
];

/**
 * HCPCS Level II codes: letter A-V followed by 4 digits (e.g. A0100, J0895).
 */
export const HCPCS_CODE_PATTERNS = [
  /HCPCS\s*(?:Code|#|No\.?)?\s*[:\-]?\s*([A-V]\d{4})/gi,
  // Standalone
  /\b([A-V]\d{4})\b/g,
];

/**
 * Common ICD-10 codes seen on Kenyan medical insurance invoices.
 * Used as a diagnosis-text fallback when only the code is extracted.
 */
export const ICD10_COMMON_LABELS: Record<string, string> = {
  // Chapter I — Infectious / Parasitic
  'A09': 'Gastroenteritis', 'A15': 'Tuberculosis', 'B54': 'Malaria',
  'B05': 'Measles', 'B06': 'Rubella', 'B30': 'Viral conjunctivitis',
  'B34': 'Viral infection',
  // Chapter II — Neoplasms
  'C00': 'Malignant neoplasm of lip', 'C50': 'Breast cancer', 'C67': 'Bladder cancer',
  // Chapter III — Blood
  'D50': 'Iron deficiency anaemia', 'D64': 'Anaemia',
  // Chapter IV — Endocrine / Metabolic
  'E10': 'Type 1 diabetes mellitus', 'E11': 'Type 2 diabetes mellitus',
  'E14': 'Diabetes mellitus', 'E39': 'Urinary disorder', 'E66': 'Obesity',
  // Chapter V — Mental
  'F32': 'Depressive episode', 'F41': 'Anxiety disorder',
  // Chapter VI — Nervous
  'G43': 'Migraine', 'G44': 'Headache',
  // Chapter VII — Eye
  'H00': 'Hordeolum / chalazion', 'H10': 'Conjunctivitis',
  'H25': 'Age-related cataract', 'H26': 'Other cataract',
  'H28': 'Cataract in diseases classified elsewhere',
  'H52': 'Refractive error',
  // Chapter VIII — Ear
  'H66': 'Otitis media', 'H71': 'Cholesteatoma',
  // Chapter IX — Circulatory
  'I10': 'Hypertension', 'I20': 'Angina', 'I25': 'Ischaemic heart disease',
  'I50': 'Heart failure', 'I63': 'Stroke',
  // Chapter X — Respiratory
  'J00': 'Common cold', 'J02': 'Acute pharyngitis', 'J03': 'Acute tonsillitis',
  'J06': 'Upper respiratory tract infection', 'J18': 'Pneumonia',
  'J20': 'Acute bronchitis', 'J30': 'Allergic rhinitis', 'J45': 'Asthma',
  // Chapter XI — Digestive
  'K02': 'Dental caries', 'K05': 'Periodontal disease', 'K21': 'GERD',
  'K25': 'Gastric ulcer', 'K29': 'Gastritis', 'K35': 'Appendicitis',
  'K37': 'Appendicitis', 'K57': 'Diverticular disease', 'K80': 'Cholelithiasis',
  // Chapter XII — Skin
  'L02': 'Cutaneous abscess / furuncle', 'L03': 'Cellulitis',
  'L20': 'Atopic dermatitis', 'L30': 'Dermatitis',
  // Chapter XIII — Musculoskeletal
  'M06': 'Rheumatoid arthritis', 'M10': 'Gout', 'M17': 'Knee arthrosis',
  'M54': 'Back pain',
  // Chapter XIV — Genitourinary
  'N17': 'Acute kidney failure', 'N18': 'Chronic kidney disease',
  'N39': 'Urinary tract infection', 'N40': 'Benign prostatic hyperplasia',
  // Chapter XV — Pregnancy
  'O10': 'Hypertensive disorders in pregnancy', 'O20': 'Haemorrhage in pregnancy',
  'O80': 'Normal delivery', 'O82': 'Caesarean section',
  // Chapter XIX — Injury
  'S00': 'Superficial injury of head', 'S72': 'Fracture of femur',
  'T14': 'Injury', 'T78': 'Adverse effects',
  // Chapter XXI — Z codes
  'Z00': 'General medical examination', 'Z30': 'Contraceptive management',
  'Z34': 'Antenatal care',
};

/** Return the most specific label for a given ICD-10 code, matching longest prefix. */
export function icd10Label(code: string): string {
  const upper = code.toUpperCase().replace('.', '');
  // Try 4-char, then 3-char prefix
  return ICD10_COMMON_LABELS[upper.slice(0, 4)]
    || ICD10_COMMON_LABELS[upper.slice(0, 3)]
    || '';
}

/**
 * Extract all medical codes from text.
 * Returns { cptCodes, icd10Codes, hcpcsCodes, allCodes }
 */
export function extractMedicalCodes(text: string): {
  cptCodes: string[];
  icd10Codes: string[];
  hcpcsCodes: string[];
  allCodes: string[];
} {
  const unique = (arr: string[]) => [...new Set(arr)];

  const cptCodes: string[] = [];
  for (const pat of CPT_CODE_PATTERNS) {
    pat.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pat.exec(text)) !== null) {
      const code = m[1];
      const n = parseInt(code);
      if (!isNaN(n) && n >= 10000 && n <= 99999) cptCodes.push(code);
    }
  }

  const icd10Codes: string[] = [];
  for (const pat of ICD10_CODE_PATTERNS) {
    pat.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pat.exec(text)) !== null) {
      const code = m[1];
      if (/^[A-HJ-NP-Z]\d{2}/.test(code)) icd10Codes.push(code.toUpperCase());
    }
  }

  const hcpcsCodes: string[] = [];
  for (const pat of HCPCS_CODE_PATTERNS) {
    pat.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pat.exec(text)) !== null) {
      const code = m[1];
      if (/^[A-V]\d{4}$/.test(code)) hcpcsCodes.push(code.toUpperCase());
    }
  }

  const allCodes = unique([...cptCodes, ...icd10Codes, ...hcpcsCodes]);
  return {
    cptCodes: unique(cptCodes),
    icd10Codes: unique(icd10Codes),
    hcpcsCodes: unique(hcpcsCodes),
    allCodes,
  };
}
