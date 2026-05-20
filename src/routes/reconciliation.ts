// ============================================================
// Reconciliation Routes — Trigger, track, and resolve mismatches
// Uses the real ReconciliationEngine + AlertService
// ============================================================

import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { authenticate, authorize } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { createAuditLog } from '../middleware/audit';
import { triggerReconciliationSchema, resolveMismatchSchema } from '../schemas';
import { NotFoundError } from '../lib/errors';
import { reconciliationEngine } from '../automation/ReconciliationEngine';
import { alertService } from '../automation/AlertService';

const router = Router();
router.use(authenticate);

// POST /reconciliation/trigger — Trigger reconciliation job
router.post('/trigger', validate(triggerReconciliationSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { jobType } = req.body;

    const totalRecords = await prisma.visaApplication.count({
      where: { status: { in: ['ACTIVE', 'IN_COUNTRY', 'EXITED'] } },
    });

    const job = await prisma.reconciliationJob.create({
      data: { jobType, totalRecords, status: 'PENDING' },
    });

    logger.info('Reconciliation job triggered', { jobId: job.id, jobType, totalRecords });

    // Run real reconciliation engine in background
    reconciliationEngine.runFull(job.id).then(async (result) => {
      // Dispatch alerts for new ghosts
      if (result.ghosts > 0) {
        const newAlerts = await prisma.ghostAlert.findMany({
          where: { status: 'OPEN', createdAt: { gte: new Date(Date.now() - 300000) } },
        });
        for (const alert of newAlerts) {
          await alertService.sendGhostAlert(alert.id);
        }
      }
    }).catch((err) => {
      logger.error('Reconciliation failed', { jobId: job.id, error: err.message });
    });

    await createAuditLog({ userId: req.user!.id, action: 'RECONCILIATION_TRIGGERED', entityType: 'ReconciliationJob', entityId: job.id, newValues: { jobType, totalRecords }, ipAddress: req.ip, userAgent: req.headers['user-agent'] });

    res.status(202).json({ success: true, data: job, message: 'Reconciliation job queued' });
  } catch (error) { next(error); }
});

// GET /reconciliation/jobs — List jobs
router.get('/jobs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;

    const [jobs, total] = await Promise.all([
      prisma.reconciliationJob.findMany({ skip: (page - 1) * limit, take: limit, orderBy: { createdAt: 'desc' } }),
      prisma.reconciliationJob.count(),
    ]);

    res.json({ success: true, data: jobs, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (error) { next(error); }
});

// GET /reconciliation/jobs/:id — Job details
router.get('/jobs/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const job = await prisma.reconciliationJob.findUnique({
      where: { id },
      include: { mismatches: { orderBy: { createdAt: 'desc' } } },
    });
    if (!job) throw new NotFoundError('ReconciliationJob', id);
    res.json({ success: true, data: job });
  } catch (error) { next(error); }
});

// GET /reconciliation/mismatches — List all mismatches
router.get('/mismatches', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const riskLevel = req.query.riskLevel as string | undefined;

    const where: any = {};
    if (riskLevel) where.riskLevel = riskLevel;
    if (req.query.resolved === 'false') where.autoResolved = false;

    const [mismatches, total] = await Promise.all([
      prisma.reconciliationMismatch.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: 'desc' }, include: { application: { include: { passenger: { select: { fullName: true, passportNumber: true } } } } } }),
      prisma.reconciliationMismatch.count({ where }),
    ]);

    res.json({ success: true, data: mismatches, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (error) { next(error); }
});

// PATCH /reconciliation/mismatches/:id/resolve
router.patch('/mismatches/:id/resolve', validate(resolveMismatchSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const { resolutionNotes } = req.body;
    const mismatch = await prisma.reconciliationMismatch.findUnique({ where: { id } });
    if (!mismatch) throw new NotFoundError('ReconciliationMismatch', id);

    const updated = await prisma.reconciliationMismatch.update({
      where: { id },
      data: { resolvedAt: new Date(), resolvedBy: req.user!.id, resolutionNotes, autoResolved: false },
    });

    await createAuditLog({ userId: req.user!.id, action: 'MISMATCH_RESOLVED', entityType: 'ReconciliationMismatch', entityId: updated.id, newValues: { resolutionNotes }, ipAddress: req.ip, userAgent: req.headers['user-agent'] as string });
    res.json({ success: true, data: updated });
  } catch (error) { next(error); }
});

export default router;
