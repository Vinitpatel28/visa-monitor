// ============================================================
// Ghost Alert Routes — Manage ghost passenger alerts
// ============================================================

import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { decrypt } from '../lib/encryption';
import { authenticate, authorize } from '../middleware/auth';
import { createAuditLog } from '../middleware/audit';
import { NotFoundError } from '../lib/errors';
import { icpSpotCheck } from '../services/ICPSpotCheckService';

const router = Router();
router.use(authenticate);

// GET /ghosts — List ghost alerts
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const where: any = {};
    if (req.query.status) where.status = req.query.status;
    if (req.query.riskLevel) where.riskLevel = req.query.riskLevel;

    const [alerts, total] = await Promise.all([
      prisma.ghostAlert.findMany({
        where, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: 'desc' },
        include: { application: { include: { passenger: { select: { fullName: true, passportNumber: true, nationality: true, sponsorCompany: true } } } } },
      }),
      prisma.ghostAlert.count({ where }),
    ]);

    const data = alerts.map((a) => ({
      ...a,
      application: { ...a.application, passenger: { ...a.application.passenger, fullName: decrypt(a.application.passenger.fullName), passportNumber: decrypt(a.application.passenger.passportNumber) } },
    }));

    res.json({ success: true, data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (error) { next(error); }
});

// GET /ghosts/stats — Dashboard stats
router.get('/stats', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const [total, open, critical, high, resolvedToday] = await Promise.all([
      prisma.ghostAlert.count(),
      prisma.ghostAlert.count({ where: { status: 'OPEN' } }),
      prisma.ghostAlert.count({ where: { riskLevel: 'CRITICAL', status: 'OPEN' } }),
      prisma.ghostAlert.count({ where: { riskLevel: 'HIGH', status: 'OPEN' } }),
      prisma.ghostAlert.count({ where: { status: 'RESOLVED', resolvedAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } } }),
    ]);

    res.json({ success: true, data: { total, open, critical, high, resolvedToday, medium: open - critical - high } });
  } catch (error) { next(error); }
});

// GET /ghosts/scraper-status — ICP scraper + circuit breaker health
router.get('/scraper-status', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const status = icpSpotCheck.getStatus();
    res.json({ success: true, data: status });
  } catch (error) { next(error); }
});

// PATCH /ghosts/:id/acknowledge
router.patch('/:id/acknowledge', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const alert = await prisma.ghostAlert.findUnique({ where: { id } });
    if (!alert) throw new NotFoundError('GhostAlert', id);

    const updated = await prisma.ghostAlert.update({
      where: { id },
      data: { status: 'ACKNOWLEDGED', acknowledgedBy: req.user!.id, acknowledgedAt: new Date() },
    });

    await createAuditLog({ userId: req.user!.id, action: 'GHOST_ACKNOWLEDGED', entityType: 'GhostAlert', entityId: updated.id, ipAddress: req.ip, userAgent: req.headers['user-agent'] as string });
    res.json({ success: true, data: updated });
  } catch (error) { next(error); }
});

// PATCH /ghosts/:id/resolve — Resolve with notes
router.patch('/:id/resolve', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const { resolution, notes } = req.body;
    const alert = await prisma.ghostAlert.findUnique({ where: { id } });
    if (!alert) throw new NotFoundError('GhostAlert', id);

    const updated = await prisma.ghostAlert.update({
      where: { id },
      data: { status: 'RESOLVED', resolvedAt: new Date() },
    });

    await createAuditLog({
      userId: req.user!.id, action: 'GHOST_RESOLVED', entityType: 'GhostAlert',
      entityId: updated.id, ipAddress: req.ip, userAgent: req.headers['user-agent'] as string,
      newValues: { resolution: resolution || 'Resolved', notes: notes || '' },
    });
    res.json({ success: true, data: updated });
  } catch (error) { next(error); }
});

// PATCH /ghosts/:id/false-positive
router.patch('/:id/false-positive', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const alert = await prisma.ghostAlert.findUnique({ where: { id } });
    if (!alert) throw new NotFoundError('GhostAlert', id);

    const updated = await prisma.ghostAlert.update({
      where: { id },
      data: { status: 'FALSE_POSITIVE', resolvedAt: new Date() },
    });

    await createAuditLog({ userId: req.user!.id, action: 'GHOST_FALSE_POSITIVE', entityType: 'GhostAlert', entityId: updated.id, ipAddress: req.ip, userAgent: req.headers['user-agent'] as string });
    res.json({ success: true, data: updated });
  } catch (error) { next(error); }
});

// POST /ghosts/:id/spot-check — Trigger ICP spot-check for a ghost alert
router.post('/:id/spot-check',
  authorize('ADMIN', 'OPERATOR'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      const alert = await prisma.ghostAlert.findUnique({
        where: { id },
        include: {
          application: {
            include: { passenger: { select: { passportNumber: true, passportExpiry: true, nationality: true } } },
          },
        },
      });

      if (!alert) throw new NotFoundError('GhostAlert', id);

      const passenger = alert.application.passenger;
      const result = await icpSpotCheck.performSpotCheck({
        passportNumber: decrypt(passenger.passportNumber),
        applicationId: alert.applicationId,
        requestedBy: req.user!.id,
        passportExpiry: passenger.passportExpiry?.toISOString().split('T')[0],
        nationality: passenger.nationality || undefined,
      });

      await createAuditLog({
        userId: req.user!.id, action: 'SPOT_CHECK_TRIGGERED', entityType: 'GhostAlert',
        entityId: id, ipAddress: req.ip, userAgent: req.headers['user-agent'] as string,
        newValues: { result: result.status, message: result.message },
      });

      res.json({ success: true, data: result });
    } catch (error) { next(error); }
  }
);

export default router;
