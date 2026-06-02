import { InvoiceFanoutService } from './invoice-fanout.service';

jest.mock('fs', () => ({
  existsSync: jest.fn(() => true),
  statSync: jest.fn(() => ({ size: 4096 })),
}));

/** Build a service with controllable mocks for every collaborator. */
function makeService() {
  const prisma = {
    claim: {
      findUnique: jest.fn().mockResolvedValue({
        batchId: 'batch-1',
        batchNumber: '20260602-001',
        providerId: 'prov-1',
        branchId: 'branch-1',
        sourcePlatform: 'android',
        appVersion: '1.4.0',
        deviceInfo: 'Pixel',
        createdBy: 'user@cic.co.ke',
      }),
      count: jest.fn().mockResolvedValue(1), // one claim already in the batch → next folio seq = 2
      create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: `claim-${data.folioNumber}`, ...data })),
    },
    document: {
      create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: `doc-${data.folioNumber}`, ...data })),
    },
  };
  const barcodeService = {
    generateFolioNumber: jest.fn((n: number) => String(n).padStart(5, '0')),
    generateClaimBarcode: jest.fn((batch: string, folio: string) => Promise.resolve(`CIC-${batch}-${folio}`)),
    generateBarcodeImage: jest.fn().mockResolvedValue(Buffer.from('png')),
  };
  const pdfWatermarkService = {
    addWatermarkAndBarcode: jest.fn().mockResolvedValue('out.pdf'),
    getPageCount: jest.fn().mockResolvedValue(2),
  };
  const pdfOperations = {
    splitPdf: jest.fn().mockResolvedValue(['out.pdf']),
  };
  const ocrQueue = { add: jest.fn().mockResolvedValue(undefined) };

  const service = new InvoiceFanoutService(
    prisma as any,
    barcodeService as any,
    pdfWatermarkService as any,
    pdfOperations as any,
    ocrQueue as any,
  );
  return { service, prisma, barcodeService, pdfWatermarkService, pdfOperations, ocrQueue };
}

