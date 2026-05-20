// ============================================================
// PDF Report Generator — Compliance & ghost detection reports
// Generates professional PDF documents with branding using pdfkit-table
// ============================================================

import PDFDocumentWithTables from 'pdfkit-table';
import { prisma } from '../lib/prisma';
import { decrypt } from '../lib/encryption';
import { logger } from '../lib/logger';
import path from 'path';
import fs from 'fs';

const REPORTS_DIR = path.join(process.cwd(), 'reports');
if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

// Brand colors (hex)
const C = {
  dark: '#1A1A2E',
  primary: '#00B4D8',
  header: '#16213E',
  accent: '#0F3460',
  text: '#333333',
  muted: '#666666',
  danger: '#E74C3C',
  warning: '#F39C12',
  success: '#2ECC71',
  white: '#FFFFFF',
  line: '#E0E0E0',
};

/**
 * Generate a Compliance Summary PDF
 */
export async function generateCompliancePDF(): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  const filename = `compliance-report-${timestamp}.pdf`;
  const filepath = path.join(REPORTS_DIR, filename);

  const doc = new PDFDocumentWithTables({ size: 'A4', margin: 50, bufferPages: true, info: {
    Title: 'Visa Workflow Compliance Report',
    Author: 'Visa Workflow Automation',
    Subject: 'Compliance & Ghost Status Report',
  }});

  const stream = fs.createWriteStream(filepath);
  doc.pipe(stream);

  // === PAGE 1: Cover ===
  drawCoverPage(doc, 'VISA WORKFLOW COMPLIANCE REPORT');

  // === PAGE 2: Executive Summary ===
  doc.addPage();
  await drawExecutiveSummary(doc);

  // === PAGE 3: Ghost Alert Details ===
  doc.addPage();
  await drawGhostAlertDetails(doc);

  // === PAGE 4: Reconciliation Summary ===
  doc.addPage();
  await drawReconciliationSummary(doc);

  // Footer on all pages
  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i++) {
    doc.switchToPage(i);
    drawFooter(doc, i + 1, pages.count);
  }

  doc.end();

  return new Promise((resolve, reject) => {
    stream.on('finish', () => {
      logger.info('📄 PDF report generated', { filepath });
      resolve(filepath);
    });
    stream.on('error', reject);
  });
}

/**
 * Generate a Ghost Detection PDF
 */
export async function generateGhostPDF(): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  const filename = `ghost-detection-report-${timestamp}.pdf`;
  const filepath = path.join(REPORTS_DIR, filename);

  const doc = new PDFDocumentWithTables({ size: 'A4', margin: 50, bufferPages: true });
  const stream = fs.createWriteStream(filepath);
  doc.pipe(stream);

  drawCoverPage(doc, 'GHOST DETECTION REPORT');
  doc.addPage();
  await drawGhostAlertDetails(doc);

  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i++) {
    doc.switchToPage(i);
    drawFooter(doc, i + 1, pages.count);
  }

  doc.end();

  return new Promise((resolve, reject) => {
    stream.on('finish', () => {
      logger.info('👻 Ghost PDF report generated', { filepath });
      resolve(filepath);
    });
    stream.on('error', reject);
  });
}

// ════════════════════════════════════════
// PAGE RENDERERS
// ════════════════════════════════════════

function drawCoverPage(doc: any, title: string) {
  // Background
  doc.rect(0, 0, 595.28, 841.89).fill(C.dark);

  // Logo text
  doc.fontSize(40).fillColor(C.primary).text('VISA-SYNC', 0, 200, { align: 'center' });

  // Title - Use moveDown to prevent overlap if it wraps to multiple lines
  doc.y = 300;
  doc.fontSize(28).fillColor(C.white).text(title, { align: 'center', width: 495, x: 50 } as any);

  // Subtitle
  doc.moveDown(1);
  doc.fontSize(16).fillColor(C.primary).text('Enterprise Reconciliation Summary', { align: 'center', width: 495, x: 50 } as any);

  // Date
  doc.moveDown(3);
  doc.fontSize(12).fillColor(C.white).text(
    `Generated: ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`,
    { align: 'center', width: 495, x: 50 } as any
  );

  // Divider
  doc.moveTo(150, doc.y + 30).lineTo(445, doc.y + 30).strokeColor(C.primary).lineWidth(2).stroke();

  // Classification
  doc.y += 70;
  doc.fontSize(10).fillColor(C.danger).text('CONFIDENTIAL — INTERNAL USE ONLY', { align: 'center', width: 495, x: 50 } as any);

  doc.fontSize(9).fillColor(C.muted).text('Visa Workflow Automation System v1.0', 50, 750, { align: 'center', width: 495 });
}

