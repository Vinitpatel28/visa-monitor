// ============================================================
// Import Routes — File upload + manual entry + import history
// Handles CSV/Excel PRO report imports and manual ICP status entry
// ============================================================

import { Router, Request, Response } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { importService } from '../services/ImportService';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const router = Router();

// ========================
// FILE UPLOAD CONFIG (multer)
// ========================

const UPLOAD_DIR = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const safeName = `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    cb(null, safeName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.xlsx', '.xls', '.csv'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only .xlsx, .xls, and .csv files are accepted.'));
    }
  },
});

// ============================================================
// ROUTES
// ============================================================

/**
 * POST /api/v1/import/upload
 * Upload and process a CSV/Excel file
 * Body: multipart/form-data with 'file' field
 * Query: ?source=PRO_REPORT (optional)
 */
router.post(
  '/upload',
  authenticate,
  authorize('ADMIN', 'OPERATOR'),
  upload.single('file'),
  async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: { code: 'NO_FILE', message: 'No file uploaded. Use field name "file".' },
        });
      }

      const source = (req.query.source as string) || 'PRO_REPORT';
      const userId = req.user!.id;

      logger.info('📤 File uploaded', { fileName: req.file.originalname, source, userId });

      // Process the file
      const result = await importService.importFile(req.file.path, userId, source);

      // Clean up uploaded file after processing
      try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }

      res.json({
        success: true,
        data: {
          importId: result.importId,
          fileName: req.file.originalname,
          totalRecords: result.totalRecords,
          processed: result.processed,
          matched: result.matched,
          mismatched: result.mismatched,
          newRecords: result.newRecords,
          errors: result.errors,
          errorDetails: result.errorDetails.slice(0, 10),
          duration: `${(result.duration / 1000).toFixed(1)}s`,
        },
      });
    } catch (error: any) {
      // Clean up file on error
      if (req.file) { try { fs.unlinkSync(req.file.path); } catch { /* ignore */ } }

      logger.error('Import upload failed', { error: error.message });
      res.status(400).json({
        success: false,
        error: { code: 'IMPORT_FAILED', message: error.message },
      });
    }
  }
);

/**
 * POST /api/v1/import/manual
 * Manual ICP status entry for a single passenger
 * Body: { passportNumber, portalStatus, fileNumber?, expiryDate?, notes? }
 */
router.post(
  '/manual',
  authenticate,
  authorize('ADMIN', 'OPERATOR'),
  async (req: Request, res: Response) => {
    try {
      const { passportNumber, portalStatus, fileNumber, expiryDate, notes } = req.body;

      if (!passportNumber || !portalStatus) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION', message: 'passportNumber and portalStatus are required' },
        });
      }

      const result = await importService.manualStatusEntry({
        passportNumber: passportNumber.trim().toUpperCase(),
        portalStatus,
        fileNumber,
        expiryDate,
        enteredBy: req.user!.id,
        notes,
      });

      res.json({
        success: true,
        data: {
          ...result,
          message: result.mismatch
            ? '⚠️ Status mismatch detected — ghost alert may be generated'
            : '✅ Status matches internal records',
        },
      });
    } catch (error: any) {
      logger.error('Manual entry failed', { error: error.message });
      res.status(400).json({
        success: false,
        error: { code: 'MANUAL_ENTRY_FAILED', message: error.message },
      });
    }
  }
);

/**
 * GET /api/v1/import/history
 * Get import history with pagination
 * Query: ?page=1&limit=20
 */
router.get(
  '/history',
  authenticate,
  async (req: Request, res: Response) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;

      const result = await importService.getImportHistory(page, limit);

      res.json({ success: true, data: result });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: { code: 'HISTORY_FAILED', message: error.message },
      });
    }
  }
);

/**
 * GET /api/v1/import/:id
 * Get details of a specific import
 */
router.get(
  '/:id',
  authenticate,
  async (req: Request, res: Response) => {
    try {
      const importRecord = await prisma.dataImport.findUnique({
        where: { id: req.params.id as string },
        include: { importedByUser: { select: { email: true } } },
      });

      if (!importRecord) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Import record not found' },
        });
      }

      res.json({ success: true, data: importRecord });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: { code: 'FETCH_FAILED', message: error.message },
      });
    }
  }
);

/**
 * GET /api/v1/import/template/download
 * Download a sample CSV template for PRO reports
 */
router.get(
  '/template/download',
  authenticate,
  (_req: Request, res: Response) => {
    const template = [
      'Passport Number,Full Name,Nationality,Visa Type,Status,File Number,Expiry Date,Sponsor Company,Department',
      'A12345678,Ahmed Al Mansouri,UAE,RESIDENCE,Valid,201/2024/1234567,2025-12-31,ABC Trading LLC,Operations',
      'B98765432,Rajesh Kumar,India,EMPLOYMENT,Expired,201/2024/7654321,2024-06-30,XYZ Construction,Engineering',
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=visa_status_template.csv');
    res.send(template);
  }
);

export default router;
