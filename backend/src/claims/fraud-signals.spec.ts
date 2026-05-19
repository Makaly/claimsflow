import {
  computeFraudSignals,
  providerMismatchSignal,
  normalizeInvoiceNumber,
} from './fraud-signals';

describe('computeFraudSignals', () => {
  const baseClaim = {
    id: 'c1',
    invoiceAmount: 4_500,
    invoiceNumber: 'INV-001',
    memberNumber: 'MEM-42',
    memberName: 'Jane Doe',
    invoiceDate: new Date('2026-05-01'),
    dateOfService: new Date('2026-04-30'),
    ocrConfidence: 0.92,
    aiExtracted: true,
  };

  it('returns no signals for a clean claim', () => {
    const signals = computeFraudSignals(baseClaim);
    expect(signals).toEqual([]);
  });

  describe('round-amount billing', () => {
    it('warns on round amount at 10k threshold', () => {
      const signals = computeFraudSignals({ ...baseClaim, invoiceAmount: 10_000 });
      expect(signals.find((s) => s.title === 'Round-Amount Billing')?.level).toBe('warning');
    });

    it('escalates to critical at 100k', () => {
      const signals = computeFraudSignals({ ...baseClaim, invoiceAmount: 100_000 });
      expect(signals.find((s) => s.title === 'Round-Amount Billing')?.level).toBe('critical');
    });

    it('does not fire for non-round amounts', () => {
      const signals = computeFraudSignals({ ...baseClaim, invoiceAmount: 10_237 });
      expect(signals.find((s) => s.title === 'Round-Amount Billing')).toBeUndefined();
    });
  });

  describe('unknown / missing identity', () => {
    it('fires when member number is empty', () => {
      const signals = computeFraudSignals({ ...baseClaim, memberNumber: '' });
      const sig = signals.find((s) => s.title === 'Unknown / Missing Patient Identity');
      expect(sig?.level).toBe('critical');
    });

    it('fires when patient name contains "unknown"', () => {
      const signals = computeFraudSignals({ ...baseClaim, memberName: 'Unknown Patient' });
      expect(signals.find((s) => s.title === 'Unknown / Missing Patient Identity')).toBeDefined();
    });
  });

  describe('high-value claim', () => {
    it('warns when amount > 200k', () => {
      const signals = computeFraudSignals({ ...baseClaim, invoiceAmount: 250_000 });
      expect(signals.find((s) => s.title === 'High-Value Claim')?.level).toBe('warning');
    });

    it('does not fire at 200k exactly', () => {
      const signals = computeFraudSignals({ ...baseClaim, invoiceAmount: 200_000 });
      // 200k is round and >= 100k so round-amount fires, but not high-value
      expect(signals.find((s) => s.title === 'High-Value Claim')).toBeUndefined();
    });
  });

  describe('duplicate invoice number', () => {
    it('flags duplicate invoice numbers', () => {
      const existing = new Set(['INV-001']);
      const signals = computeFraudSignals(baseClaim, existing, [], [
        { claimNumber: 'CLM-0099', uploadedBy: 'user-x', submittedAt: '2026-05-10' },
      ]);
      const sig = signals.find((s) => s.title === 'Duplicate Invoice Number');
      expect(sig?.level).toBe('critical');
      expect(sig?.meta?.duplicateClaimNumbers).toContain('CLM-0099');
    });
  });

  describe('normalizeInvoiceNumber', () => {
    it('strips whitespace, dashes, underscores, slashes, dots', () => {
      expect(normalizeInvoiceNumber('INV-12345')).toBe('INV12345');
      expect(normalizeInvoiceNumber('INV 12345')).toBe('INV12345');
      expect(normalizeInvoiceNumber('inv_12_345')).toBe('INV12345');
      expect(normalizeInvoiceNumber('INV/12345')).toBe('INV12345');
      expect(normalizeInvoiceNumber('INV.12345')).toBe('INV12345');
    });

    it('returns empty string for nullish input', () => {
      expect(normalizeInvoiceNumber(null)).toBe('');
      expect(normalizeInvoiceNumber(undefined)).toBe('');
      expect(normalizeInvoiceNumber('')).toBe('');
    });
  });

  describe('near-duplicate invoice number', () => {
    it('fires when sibling invoice numbers differ only in punctuation/spacing', () => {
      const siblings = [
        {
          claimNumber: 'CLM-0200',
          invoiceNumber: 'INV001', // baseClaim's "INV-001" normalises to the same
          invoiceAmount: 9_999,
          dateOfService: new Date('2025-12-01'),
        },
      ];
      const signals = computeFraudSignals(
        baseClaim, new Set(), [], [], [], [], siblings,
      );
      const sig = signals.find((s) => s.title === 'Near-Duplicate Invoice Number');
      expect(sig?.level).toBe('critical');
      expect(sig?.meta?.duplicateClaimNumbers).toContain('CLM-0200');
    });

    it('does not fire when exact-duplicate already fired', () => {
      const siblings = [
        {
          claimNumber: 'CLM-0201',
          invoiceNumber: 'INV001',
          invoiceAmount: 9_999,
          dateOfService: new Date('2025-12-01'),
        },
      ];
      const signals = computeFraudSignals(
        baseClaim,
        new Set(['INV-001']),   // exact-match fires
        [],
        [{ claimNumber: 'CLM-0099' }],
        [],
        [],
        siblings,
      );
      expect(signals.find((s) => s.title === 'Duplicate Invoice Number')).toBeDefined();
      expect(signals.find((s) => s.title === 'Near-Duplicate Invoice Number')).toBeUndefined();
    });

    it('does not fire when normalized invoice numbers differ', () => {
      const siblings = [
        {
          claimNumber: 'CLM-0202',
          invoiceNumber: 'INV-002',
          invoiceAmount: 9_999,
          dateOfService: new Date('2025-12-01'),
        },
      ];
      const signals = computeFraudSignals(
        baseClaim, new Set(), [], [], [], [], siblings,
      );
      expect(signals.find((s) => s.title === 'Near-Duplicate Invoice Number')).toBeUndefined();
    });

    it('does not fire on a very short invoice number (less than 4 chars normalised)', () => {
      const claim = { ...baseClaim, invoiceNumber: 'A-1' };
      const siblings = [
        {
          claimNumber: 'CLM-0203',
          invoiceNumber: 'A1',
          invoiceAmount: 9_999,
          dateOfService: new Date('2025-12-01'),
        },
      ];
      const signals = computeFraudSignals(claim, new Set(), [], [], [], [], siblings);
      expect(signals.find((s) => s.title === 'Near-Duplicate Invoice Number')).toBeUndefined();
    });
  });

  describe('same-amount-same-date duplicate', () => {
    it('fires when amount and DOS match within ±2 days and invoice numbers differ', () => {
      const dos = new Date('2026-04-30');
      const siblings = [
        {
          claimNumber: 'CLM-0300',
          invoiceNumber: 'INV-9999', // different invoice number
          invoiceAmount: 4_500,
          dateOfService: dos,
        },
      ];
      const signals = computeFraudSignals(
        baseClaim, new Set(), [], [], [], [], siblings,
      );
      const sig = signals.find((s) => s.title === 'Same-Amount-Same-Date Duplicate');
      expect(sig?.level).toBe('critical');
      expect(sig?.meta?.duplicateClaimNumbers).toContain('CLM-0300');
    });

    it('fires when sibling has no invoice number at all', () => {
      const dos = new Date('2026-04-30');
      const siblings = [
        {
          claimNumber: 'CLM-0301',
          invoiceNumber: null,
          invoiceAmount: 4_500,
          dateOfService: dos,
        },
      ];
      const signals = computeFraudSignals(
        baseClaim, new Set(), [], [], [], [], siblings,
      );
      expect(signals.find((s) => s.title === 'Same-Amount-Same-Date Duplicate')).toBeDefined();
    });

    it('does not fire when amount differs', () => {
      const siblings = [
        {
          claimNumber: 'CLM-0302',
          invoiceNumber: 'INV-9999',
          invoiceAmount: 5_000,  // different
          dateOfService: new Date('2026-04-30'),
        },
      ];
      const signals = computeFraudSignals(
        baseClaim, new Set(), [], [], [], [], siblings,
      );
      expect(signals.find((s) => s.title === 'Same-Amount-Same-Date Duplicate')).toBeUndefined();
    });

    it('does not fire when date is outside the ±2 day window', () => {
      const siblings = [
        {
          claimNumber: 'CLM-0303',
          invoiceNumber: 'INV-9999',
          invoiceAmount: 4_500,
          dateOfService: new Date('2026-04-25'),  // 5 days before
        },
      ];
      const signals = computeFraudSignals(
        baseClaim, new Set(), [], [], [], [], siblings,
      );
      expect(signals.find((s) => s.title === 'Same-Amount-Same-Date Duplicate')).toBeUndefined();
    });

    it('does not fire when sibling invoice number normalises to the same value (caught by 4b)', () => {
      const dos = new Date('2026-04-30');
      const siblings = [
        {
          claimNumber: 'CLM-0304',
          invoiceNumber: 'INV001',  // normalises to INV001, baseClaim is INV-001 → INV001
          invoiceAmount: 4_500,
          dateOfService: dos,
        },
      ];
      const signals = computeFraudSignals(
        baseClaim, new Set(), [], [], [], [], siblings,
      );
      // Should fire near-duplicate, NOT same-amount-same-date.
      expect(signals.find((s) => s.title === 'Near-Duplicate Invoice Number')).toBeDefined();
      expect(signals.find((s) => s.title === 'Same-Amount-Same-Date Duplicate')).toBeUndefined();
    });
  });

  describe('low OCR confidence', () => {
    it('warns when AI-extracted with low confidence', () => {
      const signals = computeFraudSignals({ ...baseClaim, ocrConfidence: 0.5 });
      expect(signals.find((s) => s.title === 'Low OCR Confidence')?.level).toBe('warning');
    });

    it('does not fire when not AI-extracted', () => {
      const signals = computeFraudSignals({ ...baseClaim, ocrConfidence: 0.5, aiExtracted: false });
      expect(signals.find((s) => s.title === 'Low OCR Confidence')).toBeUndefined();
    });
  });

  describe('date sequence sanity', () => {
    it('flags service date after invoice date when both historical', () => {
      const signals = computeFraudSignals({
        ...baseClaim,
        invoiceDate: new Date('2026-01-01'),
        dateOfService: new Date('2026-02-01'),
      });
      expect(signals.find((s) => s.title === 'Impossible Date Sequence')?.level).toBe('critical');
    });

    it('flags future-dated invoice', () => {
      const future = new Date(); future.setDate(future.getDate() + 30);
      const signals = computeFraudSignals({ ...baseClaim, invoiceDate: future });
      expect(signals.find((s) => s.title === 'Future-Dated Invoice')?.level).toBe('critical');
    });

    it('flags stale claims older than 90 days', () => {
      const old = new Date(); old.setDate(old.getDate() - 120);
      const signals = computeFraudSignals({ ...baseClaim, dateOfService: old });
      expect(signals.find((s) => s.title === 'Stale Claim — Service Over 90 Days Old')).toBeDefined();
    });
  });

  describe('batch-level signals', () => {
    it('warns when same member appears in batch siblings', () => {
      const siblings = [{ memberNumber: 'MEM-42', invoiceAmount: 1000 }];
      const signals = computeFraudSignals(baseClaim, new Set(), siblings);
      expect(signals.find((s) => s.title === 'Member Appears Multiple Times in Batch')).toBeDefined();
    });

    it('escalates to critical when member and amount both match', () => {
      const siblings = [{ memberNumber: 'MEM-42', invoiceAmount: 4_500 }];
      const signals = computeFraudSignals(baseClaim, new Set(), siblings);
      expect(
        signals.find((s) => s.title === 'Duplicate Member + Amount in Same Batch')?.level,
      ).toBe('critical');
    });
  });
});

describe('providerMismatchSignal', () => {
  it('returns critical signal with both provider names embedded', () => {
    const sig = providerMismatchSignal('Clinic A', 'Clinic B');
    expect(sig.level).toBe('critical');
    expect(sig.detail).toContain('Clinic A');
    expect(sig.detail).toContain('Clinic B');
  });
});
