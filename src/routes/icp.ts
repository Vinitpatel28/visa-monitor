// ============================================================
// ICP Routes — API endpoints for ICP portal status checks
// POST /check — single passport check
// POST /check-batch — queue multiple passports
// GET /status — scraper/session status
// GET /history — recent check history
// ============================================================

import { Router, Request, Response, NextFunction } from 'express';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { authenticate, authorize } from '../middleware/auth';
import { createAuditLog } from '../middleware/audit';
import { icpStatusFetcher, ICPCheckInput } from '../automation/ICPStatusFetcher';
import { icpCircuitBreaker } from '../automation/CircuitBreaker';

const router = Router();
router.use(authenticate);

// POST /icp/check — Check single passport against ICP portal
router.post('/check', authorize('ADMIN', 'OPERATOR'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { passportNumber, passportExpiry, nationality, permitType, applicationId } = req.body;

    // Validate required fields
    if (!passportNumber || !passportExpiry || !nationality || !permitType) {
      return res.status(400).json({
        success: false,
        error: { message: 'Missing required fields: passportNumber, passportExpiry, nationality, permitType' },
      });
    }

    if (!['RESIDENCY', 'VISA'].includes(permitType)) {
      return res.status(400).json({
        success: false,
        error: { message: 'permitType must be RESIDENCY or VISA' },
      });
    }

    const input: ICPCheckInput = {
      passportNumber,
      passportExpiry,
      nationality,
      permitType,
      applicationId,
    };

    logger.info('🔍 ICP check requested', {
      passport: passportNumber.substring(0, 3) + '***',
      permitType,
      userId: req.user?.id,
    });

    // Run the check (this will open browser, fill form, wait for CAPTCHA)
    const result = await icpStatusFetcher.checkStatus(input);

    // Audit log
    await createAuditLog({
      userId: req.user!.id,
      action: 'ICP_STATUS_CHECK',
      entityType: 'VisaApplication',
      entityId: applicationId || null,
      newValues: {
        passportNumber: passportNumber.substring(0, 3) + '***',
        status: result.status,
        success: result.success,
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] as string,
    });

    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

// POST /icp/check-batch — Queue multiple passports for checking
router.post('/check-batch', authorize('ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { passports } = req.body;
    // passports: Array<{ passportNumber, passportExpiry, nationality, permitType, applicationId? }>

    if (!Array.isArray(passports) || passports.length === 0) {
      return res.status(400).json({
        success: false,
        error: { message: 'passports must be a non-empty array' },
      });
    }

    if (passports.length > 20) {
      return res.status(400).json({
        success: false,
        error: { message: 'Maximum 20 passports per batch' },
      });
    }

    logger.info(`📋 ICP batch check requested: ${passports.length} passports`, {
      userId: req.user?.id,
    });

    // For MVP: process sequentially (one at a time with delays)
    const results = [];
    for (const passport of passports) {
      const result = await icpStatusFetcher.checkStatus({
        passportNumber: passport.passportNumber,
        passportExpiry: passport.passportExpiry,
        nationality: passport.nationality,
        permitType: passport.permitType,
        applicationId: passport.applicationId,
      });
      results.push(result);

      // Delay between checks
      if (results.length < passports.length) {
        await new Promise(r => setTimeout(r, 10000)); // 10s between checks
      }
    }

    res.json({
      success: true,
      data: {
        total: passports.length,
        successful: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        results,
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET /icp/status — Get ICP scraper status
router.get('/status', authorize('ADMIN', 'OPERATOR'), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const status = icpStatusFetcher.getStatus();
    res.json({ success: true, data: status });
  } catch (error) {
    next(error);
  }
});

// GET /icp/history — Recent ICP check history from automation_logs
router.get('/history', authorize('ADMIN', 'OPERATOR'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;

    const [logs, total] = await Promise.all([
      prisma.automationLog.findMany({
        where: { jobQueue: 'icp_status_check' },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.automationLog.count({
        where: { jobQueue: 'icp_status_check' },
      }),
    ]);

    res.json({
      success: true,
      data: logs,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    next(error);
  }
});

// POST /icp/reset — Reset circuit breaker (admin only)
router.post('/reset', authorize('ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    icpCircuitBreaker.reset();

    await createAuditLog({
      userId: req.user!.id,
      action: 'ICP_CIRCUIT_BREAKER_RESET',
      entityType: 'System',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] as string,
    });

    res.json({ success: true, message: 'Circuit breaker reset' });
  } catch (error) {
    next(error);
  }
});

// POST /icp/shutdown — Shutdown browser (admin only)
router.post('/shutdown', authorize('ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    await icpStatusFetcher.shutdown();
    res.json({ success: true, message: 'ICP browser session closed' });
  } catch (error) {
    next(error);
  }
});

export default router;
