// ============================================================
// ICP Spot-Check Service — Individual Playwright lookups
// Used for verifying 1-5 records at a time (NOT batch)
// Integrates circuit breaker for stability
// ============================================================

import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { icpCircuitBreaker, CircuitBreakerError } from '../automation/CircuitBreaker';

// ========================
// TYPES
// ========================

export interface SpotCheckRequest {
  passportNumber: string;
  applicationId: string;
  requestedBy: string;
  passportExpiry?: string;
  nationality?: string;
}

export interface SpotCheckResult {
  passportNumber: string;
  applicationId: string;
  status: 'SUCCESS' | 'CAPTCHA_REQUIRED' | 'NOT_FOUND' | 'BLOCKED' | 'ERROR';
  portalStatus?: string;
  rawResponse?: string;
  message: string;
  duration: number;
}

// ========================
// RATE LIMITER (in-memory)
// ========================

class SpotCheckRateLimiter {
  private timestamps: number[] = [];
  private readonly maxPerHour = 20;
  private readonly minIntervalMs = 15000; // 15 seconds between checks

  canProceed(): boolean {
    const now = Date.now();
    const oneHourAgo = now - 3600000;
    this.timestamps = this.timestamps.filter(t => t > oneHourAgo);

    if (this.timestamps.length >= this.maxPerHour) return false;

    const lastCheck = this.timestamps[this.timestamps.length - 1];
    if (lastCheck && (now - lastCheck) < this.minIntervalMs) return false;

    return true;
  }

  record(): void {
    this.timestamps.push(Date.now());
  }

  getStatus() {
    const now = Date.now();
    const oneHourAgo = now - 3600000;
    this.timestamps = this.timestamps.filter(t => t > oneHourAgo);
    return {
      checksThisHour: this.timestamps.length,
      maxPerHour: this.maxPerHour,
      remaining: this.maxPerHour - this.timestamps.length,
      nextAvailable: this.timestamps.length > 0
        ? Math.max(0, this.minIntervalMs - (now - this.timestamps[this.timestamps.length - 1]))
        : 0,
    };
  }
}

// ============================================================
// ICP SPOT-CHECK SERVICE
// ============================================================

export class ICPSpotCheckService {
  private rateLimiter = new SpotCheckRateLimiter();

  /**
   * Perform a single spot-check against ICP portal
   * This is operator-assisted (CAPTCHA solved manually)
   */
  async performSpotCheck(request: SpotCheckRequest): Promise<SpotCheckResult> {
    const startTime = Date.now();
    const maskedPassport = request.passportNumber.substring(0, 3) + '***';

    // Pre-flight checks
    if (!this.rateLimiter.canProceed()) {
      const status = this.rateLimiter.getStatus();
      return {
        passportNumber: request.passportNumber,
        applicationId: request.applicationId,
        status: 'BLOCKED',
        message: `Rate limit reached. ${status.remaining} checks remaining this hour. Try again in ${Math.ceil(status.nextAvailable / 1000)}s.`,
        duration: Date.now() - startTime,
      };
    }

    // Circuit breaker check
    if (!icpCircuitBreaker.canProceed()) {
      const cbStatus = icpCircuitBreaker.getStatus();
      return {
        passportNumber: request.passportNumber,
        applicationId: request.applicationId,
        status: 'BLOCKED',
        message: `Portal circuit breaker is OPEN due to consecutive failures. Retry in ${cbStatus.timeUntilRetry}. Use CSV import or manual entry instead.`,
        duration: Date.now() - startTime,
      };
    }

    try {
      // Execute through circuit breaker
      const result = await icpCircuitBreaker.execute(async () => {
        return this.executeSpotCheck(request);
      });

      this.rateLimiter.record();

      // Log the check
      await prisma.automationLog.create({
        data: {
          workerId: 'spot-check',
          jobQueue: 'icp_spot_check',
          action: 'SPOT_CHECK',
          status: result.status === 'SUCCESS' ? 'SUCCESS' : 'FAILED',
          passportHash: maskedPassport,
          durationMs: result.duration,
          errorMessage: result.status !== 'SUCCESS' ? result.message : undefined,
        },
      });

      // If successful, update the visa application
      if (result.status === 'SUCCESS' && result.portalStatus) {
        await this.updateApplicationStatus(request, result);
      }

      return result;

    } catch (error: any) {
      const duration = Date.now() - startTime;

      if (error instanceof CircuitBreakerError) {
        return {
          passportNumber: request.passportNumber,
          applicationId: request.applicationId,
          status: 'BLOCKED',
          message: error.message,
          duration,
        };
      }

      logger.error('Spot check failed', { passport: maskedPassport, error: error.message });

      return {
        passportNumber: request.passportNumber,
        applicationId: request.applicationId,
        status: 'ERROR',
        message: error.message,
        duration,
      };
    }
  }

