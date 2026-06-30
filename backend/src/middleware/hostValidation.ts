import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

/**
 * Host-header allow-list.
 *
 * The app uses the incoming Host header to build absolute URLs (e.g. the
 * HTTP→HTTPS redirect) and it could leak into other generated links. An
 * attacker who controls Host can mount password-reset poisoning, cache
 * poisoning and routing-based SSRF (PortSwigger: "HTTP Host header attacks").
 *
 * We reject any request whose Host is not explicitly trusted. The allow-list is
 * derived from ALLOWED_ORIGINS (so it stays in sync with CORS) plus an optional
 * HOST_ALLOWLIST env override, with localhost permitted outside production.
 */
function buildAllowedHosts(): Set<string> {
  const hosts = new Set<string>();

  for (const origin of (process.env.ALLOWED_ORIGINS || '').split(',')) {
    const trimmed = origin.trim();
    if (!trimmed) continue;
    try {
      hosts.add(new URL(trimmed).host); // host includes port if present
    } catch {
      // not a URL — treat as a bare host
      hosts.add(trimmed);
    }
  }

  for (const host of (process.env.HOST_ALLOWLIST || '').split(',')) {
    const trimmed = host.trim();
    if (trimmed) hosts.add(trimmed);
  }

  if (process.env.NODE_ENV !== 'production') {
    hosts.add('localhost:3001');
    hosts.add('localhost:5173');
    hosts.add('127.0.0.1:3001');
    hosts.add('localhost');
    hosts.add('127.0.0.1');
  }

  return hosts;
}

const allowedHosts = buildAllowedHosts();

export function validateHost(req: Request, res: Response, next: NextFunction): void {
  // If nothing is configured (e.g. local dev with no env), don't hard-block.
  if (allowedHosts.size === 0) {
    return next();
  }

  const host = req.headers.host;

  if (!host || !allowedHosts.has(host)) {
    logger.warn('Rejected request with untrusted Host header', {
      host,
      ip: req.ip,
      path: req.path
    });
    res.status(400).json({ error: 'Invalid host' });
    return;
  }

  next();
}
