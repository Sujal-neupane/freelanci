import { Router, Request, Response } from 'express';
import Stripe from 'stripe';
import { PrismaClient } from '@prisma/client';
import { createAuditLog } from '../services/auditService';
import logger from '../utils/logger';

const router = Router();
const prisma = new PrismaClient();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_mock');
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

// Note: This route must be mounted BEFORE express.json() in app.ts
// so that req.body is raw for Stripe signature verification.
router.post('/stripe', async (req: Request, res: Response) => {
  const sig = req.headers['stripe-signature'] as string | undefined;

  if (!sig || !webhookSecret) {
    logger.error('Missing stripe signature or webhook secret');
    res.status(400).send('Webhook Error: Missing signature');
    return;
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    logger.error('Stripe webhook signature verification failed', { error: (err as Error).message });
    res.status(400).send(`Webhook Error: ${(err as Error).message}`);
    return;
  }

  try {
    switch (event.type) {
      case 'payment_intent.amount_capturable_updated': {
        const paymentIntent = event.data.object;
        const { jobId, clientId, freelancerId } = paymentIntent.metadata;

        if (jobId && clientId) {
          // Funds are held in escrow
          await prisma.transaction.create({
            data: {
              amount: paymentIntent.amount / 100, // Convert from cents
              stripePaymentIntentId: paymentIntent.id,
              status: 'HELD',
              jobId,
              clientId,
              freelancerId: freelancerId || null
            }
          });

          await createAuditLog({
            action: 'FUNDS_HELD_IN_ESCROW',
            resourceType: 'transaction',
            resourceId: paymentIntent.id,
            ipAddress: 'stripe-webhook',
            userAgent: 'stripe-webhook',
            metadata: { jobId, amount: paymentIntent.amount / 100 }
          });
          logger.info(`Funds held for job ${jobId}`);
        }
        break;
      }
      
      case 'payment_intent.payment_failed': {
        const paymentIntent = event.data.object;
        logger.warn(`Payment failed for intent ${paymentIntent.id}`);
        break;
      }

      default:
        logger.debug(`Unhandled stripe event type ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    logger.error('Webhook processing error', { error: (error as Error).message });
    res.status(500).send('Internal Server Error');
  }
});

export default router;