describe('InvoiceFanoutService', () => {
  describe('parsePageRange', () => {
    const { service } = makeService();
    it('parses a range "1-3"', () => expect(service.parsePageRange('1-3')).toEqual({ start: 1, end: 3 }));
    it('parses a single page "4" as 4-4', () => expect(service.parsePageRange('4')).toEqual({ start: 4, end: 4 }));
    it('tolerates whitespace', () => expect(service.parsePageRange(' 2 - 5 ')).toEqual({ start: 2, end: 5 }));
    it('rejects inverted ranges', () => expect(service.parsePageRange('5-2')).toBeNull());
    it('rejects zero/negative starts', () => expect(service.parsePageRange('0-2')).toBeNull());
    it('rejects garbage', () => expect(service.parsePageRange('abc')).toBeNull());
    it('rejects empty/null', () => {
      expect(service.parsePageRange('')).toBeNull();
      expect(service.parsePageRange(null)).toBeNull();
      expect(service.parsePageRange(undefined)).toBeNull();
    });
  });

  describe('isEnabled', () => {
    const prev = process.env.ENABLE_INVOICE_FANOUT;
    afterEach(() => { process.env.ENABLE_INVOICE_FANOUT = prev; });
    it('is off by default', () => { delete process.env.ENABLE_INVOICE_FANOUT; expect(InvoiceFanoutService.isEnabled()).toBe(false); });
    it('is on only for the literal "true"', () => {
      process.env.ENABLE_INVOICE_FANOUT = 'true';
      expect(InvoiceFanoutService.isEnabled()).toBe(true);
      process.env.ENABLE_INVOICE_FANOUT = '1';
      expect(InvoiceFanoutService.isEnabled()).toBe(false);
    });
  });

  describe('fanOut', () => {
    const baseParams = {
      parentClaimId: 'claim-parent',
      sourcePdfPath: '/tmp/uploads/processed_doc.pdf',
      mimetype: 'application/pdf',
      model: 'gemini',
    };

    it('does nothing for a single invoice', async () => {
      const { service, prisma } = makeService();
      const res = await service.fanOut({ ...baseParams, invoices: [{ pageRange: '1-2' }] });
      expect(res).toEqual({ created: 0, skipped: 0 });
      expect(prisma.claim.create).not.toHaveBeenCalled();
    });

    it('skips non-PDF sources', async () => {
      const { service, pdfOperations } = makeService();
      const res = await service.fanOut({
        ...baseParams,
        mimetype: 'image/jpeg',
        sourcePdfPath: '/tmp/uploads/photo.jpg',
        invoices: [{ pageRange: '1' }, { pageRange: '2' }],
      });
      expect(res.created).toBe(0);
      expect(pdfOperations.splitPdf).not.toHaveBeenCalled();
    });

    it('creates one sibling claim + document per EXTRA invoice', async () => {
      const { service, prisma, pdfOperations, pdfWatermarkService, ocrQueue } = makeService();
      const res = await service.fanOut({
        ...baseParams,
        invoices: [{ pageRange: '1-2' }, { pageRange: '3-4' }, { pageRange: '5' }],
      });

      expect(res).toEqual({ created: 2, skipped: 0 });
      // Two siblings → two of everything (index 0 is left to the parent claim).
      expect(prisma.claim.create).toHaveBeenCalledTimes(2);
      expect(prisma.document.create).toHaveBeenCalledTimes(2);
      expect(pdfWatermarkService.addWatermarkAndBarcode).toHaveBeenCalledTimes(2);

      // Split ranges come from invoices[1] and invoices[2].
      expect(pdfOperations.splitPdf.mock.calls[0][1][0]).toMatchObject({ start: 3, end: 4 });
      expect(pdfOperations.splitPdf.mock.calls[1][1][0]).toMatchObject({ start: 5, end: 5 });

      // Distinct, sequential folios continuing after the batch's existing claim.
      const folios = prisma.claim.create.mock.calls.map((c: any) => c[0].data.folioNumber);
      expect(folios).toEqual(['00002', '00003']);

      // Each sibling is re-enqueued through the normal pipeline as a fan-out child.
      expect(ocrQueue.add).toHaveBeenCalledTimes(2);
      for (const call of ocrQueue.add.mock.calls) {
        expect(call[0]).toBe('extract-text');
        expect(call[1]).toMatchObject({ fanoutChild: true, mimetype: 'application/pdf' });
      }
    });

    it('inherits batch/provider/source metadata from the parent claim', async () => {
      const { service, prisma } = makeService();
      await service.fanOut({ ...baseParams, invoices: [{ pageRange: '1' }, { pageRange: '2' }] });
      const data = prisma.claim.create.mock.calls[0][0].data;
      expect(data).toMatchObject({
        batchId: 'batch-1',
        batchNumber: '20260602-001',
        providerId: 'prov-1',
        branchId: 'branch-1',
        sourcePlatform: 'android',
        status: 'submitted',
        barcode: 'CIC-20260602-001-00002',
      });
    });

    it('skips an invoice with an unusable pageRange but keeps going', async () => {
      const { service, prisma } = makeService();
      const res = await service.fanOut({
        ...baseParams,
        invoices: [{ pageRange: '1' }, { pageRange: 'garbage' }, { pageRange: '3' }],
      });
      expect(res).toEqual({ created: 1, skipped: 1 });
      expect(prisma.claim.create).toHaveBeenCalledTimes(1);
    });

    it('retries with the next folio on a unique-barcode collision', async () => {
      const { service, prisma } = makeService();
      // First create races a concurrent fan-out and hits the unique constraint.
      prisma.claim.create
        .mockRejectedValueOnce({ code: 'P2002' })
        .mockImplementation(({ data }: any) => Promise.resolve({ id: `claim-${data.folioNumber}`, ...data }));

      const res = await service.fanOut({ ...baseParams, invoices: [{ pageRange: '1' }, { pageRange: '2' }] });
      expect(res).toEqual({ created: 1, skipped: 0 });
      // seq 2 collided → retried at seq 3.
      const folios = prisma.claim.create.mock.calls.map((c: any) => c[0].data.folioNumber);
      expect(folios).toEqual(['00002', '00003']);
    });
  });
});
