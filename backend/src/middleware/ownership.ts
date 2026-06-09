import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import logger from '../utils/logger';

const prisma = new PrismaClient();

/**
 * Ownership verification middleware to prevent IDOR vulnerabilities.
 * Checks that req.session.userId matches the resource owner.
 * 
 * This is the most common vulnerability found in pentesting —
 * users changing resource IDs in URLs to access other users' data.
 * 
 * @param resourceType - 'job' | 'bid' | 'dispute'
 * @param paramName - req.params key containing the resource ID (default: 'id')
 */
export function requireOwnership(resourceType: 'job' | 'bid' | 'dispute', paramName: string = 'id') {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const resourceId = req.params[paramName];
    const userId = req.session.userId;

    if (!resourceId || !userId || typeof resourceId !== 'string') {
      res.status(400).json({ error: 'Invalid request' });
      return;
    }

    try {
      let isOwner = false;

      switch (resourceType) {
        case 'job': {
          const job = await prisma.job.findUnique({
            where: { id: resourceId },
            select: { clientId: true }
          });
          if (!job) {
            res.status(404).json({ error: 'Job not found' });
            return;
          }
          isOwner = job.clientId === userId;
          break;
        }

        case 'bid': {
          const bid = await prisma.bid.findUnique({
            where: { id: resourceId },
            select: { freelancerId: true }
          });
          if (!bid) {
            res.status(404).json({ error: 'Bid not found' });
            return;
          }
          isOwner = bid.freelancerId === userId;
          break;
        }

        case 'dispute': {
          const dispute = await prisma.dispute.findUnique({
            where: { id: resourceId },
            select: { raisedById: true }
          });
          if (!dispute) {
            res.status(404).json({ error: 'Dispute not found' });
            return;
          }
          isOwner = dispute.raisedById === userId;
          break;
        }
      }

      // Admins can bypass ownership checks
      if (!isOwner && req.session.role !== 'ADMIN') {
        logger.warn('Ownership check failed — possible IDOR attempt', {
          userId,
          resourceType,
          resourceId,
          path: req.path,
          ip: req.ip
        });
        res.status(403).json({ error: 'Access denied — you do not own this resource' });
        return;
      }

      next();
    } catch (error) {
      logger.error('Ownership check error', { error, resourceType, resourceId });
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}
