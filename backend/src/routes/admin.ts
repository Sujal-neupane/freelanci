import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth, requireMfaComplete } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { getAuditLogs, createAuditLog } from '../services/auditService';
import {
  addToBlocklist, removeFromBlocklist,
  addToAllowlist, removeFromAllowlist, listIpRules
} from '../middleware/ipAccess';
import logger from '../utils/logger';

// Accepts an IPv4/IPv6 address (admin-supplied). Kept deliberately simple — we
// store exact-match strings, not CIDR ranges.
function isValidIp(value: unknown): value is string {
  return typeof value === 'string' &&
    (/^(\d{1,3}\.){3}\d{1,3}$/.test(value) || /^[0-9a-fA-F:]+$/.test(value)) &&
    value.length <= 45;
}

const router = Router();
const prisma = new PrismaClient();

// All routes require ADMIN role
router.use(requireAuth, requireMfaComplete, requireRole('ADMIN'));

// ─── GET /api/admin/users — List all users ────────────────────────
router.get('/users', async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const search = req.query.search as string;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } }
      ];
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true, email: true, name: true, role: true,
          suspended: true, createdAt: true, failedLoginAttempts: true,
          lockedUntil: true
        },
        orderBy: { createdAt: 'desc' },
        skip, take: limit
      }),
      prisma.user.count({ where })
    ]);

    res.json({
      users,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    });
  } catch (error) {
    logger.error('Admin users error', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// ─── PATCH /api/admin/users/:id/suspend — Suspend/Unsuspend user ──
router.patch('/users/:id/suspend', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { suspend } = req.body; // boolean

    if (id === req.session.userId) {
      res.status(400).json({ error: 'Cannot suspend your own account' });
      return;
    }

    const user = await prisma.user.update({
      where: { id },
      data: { suspended: suspend },
      select: { id: true, suspended: true }
    });

    res.json({ message: `User ${suspend ? 'suspended' : 'unsuspended'} successfully`, user });
  } catch (error) {
    logger.error('Admin suspend user error', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to update user status' });
  }
});

// ─── GET /api/admin/audit-logs — View audit logs ──────────────────
router.get('/audit-logs', async (req: Request, res: Response) => {
  try {
    const options = {
      userId: req.query.userId as string,
      action: req.query.action as string,
      resourceType: req.query.resourceType as string,
      page: parseInt(req.query.page as string) || 1,
      limit: parseInt(req.query.limit as string) || 50
    };

    const logs = await getAuditLogs(options);
    res.json(logs);
  } catch (error) {
    logger.error('Admin audit logs error', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
});

// ─── GET /api/admin/alerts — View security alerts ─────────────────
router.get('/alerts', async (req: Request, res: Response) => {
  try {
    const alerts = await prisma.securityAlert.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        user: { select: { email: true, name: true } }
      }
    });
    res.json({ alerts });
  } catch (error) {
    logger.error('Admin alerts error', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to fetch security alerts' });
  }
});

// ─── PATCH /api/admin/alerts/:id/acknowledge — Acknowledge alert ──
router.patch('/alerts/:id/acknowledge', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    await prisma.securityAlert.update({
      where: { id },
      data: { acknowledged: true }
    });
    res.json({ message: 'Alert acknowledged' });
  } catch (error) {
    logger.error('Admin acknowledge alert error', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to acknowledge alert' });
  }
});

// ─── GET /api/admin/metrics — Dashboard metrics ───────────────────
router.get('/metrics', async (_req: Request, res: Response) => {
  try {
    const [
      totalUsers,
      totalJobs,
      activeDisputes,
      recentAlerts
    ] = await Promise.all([
      prisma.user.count(),
      prisma.job.count(),
      prisma.dispute.count({ where: { status: { in: ['OPEN', 'UNDER_REVIEW'] } } }),
      prisma.securityAlert.count({ where: { acknowledged: false } })
    ]);

    res.json({
      metrics: {
        totalUsers,
        totalJobs,
        activeDisputes,
        recentAlerts
      }
    });
  } catch (error) {
    logger.error('Admin metrics error', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to fetch metrics' });
  }
});

// ─── IP Access Control management ─────────────────────────────────

// GET /api/admin/ip-rules — current block-list and allow-list
router.get('/ip-rules', async (_req: Request, res: Response) => {
  try {
    const rules = await listIpRules();
    res.json(rules);
  } catch (error) {
    logger.error('List IP rules error', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to fetch IP rules' });
  }
});

// POST /api/admin/ip-rules — add an IP to the block-list or allow-list
// body: { ip: string, list: 'block' | 'allow' }
router.post('/ip-rules', async (req: Request, res: Response) => {
  try {
    const { ip, list } = req.body;

    if (!isValidIp(ip)) {
      res.status(400).json({ error: 'A valid IP address is required' });
      return;
    }
    if (list !== 'block' && list !== 'allow') {
      res.status(400).json({ error: "list must be 'block' or 'allow'" });
      return;
    }

    if (list === 'block') {
      await addToBlocklist(ip);
    } else {
      await addToAllowlist(ip);
    }

    await createAuditLog({
      userId: req.session.userId,
      action: list === 'block' ? 'IP_BLOCKLISTED' : 'IP_ALLOWLISTED',
      resourceType: 'ip_rule',
      resourceId: ip,
      ipAddress: req.ip || 'unknown',
      userAgent: req.get('User-Agent') || 'unknown',
      metadata: { ip, list }
    });

    res.json({ message: `IP ${ip} added to ${list}-list` });
  } catch (error) {
    logger.error('Add IP rule error', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to add IP rule' });
  }
});

// DELETE /api/admin/ip-rules — remove an IP from a list
// body: { ip: string, list: 'block' | 'allow' }
router.delete('/ip-rules', async (req: Request, res: Response) => {
  try {
    const { ip, list } = req.body;

    if (!isValidIp(ip)) {
      res.status(400).json({ error: 'A valid IP address is required' });
      return;
    }
    if (list !== 'block' && list !== 'allow') {
      res.status(400).json({ error: "list must be 'block' or 'allow'" });
      return;
    }

    if (list === 'block') {
      await removeFromBlocklist(ip);
    } else {
      await removeFromAllowlist(ip);
    }

    await createAuditLog({
      userId: req.session.userId,
      action: list === 'block' ? 'IP_UNBLOCKLISTED' : 'IP_UNALLOWLISTED',
      resourceType: 'ip_rule',
      resourceId: ip,
      ipAddress: req.ip || 'unknown',
      userAgent: req.get('User-Agent') || 'unknown',
      metadata: { ip, list }
    });

    res.json({ message: `IP ${ip} removed from ${list}-list` });
  } catch (error) {
    logger.error('Remove IP rule error', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to remove IP rule' });
  }
});

export default router;
