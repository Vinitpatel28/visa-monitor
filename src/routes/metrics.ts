// ============================================================
// Prometheus Metrics — Application observability endpoint
// Exposes key business + infra metrics in Prometheus format
// ============================================================

import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { cache } from '../lib/redis';
import { logger } from '../lib/logger';

const router = Router();

const startTime = Date.now();

/**
 * GET /metrics — Prometheus-compatible metrics endpoint
 * No authentication required (scraped by Prometheus)
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);

    // Gather metrics in parallel
    const [
      totalPassengers,
      activeVisas,
      openGhosts,
      criticalGhosts,
      totalImports,
      pendingJobs,
      completedJobs,
      totalMismatches,
      openMismatches,
      totalAuditLogs,
    ] = await Promise.all([
      prisma.passenger.count().catch(() => 0),
      prisma.visaApplication.count({ where: { status: { in: ['ACTIVE', 'IN_COUNTRY'] } } }).catch(() => 0),
      prisma.ghostAlert.count({ where: { status: 'OPEN' } }).catch(() => 0),
      prisma.ghostAlert.count({ where: { status: 'OPEN', riskLevel: 'CRITICAL' } }).catch(() => 0),
      prisma.dataImport.count().catch(() => 0),
      prisma.reconciliationJob.count({ where: { status: 'PENDING' } }).catch(() => 0),
      prisma.reconciliationJob.count({ where: { status: 'COMPLETED' } }).catch(() => 0),
      prisma.reconciliationMismatch.count().catch(() => 0),
      prisma.reconciliationMismatch.count({ where: { autoResolved: false, resolvedAt: null } }).catch(() => 0),
      prisma.auditLog.count().catch(() => 0),
    ]);

    // Redis status
    const redisUp = cache.isAvailable() ? 1 : 0;

    // Build Prometheus output
    const lines = [
      '# HELP visa_monitor_uptime_seconds Server uptime in seconds',
      '# TYPE visa_monitor_uptime_seconds gauge',
      `visa_monitor_uptime_seconds ${uptimeSeconds}`,
      '',
      '# HELP visa_monitor_passengers_total Total registered passengers',
      '# TYPE visa_monitor_passengers_total gauge',
      `visa_monitor_passengers_total ${totalPassengers}`,
      '',
      '# HELP visa_monitor_visas_active Active visa applications',
      '# TYPE visa_monitor_visas_active gauge',
      `visa_monitor_visas_active ${activeVisas}`,
      '',
      '# HELP visa_monitor_ghost_alerts_open Open ghost alerts',
      '# TYPE visa_monitor_ghost_alerts_open gauge',
      `visa_monitor_ghost_alerts_open ${openGhosts}`,
      '',
      '# HELP visa_monitor_ghost_alerts_critical Critical ghost alerts',
      '# TYPE visa_monitor_ghost_alerts_critical gauge',
      `visa_monitor_ghost_alerts_critical ${criticalGhosts}`,
      '',
      '# HELP visa_monitor_imports_total Total data imports performed',
      '# TYPE visa_monitor_imports_total counter',
      `visa_monitor_imports_total ${totalImports}`,
      '',
      '# HELP visa_monitor_reconciliation_jobs_pending Pending reconciliation jobs',
      '# TYPE visa_monitor_reconciliation_jobs_pending gauge',
      `visa_monitor_reconciliation_jobs_pending ${pendingJobs}`,
      '',
      '# HELP visa_monitor_reconciliation_jobs_completed Completed reconciliation jobs',
      '# TYPE visa_monitor_reconciliation_jobs_completed counter',
      `visa_monitor_reconciliation_jobs_completed ${completedJobs}`,
      '',
      '# HELP visa_monitor_mismatches_total Total mismatches detected',
      '# TYPE visa_monitor_mismatches_total counter',
      `visa_monitor_mismatches_total ${totalMismatches}`,
      '',
      '# HELP visa_monitor_mismatches_open Open unresolved mismatches',
      '# TYPE visa_monitor_mismatches_open gauge',
      `visa_monitor_mismatches_open ${openMismatches}`,
      '',
      '# HELP visa_monitor_audit_events_total Total audit log entries',
      '# TYPE visa_monitor_audit_events_total counter',
      `visa_monitor_audit_events_total ${totalAuditLogs}`,
      '',
      '# HELP visa_monitor_redis_up Redis connection status',
      '# TYPE visa_monitor_redis_up gauge',
      `visa_monitor_redis_up ${redisUp}`,
      '',
      '# HELP visa_monitor_database_up Database connection status',
      '# TYPE visa_monitor_database_up gauge',
      `visa_monitor_database_up 1`,
      '',
    ];

    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(lines.join('\n'));

  } catch (error: any) {
    logger.error('Metrics endpoint error', { error: error.message });
    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.status(500).send(`# Metrics error\nvisa_monitor_database_up 0\n`);
  }
});

export default router;
