// ============================================================
// Excel Report Generator — Enterprise visa & ghost reports
// Generates styled .xlsx workbooks with multiple sheets
// ============================================================

import ExcelJS from 'exceljs';
import { prisma } from '../lib/prisma';
import { decrypt } from '../lib/encryption';
import { logger } from '../lib/logger';
import path from 'path';
import fs from 'fs';

const REPORTS_DIR = path.join(process.cwd(), 'reports');

// Ensure reports directory exists
if (!fs.existsSync(REPORTS_DIR)) {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

// Brand colors
const COLORS = {
  primary: '00B4D8',
  dark: '1A1A2E',
  header: '16213E',
  accent: '0F3460',
  success: '2ECC71',
  warning: 'F39C12',
  danger: 'E74C3C',
  critical: 'C0392B',
  white: 'FFFFFF',
  lightGray: 'F5F5F5',
};

/**
 * Generate a comprehensive Visa Status Report
 */
export async function generateVisaStatusReport(): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Visa Workflow Automation';
  workbook.created = new Date();

  // === SHEET 1: Executive Summary ===
  await addSummarySheet(workbook);

  // === SHEET 2: All Passengers ===
  await addPassengersSheet(workbook);

  // === SHEET 3: Visa Applications ===
  await addApplicationsSheet(workbook);

  // === SHEET 4: Ghost Alerts ===
  await addGhostAlertsSheet(workbook);

  // === SHEET 5: Reconciliation History ===
  await addReconciliationSheet(workbook);

  // === SHEET 6: Audit Trail ===
  await addAuditSheet(workbook);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  const filename = `visa-status-report-${timestamp}.xlsx`;
  const filepath = path.join(REPORTS_DIR, filename);

  await workbook.xlsx.writeFile(filepath);
  logger.info('📊 Excel report generated', { filepath, sheets: workbook.worksheets.length });

  return filepath;
}

/**
 * Generate a Ghost Alert Report (focused on mismatches)
 */
export async function generateGhostReport(): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Visa Workflow Automation';
  workbook.created = new Date();

  await addGhostAlertsSheet(workbook);
  await addReconciliationSheet(workbook);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  const filename = `ghost-alert-report-${timestamp}.xlsx`;
  const filepath = path.join(REPORTS_DIR, filename);

  await workbook.xlsx.writeFile(filepath);
  logger.info('👻 Ghost report generated', { filepath });
  return filepath;
}

// ════════════════════════════════════════
// SHEET BUILDERS
// ════════════════════════════════════════

async function addSummarySheet(workbook: ExcelJS.Workbook) {
  const ws = workbook.addWorksheet('Executive Summary', {
    properties: { tabColor: { argb: COLORS.primary } },
  });

  ws.columns = [
    { width: 35 },
    { width: 20 },
    { width: 20 },
    { width: 20 },
  ];

  // Title
  ws.mergeCells('A1:D1');
  const titleCell = ws.getCell('A1');
  titleCell.value = 'VISA WORKFLOW AUTOMATION — EXECUTIVE SUMMARY';
  titleCell.font = { size: 16, bold: true, color: { argb: COLORS.white } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.dark } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 45;

  // Subtitle
  ws.mergeCells('A2:D2');
  const subtitleCell = ws.getCell('A2');
  subtitleCell.value = `Generated: ${new Date().toLocaleString()} | System: Visa Workflow Automation v1.0`;
  subtitleCell.font = { size: 10, italic: true, color: { argb: COLORS.primary } };
  subtitleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.header } };
  subtitleCell.alignment = { horizontal: 'center' };

  // Fetch stats
  const [passengers, applications, activeVisas, ghosts, critical, recentJobs] = await Promise.all([
    prisma.passenger.count(),
    prisma.visaApplication.count(),
    prisma.visaApplication.count({ where: { status: { in: ['ACTIVE', 'IN_COUNTRY'] } } }),
    prisma.ghostAlert.count({ where: { status: 'OPEN' } }),
    prisma.ghostAlert.count({ where: { status: 'OPEN', riskLevel: 'CRITICAL' } }),
    prisma.reconciliationJob.findMany({ take: 5, orderBy: { createdAt: 'desc' } }),
  ]);

  // Stats section
  const stats = [
    ['Total Passengers', passengers, '', ''],
    ['Total Visa Applications', applications, '', ''],
    ['Active Visas (ACTIVE + IN_COUNTRY)', activeVisas, '', ''],
    ['Open Ghost Alerts', ghosts, '', ''],
    ['Critical Alerts', critical, '', ''],
    ['Recent Reconciliation Jobs', recentJobs.length, '', ''],
  ];

  ws.addRow([]);
  const headerRow = ws.addRow(['Metric', 'Value', 'Status', 'Notes']);
  styleHeaderRow(headerRow);

  for (const [metric, value] of stats) {
    const row = ws.addRow([metric, value, value === 0 ? '✅ Clear' : '⚠️ Review', '']);
    row.getCell(1).font = { bold: true };
    if (typeof value === 'number' && value > 0 && (metric as string).includes('Ghost')) {
      row.getCell(2).font = { bold: true, color: { argb: COLORS.danger } };
    }
  }

  // Status distribution
  ws.addRow([]);
  ws.addRow([]);
  const distHeader = ws.addRow(['Visa Status Distribution', 'Count', '', '']);
  styleHeaderRow(distHeader);

  const statuses = ['PENDING', 'APPROVED', 'ACTIVE', 'IN_COUNTRY', 'EXITED', 'EXPIRED', 'CANCELLED', 'REJECTED'];
  for (const status of statuses) {
    const count = await prisma.visaApplication.count({ where: { status } });
    if (count > 0) {
      ws.addRow([status, count, '', '']);
    }
  }
}

