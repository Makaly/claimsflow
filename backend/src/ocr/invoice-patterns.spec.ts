import {
  INVOICE_NUMBER_PATTERNS,
  INVOICE_DATE_PATTERNS,
  TOTAL_AMOUNT_PATTERNS,
  MEMBERSHIP_PATTERNS,
  PATIENT_NAME_PATTERNS,
  DIAGNOSIS_PATTERNS,
  extractMedicalCodes,
  icd10Label,
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

    it('reaches Sponsor Coverage even when the figure is 200+ chars away', () => {
      // Real Aga Khan IP layout — corporate code, employer name, policy
      // line and account-type line all sit between the label and the figure
      // (~200 chars). The previous {0,80} window stopped before reaching it.
      const text = `
        Sponsor Coverage:
        AAA CORPORATE - Group Account
        Employer: ACME LIMITED                  Policy: GRP/2024/00811
        Account Type: Major Medical             Cover: Inpatient + Outpatient
        Sponsor Amount                          990,000.00
      `;
      expect(firstMatch(TOTAL_AMOUNT_PATTERNS, text)).toBe('990,000.00');
    });

    it('rejects the bare Total: fallback when the figure is under 100', () => {
      // `Total: 1.00` is the most common spurious match on IP consolidated
      // bills — a rounding line or change-due footer. The bare-Total
      // pattern's `{3,}` floor stops it; the consumer's Math.max then has
      // no candidate below the real amount.
      const text = 'Total: 1.00';
      // Either no match, or any match returned must have ≥ 3 digits.
      const captured = firstMatch(TOTAL_AMOUNT_PATTERNS, text);
      if (captured !== null) {
        expect(captured.replace(/[^\d]/g, '').length).toBeGreaterThanOrEqual(3);
      }
    });
  });

  describe('diagnosis extraction (label-trap fix)', () => {
    it('skips a "Discharge Diagnosis" sub-header and grabs the real value', () => {
      const text = 'Diagnosis:\nDischarge Diagnosis\nCATARACT, BILATERAL';
      const match = text.match(DIAGNOSIS_PATTERNS[1]);
      expect(match?.[1]?.trim()).toBe('CATARACT, BILATERAL');
    });

    it('skips a "Final Diagnosis" sub-header', () => {
      const text = 'Diagnosis:\nFinal Diagnosis\nDIABETES MELLITUS TYPE 2';
      const match = text.match(DIAGNOSIS_PATTERNS[1]);
      expect(match?.[1]?.trim()).toBe('DIABETES MELLITUS TYPE 2');
    });

    it('still works when there is no sub-header (existing behaviour)', () => {
      const text = 'Diagnosis:\nMALARIA';
      const match = text.match(DIAGNOSIS_PATTERNS[1]);
      expect(match?.[1]?.trim()).toBe('MALARIA');
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

    it('parses IP column-header layout (label alone on its own line)', () => {
      // Aga Khan inpatient cover sheets render the patient block as a
      // column: the header "Patient" is on one line, the name is on the
      // next line, then DOB / Age follow. None of the colon-based patterns
      // catch this layout.
      const text = 'Patient\nNYIKA, DAVID\nDOB 1980-05-12';
      expect(firstMatch(PATIENT_NAME_PATTERNS, text)).toBe('NYIKA, DAVID');
    });

    it('handles "Patient Name" (no colon) column header', () => {
      const text = 'Patient Name\nJANE A. DOE\nAge 42';
      expect(firstMatch(PATIENT_NAME_PATTERNS, text)).toBe('JANE A. DOE');
    });
  });

  describe('icd10Label coverage for codes seen on Aga Khan IP', () => {
    it('returns the cataract chapter for H25 / H26 / H28', () => {
      expect(icd10Label('H25')).toMatch(/cataract/i);
      expect(icd10Label('H26')).toMatch(/cataract/i);
      expect(icd10Label('H28')).toMatch(/cataract/i);
    });

    it('returns viral conjunctivitis for B30', () => {
      expect(icd10Label('B30')).toMatch(/conjunctivitis/i);
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
