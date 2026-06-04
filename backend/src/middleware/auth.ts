import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

// Extend express-session types
declare module 'express-session' {
  interface SessionData {
    userId: string;
    email: string;
    role: string;
    userAgent: string;
    mfaVerified: boolean;
    mfaPending: boolean;
    pendingUserId?: string;
    csrfToken?: string;
    createdAt: number;
    lastActive: number;
  }
}

// Session timeout constants
const ABSOLUTE_TIMEOUT_MS = 12 * 60 * 60 * 1000; // 12 hours
const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes


/**
 * Requires a valid authenticated session.
 * Also verifies user agent binding — session is bound to the browser
 * that created it, preventing session hijacking.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.session || !req.session.userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  // User agent binding — detect session hijacking
  const currentUA = req.get('User-Agent') || 'unknown';
  if (req.session.userAgent && req.session.userAgent !== currentUA) {
    logger.warn('Session user agent mismatch — possible hijacking', {
      userId: req.session.userId,
      sessionUA: req.session.userAgent?.substring(0, 50),
      requestUA: currentUA.substring(0, 50),
      ip: req.ip
    });
    req.session.destroy(() => {});
    res.clearCookie('__freelanci_sid');
    res.status(401).json({ error: 'Session invalidated — please log in again' });
    return;
  }

  // Session Timeouts Implementation
  const now = Date.now();
  
  // 1. Absolute Timeout (e.g., max 12 hours regardless of activity)
  if (req.session.createdAt && (now - req.session.createdAt > ABSOLUTE_TIMEOUT_MS)) {
    logger.info('Session absolute timeout reached', { userId: req.session.userId });
    req.session.destroy(() => {});
    res.clearCookie('__freelanci_sid');
    res.status(401).json({ error: 'Session expired (absolute timeout) — please log in again', expired: true });
    return;
  }

  // 2. Idle Timeout (e.g., max 30 mins of inactivity)
  if (req.session.lastActive && (now - req.session.lastActive > IDLE_TIMEOUT_MS)) {
    logger.info('Session idle timeout reached', { userId: req.session.userId });
    req.session.destroy(() => {});
    res.clearCookie('__freelanci_sid');
    res.status(401).json({ error: 'Session expired due to inactivity — please log in again', expired: true });
    return;
  }

  // Update last active timestamp
  req.session.lastActive = now;

  next();
}

/**
 * Ensures MFA verification is complete if the user has MFA enabled.
 * Used after requireAuth to enforce the second factor.
 */
export function requireMfaComplete(req: Request, res: Response, next: NextFunction): void {
  if (req.session.mfaPending && !req.session.mfaVerified) {
    res.status(403).json({
      error: 'MFA verification required',
      requiresMfa: true
    });
    return;
  }

  next();
}
