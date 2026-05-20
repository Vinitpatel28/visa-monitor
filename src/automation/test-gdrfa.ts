// ============================================================
// GDRFA Live Test — Tests the real government portal scraper
// Run: npx tsx src/automation/test-gdrfa.ts
// ============================================================

import { gdrfaFetcher } from './GDRFAStatusFetcher';

async function testGDRFA() {
  console.log('\n' + '='.repeat(60));
  console.log('  GDRFA DUBAI — LIVE STATUS INQUIRY TEST');
  console.log('  Target: smart.gdrfad.gov.ae (Public Portal)');
  console.log('='.repeat(60) + '\n');

  try {
    // ========================
    // TEST 1: Test with a sample file number
    // ========================
    console.log('📋 Test 1: Fetching visa status by file number...');
    console.log('   (Using headless=false so you can SEE the browser)');
    console.log('   (The browser will open, navigate to GDRFA, and fill the form)\n');

    // Run in non-headless mode so the user can see it working!
    const result = await gdrfaFetcher.fetchByFileNumber('201/2024/1234567', {
      headless: false, // Show the browser window!
      timeout: 60000,
      retries: 2,
    });

    console.log('\n' + '-'.repeat(40));
    console.log('📊 RESULT:');
    console.log(`   Status:      ${result.portalStatus}`);
    console.log(`   File Number: ${result.fileNumber}`);
    console.log(`   Visa Type:   ${result.visaType || 'N/A'}`);
    console.log(`   Expiry Date: ${result.expiryDate || 'N/A'}`);
    console.log(`   Profession:  ${result.profession || 'N/A'}`);
    console.log(`   Nationality: ${result.nationality || 'N/A'}`);
    console.log(`   Sponsor:     ${result.sponsorName || 'N/A'}`);
    console.log(`   Success:     ${result.success}`);
    console.log(`   Fetched At:  ${result.fetchedAt}`);
    if (result.errorMessage) {
      console.log(`   Error:       ${result.errorMessage}`);
    }
    if (result.rawText) {
      console.log(`   Raw Text:    ${result.rawText.substring(0, 200)}...`);
    }
    console.log('-'.repeat(40) + '\n');

  } catch (error: any) {
    console.error('❌ Test failed:', error.message);
  } finally {
    await gdrfaFetcher.close();
  }

  console.log('\n' + '='.repeat(60));
  console.log('  TEST COMPLETE');
  console.log('='.repeat(60) + '\n');

  console.log('💡 NOTES:');
  console.log('   - The file number "201/2024/1234567" is a sample.');
  console.log('   - Replace it with a REAL file number from your company');
  console.log('     to see actual visa status data from GDRFA.');
  console.log('   - If Cloudflare blocks the request, try running again');
  console.log('     after a few minutes.');
  console.log('   - Set headless: true in production for background runs.\n');
}

testGDRFA();
