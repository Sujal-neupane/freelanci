import { redis } from '../utils/redis';
import { createAuditLog } from './auditService';
import logger from '../utils/logger';

const MAX_ATTEMPTS = 12;
const LOCKOUT_DURATION = 30 * 60; // 30 minutes in seconds
const ATTEMPT_WINDOW = 30 * 60;   // 30 minutes in seconds

// Export MAX_ATTEMPTS so authService can use it for remaining attempts calculation
export { MAX_ATTEMPTS };

type LockoutEntry = {
  attempts: number;
  attemptExpiresAt: number;
  lockExpiresAt?: number;
};

// Development fallback when Redis is unavailable or slow.
const fallbackLockouts = new Map<string, LockoutEntry>();

function getFallbackEntry(email: string): LockoutEntry | undefined {
  const entry = fallbackLockouts.get(email);
  if (!entry) return undefined;

  const now = Date.now();
  if (entry.lockExpiresAt && entry.lockExpiresAt <= now) {
    fallbackLockouts.delete(email);
    return undefined;
  }

  if (entry.attemptExpiresAt <= now && !entry.lockExpiresAt) {
    fallbackLockouts.delete(email);
    return undefined;
  }

  return entry;
}

/**
 * Checks if an account is currently locked out.
 * Returns lockout status, remaining time, and attempt count.
 */
export async function checkLockout(email: string): Promise<{
  locked: boolean;
  remainingSeconds: number;
  attempts: number;
}> {
  const lockKey = `login:locked:${email}`;
  const attemptKey = `login:failed:${email}`;

  try {
    const [lockTTL, attempts] = await Promise.all([
      redis.ttl(lockKey),
      redis.get(attemptKey)
    ]);

    if (lockTTL > 0) {
      return {
        locked: true,
        remainingSeconds: lockTTL,
        attempts: parseInt(attempts || '0', 10)
      };
    }

    return {
      locked: false,
      remainingSeconds: 0,
      attempts: parseInt(attempts || '0', 10)
    };
  } catch (error) {
    logger.warn('Redis lockout check failed, using in-memory fallback', {
      email,
      error: (error as Error).message
    });

    const entry = getFallbackEntry(email);
    if (!entry) {
      return { locked: false, remainingSeconds: 0, attempts: 0 };
    }

    if (entry.lockExpiresAt && entry.lockExpiresAt > Date.now()) {
      return {
        locked: true,
        remainingSeconds: Math.ceil((entry.lockExpiresAt - Date.now()) / 1000),
        attempts: entry.attempts
      };
    }

    return {
      locked: false,
      remainingSeconds: 0,
      attempts: entry.attempts
    };
  }
}

/**
 * Records a failed login attempt in Redis.
 * After MAX_ATTEMPTS failures, locks the account for LOCKOUT_DURATION.
 * All lockout events are logged to the audit table.
 */
export async function recordFailedAttempt(
  email: string,
  ip: string,
  userAgent: string
): Promise<{ locked: boolean; attempts: number; remainingSeconds: number }> {
  const attemptKey = `login:failed:${email}`;
  const lockKey = `login:locked:${email}`;

  let attempts: number;

  try {
    // Increment failed attempts counter
    attempts = await redis.incr(attemptKey);

    // Set expiry on first attempt
    if (attempts === 1) {
      await redis.expire(attemptKey, ATTEMPT_WINDOW);
    }
  } catch (error) {
    logger.warn('Redis lockout update failed, using in-memory fallback', {
      email,
      error: (error as Error).message
    });

    const now = Date.now();
    const existing = getFallbackEntry(email);
    const nextAttempts = existing && existing.attemptExpiresAt > now ? existing.attempts + 1 : 1;

    fallbackLockouts.set(email, {
      attempts: nextAttempts,
      attemptExpiresAt: now + (ATTEMPT_WINDOW * 1000)
    });

    attempts = nextAttempts;
  }

  // Check if we've hit the lockout threshold
  if (attempts >= MAX_ATTEMPTS) {
    try {
      await redis.setex(lockKey, LOCKOUT_DURATION, '1');
    } catch {
      const entry = getFallbackEntry(email);
      fallbackLockouts.set(email, {
        attempts,
        attemptExpiresAt: Date.now() + (ATTEMPT_WINDOW * 1000),
        lockExpiresAt: Date.now() + (LOCKOUT_DURATION * 1000)
      });
      if (entry) {
        entry.lockExpiresAt = Date.now() + (LOCKOUT_DURATION * 1000);
        fallbackLockouts.set(email, entry);
      }
    }

    // Log lockout event to audit table
    await createAuditLog({
      action: 'ACCOUNT_LOCKED',
      resourceType: 'auth',
      ipAddress: ip,
      userAgent: userAgent,
      metadata: {
        email, // Email is not sensitive — it's the identifier
        attempts,
        lockoutDuration: LOCKOUT_DURATION
      }
    });

    logger.warn('Account locked due to failed login attempts', {
      email,
      attempts,
      ip
    });

    return {
      locked: true,
      attempts,
      remainingSeconds: LOCKOUT_DURATION
    };
  }

  return {
    locked: false,
    attempts,
    remainingSeconds: 0
  };
}

/**
 * Resets failed attempt counter on successful login.
 */
export async function resetAttempts(email: string): Promise<void> {
  const attemptKey = `login:failed:${email}`;
  const lockKey = `login:locked:${email}`;

  try {
    await Promise.all([
      redis.del(attemptKey),
      redis.del(lockKey)
    ]);
  } catch (error) {
    logger.warn('Redis lockout reset failed, clearing in-memory fallback', {
      email,
      error: (error as Error).message
    });
  }

  fallbackLockouts.delete(email);
}
