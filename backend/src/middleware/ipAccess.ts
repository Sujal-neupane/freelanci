import { Request, Response, NextFunction } from 'express';
import { redis } from '../utils/redis';
import { createSecurityAlert } from '../services/alertService';
import logger from '../utils/logger';

/**
 * IP-based access control.
 *
 * Three layers, evaluated in order:
 *   1. Allow-list  — trusted IPs (office/CI/admin) bypass all blocking and the
 *      auto-ban accounting entirely.
 *   2. Block-list  — permanent, admin-managed denies (Redis SET).
 *   3. Auto-ban    — IPs that accumulate too many "strikes" (rate-limit hits,
 *      CSRF failures, MFA brute-force, etc.) inside a rolling window are
 *      temporarily banned and an alert is raised.
 *
 * All state lives in Redis so bans are shared across every server instance and
 * survive restarts.
 */

const BLOCKLIST_KEY = 'ip:blocklist'; // SET of permanently blocked IPs
const ALLOWLIST_KEY = 'ip:allowlist'; // SET of trusted IPs

// Auto-ban tuning.
const STRIKE_WINDOW_SECONDS = 10 * 60; // strikes counted over 10 minutes
const STRIKE_THRESHOLD = 15;           // strikes before a temporary ban
const AUTO_BAN_SECONDS = 60 * 60;      // temporary ban length: 1 hour

function clientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

/**
 * Express middleware: deny blocked/banned IPs, let allow-listed IPs straight
 * through. Mount this BEFORE the rate limiters so a banned IP is rejected
 * cheaply.
 */
export async function ipAccessControl(req: Request, res: Response, next: NextFunction): Promise<void> {
  const ip = clientIp(req);

  try {
    // Allow-list short-circuits everything.
    if (await redis.sismember(ALLOWLIST_KEY, ip)) {
      (req as any).ipAllowlisted = true;
      return next();
    }

    const [blocked, banTtl] = await Promise.all([
      redis.sismember(BLOCKLIST_KEY, ip),
      redis.ttl(`ip:banned:${ip}`)
    ]);

    if (blocked) {
      logger.warn('Blocked IP attempted access', { ip, path: req.path });
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    if (banTtl > 0) {
      res.status(403).json({ error: 'Access temporarily denied', retryAfterSeconds: banTtl });
      return;
    }
  } catch (error) {
    // Fail open on Redis errors — availability over a hard fail here, since the
    // rate limiter and other controls still apply.
    logger.error('IP access check failed — allowing request', {
      ip,
      error: (error as Error).message
    });
  }

  next();
}

/**
 * Records a single abuse "strike" against an IP. When strikes cross the
 * threshold inside the window the IP is auto-banned and a security alert is
 * raised. Allow-listed IPs are never struck. Call this from rate-limit
 * handlers, CSRF failures, MFA brute-force detection, etc.
 */
export async function recordStrike(ip: string, reason: string): Promise<void> {
  if (!ip || ip === 'unknown') return;

  try {
    if (await redis.sismember(ALLOWLIST_KEY, ip)) return;

    const strikeKey = `ip:strikes:${ip}`;
    const strikes = await redis.incr(strikeKey);
    if (strikes === 1) {
      await redis.expire(strikeKey, STRIKE_WINDOW_SECONDS);
    }

    if (strikes >= STRIKE_THRESHOLD) {
      await redis.set(`ip:banned:${ip}`, reason, 'EX', AUTO_BAN_SECONDS);
      await redis.del(strikeKey);
      await createSecurityAlert(
        'IP_AUTO_BANNED',
        'HIGH',
        `IP ${ip} auto-banned for ${AUTO_BAN_SECONDS / 60}m after ${strikes} strikes (last: ${reason})`,
        ip
      );
      logger.warn('IP auto-banned', { ip, strikes, reason });
    }
  } catch (error) {
    logger.error('Failed to record IP strike', { ip, error: (error as Error).message });
  }
}

// ─── Admin management helpers ───────────────────────────────────────

export async function addToBlocklist(ip: string): Promise<void> {
  await redis.sadd(BLOCKLIST_KEY, ip);
  await redis.del(`ip:banned:${ip}`); // permanent block supersedes temp ban key
  logger.info('IP added to blocklist', { ip });
}

export async function removeFromBlocklist(ip: string): Promise<void> {
  await redis.srem(BLOCKLIST_KEY, ip);
  await redis.del(`ip:banned:${ip}`);
  logger.info('IP removed from blocklist', { ip });
}

export async function addToAllowlist(ip: string): Promise<void> {
  await redis.sadd(ALLOWLIST_KEY, ip);
  logger.info('IP added to allowlist', { ip });
}

export async function removeFromAllowlist(ip: string): Promise<void> {
  await redis.srem(ALLOWLIST_KEY, ip);
  logger.info('IP removed from allowlist', { ip });
}

export async function listIpRules(): Promise<{ blocklist: string[]; allowlist: string[] }> {
  const [blocklist, allowlist] = await Promise.all([
    redis.smembers(BLOCKLIST_KEY),
    redis.smembers(ALLOWLIST_KEY)
  ]);
  return { blocklist, allowlist };
}
