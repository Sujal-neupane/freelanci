import dotenv from 'dotenv';
import { Redis } from 'ioredis';
import path from 'path';
import logger from './logger';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

/**
 * Singleton Redis client instance.
 * Separated into its own file to avoid circular dependencies between app.ts and middleware files.
 * ioredis will automatically authenticate using the password in the REDIS_URL.
 */
export const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  // Keep startup responsive if Redis is temporarily unavailable.
  maxRetriesPerRequest: 1,
  enableOfflineQueue: true,
  connectTimeout: 5000,
  retryStrategy: (times) => Math.min(times * 50, 2000)
});

redis.on('connect', () => logger.info('Redis connected'));
redis.on('error', (err) => logger.error('Redis error', { error: err.message }));
