import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth, requireMfaComplete } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { requireOwnership } from '../middleware/ownership';
import { createAuditLog } from '../services/auditService';
import { validateJobInput, sanitiseInput } from '../utils/validators';
import logger from '../utils/logger';

const router = Router();
const prisma = new PrismaClient();

// ─── POST /api/jobs — Create job (clients only) ──────────────────
router.post('/', requireAuth, requireMfaComplete, requireRole('CLIENT'), async (req: Request, res: Response) => {
  try {
    const { title, description, budget, skills } = req.body;

    // Validate input
    const validation = validateJobInput({ title, description, budget, skills });
    if (!validation.valid) {
      res.status(400).json({ error: 'Validation failed', details: validation.errors });
      return;
    }

    // Sanitise text inputs
    const sanitisedTitle = sanitiseInput(title);
    const sanitisedDescription = sanitiseInput(description);
    const sanitisedSkills = (skills as string[]).map((s: string) => sanitiseInput(s));

    const job = await prisma.job.create({
      data: {
        title: sanitisedTitle,
        description: sanitisedDescription,
        budget: parseFloat(budget),
        skills: sanitisedSkills,
        clientId: req.session.userId!
      }
    });

    await createAuditLog({
      userId: req.session.userId,
      action: 'JOB_CREATED',
      resourceType: 'job',
      resourceId: job.id,
      ipAddress: req.ip || 'unknown',
      userAgent: req.get('User-Agent') || 'unknown'
    });

    res.status(201).json({ message: 'Job posted successfully', job });
  } catch (error) {
    logger.error('Create job error', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to create job' });
  }
});

// ─── GET /api/jobs — List open jobs ──────────────────────────────
router.get('/', requireAuth, requireMfaComplete, async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
    const search = req.query.search as string;
    const skill = req.query.skill as string;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { status: 'OPEN' };

    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } }
      ];
    }

    if (skill) {
      where.skills = { has: skill };
    }

    const [jobs, total] = await Promise.all([
      prisma.job.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          client: { select: { id: true, name: true } },
          _count: { select: { bids: true } }
        }
      }),
      prisma.job.count({ where })
    ]);

    res.json({
      jobs,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    });
  } catch (error) {
    logger.error('List jobs error', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to fetch jobs' });
  }
});

// ─── GET /api/jobs/my — Client's own jobs ────────────────────────
router.get('/my', requireAuth, requireMfaComplete, requireRole('CLIENT'), async (req: Request, res: Response) => {
  try {
    const jobs = await prisma.job.findMany({
      where: { clientId: req.session.userId },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { bids: true } }
      }
    });

    res.json({ jobs });
  } catch (error) {
    logger.error('Get my jobs error', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to fetch your jobs' });
  }
});

// ─── GET /api/jobs/:id — Job detail ──────────────────────────────
router.get('/:id', requireAuth, requireMfaComplete, async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const job = await prisma.job.findUnique({
      where: { id },
      include: {
        client: { select: { id: true, name: true, email: true } },
        bids: {
          include: {
            freelancer: { select: { id: true, name: true } }
          },
          orderBy: { createdAt: 'desc' }
        },
        _count: { select: { bids: true } }
      }
    });

    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }

    // Only show bids to the job owner or admin
    const isOwner = job.clientId === req.session.userId;
    const isAdmin = req.session.role === 'ADMIN';

    const response = {
      ...job,
      bids: (isOwner || isAdmin) ? job.bids : undefined
    };

    res.json({ job: response });
  } catch (error) {
    logger.error('Get job error', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to fetch job' });
  }
});

// ─── PATCH /api/jobs/:id — Update job (owner only) ───────────────
router.patch('/:id', requireAuth, requireMfaComplete, requireRole('CLIENT'), requireOwnership('job'),
  async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const { title, description, budget, skills } = req.body;

      const job = await prisma.job.findUnique({ where: { id } });
      if (job?.status !== 'OPEN') {
        res.status(400).json({ error: 'Can only edit open jobs' });
        return;
      }

      const updateData: Record<string, unknown> = {};
      if (title) updateData.title = sanitiseInput(title);
      if (description) updateData.description = sanitiseInput(description);
      if (budget) updateData.budget = parseFloat(budget);
      if (skills) updateData.skills = (skills as string[]).map(s => sanitiseInput(s));

      const updated = await prisma.job.update({
        where: { id },
        data: updateData
      });

      res.json({ message: 'Job updated', job: updated });
    } catch (error) {
      logger.error('Update job error', { error: (error as Error).message });
      res.status(500).json({ error: 'Failed to update job' });
    }
  }
);

// ─── DELETE /api/jobs/:id — Cancel job (owner only) ──────────────
router.delete('/:id', requireAuth, requireMfaComplete, requireRole('CLIENT'), requireOwnership('job'),
  async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;

      const job = await prisma.job.findUnique({ where: { id } });
      if (job?.status !== 'OPEN') {
        res.status(400).json({ error: 'Can only cancel open jobs' });
        return;
      }

      await prisma.job.update({
        where: { id },
        data: { status: 'CANCELLED' }
      });

      await createAuditLog({
        userId: req.session.userId,
        action: 'JOB_CANCELLED',
        resourceType: 'job',
        resourceId: id,
        ipAddress: req.ip || 'unknown',
        userAgent: req.get('User-Agent') || 'unknown'
      });

      res.json({ message: 'Job cancelled' });
    } catch (error) {
      logger.error('Cancel job error', { error: (error as Error).message });
      res.status(500).json({ error: 'Failed to cancel job' });
    }
  }
);

// ─── POST /api/jobs/:id/hire/:bidId — Accept bid ─────────────────
router.post('/:id/hire/:bidId', requireAuth, requireMfaComplete, requireRole('CLIENT'), requireOwnership('job'),
  async (req: Request, res: Response) => {
    try {
      const jobId = req.params.id as string;
      const bidId = req.params.bidId as string;

      const job = await prisma.job.findUnique({ where: { id: jobId } });
      if (!job || job.status !== 'OPEN') {
        res.status(400).json({ error: 'Job is not open for hiring' });
        return;
      }

      const bid = await prisma.bid.findUnique({
        where: { id: bidId },
        include: { freelancer: { select: { id: true, name: true } } }
      });

      if (!bid || bid.jobId !== jobId) {
        res.status(404).json({ error: 'Bid not found for this job' });
        return;
      }

      // Accept the bid and transition job to IN_PROGRESS
      await prisma.$transaction([
        prisma.bid.update({
          where: { id: bidId },
          data: { status: 'ACCEPTED' }
        }),
        prisma.bid.updateMany({
          where: { jobId, id: { not: bidId } },
          data: { status: 'REJECTED' }
        }),
        prisma.job.update({
          where: { id: jobId },
          data: {
            status: 'IN_PROGRESS',
            hiredFreelancerId: bid.freelancerId
          }
        })
      ]);

      await createAuditLog({
        userId: req.session.userId,
        action: 'BID_ACCEPTED',
        resourceType: 'bid',
        resourceId: bidId,
        ipAddress: req.ip || 'unknown',
        userAgent: req.get('User-Agent') || 'unknown',
        metadata: { jobId, freelancerId: bid.freelancerId }
      });

      res.json({
        message: 'Freelancer hired successfully',
        job: { id: jobId, status: 'IN_PROGRESS' },
        hiredBid: bid
      });
    } catch (error) {
      logger.error('Hire error', { error: (error as Error).message });
      res.status(500).json({ error: 'Failed to process hire' });
    }
  }
);

export default router;
