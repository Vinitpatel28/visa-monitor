// ============================================================
// Reports Generation Test
// Usage: npx tsx src/reports/test-reports.ts
// ============================================================

import { generateVisaStatusReport, generateGhostReport } from './ExcelReportGenerator';
import { generateCompliancePDF, generateGhostPDF } from './PDFReportGenerator';
import fs from 'fs';

async function main() {
  console.log('📊 Starting Report Generation Test\n');

  // Test 1: Excel Visa Status Report
  console.log('1️⃣  Generating Excel Visa Status Report...');
  const excelPath = await generateVisaStatusReport();
  const excelSize = fs.statSync(excelPath).size;
  console.log(`   ✅ ${excelPath} (${(excelSize / 1024).toFixed(1)} KB)`);
  console.log(`   📋 Sheets: Executive Summary, Passengers, Visa Applications, Ghost Alerts, Reconciliation, Audit Trail\n`);

  // Test 2: Excel Ghost Report
  console.log('2️⃣  Generating Excel Ghost Alert Report...');
  const ghostExcelPath = await generateGhostReport();
  const ghostExcelSize = fs.statSync(ghostExcelPath).size;
  console.log(`   ✅ ${ghostExcelPath} (${(ghostExcelSize / 1024).toFixed(1)} KB)\n`);

  // Test 3: PDF Compliance Report
  console.log('3️⃣  Generating PDF Compliance Report...');
  const pdfPath = await generateCompliancePDF();
  const pdfSize = fs.statSync(pdfPath).size;
  console.log(`   ✅ ${pdfPath} (${(pdfSize / 1024).toFixed(1)} KB)`);
  console.log(`   📄 Pages: Cover, Executive Summary, Ghost Alert Details, Reconciliation Summary\n`);

  // Test 4: PDF Ghost Detection Report
  console.log('4️⃣  Generating PDF Ghost Detection Report...');
  const ghostPdfPath = await generateGhostPDF();
  const ghostPdfSize = fs.statSync(ghostPdfPath).size;
  console.log(`   ✅ ${ghostPdfPath} (${(ghostPdfSize / 1024).toFixed(1)} KB)\n`);

  // Summary
  console.log('═'.repeat(60));
  console.log('📊 REPORT GENERATION SUMMARY');
  console.log('═'.repeat(60));

  const reports = [
    { name: 'Visa Status (Excel)', path: excelPath, size: excelSize },
    { name: 'Ghost Alerts (Excel)', path: ghostExcelPath, size: ghostExcelSize },
    { name: 'Compliance (PDF)', path: pdfPath, size: pdfSize },
    { name: 'Ghost Detection (PDF)', path: ghostPdfPath, size: ghostPdfSize },
  ];

  const totalSize = reports.reduce((sum, r) => sum + r.size, 0);

  for (const r of reports) {
    console.log(`  ✅ ${r.name.padEnd(25)} ${(r.size / 1024).toFixed(1).padStart(8)} KB`);
  }
  console.log('─'.repeat(60));
  console.log(`  Total: ${reports.length} reports, ${(totalSize / 1024).toFixed(1)} KB`);
  console.log(`  Location: reports/`);
  console.log('═'.repeat(60));

  console.log('\n🎉 Report Generation Test Complete!\n');
  process.exit(0);
}

main().catch((e) => {
  console.error('❌ Test failed:', e);
  process.exit(1);
});
