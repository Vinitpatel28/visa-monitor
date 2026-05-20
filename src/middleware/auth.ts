// ============================================================
// JWT Authentication Middleware
// ============================================================

import { Request, Response, NextFunction } from 'express';
import jwt, { SignOptions } from 'jsonwebtoken';
import { config } from '../config';
import { UnauthorizedError, ForbiddenError } from '../lib/errors';

// Request user type is declared in types/express.d.ts

interface JwtPayload {
  id: string;
  email: string;
  role: string;
  type: 'access' | 'refresh';
}

/**
 * Middleware: Requires valid JWT access token
 */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new UnauthorizedError('Missing or invalid authorization header');
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, config.jwt.secret) as JwtPayload;

    if (decoded.type !== 'access') {
      throw new UnauthorizedError('Invalid token type');
    }

    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
    };

    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new UnauthorizedError('Token expired');
    }
    if (error instanceof jwt.JsonWebTokenError) {
      throw new UnauthorizedError('Invalid token');
    }
    throw error;
  }
}

/**
 * Middleware: Requires specific role(s)
 * Usage: router.get('/admin', authenticate, authorize('ADMIN'), handler)
 */
export function authorize(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new UnauthorizedError('Authentication required');
    }

    if (!roles.includes(req.user.role)) {
      throw new ForbiddenError(`Role '${req.user.role}' does not have access to this resource`);
    }

    next();
  };
}

/**
 * Generate JWT access token
 */
export function generateAccessToken(payload: { id: string; email: string; role: string }): string {
  const options: SignOptions = { expiresIn: config.jwt.accessExpiry as any };
  return jwt.sign(
    { ...payload, type: 'access' },
    config.jwt.secret,
    options
  );
}

/**
 * Generate JWT refresh token
 */
export function generateRefreshToken(payload: { id: string; email: string; role: string }): string {
  const options: SignOptions = { expiresIn: config.jwt.refreshExpiry as any };
  return jwt.sign(
    { ...payload, type: 'refresh' },
    config.jwt.secret,
    options
  );
}