  /**
   * Execute the actual ICP portal lookup
   * Note: This returns CAPTCHA_REQUIRED since real automation needs operator
   */
  private async executeSpotCheck(request: SpotCheckRequest): Promise<SpotCheckResult> {
    const startTime = Date.now();

    // In production, this would launch Playwright and navigate to ICP portal.
    // Since ICP requires CAPTCHA, we return a status indicating operator action needed.
    //
    // The actual flow would be:
    // 1. Launch browser → navigate to ICP File Validity page
    // 2. Fill in passport number, expiry, nationality
    // 3. Pause for operator to solve CAPTCHA
    // 4. Submit and extract result
    //
    // For now, we provide the mock/simulation approach:

    logger.info('🔍 ICP spot-check initiated', {
      passport: request.passportNumber.substring(0, 3) + '***',
    });

    // Simulate the CAPTCHA requirement
    // In real implementation, this would be replaced with actual Playwright code
    return {
      passportNumber: request.passportNumber,
      applicationId: request.applicationId,
      status: 'CAPTCHA_REQUIRED',
      message: 'ICP portal requires CAPTCHA verification. Use the operator-assist mode in the dashboard, or enter status manually via Import → Manual Entry.',
      duration: Date.now() - startTime,
    };
  }

  /**
   * Update application with spot-check result
   */
  private async updateApplicationStatus(
    request: SpotCheckRequest,
    result: SpotCheckResult
  ): Promise<void> {
    if (!result.portalStatus) return;

    const app = await prisma.visaApplication.findUnique({
      where: { id: request.applicationId },
    });

    if (!app) return;

    // Update visa application
    await prisma.visaApplication.update({
      where: { id: request.applicationId },
      data: {
        portalStatus: result.portalStatus,
        icpStatus: result.rawResponse || result.portalStatus,
        dataSource: 'PLAYWRIGHT',
        lastPortalSync: new Date(),
      },
    });

    // Update passenger verification timestamp
    const passenger = await prisma.passenger.findFirst({
      where: { visaApplications: { some: { id: request.applicationId } } },
    });

    if (passenger) {
      await prisma.passenger.update({
        where: { id: passenger.id },
        data: {
          lastVerifiedAt: new Date(),
          lastVerifiedBy: 'PLAYWRIGHT',
        },
      });
    }

    // Record status history
    await prisma.statusHistory.create({
      data: {
        applicationId: request.applicationId,
        oldStatus: app.portalStatus || 'UNKNOWN',
        newStatus: result.portalStatus,
        source: 'AUTOMATION',
        notes: `ICP spot-check by operator. Requested by: ${request.requestedBy}`,
      },
    });

    // Check for mismatch
    if (app.status !== result.portalStatus) {
      logger.warn('⚠️ Spot-check detected status mismatch', {
        internal: app.status,
        portal: result.portalStatus,
      });
    }
  }

  /**
   * Get service status (for dashboard)
   */
  getStatus() {
    return {
      circuitBreaker: icpCircuitBreaker.getStatus(),
      rateLimiter: this.rateLimiter.getStatus(),
    };
  }
}

// Export singleton
export const icpSpotCheck = new ICPSpotCheckService();
