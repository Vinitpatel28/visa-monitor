// ============================================================
// Local Test Script for ICP Status Fetcher
// This script:
// 1. Starts the Mock ICP Portal on port 4001
// 2. Triggers an ICP status check via direct class call
// 3. Prompts the tester to solve the CAPTCHA in the open window
// 4. Extracts and logs the final result
//
// Run: npx tsx src/automation/test-icp.ts
// ============================================================

import { startICPMockPortal, CAPTCHA_ANSWER } from './ICPMockPortal';
import { icpStatusFetcher, ICPCheckInput } from './ICPStatusFetcher';
import { logger } from '../lib/logger';

// 1. Start the mock portal
startICPMockPortal(4001);

// 2. Define test input
const testInput: ICPCheckInput = {
  passportNumber: 'P1234567', // Ahmed Al Mansouri (Valid)
  passportExpiry: '2026-01-01',
  nationality: 'UAE',
  permitType: 'RESIDENCY',
};

async function runTest() {
  logger.info('🚀 Starting local integration test for ICP Status Fetcher...');
  logger.info('📝 Test Passport Data:', testInput);
  logger.info(`🔑 Tip: The mock CAPTCHA code to type is: "${CAPTCHA_ANSWER}"`);

  // Wait 2 seconds for server to start fully
  await new Promise(r => setTimeout(r, 2000));

  try {
    // Run the scraper directly
    const result = await icpStatusFetcher.checkStatus(testInput);

    logger.info('');
    logger.info('═══════════════════════════════════════════════');
    logger.info('🏁 TEST RESULTS');
    logger.info('═══════════════════════════════════════════════');
    logger.info(`Success:        ${result.success}`);
    logger.info(`Passport:       ${result.passportNumber}`);
    logger.info(`Status:         ${result.status}`);
    logger.info(`File Number:    ${result.icpFileNumber || 'N/A'}`);
    logger.info(`Holder Name:    ${result.holderName || 'N/A'}`);
    logger.info(`Expiry Date:    ${result.expiryDate || 'N/A'}`);
    logger.info(`Screenshot:     ${result.screenshotPath || 'N/A'}`);
    logger.info(`Error Message:  ${result.errorMessage || 'None'}`);
    logger.info('═══════════════════════════════════════════════');
    logger.info('');

    // Exit cleanly
    await icpStatusFetcher.shutdown();
    process.exit(result.success ? 0 : 1);
  } catch (error: any) {
    logger.error('❌ Test script encountered a critical error', { error: error.message });
    await icpStatusFetcher.shutdown();
    process.exit(1);
  }
}

// Run test after small delay
setTimeout(runTest, 1000);
