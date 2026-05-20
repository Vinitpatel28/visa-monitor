// ============================================================
// Border Events Routes — Entry/Exit event recording
// ============================================================

import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { createAuditLog } from '../middleware/audit';
import { entryEventSchema, exitEventSchema } from '../schemas';
import { NotFoundError, ConflictError } from '../lib/errors';

const router = Router();
router.use(authenticate);

// POST /events/entry
router.post('/entry', validate(entryEventSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { applicationId, eventDatetime, portOfEntry, idempotencyKey, source } = req.body;

    // Idempotency check
    const existing = await prisma.borderEvent.findUnique({ where: { idempotencyKey } });
    if (existing) {
      res.json({ success: true, data: existing, message: 'Event already recorded (idempotent)' });
      return;
    }

    const app = await prisma.visaApplication.findUnique({ where: { id: applicationId } });
    if (!app) throw new NotFoundError('VisaApplication', applicationId);

    const event = await prisma.borderEvent.create({
      data: { applicationId, eventType: 'ENTRY', eventDatetime: new Date(eventDatetime), portOfEntry, idempotencyKey, source },
    });

    // Update application status to IN_COUNTRY
    await prisma.visaApplication.update({ where: { id: applicationId }, data: { status: 'IN_COUNTRY' } });
    await prisma.statusHistory.create({
      data: { applicationId, oldStatus: app.status, newStatus: 'IN_COUNTRY', source: 'ENTRY_EVENT', changedBy: req.user!.id, notes: `Entry at ${portOfEntry || 'unknown port'}` },
    });

    await createAuditLog({ userId: req.user!.id, action: 'ENTRY_EVENT_RECORDED', entityType: 'BorderEvent', entityId: event.id, newValues: { applicationId, eventType: 'ENTRY', portOfEntry }, ipAddress: req.ip, userAgent: req.headers['user-agent'] });
    logger.info('Entry event recorded', { eventId: event.id, applicationId });
    res.status(201).json({ success: true, data: event });
  } catch (error) { next(error); }
});

// POST /events/exit
router.post('/exit', validate(exitEventSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { applicationId, eventDatetime, portOfEntry, idempotencyKey, source } = req.body;

    const existing = await prisma.borderEvent.findUnique({ where: { idempotencyKey } });
    if (existing) {
      res.json({ success: true, data: existing, message: 'Event already recorded (idempotent)' });
      return;
    }

    const app = await prisma.visaApplication.findUnique({ where: { id: applicationId } });
    if (!app) throw new NotFoundError('VisaApplication', applicationId);

    const event = await prisma.borderEvent.create({
      data: { applicationId, eventType: 'EXIT', eventDatetime: new Date(eventDatetime), portOfEntry, idempotencyKey, source },
    });

    await prisma.visaApplication.update({ where: { id: applicationId }, data: { status: 'EXITED' } });
    await prisma.statusHistory.create({
      data: { applicationId, oldStatus: app.status, newStatus: 'EXITED', source: 'EXIT_EVENT', changedBy: req.user!.id, notes: `Exit at ${portOfEntry || 'unknown port'}` },
    });

    await createAuditLog({ userId: req.user!.id, action: 'EXIT_EVENT_RECORDED', entityType: 'BorderEvent', entityId: event.id, newValues: { applicationId, eventType: 'EXIT', portOfEntry }, ipAddress: req.ip, userAgent: req.headers['user-agent'] });
    logger.info('Exit event recorded', { eventId: event.id, applicationId });
    res.status(201).json({ success: true, data: event });
  } catch (error) { next(error); }
});

// GET /events/:applicationId
router.get('/:applicationId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const events = await prisma.borderEvent.findMany({
      where: { applicationId: req.params.applicationId as string },
      orderBy: { eventDatetime: 'desc' },
    });
    res.json({ success: true, data: events });
  } catch (error) { next(error); }
});

export default router;
