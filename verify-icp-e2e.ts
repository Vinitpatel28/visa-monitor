import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🏁 Starting E2E Verification for ICP Integration...');

  // 1. Find the target visa application
  const app = await prisma.visaApplication.findFirst({
    where: { visaNumber: 'V-2024-001' }
  });

  if (!app) {
    console.error('❌ Could not find seeded VisaApplication V-2024-001');
    process.exit(1);
  }
  console.log(`✅ Found target application: ID=${app.id}`);

  // 2. Perform Login to obtain JWT
  console.log('🔑 Logging in to retrieve JWT...');
  try {
    const loginRes = await fetch('http://localhost:3000/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@visaworkflow.com',
        password: 'admin12345'
      })
    });

    const loginData = await loginRes.json() as any;
    const token = loginData?.data?.accessToken;
    if (!token) {
      console.error('❌ Login failed: Token not found in response', loginData);
      process.exit(1);
    }
    console.log('✅ Login successful, token acquired.');

    // 3. Trigger ICP status check via backend API
    console.log('🔄 Triggering ICP status check API...');
    const checkRes = await fetch('http://localhost:3000/api/v1/icp/check', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        passportNumber: 'P1234567',
        passportExpiry: '2026-01-01',
        nationality: 'UAE',
        permitType: 'RESIDENCY',
        applicationId: app.id
      })
    });

    const checkData = await checkRes.json() as any;
    console.log('✅ ICP API returned response:');
    console.dir(checkData, { depth: null });

    const resultData = checkData?.data;
    if (!resultData?.success) {
      console.error('❌ ICP check marked as failed:', resultData?.errorMessage);
      process.exit(1);
    }

    console.log('\n🔍 Verifying results match mock database:');
    console.log(`- Status: ${resultData.status} (Expected: ACTIVE)`);
    console.log(`- Holder Name: ${resultData.holderName} (Expected: Ahmed Al Mansouri)`);
    console.log(`- File Number: ${resultData.icpFileNumber} (Expected: ICP-2024-001)`);

    if (resultData.status !== 'ACTIVE' || resultData.holderName !== 'Ahmed Al Mansouri' || resultData.icpFileNumber !== 'ICP-2024-001') {
      console.error('❌ Parsed results do not match expected mock data!');
      process.exit(1);
    }
    console.log('✅ API results verified.');

    // 4. Check database to verify persistence
    console.log('\n💾 Verifying database persistence...');
    const updatedApp = await prisma.visaApplication.findUnique({
      where: { id: app.id }
    });

    console.log(`- DB Portal Status: ${updatedApp?.portalStatus}`);
    console.log(`- DB ICP Status: ${updatedApp?.icpStatus}`);
    console.log(`- DB Last Portal Sync: ${updatedApp?.lastPortalSync}`);

    if (updatedApp?.icpStatus !== 'ACTIVE' || !updatedApp?.lastPortalSync) {
      console.error('❌ Database was not updated correctly!');
      process.exit(1);
    }
    console.log('✅ Database persistence verified successfully.');

    // 5. Verify audit logging
    console.log('\n📜 Verifying audit logs...');
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'ICP_STATUS_CHECK' },
      orderBy: { createdAt: 'desc' }
    });

    if (!audit) {
      console.error('❌ Audit log for ICP status check not found!');
      process.exit(1);
    }
    console.log(`✅ Audit log verified: Action=${audit.action}, EntityType=${audit.entityType}, EntityId=${audit.entityId}`);

    console.log('\n🎉 E2E INTEGRATION TEST COMPLETED SUCCESSFULLY! 🎉');
    process.exit(0);

  } catch (err: any) {
    console.error('❌ E2E test crashed with error:', err.message);
    process.exit(1);
  }
}

main();
