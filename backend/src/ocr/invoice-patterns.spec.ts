import {
  INVOICE_NUMBER_PATTERNS,
  INVOICE_DATE_PATTERNS,
  TOTAL_AMOUNT_PATTERNS,
  MEMBERSHIP_PATTERNS,
  PATIENT_NAME_PATTERNS,
  extractMedicalCodes,
} from './invoice-patterns';

function firstMatch(patterns: RegExp[], text: string): string | null {
  for (const pat of patterns) {
    pat.lastIndex = 0;
    const m = text.match(pat);
    if (m && m[1]) return m[1];
  }
  return null;
}

describe('OCR invoice patterns', () => {
  describe('invoice number extraction', () => {
    it.each([
      ['Invoice No: AAR-INV/2023570583', 'AAR-INV/2023570583'],
      ['Invoice Number: CB-126133-23', 'CB-126133-23'],
      ['Invoice # ZMC2024/02432', 'ZMC2024/02432'],
      ['Invoice No: Nyr/13277', 'Nyr/13277'],
      ['Invoice No: INV-2024-001', 'INV-2024-001'],
    ])('parses %s', (input, expected) => {
      expect(firstMatch(INVOICE_NUMBER_PATTERNS, input)).toBe(expected);
    });

    it('does not match unrelated numeric strings without context', () => {
      // Pure number with no "Invoice" prefix should not return invoice number
      expect(firstMatch(INVOICE_NUMBER_PATTERNS, 'Phone: 0712345678')).not.toBe('0712345678');
    });
  });

  describe('invoice date extraction', () => {
    it.each([
      ['Invoice Date: 2024-02-19', '2024-02-19'],
      ['Invoice Date: 22/12/2023', '22/12/2023'],
      ['Invoice Date: 18/Dec/2023', '18/Dec/2023'],
    ])('parses %s', (input, expected) => {
      expect(firstMatch(INVOICE_DATE_PATTERNS, input)).toBe(expected);
    });
  });

  describe('total amount extraction', () => {
    it('extracts grand total', () => {
      expect(firstMatch(TOTAL_AMOUNT_PATTERNS, 'Grand Total: KES 12,500.00')).toBe('12,500.00');
    });

    it('prefers Sponsor Coverage on Aga Khan inpatient invoices', () => {
      const text = `
        Your Amount Due: 0.02
        Sponsor Coverage:
        AAA Corporate   990,000.00
      `;
      expect(firstMatch(TOTAL_AMOUNT_PATTERNS, text)).toBe('990,000.00');
    });
  });

  describe('membership number extraction', () => {
    it('extracts AK numbers regardless of suffix style', () => {
      expect(firstMatch(MEMBERSHIP_PATTERNS, 'HMN NO. AK119067-04')).toBe('AK119067-04');
      expect(firstMatch(MEMBERSHIP_PATTERNS, 'AK Number: AK00565303')).toBe('AK00565303');
    });

    it('extracts standalone AK code with dash suffix', () => {
      expect(firstMatch(MEMBERSHIP_PATTERNS, 'Patient: jane doe AK119067-04 dob 1980')).toBe('AK119067-04');
    });
  });

  describe('patient name extraction', () => {
    it('parses Aga Khan discharge header pattern', () => {
      expect(firstMatch(PATIENT_NAME_PATTERNS, 'Patient: NYIKA,DAVID\nDOB 1980')).toBe('NYIKA,DAVID');
    });

    it('parses generic Name: label', () => {
      const out = firstMatch(PATIENT_NAME_PATTERNS, 'Patient Name: JANE DOE\nInvoice No.');
      expect(out).toBe('JANE DOE');
    });
  });
});

describe('extractMedicalCodes', () => {
  it('returns empty arrays on text with no codes', () => {
    const result = extractMedicalCodes('Patient name and some notes only.');
    expect(result.cptCodes).toEqual([]);
    expect(result.icd10Codes).toEqual([]);
    expect(result.hcpcsCodes).toEqual([]);
    expect(result.allCodes).toEqual([]);
  });

  it('dedupes repeated codes', () => {
    const text = 'Diagnosis: J06.9, J06.9 Resolved. Follow-up J06.9.';
    const result = extractMedicalCodes(text);
    expect(result.icd10Codes.filter((c) => c === 'J06.9').length).toBe(1);
  });

  it('matches ICD-10 patterns case-sensitively and returns valid codes', () => {
    const result = extractMedicalCodes('Codes: E39 and J06.9 plus K29.0');
    expect(result.icd10Codes).toEqual(expect.arrayContaining(['E39', 'J06.9', 'K29.0']));
  });

  it('skips I-prefix and O-prefix codes (ambiguous with digits 1/0)', () => {
    const result = extractMedicalCodes('Codes: I99 O42');
    expect(result.icd10Codes).not.toContain('I99');
    expect(result.icd10Codes).not.toContain('O42');
  });
});
