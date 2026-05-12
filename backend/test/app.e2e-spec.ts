import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppController } from '../src/app.controller';
import { AppService } from '../src/app.service';

/**
 * Lightweight e2e: boots only AppController so we can validate the
 * health/greeting endpoints over HTTP without spinning up Prisma, Redis,
 * BullMQ, or the rest of the AppModule graph (which need infra in CI).
 *
 * Full-stack e2e against AppModule lives in `e2e/full-stack.e2e-spec.ts`
 * and is gated on `RUN_FULL_E2E=1` so it only runs when infra is wired.
 */
describe('App (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health returns ok status', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.timestamp).toBe('string');
  });

  it('GET / returns a string greeting', async () => {
    const res = await request(app.getHttpServer()).get('/').expect(200);
    expect(typeof res.text).toBe('string');
  });

  it('rejects unknown routes with 404', async () => {
    await request(app.getHttpServer()).get('/does-not-exist').expect(404);
  });
});
