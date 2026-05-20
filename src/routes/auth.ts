// ============================================================
// Auth Routes — OTP, Login, JWT, Refresh tokens
// ============================================================

import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { cache } from '../lib/redis';
import { config } from '../config';
import { logger } from '../lib/logger';
import { generateOTP, hash } from '../lib/encryption';
import { generateAccessToken, generateRefreshToken, authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { createAuditLog } from '../middleware/audit';
import {
  sendOtpSchema,
  verifyOtpSchema,
  loginSchema,
  registerSchema,
  refreshTokenSchema,
} from '../schemas';
import {
  UnauthorizedError,
  ConflictError,
  ValidationError,
  NotFoundError,
} from '../lib/errors';

const router = Router();

// ========================
// POST /auth/register
// ========================
router.post(
  '/register',
  validate(registerSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email, password, role } = req.body;

      // Check if user exists
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        throw new ConflictError('User with this email already exists');
      }

      // Hash password
      const passwordHash = await bcrypt.hash(password, 12);

      const user = await prisma.user.create({
        data: { email, passwordHash, role },
        select: { id: true, email: true, role: true, createdAt: true },
      });

      await createAuditLog({
        userId: user.id,
        action: 'USER_REGISTERED',
        entityType: 'User',
        entityId: user.id,
        newValues: { email, role },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      logger.info('User registered', { userId: user.id, email });

      res.status(201).json({
        success: true,
        data: user,
      });
    } catch (error) {
      next(error);
    }
  }
);

// ========================
// POST /auth/login
// ========================
router.post(
  '/login',
  validate(loginSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email, password } = req.body;

      const user = await prisma.user.findUnique({ where: { email } });
      if (!user || !user.isActive) {
        throw new UnauthorizedError('Invalid credentials');
      }

      const validPassword = await bcrypt.compare(password, user.passwordHash);
      if (!validPassword) {
        throw new UnauthorizedError('Invalid credentials');
      }

      const tokenPayload = { id: user.id, email: user.email, role: user.role };
      const accessToken = generateAccessToken(tokenPayload);
      const refreshToken = generateRefreshToken(tokenPayload);

      // Store refresh token in Redis
      await cache.set(
        `refresh_token:${user.id}`,
        refreshToken,
        'EX',
        7 * 24 * 60 * 60 // 7 days
      );

      await createAuditLog({
        userId: user.id,
        action: 'USER_LOGIN',
        entityType: 'User',
        entityId: user.id,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      logger.info('User logged in', { userId: user.id });

      res.json({
        success: true,
        data: {
          accessToken,
          refreshToken,
          user: {
            id: user.id,
            email: user.email,
            role: user.role,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// ========================
// POST /auth/send-otp
// ========================
router.post(
  '/send-otp',
  validate(sendOtpSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { identifier, method } = req.body;
      const identifierHash = hash(identifier);

      // Generate OTP
      const otp = generateOTP(config.otp.length);
      const otpHash = await bcrypt.hash(otp, 10);

      // Store OTP in Redis with TTL
      await cache.set(
        `otp:${identifierHash}`,
        JSON.stringify({
          otpHash,
          attempts: 0,
          maxAttempts: config.otp.maxAttempts,
        }),
        'EX',
        config.otp.expirySeconds
      );

      // Also store in PostgreSQL for audit
      await prisma.otpSession.create({
        data: {
          identifier: identifierHash,
          otpHash,
          maxAttempts: config.otp.maxAttempts,
          expiresAt: new Date(Date.now() + config.otp.expirySeconds * 1000),
        },
      });

      // In production: send OTP via Twilio/SendGrid
      // For development: log it
      logger.info('OTP generated', {
        identifier: identifierHash.substring(0, 8) + '...',
        method,
        otp: config.nodeEnv === 'development' ? otp : '[REDACTED]',
      });

      res.json({
        success: true,
        message: `OTP sent via ${method}`,
        ...(config.nodeEnv === 'development' && { devOtp: otp }),
      });
    } catch (error) {
      next(error);
    }
  }
);

// ========================
// POST /auth/verify-otp
// ========================
router.post(
  '/verify-otp',
  validate(verifyOtpSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { identifier, otp } = req.body;
      const identifierHash = hash(identifier);

      // Check Redis first (faster)
      const cached = await cache.get(`otp:${identifierHash}`);
      if (!cached) {
        throw new ValidationError('OTP expired or not found');
      }

      const session = JSON.parse(cached);

      // Check attempts
      if (session.attempts >= session.maxAttempts) {
        await cache.del(`otp:${identifierHash}`);
        throw new ValidationError('Maximum OTP attempts exceeded');
      }

      // Verify OTP
      const valid = await bcrypt.compare(otp, session.otpHash);

      if (!valid) {
        // Increment attempts
        session.attempts += 1;
        await cache.set(
          `otp:${identifierHash}`,
          JSON.stringify(session),
          'KEEPTTL'
        );
        throw new ValidationError(
          `Invalid OTP. ${session.maxAttempts - session.attempts} attempts remaining`
        );
      }

      // OTP verified — clean up
      await cache.del(`otp:${identifierHash}`);

      // Update DB record
      await prisma.otpSession.updateMany({
        where: { identifier: identifierHash, verified: false },
        data: { verified: true },
      });

      logger.info('OTP verified', {
        identifier: identifierHash.substring(0, 8) + '...',
      });

      res.json({
        success: true,
        message: 'OTP verified successfully',
        verified: true,
      });
    } catch (error) {
      next(error);
    }
  }
);

// ========================
// POST /auth/refresh
// ========================
router.post(
  '/refresh',
  validate(refreshTokenSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { refreshToken } = req.body;

      // Verify refresh token
      const jwt = require('jsonwebtoken');
      const decoded = jwt.verify(refreshToken, config.jwt.secret) as any;

      if (decoded.type !== 'refresh') {
        throw new UnauthorizedError('Invalid token type');
      }

      // Check if refresh token is still in Redis
      const stored = await cache.get(`refresh_token:${decoded.id}`);
      if (!stored || stored !== refreshToken) {
        throw new UnauthorizedError('Refresh token revoked');
      }

      // Generate new tokens
      const tokenPayload = { id: decoded.id, email: decoded.email, role: decoded.role };
      const newAccessToken = generateAccessToken(tokenPayload);
      const newRefreshToken = generateRefreshToken(tokenPayload);

      // Replace stored refresh token
      await cache.set(
        `refresh_token:${decoded.id}`,
        newRefreshToken,
        'EX',
        7 * 24 * 60 * 60
      );

      res.json({
        success: true,
        data: {
          accessToken: newAccessToken,
          refreshToken: newRefreshToken,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// ========================
// POST /auth/logout
// ========================
router.post(
  '/logout',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Remove refresh token from Redis
      await cache.del(`refresh_token:${req.user!.id}`);

      await createAuditLog({
        userId: req.user!.id,
        action: 'USER_LOGOUT',
        entityType: 'User',
        entityId: req.user!.id,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      res.json({
        success: true,
        message: 'Logged out successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

// ========================
// GET /auth/me
// ========================
router.get(
  '/me',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.user!.id },
        select: { id: true, email: true, role: true, isActive: true, createdAt: true },
      });

      if (!user) {
        throw new NotFoundError('User');
      }

      res.json({
        success: true,
        data: user,
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
