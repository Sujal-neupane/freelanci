import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { redis } from '../utils/redis';
import { recordStrike } from './ipAccess';
import logger from '../utils/logger';

/**
 * Builds a Redis-backed store for a limiter. Counters live in Redis so limits
 * are enforced consistently across every server instance and survive restarts
 * (a MemoryStore would reset on each deploy and not share state across nodes).
 */
function redisStore(prefix: string): RedisStore {
  return new RedisStore({
    prefix,
    sendCommand: (...args: string[]) => (redis as any).call(...args) as Promise<any>
  });
}

/**
 * Global rate limiter: 100 requests per 15 minutes per IP.
 */
export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 100,
  store: redisStore('rl:global:'),
  standardHeaders: true,      // RateLimit-* headers
  legacyHeaders: false,
  message: {
    error: 'Too many requests — please try again later',
    retryAfter: '15 minutes'
  },
  handler: (req, res, _next, options) => {
    logger.warn('Global rate limit exceeded', { ip: req.ip });
    void recordStrike(req.ip || 'unknown', 'global rate limit exceeded');
    res.status(429).json(options.message);
  }
});

/**
 * Auth endpoint rate limiter: 5 requests per 15 minutes per IP.
 * Strict limit on login/register to prevent brute force.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  store: redisStore('rl:auth:'),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Prefer per-account rate limiting when an email is present to better protect accounts
    const email = req.body && (req.body as any).email;
    if (email && typeof email === 'string') {
      return `auth:email:${email.toLowerCase()}`;
    }
    // Use ipKeyGenerator to properly handle IPv6 addresses and format the key
    // It expects (req, number) as parameters where number is a trustProxy value
    return ipKeyGenerator(req as any, 0);
  },
  message: {
    error: 'Too many authentication attempts — please try again later',
    retryAfter: '15 minutes'
  },
  handler: (req, res, _next, options) => {
    logger.warn('Auth rate limit exceeded', { ip: req.ip });
    void recordStrike(req.ip || 'unknown', 'auth rate limit exceeded');
    res.status(429).json(options.message);
  },
  skipSuccessfulRequests: true  // Only count failed attempts
});

/**
 * Authenticated API rate limiter: 200 requests per 15 minutes per USER.
 * Helps prevent abuse from logged-in accounts (e.g. scraping, spamming).
 * Uses req.session.userId as the key if available, otherwise IP.
 */
export const authenticatedApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  store: redisStore('rl:apiuser:'),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Rate limit by User ID if authenticated, fallback to IP
    if (req.session?.userId) {
      return `user:${req.session.userId}`;
    }
    // Use ipKeyGenerator to properly handle IPv6 addresses and format the key
    return ipKeyGenerator(req as any, 0);
  },
  message: {
    error: 'Too many API requests — please slow down',
    retryAfter: '15 minutes'
  },
  handler: (req, res, _next, options) => {
    logger.warn('Authenticated API rate limit exceeded', { 
      userId: req.session?.userId,
      ip: req.ip,
      path: req.path
    });
    res.status(429).json(options.message);
  }
});