async function drawExecutiveSummary(doc: any) {
  drawSectionHeader(doc, 'EXECUTIVE SUMMARY', 50);

  const [passengers, applications, activeVisas, ghosts, critical, high] = await Promise.all([
    prisma.passenger.count(),
    prisma.visaApplication.count(),
    prisma.visaApplication.count({ where: { status: { in: ['ACTIVE', 'IN_COUNTRY'] } } }),
    prisma.ghostAlert.count({ where: { status: 'OPEN' } }),
    prisma.ghostAlert.count({ where: { status: 'OPEN', riskLevel: 'CRITICAL' } }),
    prisma.ghostAlert.count({ where: { status: 'OPEN', riskLevel: 'HIGH' } }),
  ]);

  let y = 100;
  
  const tableData = {
    title: "System Overview",
    headers: [
      { label: "Metric", property: "metric", width: 250, align: "left" },
      { label: "Value", property: "value", width: 100, align: "center" },
      { label: "Status", property: "status", width: 100, align: "center" }
    ],
    rows: [
      ["Total Passengers", passengers.toString(), "OK"],
      ["Total Applications", applications.toString(), "OK"],
      ["Active Visas (In Country)", activeVisas.toString(), "OK"],
      ["Open Ghost Alerts", ghosts.toString(), ghosts > 0 ? "WARNING" : "OK"],
      ["Critical Alerts", critical.toString(), critical > 0 ? "CRITICAL" : "OK"],
      ["High Risk Alerts", high.toString(), high > 0 ? "WARNING" : "OK"]
    ]
  };

  doc.y = y;
  doc.fillColor(C.text);
  await doc.table(tableData, { 
    padding: 7,
    prepareHeader: () => doc.font("Helvetica-Bold").fontSize(11),
    prepareRow: (row: any, indexColumn: any, indexRow: any, rectRow: any, rectCell: any) => {
      doc.font("Helvetica").fontSize(10);
      if (row[2] === "CRITICAL") doc.fillColor(C.danger).font("Helvetica-Bold");
      else if (row[2] === "WARNING") doc.fillColor(C.warning).font("Helvetica-Bold");
      else doc.fillColor(C.text);
    }
  });

  doc.y += 30;
  drawSectionHeader(doc, 'RISK ASSESSMENT', doc.y);

  let riskLevel = 'LOW';
  if (critical > 0) riskLevel = 'CRITICAL';
  else if (high > 0) riskLevel = 'HIGH';
  else if (ghosts > 0) riskLevel = 'MEDIUM';

  doc.y += 20;
  doc.fontSize(14).font("Helvetica-Bold").fillColor(C.text).text(`Overall System Risk: ${riskLevel}`, { align: "left" });
  doc.fontSize(10).font("Helvetica").fillColor(C.muted).text(`There are currently ${critical} critical alerts and ${high} high-risk alerts that require immediate attention by the compliance team.`, { align: "left" });
}

