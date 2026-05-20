// ============================================================
// Audit Log Middleware — Tracks all data-modifying operations
// ============================================================

import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

/**
 * Creates an audit log entry for data-modifying operations.
 * Called after successful operations in route handlers.
 */
export async function createAuditLog(params: {
  userId?: string;
  action: string;
  entityType?: string;
  entityId?: string;
  oldValues?: Record<string, any>;
  newValues?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: params.userId,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        oldValues: params.oldValues ? JSON.stringify(params.oldValues) : undefined,
        newValues: params.newValues ? JSON.stringify(params.newValues) : undefined,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
      },
    });
  } catch (error) {
    // Audit log failures should never break the request
    logger.error('Failed to create audit log', { error, params });
  }
}

/**
 * Middleware that attaches audit helper to request
 */
export function auditMiddleware(req: Request, _res: Response, next: NextFunction): void {
  // Attach IP and user agent for easy access in handlers
  (req as any).auditContext = {
    ipAddress: req.ip || req.socket.remoteAddress,
    userAgent: req.headers['user-agent'],
  };
  next();
}
