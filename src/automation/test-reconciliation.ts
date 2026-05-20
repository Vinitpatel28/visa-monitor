// ============================================================
// Reconciliation + Ghost Detection Integration Test
// Usage: npx tsx src/automation/test-reconciliation.ts
// ============================================================

import { PrismaClient } from '@prisma/client';
import { ReconciliationEngine } from './ReconciliationEngine';
import { AlertService } from './AlertService';

const prisma = new PrismaClient();

async function main() {
  console.log('🔄 Starting Reconciliation Engine Test\n');

  // Step 1: Show current state
  console.log('1️⃣  Current Database State:');
  const passengers = await prisma.passenger.count();
  const applications = await prisma.visaApplication.findMany({
    include: { passenger: true, borderEvents: { orderBy: { eventDatetime: 'desc' }, take: 1 } },
  });
  const existingGhosts = await prisma.ghostAlert.count({ where: { status: 'OPEN' } });

  console.log(`   Passengers: ${passengers}`);
  console.log(`   Applications: ${applications.length}`);
  console.log(`   Existing Open Ghosts: ${existingGhosts}`);
  console.log('');

  for (const app of applications) {
    const lastEvent = app.borderEvents[0];
    const eventInfo = lastEvent ? `${lastEvent.eventType} @ ${lastEvent.portOfEntry}` : 'No events';
    console.log(`   📋 ${app.visaNumber} | Status: ${app.status} | Last Event: ${eventInfo}`);
  }

  // Step 2: Create reconciliation job
  console.log('\n2️⃣  Creating Reconciliation Job...');
  const job = await prisma.reconciliationJob.create({
    data: { jobType: 'FULL', status: 'PENDING' },
  });
  console.log(`   Job ID: ${job.id}`);

  // Step 3: Run reconciliation
  console.log('\n3️⃣  Running Reconciliation Engine...');
  const engine = new ReconciliationEngine({
    batchSize: 10,
    ghostThresholdHours: 24,
    autoResolveThreshold: 20,
  });

  const result = await engine.runFull(job.id);

  console.log('\n   ═══════════════════════════════════════');
  console.log('   📊 RECONCILIATION RESULTS');
  console.log('   ═══════════════════════════════════════');
  console.log(`   Total Checked:   ${result.totalChecked}`);
  console.log(`   Mismatches:      ${result.mismatches}`);
  console.log(`   Ghost Passengers: ${result.ghosts}`);
  console.log(`   Auto-Resolved:   ${result.autoResolved}`);
  console.log(`   Duration:        ${result.duration}ms`);
  console.log(`   Errors:          ${result.errors.length}`);
  if (result.errors.length > 0) {
    for (const err of result.errors) {
      console.log(`     ❌ ${err}`);
    }
  }

  // Step 4: Show mismatches
  console.log('\n4️⃣  Mismatches Found:');
  const mismatches = await prisma.reconciliationMismatch.findMany({
    where: { jobId: job.id },
    include: { application: { include: { passenger: { select: { fullName: true } } } } },
  });

  if (mismatches.length === 0) {
    console.log('   ✅ No mismatches found');
  } else {
    for (const m of mismatches) {
      const risk = {
        CRITICAL: '🔴',
        HIGH: '🟠',
        MEDIUM: '🟡',
        LOW: '🟢',
      }[m.riskLevel || ''] || '⚪';

      console.log(`   ${risk} ${m.mismatchType} | Internal: ${m.internalStatus} → Portal: ${m.portalStatus} | Score: ${m.ghostScore} | ${m.autoResolved ? 'AUTO-RESOLVED' : m.riskLevel}`);
    }
  }

  // Step 5: Show ghost alerts
  console.log('\n5️⃣  Ghost Alerts:');
  const alerts = await prisma.ghostAlert.findMany({
    where: { status: 'OPEN' },
    include: { application: { include: { passenger: { select: { fullName: true, passportNumber: true } } } } },
    orderBy: { ghostScore: 'desc' },
  });

  if (alerts.length === 0) {
    console.log('   ✅ No ghost alerts');
  } else {
    console.log(`   Total Open Alerts: ${alerts.length}\n`);
    for (const alert of alerts) {
      const risk = {
        CRITICAL: '🔴',
        HIGH: '🟠',
        MEDIUM: '🟡',
        LOW: '🟢',
      }[alert.riskLevel] || '⚪';

      console.log(`   ${risk} Ghost Score: ${alert.ghostScore}/100 | Risk: ${alert.riskLevel}`);
      console.log(`     Location: ${alert.lastKnownLocation || 'Unknown'}`);
      console.log(`     Hours Since Exit: ${alert.hoursSinceExit ? Number(alert.hoursSinceExit).toFixed(1) + 'h' : 'N/A'}`);
      console.log(`     Action: ${alert.suggestedAction}`);
      console.log('');
    }
  }

  // Step 6: Send alerts
  console.log('6️⃣  Dispatching Alerts...');
  const alertService = new AlertService({ channels: ['CONSOLE'] });
  for (const alert of alerts) {
    await alertService.sendGhostAlert(alert.id);
  }

  // Step 7: Generate digest
  console.log('\n7️⃣  Alert Digest:');
  const digest = await alertService.generateDigest();
  console.log(`   Total Active: ${digest.total}`);
  console.log(`   Critical: ${digest.critical} | High: ${digest.high} | Medium: ${digest.medium} | Low: ${digest.low}`);
  console.log(`   Unacknowledged: ${digest.unacknowledged}`);
  console.log(`   Avg Ghost Score: ${digest.avgScore}`);

  console.log('\n🎉 Reconciliation Engine Test Complete!\n');

  await prisma.$disconnect();
  process.exit(0);
}

main().catch((e) => {
  console.error('❌ Test failed:', e);
  process.exit(1);
});
