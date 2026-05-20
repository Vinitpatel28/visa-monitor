// ============================================================
// Visa Application Routes — CRUD + status management
// ============================================================

import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { encrypt, decrypt } from '../lib/encryption';
import { logger } from '../lib/logger';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { createAuditLog } from '../middleware/audit';
import { createApplicationSchema, updateStatusSchema, statusByPassportSchema } from '../schemas';
import { NotFoundError } from '../lib/errors';

const router = Router();
router.use(authenticate);

// POST /applications
router.post('/', validate(createApplicationSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { passengerId, visaNumber, visaType, issuedDate, expiryDate } = req.body;
    const passenger = await prisma.passenger.findUnique({ where: { id: passengerId } });
    if (!passenger) throw new NotFoundError('Passenger', passengerId);

    const application = await prisma.visaApplication.create({
      data: {
        passengerId, visaNumber, visaType,
        issuedDate: issuedDate ? new Date(issuedDate) : undefined,
        expiryDate: expiryDate ? new Date(expiryDate) : undefined,
      },
    });

    await prisma.statusHistory.create({
      data: { applicationId: application.id, newStatus: 'PENDING', source: 'MANUAL', changedBy: req.user!.id, notes: 'Application created' },
    });

    await createAuditLog({ userId: req.user!.id, action: 'APPLICATION_CREATED', entityType: 'VisaApplication', entityId: application.id, newValues: { visaNumber, visaType }, ipAddress: req.ip, userAgent: req.headers['user-agent'] as string });
    logger.info('Visa application created', { applicationId: application.id });
    res.status(201).json({ success: true, data: application });
  } catch (error) { next(error); }
});

// GET /applications
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const where: any = {};
    if (req.query.status) where.status = req.query.status as string;

    const [applications, total] = await Promise.all([
      prisma.visaApplication.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: 'desc' }, include: { passenger: { select: { id: true, fullName: true, passportNumber: true, nationality: true } } } }),
      prisma.visaApplication.count({ where }),
    ]);

    const result = applications.map((app) => ({ ...app, passenger: { ...app.passenger, fullName: decrypt(app.passenger.fullName), passportNumber: decrypt(app.passenger.passportNumber) } }));
    res.json({ success: true, data: result, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (error) { next(error); }
});

// GET /applications/:id
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const app = await prisma.visaApplication.findUnique({
      where: { id },
      include: {
        passenger: true,
        statusHistory: { orderBy: { createdAt: 'desc' } },
        borderEvents: { orderBy: { eventDatetime: 'desc' } },
        ghostAlerts: { orderBy: { createdAt: 'desc' }, take: 5 },
      },
    });
    if (!app) throw new NotFoundError('VisaApplication', id);
    const pax = app.passenger;
    res.json({ success: true, data: { ...app, passenger: { ...pax, fullName: decrypt(pax.fullName), passportNumber: decrypt(pax.passportNumber) } } });
  } catch (error) { next(error); }
});

// PATCH /applications/:id/status
router.patch('/:id/status', validate(updateStatusSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const { status, notes } = req.body;
    const existing = await prisma.visaApplication.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('VisaApplication', id);

    const updated = await prisma.visaApplication.update({ where: { id }, data: { status } });
    await prisma.statusHistory.create({ data: { applicationId: updated.id, oldStatus: existing.status, newStatus: status, source: 'MANUAL', changedBy: req.user!.id, notes } });
    await createAuditLog({ userId: req.user!.id, action: 'STATUS_UPDATED', entityType: 'VisaApplication', entityId: updated.id, oldValues: { status: existing.status }, newValues: { status }, ipAddress: req.ip, userAgent: req.headers['user-agent'] as string });
    logger.info('Status updated', { applicationId: updated.id, oldStatus: existing.status, newStatus: status });
    res.json({ success: true, data: updated });
  } catch (error) { next(error); }
});

// GET /status/:passport
router.get('/status/:passport', validate(statusByPassportSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const encPassport = encrypt(req.params.passport as string);
    const passenger = await prisma.passenger.findUnique({ where: { passportNumber: encPassport }, include: { visaApplications: { orderBy: { createdAt: 'desc' }, include: { borderEvents: { orderBy: { eventDatetime: 'desc' }, take: 1 } } } } });
    if (!passenger) throw new NotFoundError('Passenger');
    res.json({ success: true, data: { passenger: { id: passenger.id, fullName: decrypt(passenger.fullName), nationality: passenger.nationality }, applications: passenger.visaApplications } });
  } catch (error) { next(error); }
});

export default router;
