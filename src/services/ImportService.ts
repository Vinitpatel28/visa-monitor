// ============================================================
// Import Service — CSV/Excel Parser & Reconciler
// Parses PRO status reports and reconciles against internal DB
// Primary data source for enterprise visa monitoring
// ============================================================

import ExcelJS from 'exceljs';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { encrypt } from '../lib/encryption';
import fs from 'fs';
import path from 'path';

// ========================
// TYPES
// ========================

export interface ImportedRecord {
  passportNumber: string;
  fullName?: string;
  nationality?: string;
  visaType?: string;
  status?: string;
  fileNumber?: string;
  expiryDate?: string;
  issuedDate?: string;
  sponsorCompany?: string;
  department?: string;
  rowNumber: number;
}

export interface ColumnMapping {
  passportNumber: number;
  fullName?: number;
  nationality?: number;
  visaType?: number;
  status?: number;
  fileNumber?: number;
  expiryDate?: number;
  issuedDate?: number;
  sponsorCompany?: number;
  department?: number;
}

export interface ImportResult {
  importId: string;
  totalRecords: number;
  processed: number;
  matched: number;
  mismatched: number;
  newRecords: number;
  errors: number;
  errorDetails: string[];
  duration: number;
}

// ========================
// STATUS NORMALIZATION MAP
// ========================

const STATUS_MAP: Record<string, string> = {
  // English ICP statuses
  'valid': 'ACTIVE',
  'active': 'ACTIVE',
  'in force': 'ACTIVE',
  'in country': 'IN_COUNTRY',
  'expired': 'EXPIRED',
  'cancelled': 'CANCELLED',
  'canceled': 'CANCELLED',
  'closed': 'CLOSED',
  'used': 'USED',
  'pending': 'PENDING',
  'under process': 'PENDING',
  'rejected': 'REJECTED',
  'exited': 'EXITED',
  // Arabic ICP statuses
  'سارية': 'ACTIVE',
  'ساري': 'ACTIVE',
  'منتهية': 'EXPIRED',
  'ملغاة': 'CANCELLED',
  'مستخدمة': 'USED',
  'مغلق': 'CLOSED',
  'قيد المعالجة': 'PENDING',
};

// ========================
// COLUMN DETECTION PATTERNS
// ========================

const COLUMN_PATTERNS: Record<keyof ColumnMapping, RegExp> = {
  passportNumber: /passport|pass\.?\s*no|pass\.?\s*num|رقم الجواز/i,
  fullName: /name|full\s*name|passenger|الاسم/i,
  nationality: /national|country|citizen|الجنسية/i,
  visaType: /visa\s*type|permit\s*type|type|نوع/i,
  status: /status|validity|state|الحالة/i,
  fileNumber: /file\s*no|file\s*num|uid|unified|رقم الملف/i,
  expiryDate: /expir|valid\s*until|valid\s*to|تاريخ.*انتهاء/i,
  issuedDate: /issue|start|from|تاريخ.*إصدار/i,
  sponsorCompany: /sponsor|company|employer|الكفيل|الشركة/i,
  department: /department|dept|القسم/i,
};

// ============================================================
// IMPORT SERVICE CLASS
// ============================================================

export class ImportService {

  /**
   * Import an Excel/CSV file — main entry point
   */
  async importFile(
    filePath: string,
    importedBy: string,
    source: string = 'PRO_REPORT'
  ): Promise<ImportResult> {
    const startTime = Date.now();
    const fileExt = path.extname(filePath).toLowerCase();
    const fileName = path.basename(filePath);

    logger.info('📁 Starting file import', { fileName, source, importedBy });

    // Create import tracking record
    const importRecord = await prisma.dataImport.create({
      data: {
        fileName,
        fileType: fileExt === '.csv' ? 'CSV' : 'XLSX',
        source,
        status: 'PROCESSING',
        importedBy,
      },
    });

    try {
      // Parse the file
      const records = await this.parseFile(filePath, fileExt);

      if (records.length === 0) {
        throw new Error('No valid records found in file. Check column headers.');
      }

      // Update total count
      await prisma.dataImport.update({
        where: { id: importRecord.id },
        data: { totalRecords: records.length },
      });

      // Process each record
      const result = await this.processRecords(records, importRecord.id);

      // Finalize import record
      const duration = Date.now() - startTime;
      await prisma.dataImport.update({
        where: { id: importRecord.id },
        data: {
          status: 'COMPLETED',
          processedCount: result.processed,
          matchedCount: result.matched,
          mismatchedCount: result.mismatched,
          newRecordCount: result.newRecords,
          errorCount: result.errors,
          completedAt: new Date(),
          summary: JSON.stringify({
            duration,
            errorDetails: result.errorDetails.slice(0, 50),
          }),
        },
      });

      logger.info('✅ File import completed', {
        importId: importRecord.id,
        total: records.length,
        matched: result.matched,
        mismatched: result.mismatched,
        newRecords: result.newRecords,
        errors: result.errors,
        durationMs: duration,
      });

      return {
        importId: importRecord.id,
        totalRecords: records.length,
        ...result,
        duration,
      };

    } catch (error: any) {
      await prisma.dataImport.update({
        where: { id: importRecord.id },
        data: {
          status: 'FAILED',
          errorMessage: error.message,
          completedAt: new Date(),
        },
      });

      logger.error('❌ File import failed', { importId: importRecord.id, error: error.message });
      throw error;
    }
  }