async function addPassengersSheet(workbook: ExcelJS.Workbook) {
  const ws = workbook.addWorksheet('Passengers', {
    properties: { tabColor: { argb: '2ECC71' } },
  });

  ws.columns = [
    { header: '#', width: 5 },
    { header: 'Full Name', width: 25 },
    { header: 'Passport', width: 18 },
    { header: 'Nationality', width: 15 },
    { header: 'Date of Birth', width: 15 },
    { header: 'Sponsor', width: 22 },
    { header: 'Department', width: 15 },
    { header: 'Created', width: 18 },
  ];

  styleHeaderRow(ws.getRow(1));

  const passengers = await prisma.passenger.findMany({ orderBy: { createdAt: 'desc' } });
  let idx = 1;
  for (const p of passengers) {
    const row = ws.addRow([
      idx++,
      safeDecrypt(p.fullName),
      maskPassport(safeDecrypt(p.passportNumber)),
      p.nationality || '-',
      p.dateOfBirth ? new Date(p.dateOfBirth).toLocaleDateString() : '-',
      p.sponsorCompany || '-',
      p.department || '-',
      new Date(p.createdAt).toLocaleDateString(),
    ]);
    if (idx % 2 === 0) stripeRow(row);
  }

  ws.autoFilter = { from: 'A1', to: 'H1' };
}

async function addApplicationsSheet(workbook: ExcelJS.Workbook) {
  const ws = workbook.addWorksheet('Visa Applications', {
    properties: { tabColor: { argb: '3498DB' } },
  });

  ws.columns = [
    { header: '#', width: 5 },
    { header: 'Visa Number', width: 15 },
    { header: 'Passenger', width: 22 },
    { header: 'Type', width: 14 },
    { header: 'Status', width: 14 },
    { header: 'Portal Status', width: 14 },
    { header: 'Issued', width: 14 },
    { header: 'Expiry', width: 14 },
    { header: 'Last Sync', width: 18 },
  ];

  styleHeaderRow(ws.getRow(1));

  const apps = await prisma.visaApplication.findMany({
    include: { passenger: { select: { fullName: true } } },
    orderBy: { createdAt: 'desc' },
  });

  let idx = 1;
  for (const app of apps) {
    const row = ws.addRow([
      idx++,
      app.visaNumber || '-',
      safeDecrypt(app.passenger.fullName),
      app.visaType || '-',
      app.status,
      app.portalStatus || '-',
      app.issuedDate ? new Date(app.issuedDate).toLocaleDateString() : '-',
      app.expiryDate ? new Date(app.expiryDate).toLocaleDateString() : '-',
      app.lastPortalSync ? new Date(app.lastPortalSync).toLocaleString() : 'Never',
    ]);

    // Color-code status
    const statusCell = row.getCell(5);
    if (app.status === 'IN_COUNTRY') {
      statusCell.font = { bold: true, color: { argb: COLORS.success } };
    } else if (app.status === 'EXITED') {
      statusCell.font = { bold: true, color: { argb: COLORS.warning } };
    } else if (['EXPIRED', 'CANCELLED', 'REJECTED'].includes(app.status)) {
      statusCell.font = { bold: true, color: { argb: COLORS.danger } };
    }

    if (idx % 2 === 0) stripeRow(row);
  }

  ws.autoFilter = { from: 'A1', to: 'I1' };
}

