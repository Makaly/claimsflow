import { Test } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaService } from './prisma/prisma.service';

describe('AppController', () => {
  let controller: AppController;

  beforeAll(async () => {
    // PrismaService is only exercised by the /ready endpoint; the /health
    // and / endpoints don't need it, so a minimal mock keeps the test
    // hermetic (no real DB connection at unit-test time).
    const prismaMock = { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) };

    const moduleRef = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    controller = moduleRef.get(AppController);
  });

  it('responds to GET / with a greeting', () => {
    expect(typeof controller.getHello()).toBe('string');
  });

  it('exposes a healthcheck with ok status and ISO timestamp', () => {
    const result = controller.getHealth();
    expect(result.status).toBe('ok');
    expect(() => new Date(result.timestamp).toISOString()).not.toThrow();
  });
});
