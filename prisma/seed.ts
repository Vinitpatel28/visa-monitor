// ============================================================
// Database Seed Script — Development test data
// ============================================================

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const prisma = new PrismaClient();

// Simple encryption for seed data
const ALGORITHM = 'aes-256-cbc';
function getKey(): Buffer { return crypto.createHash('sha256').update('32-byte-hex-key-change-in-prod-00').digest(); }
function getIV(): Buffer { return crypto.createHash('md5').update('16-byte-iv-change').digest(); }
function encrypt(text: string): string {
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), getIV());
  return cipher.update(text, 'utf8', 'hex') + cipher.final('hex');
}

async function seed() {
  console.log('🌱 Seeding database...\n');

  // Clean existing data
  await prisma.dataImport.deleteMany();
  await prisma.automationLog.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.otpSession.deleteMany();
  await prisma.ghostAlert.deleteMany();
  await prisma.reconciliationMismatch.deleteMany();
  await prisma.reconciliationJob.deleteMany();
  await prisma.borderEvent.deleteMany();
  await prisma.statusHistory.deleteMany();
  await prisma.visaApplication.deleteMany();
  await prisma.passenger.deleteMany();
  await prisma.user.deleteMany();

  // === USERS ===
  const adminHash = await bcrypt.hash('admin12345', 12);
  const operatorHash = await bcrypt.hash('operator123', 12);

  const admin = await prisma.user.create({ data: { email: 'admin@visaworkflow.com', passwordHash: adminHash, role: 'ADMIN' } });
  const operator = await prisma.user.create({ data: { email: 'operator@visaworkflow.com', passwordHash: operatorHash, role: 'OPERATOR' } });
  const viewer = await prisma.user.create({ data: { email: 'viewer@visaworkflow.com', passwordHash: await bcrypt.hash('viewer1234', 12), role: 'VIEWER' } });
  console.log('✅ Users created (admin, operator, viewer)');

  // === PASSENGERS ===
  const passengers = await Promise.all([
    prisma.passenger.create({ data: { passportNumber: encrypt('P1234567'), fullName: encrypt('Ahmed Al Mansouri'), nationality: 'UAE', dateOfBirth: new Date('1985-03-15'), passportExpiry: new Date('2028-03-15'), icpFileNumber: '201/2024/1234567', sponsorCompany: 'Emirates Group', department: 'Operations', lastVerifiedAt: new Date(), lastVerifiedBy: 'CSV_IMPORT' } }),
    prisma.passenger.create({ data: { passportNumber: encrypt('P2345678'), fullName: encrypt('Rajesh Kumar'), nationality: 'India', dateOfBirth: new Date('1990-07-22'), passportExpiry: new Date('2027-07-22'), icpFileNumber: '201/2024/2345678', sponsorCompany: 'Dubai Holding', department: 'IT', lastVerifiedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000), lastVerifiedBy: 'PLAYWRIGHT' } }),
    prisma.passenger.create({ data: { passportNumber: encrypt('P3456789'), fullName: encrypt('Maria Santos'), nationality: 'Philippines', dateOfBirth: new Date('1988-11-03'), passportExpiry: new Date('2029-11-03'), sponsorCompany: 'Emirates Group', department: 'HR' } }),
    prisma.passenger.create({ data: { passportNumber: encrypt('P4567890'), fullName: encrypt('John Smith'), nationality: 'UK', dateOfBirth: new Date('1982-01-20'), passportExpiry: new Date('2026-01-20'), sponsorCompany: 'DEWA', department: 'Engineering', lastVerifiedAt: new Date(), lastVerifiedBy: 'MANUAL_ENTRY' } }),
    prisma.passenger.create({ data: { passportNumber: encrypt('P5678901'), fullName: encrypt('Fatima Hassan'), nationality: 'Egypt', dateOfBirth: new Date('1995-09-10'), passportExpiry: new Date('2028-09-10'), icpFileNumber: '201/2024/5678901', sponsorCompany: 'Dubai Holding', department: 'Finance' } }),
  ]);
  console.log('✅ 5 Passengers created');

  // === VISA APPLICATIONS ===
  const apps = await Promise.all([
    prisma.visaApplication.create({ data: { passengerId: passengers[0].id, visaNumber: 'V-2024-001', visaType: 'EMPLOYMENT', status: 'IN_COUNTRY', portalStatus: 'ACTIVE', icpStatus: 'Valid', dataSource: 'CSV_IMPORT', issuedDate: new Date('2024-01-01'), expiryDate: new Date('2026-01-01'), lastPortalSync: new Date() } }),
    prisma.visaApplication.create({ data: { passengerId: passengers[1].id, visaNumber: 'V-2024-002', visaType: 'EMPLOYMENT', status: 'IN_COUNTRY', portalStatus: 'EXPIRED', icpStatus: 'Expired', dataSource: 'PLAYWRIGHT', issuedDate: new Date('2024-02-15'), expiryDate: new Date('2026-02-15'), lastPortalSync: new Date(Date.now() - 48 * 60 * 60 * 1000) } }),
    prisma.visaApplication.create({ data: { passengerId: passengers[2].id, visaNumber: 'V-2024-003', visaType: 'EMPLOYMENT', status: 'ACTIVE', dataSource: 'MANUAL_ENTRY', issuedDate: new Date('2024-03-01'), expiryDate: new Date('2026-03-01') } }),
    prisma.visaApplication.create({ data: { passengerId: passengers[3].id, visaNumber: 'V-2024-004', visaType: 'VISIT', status: 'EXITED', portalStatus: 'USED', icpStatus: 'Used', dataSource: 'CSV_IMPORT', issuedDate: new Date('2024-06-01'), expiryDate: new Date('2024-09-01'), lastPortalSync: new Date() } }),
    prisma.visaApplication.create({ data: { passengerId: passengers[4].id, visaNumber: 'V-2024-005', visaType: 'EMPLOYMENT', status: 'IN_COUNTRY', icpStatus: 'Valid', dataSource: 'CSV_IMPORT', issuedDate: new Date('2024-04-01'), expiryDate: new Date('2024-04-01') } }),
  ]);
  console.log('✅ 5 Visa Applications created');

  // === BORDER EVENTS ===
  await Promise.all([
    prisma.borderEvent.create({ data: { applicationId: apps[0].id, eventType: 'ENTRY', eventDatetime: new Date('2024-01-05'), portOfEntry: 'Dubai International Airport', idempotencyKey: 'entry-001', source: 'MANUAL' } }),
    prisma.borderEvent.create({ data: { applicationId: apps[1].id, eventType: 'ENTRY', eventDatetime: new Date('2024-02-20'), portOfEntry: 'Abu Dhabi Airport', idempotencyKey: 'entry-002', source: 'MANUAL' } }),
    // Ghost scenario: exit recorded but status still IN_COUNTRY
    prisma.borderEvent.create({ data: { applicationId: apps[1].id, eventType: 'EXIT', eventDatetime: new Date(Date.now() - 96 * 60 * 60 * 1000), portOfEntry: 'Dubai International Airport', idempotencyKey: 'exit-002', source: 'AUTOMATION' } }),
    prisma.borderEvent.create({ data: { applicationId: apps[3].id, eventType: 'ENTRY', eventDatetime: new Date('2024-06-05'), portOfEntry: 'Sharjah Airport', idempotencyKey: 'entry-004', source: 'WEBHOOK' } }),
    prisma.borderEvent.create({ data: { applicationId: apps[3].id, eventType: 'EXIT', eventDatetime: new Date('2024-08-15'), portOfEntry: 'Dubai International Airport', idempotencyKey: 'exit-004', source: 'WEBHOOK' } }),
    prisma.borderEvent.create({ data: { applicationId: apps[4].id, eventType: 'ENTRY', eventDatetime: new Date('2024-04-05'), portOfEntry: 'Dubai International Airport', idempotencyKey: 'entry-005', source: 'MANUAL' } }),
  ]);
  console.log('✅ Border Events created (including ghost scenario)');

  // === STATUS HISTORY ===
  for (const app of apps) {
    await prisma.statusHistory.create({ data: { applicationId: app.id, newStatus: app.status, source: 'MANUAL', changedBy: operator.id, notes: 'Initial status set' } });
  }
  console.log('✅ Status History entries created');

  // === GHOST ALERT (for passenger 2 — Rajesh Kumar) ===
  await prisma.ghostAlert.create({
    data: { applicationId: apps[1].id, ghostScore: 85, riskLevel: 'CRITICAL', status: 'OPEN', lastKnownLocation: 'Dubai International Airport', hoursSinceExit: 96, suggestedAction: 'IMMEDIATE_REVIEW - Passenger exited 96h ago but status shows IN_COUNTRY' },
  });
  console.log('✅ Ghost Alert created (CRITICAL)');

  // === AUDIT LOG ===
  await prisma.auditLog.create({ data: { userId: admin.id, action: 'SYSTEM_SEED', entityType: 'System', newValues: JSON.stringify({ message: 'Database seeded with test data' }) } });
  console.log('✅ Audit log entry created');

  console.log('\n🎉 Database seeded successfully!');
  console.log('\n📋 Test credentials:');
  console.log('   Admin:    admin@visaworkflow.com / admin12345');
  console.log('   Operator: operator@visaworkflow.com / operator123');
  console.log('   Viewer:   viewer@visaworkflow.com / viewer1234');
}

seed()
  .catch((e) => { console.error('❌ Seed failed:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
