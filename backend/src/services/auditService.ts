import { PrismaClient, Prisma } from '@prisma/client';
import logger from '../utils/logger';

const prisma = new PrismaClient();

export interface AuditLogEntry {
  userId?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  ipAddress: string;
  userAgent: string;
  metadata?: Prisma.InputJsonValue;
}

/**
 * Creates a structured audit log entry.
 * 
 * Fields logged: userId, action, resourceType, resourceId,
 * ipAddress, userAgent, metadata, timestamp.
 * 
 * NEVER logs: passwords, tokens, card numbers, session IDs.
 */
export async function createAuditLog(entry: AuditLogEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: entry.userId || null,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId || null,
        ipAddress: entry.ipAddress,
        userAgent: entry.userAgent,
        metadata: entry.metadata ?? undefined,
      }
    });

    logger.debug('Audit log created', {
      action: entry.action,
      resourceType: entry.resourceType,
      userId: entry.userId
    });
  } catch (error) {
    // Audit logging should never crash the application
    logger.error('Failed to create audit log', {
      error: (error as Error).message,
      action: entry.action
    });
  }
}

/**
 * Retrieves audit logs with filtering and pagination.
 */
export async function getAuditLogs(options: {
  userId?: string;
  action?: string;
  resourceType?: string;
  page?: number;
  limit?: number;
  startDate?: Date;
  endDate?: Date;
}) {
  const page = options.page || 1;
  const limit = Math.min(options.limit || 50, 100);
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = {};
  if (options.userId) where.userId = options.userId;
  if (options.action) where.action = options.action;
  if (options.resourceType) where.resourceType = options.resourceType;
  if (options.startDate || options.endDate) {
    where.timestamp = {};
    if (options.startDate) (where.timestamp as Record<string, unknown>).gte = options.startDate;
    if (options.endDate) (where.timestamp as Record<string, unknown>).lte = options.endDate;
  }

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      skip,
      take: limit,
      include: {
        user: {
          select: { id: true, email: true, name: true, role: true }
        }
      }
    }),
    prisma.auditLog.count({ where })
  ]);

  return {
    logs,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  };
}
