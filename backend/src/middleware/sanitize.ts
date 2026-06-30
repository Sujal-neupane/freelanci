import { Request, Response, NextFunction } from 'express';
import { sanitiseInput } from '../utils/validators';
import logger from '../utils/logger';

function scrubObject(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return sanitiseInput(obj);
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(scrubObject);
  const out: any = {};
  for (const k of Object.keys(obj)) {
    // Prevent prototype pollution via __proto__, constructor, or prototype keys
    // These are commonly used to inject properties into Object.prototype
    // See: https://cwe.mitre.org/data/definitions/1321.html
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    out[k] = scrubObject(obj[k]);
  }
  return out;
}

export function sanitizeRequest(req: Request, _res: Response, next: NextFunction) {
  try {
    // Skip known raw routes (webhooks)
    if (req.path && req.path.startsWith('/api/webhooks/')) return next();

    if (req.body) req.body = scrubObject(req.body);
    if (req.query) req.query = scrubObject(req.query);
    if (req.params) req.params = scrubObject(req.params);
  } catch (err) {
    logger.warn('Failed to sanitise request', { error: (err as Error).message });
  }
  return next();
}

// Replace res.json with a safe encoder that sanitises string values
export function safeJsonMiddleware(req: Request, res: Response, next: NextFunction) {
  const origJson = res.json.bind(res);
  res.json = (body?: any) => {
    try {
      const safeBody = scrubObject(body);
      // @ts-ignore
      return origJson(safeBody);
    } catch (err) {
      logger.warn('Failed to sanitise response body', { error: (err as Error).message });
      // Fallback to original
      // @ts-ignore
      return origJson(body);
    }
  };
  next();
}

export default {
  sanitizeRequest,
  safeJsonMiddleware
};
