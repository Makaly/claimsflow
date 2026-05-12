import { ConnectionOptions } from 'bullmq';

export function getRedisConnection(): ConnectionOptions {
  return {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB || '0', 10),
    // BullMQ requires these two flags on the ioredis connection
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    // Socket performance
    keepAlive: 30_000,
    family: 4,             // force IPv4 — avoids slow DNS dual-stack lookups
    connectTimeout: 5_000,
    // Exponential backoff reconnect: 50ms → 100ms → 200ms … capped at 30s
    retryStrategy: (times: number) => Math.min(50 * 2 ** times, 30_000),
  };
}
