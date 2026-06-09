import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

/**
 * RBAC middleware factory.
 * Checks that the authenticated user has one of the allowed roles.
 * NEVER trusts frontend for role checks — always server-side.
 * 
 * Usage: requireRole('CLIENT') or requireRole('CLIENT', 'ADMIN')
 */
export function requireRole(...allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.session || !req.session.userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const userRole = req.session.role;

    if (!userRole || !allowedRoles.includes(userRole)) {
      logger.warn('RBAC access denied', {
        userId: req.session.userId,
        userRole,
        requiredRoles: allowedRoles,
        path: req.path,
        method: req.method,
        ip: req.ip
      });

      res.status(403).json({
        error: 'Access denied — insufficient permissions'
      });
      return;
    }

    next();
  };
}