async function drawGhostAlertDetails(doc: any) {
  drawSectionHeader(doc, 'GHOST ALERT DETAILS', 50);

  const alerts = await prisma.ghostAlert.findMany({
    include: {
      application: {
        include: { passenger: { select: { fullName: true, passportNumber: true } } },
      },
    },
    orderBy: { ghostScore: 'desc' },
  });

  doc.y = 100;

  if (alerts.length === 0) {
    doc.fontSize(12).fillColor(C.success).text('No ghost alerts detected. System is clean.', 50, doc.y);
    return;
  }

  const rows = alerts.map((a: any) => [
    safeDecrypt(a.application.passenger.fullName),
    maskPassport(safeDecrypt(a.application.passenger.passportNumber)),
    a.riskLevel,
    a.ghostScore.toString(),
    `${a.application.status} -> ${a.application.portalStatus || '?'}`,
    a.status
  ]);

  const tableData = {
    title: `Active Alerts (${alerts.length})`,
    headers: [
      { label: "Passenger Name", property: "name", width: 120 },
      { label: "Passport", property: "passport", width: 70 },
      { label: "Risk", property: "risk", width: 60, align: "center" },
      { label: "Score", property: "score", width: 40, align: "center" },
      { label: "Mismatch (Int -> Ext)", property: "mismatch", width: 130 },
      { label: "Status", property: "status", width: 75 }
    ],
    rows: rows
  };

  doc.fillColor(C.text);
  await doc.table(tableData, {
    padding: 7,
    prepareHeader: () => doc.font("Helvetica-Bold").fontSize(10),
    prepareRow: (row: any, indexColumn: any, indexRow: any) => {
      doc.font("Helvetica").fontSize(9);
      if (row[2] === "CRITICAL") doc.fillColor(C.danger).font("Helvetica-Bold");
      else if (row[2] === "HIGH") doc.fillColor(C.warning).font("Helvetica-Bold");
      else doc.fillColor(C.text);
    }
  });
}

async function drawReconciliationSummary(doc: any) {
  drawSectionHeader(doc, 'RECONCILIATION SUMMARY', 50);

  const mismatches = await prisma.reconciliationMismatch.findMany({
    include: { application: { include: { passenger: { select: { fullName: true } } } } },
    orderBy: { createdAt: 'desc' },
    take: 30,
  });

  doc.y = 100;

  if (mismatches.length === 0) {
    doc.fontSize(12).fillColor(C.success).text('No mismatches found.', 50, doc.y);
    return;
  }

  const rows = mismatches.map((m: any) => [
    m.mismatchType,
    m.riskLevel,
    m.ghostScore.toString(),
    m.internalStatus,
    m.portalStatus,
    m.autoResolved ? 'Auto' : m.resolvedAt ? 'Manual' : 'Open'
  ]);

  const tableData = {
    title: "Recent Mismatches Detected",
    headers: [
      { label: "Mismatch Type", width: 120 },
      { label: "Risk", width: 60, align: "center" },
      { label: "Score", width: 50, align: "center" },
      { label: "Internal Status", width: 90 },
      { label: "Portal Status", width: 90 },
      { label: "Resolution", width: 85 }
    ],
    rows: rows
  };

  doc.fillColor(C.text);
  await doc.table(tableData, {
    padding: 7,
    prepareHeader: () => doc.font("Helvetica-Bold").fontSize(10),
    prepareRow: () => {
      doc.font("Helvetica").fontSize(9).fillColor(C.text);
    }
  });
}

// ════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════

function drawSectionHeader(doc: any, title: string, y: number) {
  doc.rect(0, y, 595.28, 35).fill(C.header);
  doc.fontSize(14).font("Helvetica-Bold").fillColor(C.primary).text(title, 50, y + 10);
}

function drawFooter(doc: any, page: number, total: number) {
  const y = 770; // Changed from 810 to prevent triggering automatic page breaks
  doc.fontSize(8).font("Helvetica").fillColor(C.muted)
    .text(`Page ${page} of ${total} | CONFIDENTIAL — Visa Workflow Automation`, 50, y, { align: 'center', width: 495 });
}

function safeDecrypt(value: string): string {
  try { return decrypt(value); } catch { return value; }
}

function maskPassport(value: string): string {
  if (!value) return '-';
  if (value.length <= 3) return '***';
  return value.substring(0, 3) + '*'.repeat(value.length - 3);
}

/**
 * Generate a Reconciliation Summary PDF
 */