  // ════════════════════════════════════════
  // FILE PARSING
  // ════════════════════════════════════════

  /**
   * Parse Excel or CSV file into standardized records
   */
  private async parseFile(filePath: string, ext: string): Promise<ImportedRecord[]> {
    const workbook = new ExcelJS.Workbook();

    if (ext === '.csv') {
      await workbook.csv.readFile(filePath);
    } else {
      await workbook.xlsx.readFile(filePath);
    }

    const sheet = workbook.worksheets[0];
    if (!sheet || sheet.rowCount < 2) {
      throw new Error('File is empty or has no data rows');
    }

    // Auto-detect column mapping from header row
    const mapping = this.detectColumnMapping(sheet);
    if (!mapping.passportNumber) {
      throw new Error(
        'Could not detect a "Passport Number" column. ' +
        'Please ensure the header row contains a column like "Passport No", "Passport Number", etc.'
      );
    }

    logger.info('🔍 Column mapping detected', { mapping });

    // Parse data rows
    const records: ImportedRecord[] = [];
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // Skip header

      const passport = this.getCellValue(row, mapping.passportNumber);
      if (!passport || passport.trim().length < 3) return; // Skip empty rows

      records.push({
        passportNumber: passport.trim().toUpperCase(),
        fullName: mapping.fullName ? this.getCellValue(row, mapping.fullName) : undefined,
        nationality: mapping.nationality ? this.getCellValue(row, mapping.nationality) : undefined,
        visaType: mapping.visaType ? this.getCellValue(row, mapping.visaType) : undefined,
        status: mapping.status ? this.getCellValue(row, mapping.status) : undefined,
        fileNumber: mapping.fileNumber ? this.getCellValue(row, mapping.fileNumber) : undefined,
        expiryDate: mapping.expiryDate ? this.getCellValue(row, mapping.expiryDate) : undefined,
        issuedDate: mapping.issuedDate ? this.getCellValue(row, mapping.issuedDate) : undefined,
        sponsorCompany: mapping.sponsorCompany ? this.getCellValue(row, mapping.sponsorCompany) : undefined,
        department: mapping.department ? this.getCellValue(row, mapping.department) : undefined,
        rowNumber,
      });
    });

    return records;
  }

  /**
   * Auto-detect column mapping from header row
   */
  private detectColumnMapping(sheet: ExcelJS.Worksheet): ColumnMapping {
    const mapping: Partial<ColumnMapping> = {};
    const headerRow = sheet.getRow(1);

    headerRow.eachCell((cell, colNumber) => {
      const header = String(cell.value || '').trim();
      if (!header) return;

      for (const [field, pattern] of Object.entries(COLUMN_PATTERNS)) {
        if (pattern.test(header) && !(field in mapping)) {
          (mapping as any)[field] = colNumber;
        }
      }
    });

    return mapping as ColumnMapping;
  }

  /**
   * Safely extract cell value as string
   */
  private getCellValue(row: ExcelJS.Row, colNumber: number): string {
    const cell = row.getCell(colNumber);
    if (!cell || cell.value === null || cell.value === undefined) return '';

    // Handle date values
    if (cell.value instanceof Date) {
      return cell.value.toISOString().split('T')[0]; // YYYY-MM-DD
    }

    // Handle rich text
    if (typeof cell.value === 'object' && 'richText' in cell.value) {
      return (cell.value as any).richText.map((r: any) => r.text).join('');
    }

    return String(cell.value).trim();
  }

  // ════════════════════════════════════════
  // RECORD PROCESSING & RECONCILIATION
  // ════════════════════════════════════════

  /**
   * Process parsed records — upsert into DB and detect mismatches
   */
  private async processRecords(
    records: ImportedRecord[],
    importId: string
  ): Promise<Omit<ImportResult, 'importId' | 'totalRecords' | 'duration'>> {
    let processed = 0;
    let matched = 0;
    let mismatched = 0;
    let newRecords = 0;
    let errors = 0;
    const errorDetails: string[] = [];

    for (const record of records) {
      try {
        const result = await this.processOneRecord(record, importId);
        processed++;

        if (result === 'MATCHED') matched++;
        else if (result === 'MISMATCHED') mismatched++;
        else if (result === 'NEW') newRecords++;

      } catch (error: any) {
        errors++;
        const detail = `Row ${record.rowNumber} (${record.passportNumber}): ${error.message}`;
        errorDetails.push(detail);
        logger.warn('Import row error', { row: record.rowNumber, error: error.message });
      }
    }

    return { processed, matched, mismatched, newRecords, errors, errorDetails };
  }

  /**
   * Process a single imported record
   */
  private async processOneRecord(
    record: ImportedRecord,
    importId: string
  ): Promise<'MATCHED' | 'MISMATCHED' | 'NEW'> {
    const normalizedStatus = record.status ? this.normalizeStatus(record.status) : null;

    const encryptedPassport = encrypt(record.passportNumber);

    // Find existing passenger by passport number
    const existingPassenger = await prisma.passenger.findUnique({
      where: { passportNumber: encryptedPassport },
      include: {
        visaApplications: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!existingPassenger) {
      // NEW: Create passenger + visa application from import
      const passenger = await prisma.passenger.create({
        data: {
          passportNumber: encryptedPassport,
          fullName: encrypt(record.fullName || 'Unknown (Imported)'),
          nationality: record.nationality || null,
          icpFileNumber: record.fileNumber || null,
          sponsorCompany: record.sponsorCompany || null,
          department: record.department || null,
          lastVerifiedAt: new Date(),
          lastVerifiedBy: 'CSV_IMPORT',
        },
      });

      await prisma.visaApplication.create({
        data: {
          passengerId: passenger.id,
          visaType: record.visaType || null,
          status: normalizedStatus || 'ACTIVE',
          portalStatus: normalizedStatus || null,
          icpStatus: record.status || null,
          dataSource: 'CSV_IMPORT',
          expiryDate: record.expiryDate ? new Date(record.expiryDate) : null,
          issuedDate: record.issuedDate ? new Date(record.issuedDate) : null,
          lastPortalSync: new Date(),
        },
      });

      return 'NEW';
    }

    // EXISTING: Update passenger fields if provided
    const updateData: any = {
      lastVerifiedAt: new Date(),
      lastVerifiedBy: 'CSV_IMPORT',
    };
    if (record.nationality) updateData.nationality = record.nationality;
    if (record.fileNumber) updateData.icpFileNumber = record.fileNumber;
    if (record.sponsorCompany) updateData.sponsorCompany = record.sponsorCompany;
    if (record.department) updateData.department = record.department;

    await prisma.passenger.update({
      where: { id: existingPassenger.id },
      data: updateData,
    });

    // Check for status mismatch with latest visa application
    const latestApp = existingPassenger.visaApplications[0];
    if (!latestApp) {
      // Passenger exists but no visa application — create one
      await prisma.visaApplication.create({
        data: {
          passengerId: existingPassenger.id,
          visaType: record.visaType || null,
          status: normalizedStatus || 'ACTIVE',
          portalStatus: normalizedStatus || null,
          icpStatus: record.status || null,
          dataSource: 'CSV_IMPORT',
          expiryDate: record.expiryDate ? new Date(record.expiryDate) : null,
          lastPortalSync: new Date(),
        },
      });
      return 'NEW';
    }

    // Update portal status from CSV data
    await prisma.visaApplication.update({
      where: { id: latestApp.id },
      data: {
        portalStatus: normalizedStatus || latestApp.portalStatus,
        icpStatus: record.status || latestApp.icpStatus,
        dataSource: 'CSV_IMPORT',
        lastPortalSync: new Date(),
        expiryDate: record.expiryDate ? new Date(record.expiryDate) : latestApp.expiryDate,
      },
    });

    // Compare internal status vs imported portal status
    if (normalizedStatus && latestApp.status !== normalizedStatus) {
      // Log the mismatch in status history
      await prisma.statusHistory.create({
        data: {
          applicationId: latestApp.id,
          oldStatus: latestApp.portalStatus || 'UNKNOWN',
          newStatus: normalizedStatus,
          source: 'CSV_IMPORT',
          notes: `CSV import detected status change. Internal: ${latestApp.status}, Portal: ${normalizedStatus}`,
        },
      });

      return 'MISMATCHED';
    }

    return 'MATCHED';
  }

  // ════════════════════════════════════════
  // MANUAL STATUS ENTRY
  // ════════════════════════════════════════

  /**
   * Manually enter ICP portal status for a passenger
   */
  async manualStatusEntry(params: {
    passportNumber: string;
    portalStatus: string;
    fileNumber?: string;
    expiryDate?: string;
    enteredBy: string;
    notes?: string;
  }): Promise<{ success: boolean; mismatch: boolean; applicationId?: string }> {
    const normalizedStatus = this.normalizeStatus(params.portalStatus);

    const encryptedPassport = encrypt(params.passportNumber);
    const passenger = await prisma.passenger.findUnique({
      where: { passportNumber: encryptedPassport },
      include: { visaApplications: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });

    if (!passenger) {
      throw new Error(`Passenger not found: ${params.passportNumber}`);
    }

    // Update passenger verification timestamp
    await prisma.passenger.update({
      where: { id: passenger.id },
      data: {
        lastVerifiedAt: new Date(),
        lastVerifiedBy: 'MANUAL_ENTRY',
        icpFileNumber: params.fileNumber || passenger.icpFileNumber,
      },
    });

    const latestApp = passenger.visaApplications[0];
    if (!latestApp) {
      throw new Error(`No visa application found for: ${params.passportNumber}`);
    }

    const isMismatch = latestApp.status !== normalizedStatus;

    // Update visa application
    await prisma.visaApplication.update({
      where: { id: latestApp.id },
      data: {
        portalStatus: normalizedStatus,
        icpStatus: params.portalStatus,
        dataSource: 'MANUAL_ENTRY',
        lastPortalSync: new Date(),
        expiryDate: params.expiryDate ? new Date(params.expiryDate) : latestApp.expiryDate,
      },
    });

    // Record in status history
    await prisma.statusHistory.create({
      data: {
        applicationId: latestApp.id,
        oldStatus: latestApp.portalStatus || 'UNKNOWN',
        newStatus: normalizedStatus,
        source: 'MANUAL_ENTRY',
        changedBy: params.enteredBy,
        notes: params.notes || `Manual ICP status entry by operator`,
      },
    });

    logger.info('✍️ Manual status entry', {
      passport: params.passportNumber.substring(0, 3) + '***',
      status: normalizedStatus,
      mismatch: isMismatch,
    });

    if (isMismatch) {
      // Import the reconciliation engine dynamically or at the top of the file
      // to immediately generate the ghost alert
      const jobId = `manual-${Date.now()}`;
      await prisma.reconciliationJob.create({
        data: {
          id: jobId,
          jobType: 'TARGETED',
          status: 'PENDING',
          totalRecords: 1,
        }
      });
      const { reconciliationEngine } = require('../automation/ReconciliationEngine');
      await reconciliationEngine.runTargeted(jobId, [latestApp.id]);
    }

    return {
      success: true,
      mismatch: isMismatch,
      applicationId: latestApp.id,
    };
  }

  // ════════════════════════════════════════
  // IMPORT HISTORY
  // ════════════════════════════════════════

  /**
   * Get import history with pagination
   */
  async getImportHistory(page: number = 1, limit: number = 20) {
    const [imports, total] = await Promise.all([
      prisma.dataImport.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { importedByUser: { select: { email: true } } },
      }),
      prisma.dataImport.count(),
    ]);

    return {
      imports,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // ════════════════════════════════════════
  // UTILITIES
  // ════════════════════════════════════════

  /**
   * Normalize raw status text to internal status code
   */
  private normalizeStatus(raw: string): string {
    const cleaned = raw.trim().toLowerCase();
    return STATUS_MAP[cleaned] || raw.toUpperCase();
  }
}

// Export singleton
export const importService = new ImportService();
