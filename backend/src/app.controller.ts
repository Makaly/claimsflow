import { Controller, Get, HttpCode, HttpStatus, Logger, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { AppService } from './app.service';
import { PrismaService } from './prisma/prisma.service';
import Redis from 'ioredis';
import { getRedisConnection } from './config/redis.config';

@Controller()
export class AppController {
  private readonly logger = new Logger(AppController.name);
  private redisClient: Redis | null = null;

  constructor(
    private readonly appService: AppService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  // /api/health is a *liveness* probe — fast, dependency-free. Render's
  // healthCheckPath points here today. The probe is exempt from the global
  // and auth throttlers because edge nodes share an egress IP pool and
  // would otherwise trip the rate limit and look unhealthy.
  //
  // For a deeper check that actually exercises DB and Redis, see /api/ready.
  @SkipThrottle({ global: true, auth: true })
  @Get('health')
  getHealth() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  // Readiness probe — exercises Prisma + Redis with a 500ms budget per
  // check. Returns 503 when a dependency is unreachable so the orchestrator
  // can keep a half-broken pod out of rotation. Skipped from throttling
  // for the same reason as /api/health.
  @SkipThrottle({ global: true, auth: true })
  @Get('ready')
  async getReady(@Res() res: any) {
    const started = Date.now();
    const [db, redis] = await Promise.all([
      this.checkDb(),
      this.checkRedis(),
    ]);
    const ok = db.ok && redis.ok;
    const body = {
      status: ok ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      checks: { db, redis },
      durationMs: Date.now() - started,
    };
    res.status(ok ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE).json(body);
  }

  private async checkDb(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const t0 = Date.now();
    try {
      await this.withTimeout(this.prisma.$queryRaw`SELECT 1`, 500);
      return { ok: true, latencyMs: Date.now() - t0 };
    } catch (e: any) {
      this.logger.warn(`db readiness failed in ${Date.now() - t0}ms: ${e?.message}`);
      return { ok: false, latencyMs: Date.now() - t0, error: 'db_unreachable' };
    }
  }

  private async checkRedis(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const t0 = Date.now();
    try {
      if (!this.redisClient) {
        const conn = getRedisConnection() as any;
        // Dedicated lightweight client — don't borrow from BullMQ's pool
        // (which uses maxRetriesPerRequest=null and would queue forever).
        this.redisClient = new Redis({
          host: conn.host,
          port: conn.port,
          password: conn.password,
          db: conn.db,
          family: conn.family,
          connectTimeout: 500,
          maxRetriesPerRequest: 1,
          lazyConnect: false,
        });
        this.redisClient.on('error', () => { /* swallowed — surfaced via PING */ });
      }
      const pong = await this.withTimeout(this.redisClient.ping(), 500);
      if (pong !== 'PONG') throw new Error('unexpected_response');
      return { ok: true, latencyMs: Date.now() - t0 };
    } catch (e: any) {
      this.logger.warn(`redis readiness failed in ${Date.now() - t0}ms: ${e?.message}`);
      return { ok: false, latencyMs: Date.now() - t0, error: 'redis_unreachable' };
    }
  }

  private withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
      p,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), ms),
      ),
    ]);
  }
}