export async function generateReconciliationPDF(): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  const filename = `reconciliation-report-${timestamp}.pdf`;
  const filepath = path.join(REPORTS_DIR, filename);

  const doc = new PDFDocumentWithTables({ size: 'A4', margin: 50, bufferPages: true, info: {
    Title: 'Reconciliation Summary Report',
    Author: 'Visa Monitor Enterprise',
  }});

  const stream = fs.createWriteStream(filepath);
  doc.pipe(stream);

  // === HEADER ===
  doc.rect(0, 0, 595, 85).fill(C.header);
  doc.fontSize(22).font('Helvetica-Bold').fillColor(C.white).text('RECONCILIATION REPORT', 50, 25);
  doc.fontSize(10).font('Helvetica').fillColor(C.primary)
    .text(`Generated: ${new Date().toLocaleString('en-AE')} | Visa Monitor Enterprise`, 50, 55);
  doc.moveDown(3);

  // === SUMMARY STATS ===
  const [totalJobs, completedJobs, totalMismatches, openMismatches, totalGhosts, openGhosts] = await Promise.all([
    prisma.reconciliationJob.count(),
    prisma.reconciliationJob.count({ where: { status: 'COMPLETED' } }),
    prisma.reconciliationMismatch.count(),
    prisma.reconciliationMismatch.count({ where: { autoResolved: false, resolvedAt: null } }),
    prisma.ghostAlert.count(),
    prisma.ghostAlert.count({ where: { status: 'OPEN' } }),
  ]);

  doc.y = 100;
  drawSectionHeader(doc, 'EXECUTIVE SUMMARY', doc.y);
  doc.moveDown(2);

  const summaryData = [
    ['Metric', 'Value'],
    ['Total Reconciliation Jobs', String(totalJobs)],
    ['Completed Jobs', String(completedJobs)],
    ['Total Mismatches Detected', String(totalMismatches)],
    ['Open Mismatches', String(openMismatches)],
    ['Total Ghost Alerts', String(totalGhosts)],
    ['Open Ghost Alerts', String(openGhosts)],
    ['Resolution Rate', totalMismatches > 0 ? `${Math.round(((totalMismatches - openMismatches) / totalMismatches) * 100)}%` : 'N/A'],
  ];

  await (doc as any).table({
    headers: summaryData[0], rows: summaryData.slice(1),
  }, {
    width: 495, x: 50,
    columnsSize: [300, 195],
    prepareHeader: () => doc.font('Helvetica-Bold').fontSize(9).fillColor(C.white),
    prepareRow: () => doc.font('Helvetica').fontSize(9).fillColor(C.text),
  });

  // === RECENT JOBS ===
  doc.addPage();
  drawSectionHeader(doc, 'RECENT RECONCILIATION JOBS', 50);
  doc.moveDown(2);
  doc.y = 80;

  const recentJobs = await prisma.reconciliationJob.findMany({
    take: 15, orderBy: { createdAt: 'desc' },
  });

  if (recentJobs.length > 0) {
    const jobRows = recentJobs.map(j => [
      j.createdAt.toLocaleDateString('en-AE', { month: 'short', day: 'numeric' }),
      j.status,
      String(j.totalRecords || 0),
      String(j.checkedRecords || 0),
      String(j.mismatchCount || 0),
      String(j.ghostCount || 0),
    ]);

    await (doc as any).table({
      headers: ['Date', 'Status', 'Total', 'Checked', 'Mismatches', 'Ghosts'],
      rows: jobRows,
    }, {
      width: 495, x: 50,
      columnsSize: [80, 80, 70, 75, 95, 95],
      prepareHeader: () => doc.font('Helvetica-Bold').fontSize(8).fillColor(C.white),
      prepareRow: () => doc.font('Helvetica').fontSize(8).fillColor(C.text),
    });
  }

  // === OPEN MISMATCHES ===
  const openMismatchRecords = await prisma.reconciliationMismatch.findMany({
    where: { autoResolved: false, resolvedAt: null },
    take: 20, orderBy: { createdAt: 'desc' },
    include: { application: { include: { passenger: { select: { fullName: true, passportNumber: true } } } } },
  });

  if (openMismatchRecords.length > 0) {
    doc.addPage();
    drawSectionHeader(doc, 'OPEN MISMATCHES — ACTION REQUIRED', 50);
    doc.moveDown(2);
    doc.y = 80;

    const mismatchRows = openMismatchRecords.map(m => [
      maskPassport(safeDecrypt(m.application.passenger.passportNumber)),
      safeDecrypt(m.application.passenger.fullName),
      m.internalStatus || '—',
      m.portalStatus || '—',
      m.riskLevel || '—',
      String(m.ghostScore || 0),
    ]);

    await (doc as any).table({
      headers: ['Passport', 'Name', 'Internal', 'Portal', 'Risk', 'Score'],
      rows: mismatchRows,
    }, {
      width: 495, x: 50,
      columnsSize: [75, 120, 75, 75, 70, 80],
      prepareHeader: () => doc.font('Helvetica-Bold').fontSize(8).fillColor(C.white),
      prepareRow: () => doc.font('Helvetica').fontSize(8).fillColor(C.text),
    });
  }

  // Footer
  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i++) {
    doc.switchToPage(i);
    drawFooter(doc, i + 1, pages.count);
  }

  doc.end();

  return new Promise((resolve, reject) => {
    stream.on('finish', () => {
      logger.info('✅ Reconciliation PDF generated', { filepath });
      resolve(filepath);
    });
    stream.on('error', reject);
  });
}

