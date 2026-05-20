// ============================================================
// Job Scheduler — Cron-based scheduling for reconciliation,
// ghost detection, alert escalation, and session cleanup
// ============================================================

import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { reconciliationEngine } from './ReconciliationEngine';
import { alertService } from './AlertService';
import { sessionPool } from './SessionPool';

interface ScheduledJob {
  name: string;
  intervalMs: number;
  handler: () => Promise<void>;
  timer: NodeJS.Timeout | null;
  lastRun: Date | null;
  isRunning: boolean;
  runCount: number;
}

/**
 * JobScheduler
 * 
 * Manages recurring background tasks:
 * - Full reconciliation (every 6 hours)
 * - Alert escalation checks (every 15 minutes)
 * - Session pool cleanup (every hour)
 * - Stats digest (every 24 hours)
 */
export class JobScheduler {
  private jobs: Map<string, ScheduledJob> = new Map();
  private isRunning = false;

  /**
   * Initialize and register all scheduled jobs
   */
  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    // Register jobs
    this.register('full_reconciliation', 6 * 60 * 60 * 1000, this.runReconciliation.bind(this)); // 6 hours
    this.register('alert_escalation', 15 * 60 * 1000, this.runEscalationCheck.bind(this)); // 15 min
    this.register('session_cleanup', 60 * 60 * 1000, this.runSessionCleanup.bind(this)); // 1 hour
    this.register('daily_digest', 24 * 60 * 60 * 1000, this.runDailyDigest.bind(this)); // 24 hours
    this.register('expired_visa_check', 12 * 60 * 60 * 1000, this.runExpiredVisaCheck.bind(this)); // 12 hours
    this.register('stale_data_check', 24 * 60 * 60 * 1000, this.runStaleDataCheck.bind(this)); // 24 hours

