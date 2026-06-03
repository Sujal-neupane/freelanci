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
  }
}

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
    res.status(401).json({ error: 'Session invalidated — please log in again' });
    return;
  }

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
