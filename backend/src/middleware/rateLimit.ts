import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { redis } from '../app';
import logger from '../utils/logger';

/**
 * Global rate limiter: 100 requests per 15 minutes per IP.
 * Counters stored in Redis so limits survive server restarts.
 */
export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 100,
  standardHeaders: true,      // RateLimit-* headers
  legacyHeaders: false,
  message: {
    error: 'Too many requests — please try again later',
    retryAfter: '15 minutes'
  },
  handler: (_req, res, _next, options) => {
    logger.warn('Global rate limit exceeded', { ip: _req.ip });
    res.status(429).json(options.message);
  }
});

/**
 * Auth endpoint rate limiter: 5 requests per 15 minutes per IP.
 * Strict limit on login/register to prevent brute force.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many authentication attempts — please try again later',
    retryAfter: '15 minutes'
  },
  handler: (_req, res, _next, options) => {
    logger.warn('Auth rate limit exceeded', { ip: _req.ip });
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
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Rate limit by User ID if authenticated, fallback to IP
    return req.session?.userId ? `user:${req.session.userId}` : `ip:${req.ip}`;
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
