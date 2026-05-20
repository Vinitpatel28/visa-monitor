// ============================================================
// Reconciliation Engine — Core engine for visa status matching
// Coordinates portal status vs internal DB + ghost detection
// ============================================================

import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { decrypt } from '../lib/encryption';
import { calculateGhostScore } from './AutomationWorker';

export interface ReconciliationConfig {
  batchSize: number;
  ghostThresholdHours: number;
  autoResolveThreshold: number; // Score below this auto-resolves
  maxConcurrent: number;
}

interface ReconciliationResult {
  jobId: string;
  totalChecked: number;
  mismatches: number;
  ghosts: number;
  autoResolved: number;
  duration: number;
  errors: string[];
}

const DEFAULT_CONFIG: ReconciliationConfig = {
  batchSize: 50,
  ghostThresholdHours: 24,
  autoResolveThreshold: 20,
  maxConcurrent: 3,
};

/**
 * ReconciliationEngine
 *
 * Enterprise reconciliation engine that:
 * 1. Compares internal visa statuses against portal data
 * 2. Detects ghost passengers (status mismatches, stale entries)
 * 3. Auto-resolves low-risk mismatches
 * 4. Escalates high-risk cases with scored alerts
 * 5. Maintains full audit trail
 */
export class ReconciliationEngine {
  private config: ReconciliationConfig;

