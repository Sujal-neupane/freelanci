import { PrismaClient } from '@prisma/client';
import logger from '../utils/logger';

const prisma = new PrismaClient();

export async function createSecurityAlert(
  type: string,
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
  message: string,
  ipAddress?: string,
  userId?: string
) {
  try {
    await prisma.securityAlert.create({
      data: {
        type,
        severity,
        message,
        ipAddress,
        userId
      }
    });

    logger.warn(`Security Alert: ${type}`, { severity, message, ipAddress, userId });
  } catch (error) {
    logger.error('Failed to create security alert', { error: (error as Error).message });
  }
}
