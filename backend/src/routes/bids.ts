import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth, requireMfaComplete } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { createAuditLog } from '../services/auditService';
import { validateBidInput, sanitiseInput } from '../utils/validators';
import logger from '../utils/logger';

const router = Router();
const prisma = new PrismaClient();

// ─── POST /api/jobs/:id/bids — Submit bid (freelancers only) ─────
router.post('/:id/bids', requireAuth, requireMfaComplete, requireRole('FREELANCER'),
  async (req: Request, res: Response) => {
    try {
      const jobId = req.params.id as string;
      const freelancerId = req.session.userId!;
      const { amount, proposal } = req.body;

      // Validate input
      const validation = validateBidInput({ amount, proposal });
      if (!validation.valid) {
        res.status(400).json({ error: 'Validation failed', details: validation.errors });
        return;
      }

      // Check job exists and is open
      const job = await prisma.job.findUnique({ where: { id: jobId } });
      if (!job) {
        res.status(404).json({ error: 'Job not found' });
        return;
      }
      if (job.status !== 'OPEN') {
        res.status(400).json({ error: 'This job is no longer accepting bids' });
        return;
      }

      // Business logic: can't bid on own job
      if (job.clientId === freelancerId) {
        res.status(403).json({ error: 'You cannot bid on your own job' });
        return;
      }

      // Check freelancer hasn't already bid
      const existingBid = await prisma.bid.findUnique({
        where: { freelancerId_jobId: { freelancerId, jobId } }
      });
      if (existingBid) {
        res.status(409).json({ error: 'You have already submitted a bid for this job' });
        return;
      }

      const bid = await prisma.bid.create({
        data: {
          amount: parseFloat(amount),
          proposal: sanitiseInput(proposal),
          freelancerId,
          jobId
        }
      });

      await createAuditLog({
        userId: freelancerId,
        action: 'BID_SUBMITTED',
        resourceType: 'bid',
        resourceId: bid.id,
        ipAddress: req.ip || 'unknown',
        userAgent: req.get('User-Agent') || 'unknown',
        metadata: { jobId, amount: bid.amount }
      });

      res.status(201).json({ message: 'Bid submitted successfully', bid });
    } catch (error) {
      logger.error('Submit bid error', { error: (error as Error).message });
      res.status(500).json({ error: 'Failed to submit bid' });
    }
  }
);

// ─── GET /api/jobs/:id/bids — List bids for a job ────────────────
// Only job owner or admin can see all bids
router.get('/:id/bids', requireAuth, requireMfaComplete, async (req: Request, res: Response) => {
  try {
    const jobId = req.params.id as string;

    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }

    // Only job owner or admin can see bids
    if (job.clientId !== req.session.userId && req.session.role !== 'ADMIN') {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const bids = await prisma.bid.findMany({
      where: { jobId },
      include: {
        freelancer: { select: { id: true, name: true, email: true } }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json({ bids });
  } catch (error) {
    logger.error('List bids error', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to fetch bids' });
  }
});

// ─── GET /api/bids/my — Freelancer's own bids ────────────────────
router.get('/my', requireAuth, requireMfaComplete, requireRole('FREELANCER'),
  async (req: Request, res: Response) => {
    try {
      const bids = await prisma.bid.findMany({
        where: { freelancerId: req.session.userId },
        include: {
          job: {
            select: { id: true, title: true, budget: true, status: true }
          }
        },
        orderBy: { createdAt: 'desc' }
      });

      res.json({ bids });
    } catch (error) {
      logger.error('Get my bids error', { error: (error as Error).message });
      res.status(500).json({ error: 'Failed to fetch your bids' });
    }
  }
);

export default router;