async function addGhostAlertsSheet(workbook: ExcelJS.Workbook) {
  const ws = workbook.addWorksheet('Ghost Alerts', {
    properties: { tabColor: { argb: COLORS.danger } },
  });

  ws.columns = [
    { header: '#', width: 5 },
    { header: 'Risk', width: 10 },
    { header: 'Score', width: 8 },
    { header: 'Passenger', width: 22 },
    { header: 'Internal Status', width: 15 },
    { header: 'Portal Status', width: 15 },
    { header: 'Hours Since Exit', width: 16 },
    { header: 'Location', width: 25 },
    { header: 'Status', width: 15 },
    { header: 'Action', width: 20 },
    { header: 'Created', width: 18 },
  ];

  styleHeaderRow(ws.getRow(1));

  const alerts = await prisma.ghostAlert.findMany({
    include: {
      application: {
        include: { passenger: { select: { fullName: true } } },
      },
    },
    orderBy: { ghostScore: 'desc' },
  });

  let idx = 1;
  for (const alert of alerts) {
    const row = ws.addRow([
      idx++,
      alert.riskLevel,
      alert.ghostScore,
      safeDecrypt(alert.application.passenger.fullName),
      alert.application.status,
      alert.application.portalStatus || '-',
      alert.hoursSinceExit ? Number(alert.hoursSinceExit).toFixed(1) : '-',
      alert.lastKnownLocation || '-',
      alert.status,
      alert.suggestedAction || '-',
      new Date(alert.createdAt).toLocaleString(),
    ]);

    // Color by risk
    const riskCell = row.getCell(2);
    const riskColorMap: Record<string, string> = {
      CRITICAL: COLORS.critical,
      HIGH: COLORS.danger,
      MEDIUM: COLORS.warning,
      LOW: COLORS.success,
    };
    const riskColor = riskColorMap[alert.riskLevel] || COLORS.white;

    riskCell.font = { bold: true, color: { argb: COLORS.white } };
    riskCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: riskColor } };
    riskCell.alignment = { horizontal: 'center' };

    if (idx % 2 === 0) stripeRow(row);
  }

  ws.autoFilter = { from: 'A1', to: 'K1' };
}

async function addReconciliationSheet(workbook: ExcelJS.Workbook) {
  const ws = workbook.addWorksheet('Reconciliation', {
    properties: { tabColor: { argb: 'F39C12' } },
  });

  ws.columns = [
    { header: '#', width: 5 },
    { header: 'Job Type', width: 12 },
    { header: 'Status', width: 12 },
    { header: 'Total', width: 8 },
    { header: 'Checked', width: 10 },
    { header: 'Mismatches', width: 12 },
    { header: 'Ghosts', width: 10 },
    { header: 'Started', width: 20 },
    { header: 'Completed', width: 20 },
    { header: 'Error', width: 30 },
  ];

  styleHeaderRow(ws.getRow(1));

  const jobs = await prisma.reconciliationJob.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
  let idx = 1;
  for (const job of jobs) {
    const row = ws.addRow([
      idx++,
      job.jobType,
      job.status,
      job.totalRecords ?? 0,
      job.checkedRecords,
      job.mismatchCount,
      job.ghostCount,
      job.startedAt ? new Date(job.startedAt).toLocaleString() : '-',
      job.completedAt ? new Date(job.completedAt).toLocaleString() : '-',
      job.errorMessage || '',
    ]);

    const statusCell = row.getCell(3);
    if (job.status === 'COMPLETED') statusCell.font = { color: { argb: COLORS.success } };
    else if (job.status === 'FAILED') statusCell.font = { bold: true, color: { argb: COLORS.danger } };

    if (idx % 2 === 0) stripeRow(row);
  }
}

async function addAuditSheet(workbook: ExcelJS.Workbook) {
  const ws = workbook.addWorksheet('Audit Trail', {
    properties: { tabColor: { argb: '9B59B6' } },
  });

  ws.columns = [
    { header: '#', width: 5 },
    { header: 'User', width: 25 },
    { header: 'Action', width: 25 },
    { header: 'Entity', width: 15 },
    { header: 'IP Address', width: 16 },
    { header: 'Timestamp', width: 20 },
  ];

  styleHeaderRow(ws.getRow(1));

  const logs = await prisma.auditLog.findMany({
    include: { user: { select: { email: true } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  let idx = 1;
  for (const log of logs) {
    const row = ws.addRow([
      idx++,
      log.user?.email || 'System',
      log.action,
      log.entityType || '-',
      log.ipAddress || '-',
      new Date(log.createdAt).toLocaleString(),
    ]);
    if (idx % 2 === 0) stripeRow(row);
  }

  ws.autoFilter = { from: 'A1', to: 'F1' };
}

// ════════════════════════════════════════
// STYLE HELPERS
// ════════════════════════════════════════

function styleHeaderRow(row: ExcelJS.Row) {
  row.height = 28;
  row.eachCell((cell) => {
    cell.font = { bold: true, size: 11, color: { argb: COLORS.white } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.header } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = {
      bottom: { style: 'medium', color: { argb: COLORS.primary } },
    };
  });
}

function stripeRow(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.lightGray } };
  });
}

function safeDecrypt(value: string): string {
  try { return decrypt(value); } catch { return value; }
}

function maskPassport(value: string): string {
  if (value.length <= 3) return '***';
  return value.substring(0, 3) + '*'.repeat(value.length - 3);
}