/**
 * Generate an Import Activity PDF
 */
export async function generateImportActivityPDF(): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  const filename = `import-activity-${timestamp}.pdf`;
  const filepath = path.join(REPORTS_DIR, filename);

  const doc = new PDFDocumentWithTables({ size: 'A4', margin: 50, bufferPages: true, info: {
    Title: 'Import Activity Report',
    Author: 'Visa Monitor Enterprise',
  }});

  const stream = fs.createWriteStream(filepath);
  doc.pipe(stream);

  // === HEADER ===
  doc.rect(0, 0, 595, 85).fill(C.header);
  doc.fontSize(22).font('Helvetica-Bold').fillColor(C.white).text('IMPORT ACTIVITY REPORT', 50, 25);
  doc.fontSize(10).font('Helvetica').fillColor(C.primary)
    .text(`Generated: ${new Date().toLocaleString('en-AE')} | Visa Monitor Enterprise`, 50, 55);
  doc.moveDown(3);

  // === IMPORT SUMMARY ===
  const imports = await prisma.dataImport.findMany({
    take: 30, orderBy: { createdAt: 'desc' },
    include: { importedByUser: { select: { email: true } } },
  });

  const totalImported = imports.reduce((sum, i) => sum + (i.totalRecords || 0), 0);
  const totalMatched = imports.reduce((sum, i) => sum + (i.matchedCount || 0), 0);
  const totalMismatched = imports.reduce((sum, i) => sum + (i.mismatchedCount || 0), 0);

  doc.y = 100;
  drawSectionHeader(doc, 'IMPORT SUMMARY', doc.y);
  doc.moveDown(2);

  const summaryData = [
    ['Metric', 'Value'],
    ['Total Imports', String(imports.length)],
    ['Total Records Imported', String(totalImported)],
    ['Total Matched', String(totalMatched)],
    ['Total Mismatched', String(totalMismatched)],
    ['Match Rate', totalImported > 0 ? `${Math.round((totalMatched / totalImported) * 100)}%` : 'N/A'],
  ];

  await (doc as any).table({
    headers: summaryData[0], rows: summaryData.slice(1),
  }, {
    width: 495, x: 50,
    columnsSize: [300, 195],
    prepareHeader: () => doc.font('Helvetica-Bold').fontSize(9).fillColor(C.white),
    prepareRow: () => doc.font('Helvetica').fontSize(9).fillColor(C.text),
  });

  // === IMPORT HISTORY TABLE ===
  if (imports.length > 0) {
    doc.addPage();
    drawSectionHeader(doc, 'IMPORT HISTORY', 50);
    doc.moveDown(2);
    doc.y = 80;

    const importRows = imports.map(i => [
      i.createdAt.toLocaleDateString('en-AE', { month: 'short', day: 'numeric' }),
      i.fileName || '—',
      i.source || '—',
      String(i.totalRecords || 0),
      String(i.matchedCount || 0),
      String(i.mismatchedCount || 0),
      i.status || '—',
    ]);

    await (doc as any).table({
      headers: ['Date', 'File', 'Source', 'Records', 'Matched', 'Mismatched', 'Status'],
      rows: importRows,
    }, {
      width: 495, x: 50,
      columnsSize: [55, 120, 60, 55, 60, 70, 75],
      prepareHeader: () => doc.font('Helvetica-Bold').fontSize(7).fillColor(C.white),
      prepareRow: () => doc.font('Helvetica').fontSize(7).fillColor(C.text),
    });
  }

  // Footer
  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i++) {
    doc.switchToPage(i);
    drawFooter(doc, i + 1, pages.count);
  }

  doc.end();

  return new Promise((resolve, reject) => {
    stream.on('finish', () => {
      logger.info('✅ Import Activity PDF generated', { filepath });
      resolve(filepath);
    });
    stream.on('error', reject);
  });
}
