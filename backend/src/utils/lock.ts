import { redis } from './redis';
import crypto from 'crypto';
import logger from './logger';

/**
 * Lightweight Redis-based mutual-exclusion lock.
 *
 * Used to serialise money-moving operations (escrow fund / release) so that two
 * concurrent requests for the same job cannot both pass a "check status" step
 * and then both act on it — the classic time-of-check-to-time-of-use race that
 * enables double-spend / double-release (PortSwigger: "Race conditions").
 *
 * The lock is acquired with SET NX (atomic) and carries a random owner token so
 * we only ever release a lock we still hold (released via a compare-and-delete
 * Lua script to avoid deleting someone else's lock after a TTL expiry).
 */
const RELEASE_SCRIPT =
  'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';

export async function withLock<T>(
  key: string,
  fn: () => Promise<T>,
  ttlMs = 10000
): Promise<{ acquired: false } | { acquired: true; result: T }> {
  const lockKey = `lock:${key}`;
  const token = crypto.randomUUID();

  const acquired = await redis.set(lockKey, token, 'PX', ttlMs, 'NX');
  if (acquired !== 'OK') {
    return { acquired: false };
  }

  try {
    const result = await fn();
    return { acquired: true, result };
  } finally {
    try {
      await redis.eval(RELEASE_SCRIPT, 1, lockKey, token);
    } catch (error) {
      logger.warn('Failed to release lock — will expire via TTL', {
        lockKey,
        error: (error as Error).message
      });
    }
  }
}
