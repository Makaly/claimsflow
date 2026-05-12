import { computeFraudSignals, providerMismatchSignal } from './fraud-signals';

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