  constructor(config: Partial<ReconciliationConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Run a full reconciliation job
   */
  async runFull(jobId: string): Promise<ReconciliationResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    let totalChecked = 0;
    let mismatchCount = 0;
    let ghostCount = 0;
    let autoResolved = 0;

    logger.info('🔄 Reconciliation engine starting FULL run', { jobId });

    await prisma.reconciliationJob.update({
      where: { id: jobId },
      data: { status: 'RUNNING', startedAt: new Date() },
    });

    try {
      // Get all active/in-country applications in batches
      const totalRecords = await prisma.visaApplication.count({
        where: { status: { in: ['ACTIVE', 'IN_COUNTRY', 'EXITED'] } },
      });

      await prisma.reconciliationJob.update({
        where: { id: jobId },
        data: { totalRecords },
      });

      let offset = 0;

      while (offset < totalRecords) {
        const batch = await prisma.visaApplication.findMany({
          where: { status: { in: ['ACTIVE', 'IN_COUNTRY', 'EXITED'] } },
          include: {
            passenger: true,
            borderEvents: { orderBy: { eventDatetime: 'desc' }, take: 5 },
            ghostAlerts: { where: { status: 'OPEN' }, take: 1 },
          },
          skip: offset,
          take: this.config.batchSize,
        });

        for (const app of batch) {
          try {
            const result = await this.reconcileApplication(jobId, app);
            totalChecked++;

            if (result.isMismatch) mismatchCount++;
            if (result.isGhost) ghostCount++;
            if (result.autoResolved) autoResolved++;
          } catch (error: any) {
            errors.push(`App ${app.id}: ${error.message}`);
            logger.error('Reconciliation error for application', {
              applicationId: app.id,
              error: error.message,
            });
          }
        }

        offset += this.config.batchSize;

        // Progress update
        await prisma.reconciliationJob.update({
          where: { id: jobId },
          data: {
            checkedRecords: totalChecked,
            mismatchCount,
            ghostCount,
          },
        });

        logger.info('Reconciliation progress', {
          jobId,
          checked: totalChecked,
          total: totalRecords,
          percent: Math.round((totalChecked / totalRecords) * 100),
        });
      }

      // Mark complete
      const duration = Date.now() - startTime;
      await prisma.reconciliationJob.update({
        where: { id: jobId },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          checkedRecords: totalChecked,
          mismatchCount,
          ghostCount,
          errorMessage: errors.length > 0 ? errors.join('; ') : null,
        },
      });

      logger.info('✅ Reconciliation completed', {
        jobId,
        totalChecked,
        mismatches: mismatchCount,
        ghosts: ghostCount,
        autoResolved,
        durationMs: duration,
      });

      return { jobId, totalChecked, mismatches: mismatchCount, ghosts: ghostCount, autoResolved, duration, errors };

    } catch (error: any) {
      await prisma.reconciliationJob.update({
        where: { id: jobId },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          errorMessage: error.message,
        },
      });
      throw error;
    }
  }

  /**
   * Run targeted reconciliation for specific applications
   */
  async runTargeted(jobId: string, applicationIds: string[]): Promise<ReconciliationResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    let totalChecked = 0;
    let mismatchCount = 0;
    let ghostCount = 0;
    let autoResolved = 0;

    logger.info('🎯 Reconciliation engine starting TARGETED run', {
      jobId,
      targets: applicationIds.length,
    });

    await prisma.reconciliationJob.update({
      where: { id: jobId },
      data: { status: 'RUNNING', startedAt: new Date(), totalRecords: applicationIds.length },
    });

    const applications = await prisma.visaApplication.findMany({
      where: { id: { in: applicationIds } },
      include: {
        passenger: true,
        borderEvents: { orderBy: { eventDatetime: 'desc' }, take: 5 },
        ghostAlerts: { where: { status: 'OPEN' }, take: 1 },
      },
    });

    for (const app of applications) {
      try {
        const result = await this.reconcileApplication(jobId, app);
        totalChecked++;
        if (result.isMismatch) mismatchCount++;
        if (result.isGhost) ghostCount++;
        if (result.autoResolved) autoResolved++;
      } catch (error: any) {
        errors.push(`App ${app.id}: ${error.message}`);
      }
    }

    const duration = Date.now() - startTime;
    await prisma.reconciliationJob.update({
      where: { id: jobId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        checkedRecords: totalChecked,
        mismatchCount,
        ghostCount,
      },
    });

    return { jobId, totalChecked, mismatches: mismatchCount, ghosts: ghostCount, autoResolved, duration, errors };
  }

  /**
   * Reconcile a single visa application
   */
  private async reconcileApplication(
    jobId: string,
    app: any
  ): Promise<{ isMismatch: boolean; isGhost: boolean; autoResolved: boolean }> {
    let isMismatch = false;
    let isGhost = false;
    let autoResolved = false;

    const internalStatus = app.status;

    // Determine portal status (use stored portalStatus or simulate)
    const portalStatus = app.portalStatus || this.simulatePortalStatus(app);

    // ═══════════════════════════════════════
    // CHECK 1: Status mismatch detection
    // ═══════════════════════════════════════
    if (portalStatus && internalStatus !== portalStatus) {
      isMismatch = true;

      // Calculate ghost score
      const lastExit = app.borderEvents.find((e: any) => e.eventType === 'EXIT');
      const ghostResult = calculateGhostScore({
        internalStatus,
        portalStatus,
        lastExitScan: lastExit?.eventDatetime || null,
        lastPortalSync: app.lastPortalSync,
        visaExpiry: app.expiryDate,
      });

      // Create mismatch record
      const mismatch = await prisma.reconciliationMismatch.create({
        data: {
          jobId,
          applicationId: app.id,
          internalStatus,
          portalStatus,
          mismatchType: ghostResult.score >= 40 ? 'GHOST_PASSENGER' : 'STATUS_MISMATCH',
          riskLevel: ghostResult.riskLevel,
          ghostScore: ghostResult.score,
        },
      });

      // Auto-resolve low-risk mismatches
      if (ghostResult.score < this.config.autoResolveThreshold) {
        await prisma.reconciliationMismatch.update({
          where: { id: mismatch.id },
          data: {
            autoResolved: true,
            resolvedAt: new Date(),
            resolutionNotes: `Auto-resolved: ghost score ${ghostResult.score} below threshold ${this.config.autoResolveThreshold}`,
          },
        });
        autoResolved = true;
      }

      // ═══════════════════════════════════════
      // CHECK 2: Ghost passenger detection
      // ═══════════════════════════════════════
      if (ghostResult.score >= 40) {
        isGhost = true;

        // Skip if already has open alert
        if (!app.ghostAlerts || app.ghostAlerts.length === 0) {
          const lastEvent = app.borderEvents[0];
          const hoursSinceExit = lastExit
            ? (Date.now() - new Date(lastExit.eventDatetime).getTime()) / (1000 * 60 * 60)
            : null;

          await prisma.ghostAlert.create({
            data: {
              applicationId: app.id,
              mismatchId: mismatch.id,
              ghostScore: ghostResult.score,
              riskLevel: ghostResult.riskLevel,
              status: 'OPEN',
              lastKnownLocation: lastEvent?.portOfEntry || null,
              hoursSinceExit: hoursSinceExit,
              suggestedAction: ghostResult.suggestedAction,
            },
          });

          logger.warn('👻 Ghost passenger detected', {
            applicationId: app.id,
            ghostScore: ghostResult.score,
            riskLevel: ghostResult.riskLevel,
            internalStatus,
            portalStatus,
          });
        }
      }
    }

    // ═══════════════════════════════════════
    // CHECK 3: Stale record detection
    // ═══════════════════════════════════════
    if (internalStatus === 'IN_COUNTRY' && app.borderEvents.length > 0) {
      const lastEvent = app.borderEvents[0];
      if (lastEvent.eventType === 'EXIT') {
        const hoursSinceExit = (Date.now() - new Date(lastEvent.eventDatetime).getTime()) / (1000 * 60 * 60);

        if (hoursSinceExit > this.config.ghostThresholdHours && !isMismatch) {
          isMismatch = true;
          isGhost = true;

          const score = Math.min(Math.round(40 + (hoursSinceExit > 72 ? 30 : 0) + 25), 100);
          const riskLevel = score >= 80 ? 'CRITICAL' : score >= 60 ? 'HIGH' : score >= 40 ? 'MEDIUM' : 'LOW';

          await prisma.reconciliationMismatch.create({
            data: {
              jobId,
              applicationId: app.id,
              internalStatus,
              portalStatus: 'STALE_RECORD',
              mismatchType: 'GHOST_PASSENGER',
              riskLevel,
              ghostScore: score,
            },
          });

          if (!app.ghostAlerts || app.ghostAlerts.length === 0) {
            await prisma.ghostAlert.create({
              data: {
                applicationId: app.id,
                ghostScore: score,
                riskLevel,
                status: 'OPEN',
                lastKnownLocation: lastEvent.portOfEntry,
                hoursSinceExit,
                suggestedAction: score >= 80 ? 'IMMEDIATE_REVIEW' : 'VERIFY_WITH_PORTAL',
              },
            });
          }
        }
      }
    }

    // ═══════════════════════════════════════
    // CHECK 4: Expired visa still active
    // ═══════════════════════════════════════
    if (app.expiryDate && new Date(app.expiryDate) < new Date()) {
      if (['ACTIVE', 'IN_COUNTRY'].includes(internalStatus) && !isMismatch) {
        isMismatch = true;

        await prisma.reconciliationMismatch.create({
          data: {
            jobId,
            applicationId: app.id,
            internalStatus,
            portalStatus: 'EXPIRED',
            mismatchType: 'STATUS_MISMATCH',
            riskLevel: 'HIGH',
            ghostScore: 30,
          },
        });
      }
    }

    return { isMismatch, isGhost, autoResolved };
  }

  /**
   * Simulate portal status for development
   * In production, this would be replaced by actual portal fetch
   */
  private simulatePortalStatus(app: any): string {
    // Use the last border event to determine likely status
    if (app.borderEvents.length > 0) {
      const lastEvent = app.borderEvents[0];
      if (lastEvent.eventType === 'EXIT') return 'EXITED';
      if (lastEvent.eventType === 'ENTRY') return 'IN_COUNTRY';
    }

    // Check expiry
    if (app.expiryDate && new Date(app.expiryDate) < new Date()) {
      return 'EXPIRED';
    }

    return app.status;
  }
}

export const reconciliationEngine = new ReconciliationEngine();