    logger.info('⏰ Job scheduler started', {
      jobs: Array.from(this.jobs.keys()),
    });
  }

  /**
   * Register a recurring job
   */
  private register(name: string, intervalMs: number, handler: () => Promise<void>): void {
    const job: ScheduledJob = {
      name,
      intervalMs,
      handler,
      timer: null,
      lastRun: null,
      isRunning: false,
      runCount: 0,
    };

    // Start the interval
    job.timer = setInterval(async () => {
      if (job.isRunning) {
        logger.debug(`Skipping ${name} — still running from previous invocation`);
        return;
      }

      job.isRunning = true;
      const start = Date.now();

      try {
        await handler();
        job.runCount++;
        job.lastRun = new Date();
        logger.info(`Job ${name} completed`, { durationMs: Date.now() - start, runCount: job.runCount });
      } catch (error: any) {
        logger.error(`Job ${name} failed`, { error: error.message });
      } finally {
        job.isRunning = false;
      }
    }, intervalMs);

    this.jobs.set(name, job);
  }

  /**
   * Manually trigger a job by name
   */
  async triggerJob(name: string): Promise<void> {
    const job = this.jobs.get(name);
    if (!job) throw new Error(`Unknown job: ${name}`);
    if (job.isRunning) throw new Error(`Job ${name} is already running`);

    job.isRunning = true;
    try {
      await job.handler();
      job.runCount++;
      job.lastRun = new Date();
    } finally {
      job.isRunning = false;
    }
  }

  // ════════════════════════════════════════
  // JOB HANDLERS
  // ════════════════════════════════════════

  /**
   * Run full reconciliation
   */
  private async runReconciliation(): Promise<void> {
    logger.info('🔄 Scheduled: Full reconciliation starting...');

    const job = await prisma.reconciliationJob.create({
      data: { jobType: 'FULL', status: 'PENDING' },
    });

    const result = await reconciliationEngine.runFull(job.id);

    // Send alerts for any new ghost detections
    if (result.ghosts > 0) {
      const newAlerts = await prisma.ghostAlert.findMany({
        where: {
          status: 'OPEN',
          createdAt: { gte: new Date(Date.now() - 60000) }, // Last minute
        },
      });

      for (const alert of newAlerts) {
        await alertService.sendGhostAlert(alert.id);
      }
    }
  }

  /**
   * Check for unacknowledged alerts needing escalation
   */
  private async runEscalationCheck(): Promise<void> {
    await alertService.checkEscalations();
  }

  /**
   * Clean up stale sessions
   */
  private async runSessionCleanup(): Promise<void> {
    sessionPool.resetCounters();
    logger.info('Session pool counters reset');
  }

  /**
   * Generate and log daily digest
   */
  private async runDailyDigest(): Promise<void> {
    const digest = await alertService.generateDigest();

    logger.info('📊 Daily Digest', {
      totalAlerts: digest.total,
      critical: digest.critical,
      high: digest.high,
      medium: digest.medium,
      unacknowledged: digest.unacknowledged,
      avgGhostScore: digest.avgScore,
    });

    // Log to automation_logs for reporting
    await prisma.automationLog.create({
      data: {
        workerId: 'scheduler',
        jobQueue: 'daily_digest',
        action: 'DIGEST_GENERATED',
        status: 'SUCCESS',
        errorMessage: JSON.stringify(digest),
      },
    });
  }

  /**
   * Check for expired visas still showing as active
   */
  private async runExpiredVisaCheck(): Promise<void> {
    const expiredActive = await prisma.visaApplication.findMany({
      where: {
        status: { in: ['ACTIVE', 'IN_COUNTRY'] },
        expiryDate: { lt: new Date() },
      },
      include: { passenger: true },
    });

    if (expiredActive.length > 0) {
      logger.warn(`⚠️ Found ${expiredActive.length} expired visas still marked as active`);

      for (const app of expiredActive) {
        // Create status history entry
        await prisma.statusHistory.create({
          data: {
            applicationId: app.id,
            oldStatus: app.status,
            newStatus: 'EXPIRED',
            source: 'SYSTEM',
            notes: `Auto-expired by scheduler. Original expiry: ${app.expiryDate}`,
          },
        });
      }
    }
  }

  /**
   * Check for stale records not verified in 7+ days
   */
  private async runStaleDataCheck(): Promise<void> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const staleCount = await prisma.visaApplication.count({
      where: {
        status: { in: ['ACTIVE', 'IN_COUNTRY'] },
        OR: [
          { lastPortalSync: null },
          { lastPortalSync: { lt: sevenDaysAgo } },
        ],
      },
    });

    if (staleCount > 0) {
      logger.warn(`📊 Stale data alert: ${staleCount} active records not verified in 7+ days`);

      await prisma.automationLog.create({
        data: {
          workerId: 'scheduler',
          jobQueue: 'stale_data_check',
          action: 'STALE_DATA_DETECTED',
          status: 'SUCCESS',
          errorMessage: JSON.stringify({ staleCount, threshold: '7 days' }),
        },
      });
    }
  }

  /**
   * Get scheduler status
   */
  getStatus(): Record<string, any> {
    const status: Record<string, any> = { running: this.isRunning, jobs: {} };

    for (const [name, job] of this.jobs) {
      status.jobs[name] = {
        intervalMs: job.intervalMs,
        intervalHuman: this.humanizeMs(job.intervalMs),
        isRunning: job.isRunning,
        lastRun: job.lastRun?.toISOString() || 'never',
        runCount: job.runCount,
      };
    }

    return status;
  }

  /**
   * Stop all scheduled jobs
   */
  stop(): void {
    for (const [name, job] of this.jobs) {
      if (job.timer) clearInterval(job.timer);
    }
    this.jobs.clear();
    this.isRunning = false;
    logger.info('Job scheduler stopped');
  }

  private humanizeMs(ms: number): string {
    if (ms >= 86400000) return `${ms / 86400000}d`;
    if (ms >= 3600000) return `${ms / 3600000}h`;
    if (ms >= 60000) return `${ms / 60000}m`;
    return `${ms / 1000}s`;
  }
}

export const scheduler = new JobScheduler();
