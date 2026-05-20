// ============================================================
// Admin Routes — Audit logs, automation logs, system health
// ============================================================

import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { cache } from '../lib/redis';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();
router.use(authenticate);
router.use(authorize('ADMIN'));

// GET /admin/audit-logs
router.get('/audit-logs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const where: any = {};
    if (req.query.action) where.action = req.query.action;
    if (req.query.entityType) where.entityType = req.query.entityType;

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: 'desc' }, include: { user: { select: { email: true, role: true } } } }),
      prisma.auditLog.count({ where }),
    ]);

    res.json({ success: true, data: logs, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (error) { next(error); }
});

// GET /admin/automation-logs
router.get('/automation-logs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;

    const [logs, total] = await Promise.all([
      prisma.automationLog.findMany({ skip: (page - 1) * limit, take: limit, orderBy: { createdAt: 'desc' } }),
      prisma.automationLog.count(),
    ]);

    res.json({ success: true, data: logs, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (error) { next(error); }
});

// GET /admin/system/health — Enhanced with scraper health + data freshness
router.get('/system/health', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const checks: Record<string, any> = { status: 'healthy', timestamp: new Date().toISOString() };

    // DB check
    try {
      await prisma.$queryRawUnsafe('SELECT 1');
      checks.database = { status: 'connected' };
    } catch {
      checks.database = { status: 'disconnected' };
      checks.status = 'degraded';
    }

    // Redis check
    try {
      await cache.ping();
      checks.redis = { status: 'connected' };
    } catch {
      checks.redis = { status: 'disconnected' };
      checks.status = 'degraded';
    }

    // Core stats
    const [totalPassengers, totalApplications, openGhosts, pendingJobs] = await Promise.all([
      prisma.passenger.count(),
      prisma.visaApplication.count(),
      prisma.ghostAlert.count({ where: { status: 'OPEN' } }),
      prisma.reconciliationJob.count({ where: { status: 'PENDING' } }),
    ]);
    checks.stats = { totalPassengers, totalApplications, openGhosts, pendingJobs };

    // Data freshness — how stale is our data?
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [neverChecked, staleRecords, recentlyVerified] = await Promise.all([
      prisma.visaApplication.count({ where: { lastPortalSync: null } }),
      prisma.visaApplication.count({ where: { lastPortalSync: { lt: sevenDaysAgo } } }),
      prisma.visaApplication.count({ where: { lastPortalSync: { gte: sevenDaysAgo } } }),
    ]);
    checks.dataFreshness = {
      neverChecked,
      staleRecords,
      recentlyVerified,
      freshnessScore: totalApplications > 0
        ? Math.round((recentlyVerified / totalApplications) * 100)
        : 0,
    };

    // Import stats
    const lastImport = await prisma.dataImport.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { fileName: true, status: true, createdAt: true, totalRecords: true, mismatchedCount: true },
    });
    checks.lastImport = lastImport || null;

    // Last reconciliation
    const lastRecon = await prisma.reconciliationJob.findFirst({
      where: { status: 'COMPLETED' },
      orderBy: { completedAt: 'desc' },
      select: { completedAt: true, checkedRecords: true, mismatchCount: true, ghostCount: true },
    });
    checks.lastReconciliation = lastRecon || null;

    checks.uptime = process.uptime();
    checks.memory = process.memoryUsage();

    res.json({ success: true, data: checks });
  } catch (error) { next(error); }
});

// GET /admin/dashboard — Dashboard summary
router.get('/dashboard', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const today = new Date(new Date().setHours(0, 0, 0, 0));

    const [totalPassengers, activeVisas, ghostsOpen, ghostsCritical, reconciliationJobs, eventsToday, recentMismatches] = await Promise.all([
      prisma.passenger.count(),
      prisma.visaApplication.count({ where: { status: { in: ['ACTIVE', 'IN_COUNTRY'] } } }),
      prisma.ghostAlert.count({ where: { status: 'OPEN' } }),
      prisma.ghostAlert.count({ where: { status: 'OPEN', riskLevel: 'CRITICAL' } }),
      prisma.reconciliationJob.findMany({ take: 5, orderBy: { createdAt: 'desc' } }),
      prisma.borderEvent.count({ where: { createdAt: { gte: today } } }),
      prisma.reconciliationMismatch.findMany({ take: 10, orderBy: { createdAt: 'desc' }, include: { application: { include: { passenger: { select: { fullName: true } } } } } }),
    ]);

    res.json({
      success: true,
      data: { totalPassengers, activeVisas, ghostsOpen, ghostsCritical, eventsToday, recentReconciliationJobs: reconciliationJobs, recentMismatches },
    });
  } catch (error) { next(error); }
});

// GET /admin/scraper/status — ICP scraper + circuit breaker status
router.get('/scraper/status', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const { icpSpotCheck } = await import('../services/ICPSpotCheckService');
    res.json({ success: true, data: icpSpotCheck.getStatus() });
  } catch (error) { next(error); }
});

// POST /admin/scraper/reset — Reset circuit breaker (admin only)
router.post('/scraper/reset', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { icpCircuitBreaker } = await import('../automation/CircuitBreaker');
    icpCircuitBreaker.reset();

    await prisma.auditLog.create({
      data: {
        userId: req.user!.id,
        action: 'CIRCUIT_BREAKER_RESET',
        entityType: 'System',
        newValues: JSON.stringify({ resetBy: req.user!.id, timestamp: new Date().toISOString() }),
      },
    });

    res.json({ success: true, message: 'Circuit breaker reset successfully' });
  } catch (error) { next(error); }
});

export default router;
