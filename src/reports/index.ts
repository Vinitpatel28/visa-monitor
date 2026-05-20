// ============================================================
// Reports API Routes — Generate & download Excel/PDF reports
// ============================================================

import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { createAuditLog } from '../middleware/audit';
import { logger } from '../lib/logger';
import { generateVisaStatusReport, generateGhostReport } from './ExcelReportGenerator';
import { generateCompliancePDF, generateGhostPDF, generateReconciliationPDF, generateImportActivityPDF } from './PDFReportGenerator';
import path from 'path';
import fs from 'fs';

const router = Router();
router.use(authenticate);

const REPORTS_DIR = path.join(process.cwd(), 'reports');

// GET /reports/excel/visa-status — Full visa status Excel report
router.get('/excel/visa-status', authorize('ADMIN', 'OPERATOR'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    logger.info('Generating Excel visa status report', { user: req.user?.id });

    const filepath = await generateVisaStatusReport();
    const filename = path.basename(filepath);

    await createAuditLog({
      userId: req.user!.id, action: 'REPORT_GENERATED', entityType: 'Report',
      entityId: filename, newValues: { type: 'excel', report: 'visa-status' },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });

    res.download(filepath, filename, (err) => {
      if (err) logger.error('Report download failed', { error: err.message });
    });
  } catch (error) { next(error); }
});

// GET /reports/excel/ghost-alerts — Ghost alerts Excel report
router.get('/excel/ghost-alerts', authorize('ADMIN', 'OPERATOR'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    logger.info('Generating Excel ghost alert report', { user: req.user?.id });

    const filepath = await generateGhostReport();
    const filename = path.basename(filepath);

    await createAuditLog({
      userId: req.user!.id, action: 'REPORT_GENERATED', entityType: 'Report',
      entityId: filename, newValues: { type: 'excel', report: 'ghost-alerts' },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });

    res.download(filepath, filename);
  } catch (error) { next(error); }
});

// GET /reports/pdf/compliance — Compliance PDF report
router.get('/pdf/compliance', authorize('ADMIN', 'OPERATOR'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    logger.info('Generating PDF compliance report', { user: req.user?.id });

    const filepath = await generateCompliancePDF();
    const filename = path.basename(filepath);

    await createAuditLog({
      userId: req.user!.id, action: 'REPORT_GENERATED', entityType: 'Report',
      entityId: filename, newValues: { type: 'pdf', report: 'compliance' },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });

    res.download(filepath, filename);
  } catch (error) { next(error); }
});

// GET /reports/pdf/ghost-detection — Ghost detection PDF report
router.get('/pdf/ghost-detection', authorize('ADMIN', 'OPERATOR'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    logger.info('Generating PDF ghost detection report', { user: req.user?.id });

    const filepath = await generateGhostPDF();
    const filename = path.basename(filepath);

    await createAuditLog({
      userId: req.user!.id, action: 'REPORT_GENERATED', entityType: 'Report',
      entityId: filename, newValues: { type: 'pdf', report: 'ghost-detection' },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });

    res.download(filepath, filename);
  } catch (error) { next(error); }
});

// GET /reports/pdf/reconciliation — Reconciliation summary PDF
router.get('/pdf/reconciliation', authorize('ADMIN', 'OPERATOR'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    logger.info('Generating PDF reconciliation report', { user: req.user?.id });

    const filepath = await generateReconciliationPDF();
    const filename = path.basename(filepath);

    await createAuditLog({
      userId: req.user!.id, action: 'REPORT_GENERATED', entityType: 'Report',
      entityId: filename, newValues: { type: 'pdf', report: 'reconciliation' },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });

    res.download(filepath, filename);
  } catch (error) { next(error); }
});

// GET /reports/pdf/import-activity — Import activity PDF
router.get('/pdf/import-activity', authorize('ADMIN', 'OPERATOR'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    logger.info('Generating PDF import activity report', { user: req.user?.id });

    const filepath = await generateImportActivityPDF();
    const filename = path.basename(filepath);

    await createAuditLog({
      userId: req.user!.id, action: 'REPORT_GENERATED', entityType: 'Report',
      entityId: filename, newValues: { type: 'pdf', report: 'import-activity' },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });

    res.download(filepath, filename);
  } catch (error) { next(error); }
});

// GET /reports/list — List generated reports
router.get('/list', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!fs.existsSync(REPORTS_DIR)) {
      return res.json({ success: true, data: [] });
    }

    const files = fs.readdirSync(REPORTS_DIR).map((file) => {
      const fullPath = path.join(REPORTS_DIR, file);
      const stat = fs.statSync(fullPath);
      return {
        filename: file,
        type: file.endsWith('.xlsx') ? 'excel' : file.endsWith('.pdf') ? 'pdf' : 'unknown',
        size: stat.size,
        sizeHuman: formatBytes(stat.size),
        created: stat.birthtime,
      };
    }).sort((a, b) => b.created.getTime() - a.created.getTime());

    res.json({ success: true, data: files, total: files.length });
  } catch (error) { next(error); }
});

// GET /reports/download/:filename — Download a specific report
router.get('/download/:filename', authorize('ADMIN', 'OPERATOR'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const filename = req.params.filename as string;
    // Sanitize filename to prevent path traversal
    const sanitized = path.basename(filename);
    const filepath = path.join(REPORTS_DIR, sanitized);

    if (!fs.existsSync(filepath)) {
      return res.status(404).json({ success: false, error: 'Report not found' });
    }

    res.download(filepath, sanitized);
  } catch (error) { next(error); }
});

// DELETE /reports/:filename — Delete a report
router.delete('/:filename', authorize('ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sanitized = path.basename(req.params.filename as string);
    const filepath = path.join(REPORTS_DIR, sanitized);

    if (!fs.existsSync(filepath)) {
      return res.status(404).json({ success: false, error: 'Report not found' });
    }

    fs.unlinkSync(filepath);
    await createAuditLog({
      userId: req.user!.id, action: 'REPORT_DELETED', entityType: 'Report',
      entityId: sanitized, ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });

    res.json({ success: true, message: `Report ${sanitized} deleted` });
  } catch (error) { next(error); }
});

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

export default router;
