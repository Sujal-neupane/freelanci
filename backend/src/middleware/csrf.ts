import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import logger from '../utils/logger';

/**
 * Generates a CSRF token and stores it in the user's session.
 * Also sends it to the frontend via a non-HttpOnly cookie (Double Submit pattern variant)
 * so the frontend JS can read it and attach it to subsequent headers.
 */
export function generateCsrfToken(req: Request, res: Response, next: NextFunction): void {
  if (!req.session) {
    return next();
  }

  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  
  // Send token to frontend via a non-HttpOnly cookie so JS can read it
  res.cookie('XSRF-TOKEN', req.session.csrfToken, {
    httpOnly: false, // Frontend needs to read this specific cookie
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/'
  });
  
  next();
}

/**
 * Verifies the CSRF token on state-changing requests (POST, PUT, PATCH, DELETE).
 * Defends against Cross-Site Request Forgery attacks.
 */
export function verifyCsrfToken(req: Request, res: Response, next: NextFunction): void {
  // Safe methods don't need CSRF protection
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    next();
    return;
  }

  // Stripe webhooks have their own signature verification and don't use sessions/CSRF
  if (req.path.startsWith('/api/webhooks/stripe')) {
    next();
    return;
  }

  const token = req.get('X-CSRF-Token') || req.get('X-XSRF-TOKEN');
  
  if (!token || !req.session || token !== req.session.csrfToken) {
    logger.warn('CSRF token validation failed', {
      ip: req.ip,
      path: req.path,
      method: req.method,
      userId: req.session?.userId
    });
    res.status(403).json({ error: 'Invalid or missing CSRF token' });
    return;
  }

  next();
}
