// ============================================================
// Passenger Routes — CRUD operations for passport holders
// ============================================================

import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { encrypt, decrypt } from '../lib/encryption';
import { logger } from '../lib/logger';
import { authenticate, authorize } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { createAuditLog } from '../middleware/audit';
import { createPassengerSchema, updatePassengerSchema } from '../schemas';
import { NotFoundError, ConflictError } from '../lib/errors';

const router = Router();

// All passenger routes require authentication
router.use(authenticate);

// ========================
// POST /passengers — Create new passenger
// ========================
router.post(
  '/',
  validate(createPassengerSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { passportNumber, fullName, nationality, dateOfBirth, sponsorCompany, department } = req.body;

      // Encrypt PII before storing
      const encryptedPassport = encrypt(passportNumber);
      const encryptedName = encrypt(fullName);

      // Check for duplicate
      const existing = await prisma.passenger.findUnique({
        where: { passportNumber: encryptedPassport },
      });
      if (existing) {
        throw new ConflictError('Passenger with this passport number already exists');
      }

      const passenger = await prisma.passenger.create({
        data: {
          passportNumber: encryptedPassport,
          fullName: encryptedName,
          nationality,
          dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : undefined,
          sponsorCompany,
          department,
        },
      });

      await createAuditLog({
        userId: req.user!.id,
        action: 'PASSENGER_CREATED',
        entityType: 'Passenger',
        entityId: passenger.id,
        newValues: { passportNumber: '***ENCRYPTED***', nationality, sponsorCompany },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      logger.info('Passenger created', { passengerId: passenger.id });

      // Return with decrypted data
      res.status(201).json({
        success: true,
        data: {
          ...passenger,
          passportNumber: passportNumber, // Return original
          fullName: fullName,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// ========================
// GET /passengers — List all passengers (paginated)
// ========================
router.get(
  '/',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const skip = (page - 1) * limit;

      const [passengers, total] = await Promise.all([
        prisma.passenger.findMany({
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: {
            visaApplications: {
              select: { id: true, visaNumber: true, status: true, visaType: true },
            },
          },
        }),
        prisma.passenger.count(),
      ]);

      // Decrypt PII for response
      const decrypted = passengers.map((p) => ({
        ...p,
        passportNumber: decrypt(p.passportNumber),
        fullName: decrypt(p.fullName),
      }));

      res.json({
        success: true,
        data: decrypted,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// ========================
// GET /passengers/:id — Get single passenger
// ========================
router.get(
  '/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      const passenger = await prisma.passenger.findUnique({
        where: { id },
        include: {
          visaApplications: {
            include: {
              borderEvents: { orderBy: { eventDatetime: 'desc' }, take: 5 },
              statusHistory: { orderBy: { createdAt: 'desc' }, take: 10 },
            },
          },
        },
      });

      if (!passenger) {
        throw new NotFoundError('Passenger', id);
      }

      res.json({
        success: true,
        data: {
          ...passenger,
          passportNumber: decrypt(passenger.passportNumber),
          fullName: decrypt(passenger.fullName),
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// ========================
// PATCH /passengers/:id — Update passenger
// ========================
router.patch(
  '/:id',
  validate(updatePassengerSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { fullName, nationality, dateOfBirth, sponsorCompany, department } = req.body;

      const id = req.params.id as string;
      const existing = await prisma.passenger.findUnique({ where: { id } });
      if (!existing) {
        throw new NotFoundError('Passenger', id);
      }

      const updateData: any = {};
      if (fullName) updateData.fullName = encrypt(fullName);
      if (nationality !== undefined) updateData.nationality = nationality;
      if (dateOfBirth) updateData.dateOfBirth = new Date(dateOfBirth);
      if (sponsorCompany !== undefined) updateData.sponsorCompany = sponsorCompany;
      if (department !== undefined) updateData.department = department;

      const updated = await prisma.passenger.update({
        where: { id },
        data: updateData,
      });

      await createAuditLog({
        userId: req.user!.id,
        action: 'PASSENGER_UPDATED',
        entityType: 'Passenger',
        entityId: updated.id,
        oldValues: { nationality: existing.nationality, sponsorCompany: existing.sponsorCompany },
        newValues: { nationality, sponsorCompany },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      res.json({
        success: true,
        data: {
          ...updated,
          passportNumber: decrypt(updated.passportNumber),
          fullName: decrypt(updated.fullName),
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
