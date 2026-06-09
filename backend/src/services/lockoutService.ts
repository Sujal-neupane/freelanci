import { redis } from '../app';
import { createAuditLog } from './auditService';
import logger from '../utils/logger';

const MAX_ATTEMPTS = 5;
const LOCKOUT_DURATION = 15 * 60; // 15 minutes in seconds
const ATTEMPT_WINDOW = 15 * 60;   // 15 minutes in seconds

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

  // Increment failed attempts counter
  const attempts = await redis.incr(attemptKey);

  // Set expiry on first attempt
  if (attempts === 1) {
    await redis.expire(attemptKey, ATTEMPT_WINDOW);
  }

  // Check if we've hit the lockout threshold
  if (attempts >= MAX_ATTEMPTS) {
    await redis.setex(lockKey, LOCKOUT_DURATION, '1');

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

  await Promise.all([
    redis.del(attemptKey),
    redis.del(lockKey)
  ]);
}
