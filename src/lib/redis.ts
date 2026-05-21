// ============================================================
// Redis Client — Connection for cache, sessions, and queues
// Falls back gracefully in development if Redis is unavailable
// ============================================================

import Redis from 'ioredis';
import { config } from '../config';
import { logger } from './logger';

let redis: Redis;
let redisAvailable = false;

try {
  // Use REDIS_URL connection string (Render) or fall back to host/port (local dev)
  const redisOptions: any = {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
    retryStrategy(times: number) {
      if (times > 3) {
        logger.warn('Redis unavailable — using in-memory fallback for development');
        return null; // Stop retrying
      }
      return Math.min(times * 200, 2000);
    },
  };

  if (config.redis.url) {
    redis = new Redis(config.redis.url, redisOptions);
  } else {
    redis = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
      ...redisOptions,
    });
  }

  redis.on('connect', () => {
    redisAvailable = true;
    logger.info('✅ Redis connected');
  });

  redis.on('error', (err) => {
    if (redisAvailable) {
      logger.error('❌ Redis connection error', { error: err.message });
    }
    redisAvailable = false;
  });

  redis.on('close', () => {
    redisAvailable = false;
  });

  // Try to connect
  redis.connect().catch(() => {
    logger.warn('⚠️  Redis not available — using in-memory store for OTP/sessions');
  });
} catch {
  logger.warn('⚠️  Redis initialization failed — using in-memory fallback');
  redis = null as any;
}

// In-memory fallback store for development without Redis
const memoryStore = new Map<string, { value: string; expiresAt: number }>();

/**
 * Redis-compatible get/set/del with in-memory fallback
 */
export const cache = {
  async get(key: string): Promise<string | null> {
    if (redisAvailable && redis) {
      return redis.get(key);
    }
    const item = memoryStore.get(key);
    if (!item) return null;
    if (Date.now() > item.expiresAt) {
      memoryStore.delete(key);
      return null;
    }
    return item.value;
  },

  async set(key: string, value: string, mode?: string, ttl?: number): Promise<void> {
    if (redisAvailable && redis) {
      if (mode === 'EX' && ttl) {
        await redis.set(key, value, 'EX', ttl);
      } else if (mode === 'KEEPTTL') {
        // Get remaining TTL before setting
        await redis.set(key, value, 'KEEPTTL');
      } else {
        await redis.set(key, value);
      }
      return;
    }
    // In-memory fallback
    const expiresAt = ttl ? Date.now() + ttl * 1000 : Date.now() + 3600000; // 1hr default
    memoryStore.set(key, { value, expiresAt });
  },

  async del(key: string): Promise<void> {
    if (redisAvailable && redis) {
      await redis.del(key);
      return;
    }
    memoryStore.delete(key);
  },

  async ping(): Promise<string> {
    if (redisAvailable && redis) {
      return redis.ping();
    }
    return 'PONG (memory)';
  },

  isAvailable(): boolean {
    return redisAvailable;
  },
};

export { redis };
