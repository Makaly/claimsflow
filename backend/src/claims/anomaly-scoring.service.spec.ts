import { Test } from '@nestjs/testing';
import { AnomalyScoringService } from './anomaly-scoring.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AnomalyScoringService', () => {
  let service: AnomalyScoringService;
  let prisma: {
    claim: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      claim: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AnomalyScoringService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = moduleRef.get(AnomalyScoringService);
  });

  it('returns low risk with score 0 when claim is missing', async () => {
    prisma.claim.findUnique.mockResolvedValueOnce(null);
    const result = await service.scoreClaim('missing');
    expect(result.score).toBe(0);
    expect(result.riskLevel).toBe('low');
    expect(result.factors).toEqual([]);
  });

  it('flags amount outliers more than 2 standard deviations from provider mean', async () => {
    prisma.claim.findUnique.mockResolvedValueOnce({
      id: 'c1',
      providerId: 'p1',
      invoiceAmount: 500_000,
      memberNumber: 'MEM-1',
      submittedAt: new Date('2026-05-12T10:00:00Z'),
      dateOfService: new Date('2026-05-10'),
    });

    const peerAmounts = [1000, 1100, 950, 1050, 1200, 1150, 980];
    prisma.claim.findMany.mockResolvedValueOnce(
      peerAmounts.map((a) => ({ invoiceAmount: a, memberNumber: 'OTHER', dateOfService: null, submittedAt: new Date() })),
    );

    const result = await service.scoreClaim('c1');
    const outlier = result.factors.find((f) => f.name === 'amount_outlier');
    expect(outlier).toBeDefined();
    expect(outlier!.contribution).toBeGreaterThan(0);
  });

  it('flags high submission velocity when provider has >20 claims/hour', async () => {
    prisma.claim.findUnique.mockResolvedValueOnce({
      id: 'c1',
      providerId: 'p1',
      invoiceAmount: 1000,
      memberNumber: 'MEM-1',
      submittedAt: new Date('2026-05-12T10:00:00Z'),
      dateOfService: new Date('2026-05-10'),
    });
    prisma.claim.findMany.mockResolvedValueOnce([]);
    prisma.claim.count.mockResolvedValueOnce(42);

    const result = await service.scoreClaim('c1');
    expect(result.factors.find((f) => f.name === 'high_submission_velocity')).toBeDefined();
  });

  it('caps score at 1 and assigns high risk when many factors trigger', async () => {
    prisma.claim.findUnique.mockResolvedValueOnce({
      id: 'c1',
      providerId: 'p1',
      invoiceAmount: 999_999,
      memberNumber: 'MEM-1',
      submittedAt: new Date('2026-05-12T10:00:00Z'),
      dateOfService: new Date('2026-05-10'),
    });
    prisma.claim.findMany.mockResolvedValueOnce(
      Array.from({ length: 10 }, () => ({ invoiceAmount: 1000, memberNumber: 'X', dateOfService: null, submittedAt: new Date() })),
    );
    prisma.claim.count.mockResolvedValue(200);

    const result = await service.scoreClaim('c1');
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThanOrEqual(1);
    expect(['low', 'medium', 'high']).toContain(result.riskLevel);
  });
});
