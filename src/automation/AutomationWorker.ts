// ============================================================
// Automation Worker — BullMQ worker for portal automation jobs
// Processes visa status checks from the job queue
// ============================================================

import { Worker, Job, Queue } from 'bullmq';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { cache } from '../lib/redis';
import { config } from '../config';
import { hash } from '../lib/encryption';
import { sessionManager, PortalCredentials } from './BrowserSessionManager';
import { StatusFetcher, PortalStatusResult } from './StatusFetcher';

// ============================================================
// Queue Definitions
// ============================================================

const redisConnection = {
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password || undefined,
};

// Job queues
export const queues = {
  statusCheck: new Queue('visa_status_check', { connection: redisConnection }),
  reconciliation: new Queue('reconciliation', { connection: redisConnection }),
  ghostDetection: new Queue('ghost_detection', { connection: redisConnection }),
  alerting: new Queue('alerting', { connection: redisConnection }),
};

// ============================================================
// Job Interfaces
// ============================================================

export interface StatusCheckJob {
  passportNumber: string;
  applicationId: string;
  accountId: string; // Portal account to use
  priority?: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface ReconciliationJobData {
  jobId: string;
  jobType: 'FULL' | 'TARGETED' | 'TRIGGERED';
  passportNumbers?: string[];
}

export interface GhostDetectionJobData {
  applicationId: string;
  passportNumber: string;
  internalStatus: string;
  portalStatus: string;
}

// ============================================================
// Automation Worker
// ============================================================

export class AutomationWorker {
  private worker: Worker | null = null;
  private statusFetcher: StatusFetcher | null = null;
  private workerId: string;

  constructor() {
    this.workerId = `worker-${process.pid}-${Date.now()}`;
  }

  /**
   * Start the automation worker
   */
  async start(credentials: PortalCredentials): Promise<void> {
    this.statusFetcher = new StatusFetcher(credentials);

    this.worker = new Worker(
      'visa_status_check',
      async (job: Job<StatusCheckJob>) => {
        return this.processStatusCheck(job);
      },
      {
        connection: redisConnection,
        concurrency: 1, // One browser at a time
        limiter: {
          max: 10,
          duration: 60000, // Max 10 jobs per minute
        },
      }
    );

    this.worker.on('completed', (job) => {
      logger.info('✅ Job completed', { jobId: job.id, passport: job.data.passportNumber?.substring(0, 3) + '***' });
    });

    this.worker.on('failed', (job, error) => {
      logger.error('❌ Job failed', { jobId: job?.id, error: error.message });
    });

    this.worker.on('error', (error) => {
      logger.error('Worker error', { error: error.message });
    });

    logger.info('🤖 Automation worker started', { workerId: this.workerId });
  }

  /**
   * Process a visa status check job
   */
  private async processStatusCheck(job: Job<StatusCheckJob>): Promise<PortalStatusResult | null> {
    const { passportNumber, applicationId } = job.data;
    const startTime = Date.now();
    const passportHash = hash(passportNumber);

    // Log automation start
    const logEntry = await prisma.automationLog.create({
      data: {
        workerId: this.workerId,
        jobQueue: 'visa_status_check',
        jobId: job.id,
        passportHash,
        action: 'STATUS_CHECK',
        status: 'RUNNING',
      },
    });

    try {
      // Fetch portal status
      const result = await this.statusFetcher!.fetchStatus(passportNumber);
      const duration = Date.now() - startTime;

      // Update automation log
      await prisma.automationLog.update({
        where: { id: logEntry.id },
        data: {
          status: 'SUCCESS',
          durationMs: duration,
        },
      });

      // Update the visa application with portal status
      await prisma.visaApplication.update({
        where: { id: applicationId },
        data: {
          portalStatus: result.portalStatus,
          lastPortalSync: new Date(),
        },
      });

      // Check for status mismatch
      const application = await prisma.visaApplication.findUnique({
        where: { id: applicationId },
      });

      if (application && application.status !== result.portalStatus) {
        // Enqueue ghost detection job
        await queues.ghostDetection.add('detect', {
          applicationId,
          passportNumber,
          internalStatus: application.status,
          portalStatus: result.portalStatus,
        });
      }

      return result;

    } catch (error: any) {
      const duration = Date.now() - startTime;

      await prisma.automationLog.update({
        where: { id: logEntry.id },
        data: {
          status: 'FAILED',
          durationMs: duration,
          errorMessage: error.message,
          attempts: job.attemptsMade + 1,
        },
      });

      throw error; // BullMQ will handle retry
    }
  }

  /**
   * Stop the worker
   */
  async stop(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
    }
    await sessionManager.shutdown();
    logger.info('Worker stopped', { workerId: this.workerId });
  }
}

// ============================================================
// Ghost Detection Score Calculator
// (Moved here for use by both worker and API)
// ============================================================

export function calculateGhostScore(params: {
  internalStatus: string;
  portalStatus: string;
  lastExitScan?: Date | null;
  lastPortalSync?: Date | null;
  visaExpiry?: Date | null;
}): { score: number; riskLevel: string; suggestedAction: string } {
  let score = 0;
  const now = new Date();

  // Internal says IN_COUNTRY but exit scanned > 24h ago
  if (params.internalStatus === 'IN_COUNTRY' && params.lastExitScan) {
    const hoursSinceExit = (now.getTime() - params.lastExitScan.getTime()) / (1000 * 60 * 60);
    if (hoursSinceExit > 24) score += 40;
    if (hoursSinceExit > 72) score += 30;
  }

  // Portal status mismatches internal
  if (params.portalStatus && params.internalStatus !== params.portalStatus) {
    score += 25;
  }

  // No portal sync in > 12 hours for active record
  if (params.lastPortalSync) {
    const hoursSinceSync = (now.getTime() - params.lastPortalSync.getTime()) / (1000 * 60 * 60);
    if (hoursSinceSync > 12) score += 20;
  } else {
    score += 15; // Never synced
  }

  // Visa expired but showing as active
  if (params.visaExpiry && params.visaExpiry < now &&
      ['ACTIVE', 'IN_COUNTRY'].includes(params.internalStatus)) {
    score += 30;
  }

  score = Math.min(score, 100);

  // Determine risk level
  let riskLevel: string;
  if (score >= 80) riskLevel = 'CRITICAL';
  else if (score >= 60) riskLevel = 'HIGH';
  else if (score >= 40) riskLevel = 'MEDIUM';
  else riskLevel = 'LOW';

  // Suggest action
  let suggestedAction: string;
  if (score >= 80) suggestedAction = 'IMMEDIATE_REVIEW';
  else if (score >= 60) suggestedAction = 'VERIFY_WITH_PORTAL';
  else if (score >= 40) suggestedAction = 'SCHEDULE_RECHECK';
  else suggestedAction = 'MONITOR';

  return { score, riskLevel, suggestedAction };
}
