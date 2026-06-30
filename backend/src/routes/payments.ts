import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import Stripe from 'stripe';
import { requireAuth, requireMfaComplete } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { createAuditLog } from '../services/auditService';
import { withLock } from '../utils/lock';
import logger from '../utils/logger';

const router = Router();
const prisma = new PrismaClient();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_mock');

// ─── POST /api/payments/fund/:jobId — Client funds project ────────
router.post('/fund/:jobId', requireAuth, requireMfaComplete, requireRole('CLIENT'), async (req: Request, res: Response) => {
  try {
    const jobId = req.params.jobId as string;

    const job = await prisma.job.findUnique({
      where: { id: jobId },
      include: {
        bids: { where: { status: 'ACCEPTED' } }
      }
    });

    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }

    if (job.clientId !== req.session.userId) {
      res.status(403).json({ error: 'Not authorized to fund this job' });
      return;
    }

    if (job.status !== 'IN_PROGRESS') {
      res.status(400).json({ error: 'Job must be IN_PROGRESS to fund' });
      return;
    }

    if (job.bids.length === 0) {
      res.status(400).json({ error: 'No accepted bid found for this job' });
      return;
    }

    const acceptedBid = job.bids[0];

    // Serialise funding for this job so two concurrent requests cannot both
    // pass the "already funded?" check and each create a PaymentIntent +
    // escrow record (double-charge race).
    const outcome = await withLock(`escrow:${jobId}`, async () => {
      const existingTx = await prisma.transaction.findFirst({
        where: { jobId, status: { in: ['HELD', 'RELEASED'] } }
      });

      if (existingTx) {
        return { status: 400, body: { error: 'Job is already funded' } };
      }

      // Create a PaymentIntent with manual capture (escrow flow)
      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(acceptedBid.amount * 100), // Stripe expects cents
        currency: 'usd',
        capture_method: 'manual', // Don't capture funds immediately
        metadata: {
          jobId: job.id,
          clientId: req.session.userId!,
          freelancerId: acceptedBid.freelancerId
        },
      });

      return {
        status: 200,
        body: {
          clientSecret: paymentIntent.client_secret,
          amount: acceptedBid.amount,
          message: 'Payment intent created. Proceed to client-side confirmation.'
        }
      };
    });

    if (!outcome.acquired) {
      res.status(409).json({ error: 'A funding request is already in progress for this job' });
      return;
    }

    res.status(outcome.result.status).json(outcome.result.body);
  } catch (error) {
    logger.error('Payment funding error', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to initiate funding' });
  }
});

// ─── POST /api/payments/release/:jobId — Client releases funds ────
router.post('/release/:jobId', requireAuth, requireMfaComplete, requireRole('CLIENT'), async (req: Request, res: Response) => {
  try {
    const jobId = req.params.jobId as string;

    const transaction = await prisma.transaction.findFirst({
      where: { jobId, clientId: req.session.userId, status: 'HELD' },
    });

    if (!transaction || !transaction.stripePaymentIntentId) {
      res.status(404).json({ error: 'No funds currently held in escrow for this job' });
      return;
    }

    // Capture the payment intent to transfer funds
    const intent = await stripe.paymentIntents.capture(transaction.stripePaymentIntentId);

    if (intent.status === 'succeeded') {
      await prisma.$transaction([
        prisma.transaction.update({
          where: { id: transaction.id },
          data: { status: 'RELEASED' }
        }),
        prisma.job.update({
          where: { id: jobId },
          data: { status: 'COMPLETED' }
        })
      ]);

      await createAuditLog({
        userId: req.session.userId,
        action: 'PAYMENT_RELEASED',
        resourceType: 'transaction',
        resourceId: transaction.id,
        ipAddress: req.ip || 'unknown',
        userAgent: req.get('User-Agent') || 'unknown',
        metadata: { jobId, amount: transaction.amount }
      });

      res.json({ message: 'Funds released to freelancer successfully' });
    } else {
      res.status(400).json({ error: 'Failed to capture funds', status: intent.status });
    }

  } catch (error) {
    logger.error('Payment release error', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to release funds' });
  }
});

// ─── GET /api/payments/history — View transaction history ─────────
router.get('/history', requireAuth, requireMfaComplete, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId;
    const role = req.session.role;

    const whereClause = role === 'CLIENT'
      ? { clientId: userId }
      : { freelancerId: userId };

    const transactions = await prisma.transaction.findMany({
      where: whereClause,
      include: {
        job: { select: { title: true } },
        client: { select: { name: true } },
        freelancer: { select: { name: true } }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json({ transactions });
  } catch (error) {
    logger.error('Transaction history error', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to fetch transaction history' });
  }
});

export default router;
