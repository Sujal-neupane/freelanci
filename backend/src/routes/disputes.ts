import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth, requireMfaComplete } from '../middleware/auth';
import { createAuditLog } from '../services/auditService';
import { sanitiseInput } from '../utils/validators';
import logger from '../utils/logger';

const router = Router();
const prisma = new PrismaClient();

// ─── POST /api/disputes/:jobId — Raise a dispute ──────────────────
router.post('/:jobId', requireAuth, requireMfaComplete, async (req: Request, res: Response) => {
  try {
    const jobId = req.params.jobId as string;
    const { reason } = req.body;
    const userId = req.session.userId!;

    if (!reason || reason.trim().length < 10) {
      res.status(400).json({ error: 'A detailed reason (min 10 chars) is required' });
      return;
    }

    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }

    // Business Logic: Only client or hired freelancer can raise a dispute
    if (job.clientId !== userId && job.hiredFreelancerId !== userId) {
      res.status(403).json({ error: 'Only parties involved in the job can raise a dispute' });
      return;
    }

    // Prevent multiple disputes
    const existing = await prisma.dispute.findFirst({
      where: { jobId, status: { not: 'RESOLVED' } }
    });

    if (existing) {
      res.status(400).json({ error: 'An active dispute already exists for this job' });
      return;
    }

    const dispute = await prisma.dispute.create({
      data: {
        jobId,
        raisedById: userId,
        reason: sanitiseInput(reason)
      }
    });

    // If job is in progress and has held funds, update job status
    if (job.status === 'IN_PROGRESS') {
       await prisma.job.update({
         where: { id: jobId },
         data: { status: 'DISPUTED' }
       });
       
       await prisma.transaction.updateMany({
         where: { jobId, status: 'HELD' },
         data: { status: 'DISPUTED' }
       });
    }

    await createAuditLog({
      userId,
      action: 'DISPUTE_RAISED',
      resourceType: 'dispute',
      resourceId: dispute.id,
      ipAddress: req.ip || 'unknown',
      userAgent: req.get('User-Agent') || 'unknown',
      metadata: { jobId }
    });

    res.status(201).json({ message: 'Dispute raised successfully', dispute });
  } catch (error) {
    logger.error('Raise dispute error', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to raise dispute' });
  }
});

// ─── GET /api/disputes/my — List user's disputes ──────────────────
router.get('/my', requireAuth, requireMfaComplete, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;

    const disputes = await prisma.dispute.findMany({
      where: {
        OR: [
          { raisedById: userId },
          { job: { clientId: userId } },
          { job: { hiredFreelancerId: userId } }
        ]
      },
      include: {
        job: { select: { title: true, status: true } },
        raisedBy: { select: { name: true, role: true } }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json({ disputes });
  } catch (error) {
    logger.error('List my disputes error', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to fetch disputes' });
  }
});

export default router;
