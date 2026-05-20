// ============================================================
// Automation Integration Test
// Runs the full flow: Mock Portal → Login → Status Fetch
// Usage: npx tsx src/automation/test-automation.ts
// ============================================================

import { chromium, Page } from 'playwright';
import { startMockPortal } from './MockPortal';

const PORTAL_URL = 'http://localhost:4000';
const PORTAL_USER = 'portal_admin';
const PORTAL_PASS = 'portal123';
const OTP = '123456';

// Test passport numbers
const TEST_PASSPORTS = ['P1234567', 'P2345678', 'P3456789', 'P4567890', 'P5678901'];

async function main() {
  console.log('🚀 Starting Automation Integration Test\n');

  // Step 1: Start Mock Portal
  console.log('1️⃣  Starting Mock GDRFA Portal...');
  await startMockPortal(4000);

  // Step 2: Launch browser
  console.log('\n2️⃣  Launching Chromium browser...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    viewport: { width: 1366, height: 768 },
  });

  const page = await context.newPage();

  try {
    // Step 3: Login
    console.log('\n3️⃣  Logging into GDRFA Portal...');
    await page.goto(`${PORTAL_URL}/login`, { waitUntil: 'networkidle' });

    // Fill credentials
    await page.fill('#username', PORTAL_USER);
    await page.fill('#password', PORTAL_PASS);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/verify-otp**', { timeout: 5000 }).catch(() => {});

    // Wait for OTP page
    await page.waitForSelector('input[name="otp"]', { timeout: 5000 });
    console.log('   ✅ Login form submitted, OTP page loaded');

    // Fill OTP
    await page.fill('input[name="otp"]', OTP);
    await page.click('button[type="submit"]');

    // Wait for dashboard
    await page.waitForSelector('[data-page="dashboard"]', { timeout: 10000 });
    console.log('   ✅ OTP verified, dashboard loaded');
    console.log(`   📍 Current URL: ${page.url()}`);

    // Step 4: Navigate to status check
    console.log('\n4️⃣  Checking visa statuses...\n');
    
    const results: any[] = [];

    for (const passport of TEST_PASSPORTS) {
      // Intercept XHR response
      let statusData: any = null;

      const responseHandler = async (response: any) => {
        if (response.url().includes('/api/visa/status')) {
          try {
            statusData = await response.json();
          } catch {}
        }
      };

      page.on('response', responseHandler);

      // Go to status check page
      await page.goto(`${PORTAL_URL}/status-check`, { waitUntil: 'networkidle' });

      // Fill passport and search
      await page.fill('#passportNumber', passport);
      await page.click('.search-btn');

      // Wait for result
      await page.waitForSelector('.status-result .value', { timeout: 5000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 1000));

      page.removeListener('response', responseHandler);

      if (statusData && statusData.found) {
        const icon = statusData.status === 'IN_COUNTRY' ? '🟢' : statusData.status === 'EXITED' ? '🔴' : '🟡';
        console.log(`   ${icon} ${passport} → ${statusData.status} | ${statusData.name} | Visa: ${statusData.visaNumber}`);
        results.push(statusData);
      } else {
        console.log(`   ⚪ ${passport} → NOT FOUND`);
      }
    }

    // Step 5: Ghost Detection Simulation
    console.log('\n5️⃣  Ghost Detection Analysis:');
    console.log('   ─────────────────────────────────────────────────');
    
    // Simulated internal statuses (from our DB seed data)
    const internalStatuses: Record<string, string> = {
      P1234567: 'IN_COUNTRY',
      P2345678: 'IN_COUNTRY',  // Ghost! Portal says EXITED
      P3456789: 'ACTIVE',
      P4567890: 'EXITED',
      P5678901: 'IN_COUNTRY',
    };

    let ghostCount = 0;
    for (const result of results) {
      const internal = internalStatuses[result.passport];
      const portal = result.status;
      
      if (internal && internal !== portal) {
        ghostCount++;
        const score = calculateSimpleGhostScore(internal, portal);
        console.log(`   🔺 MISMATCH: ${result.passport} (${result.name})`);
        console.log(`      Internal: ${internal} | Portal: ${portal}`);
        console.log(`      Ghost Score: ${score.score}/100 | Risk: ${score.risk}`);
        console.log(`      Action: ${score.action}`);
        console.log('');
      }
    }

    if (ghostCount === 0) {
      console.log('   ✅ No ghost passengers detected');
    } else {
      console.log(`   ⚠️  ${ghostCount} ghost passenger(s) detected!`);
    }

    // Step 6: Take screenshot of final state
    const screenshotPath = `screenshots/test-automation-${Date.now()}.png`;
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`\n📸 Screenshot saved: ${screenshotPath}`);

  } catch (error: any) {
    console.error('\n❌ Test failed:', error.message);
    await page.screenshot({ path: `screenshots/test-fail-${Date.now()}.png` });
  } finally {
    await browser.close();
    console.log('\n✅ Browser closed');
    console.log('\n🎉 Automation Integration Test Complete!\n');
    process.exit(0);
  }
}

function calculateSimpleGhostScore(internal: string, portal: string): { score: number; risk: string; action: string } {
  let score = 0;
  
  // Status mismatch
  if (internal !== portal) score += 25;
  
  // IN_COUNTRY internally but EXITED on portal — classic ghost
  if (internal === 'IN_COUNTRY' && portal === 'EXITED') score += 40;
  
  // Additional for being a critical case
  if (internal === 'IN_COUNTRY' && portal === 'EXITED') score += 20;

  score = Math.min(score, 100);

  const risk = score >= 80 ? 'CRITICAL' : score >= 60 ? 'HIGH' : score >= 40 ? 'MEDIUM' : 'LOW';
  const action = score >= 80 ? 'IMMEDIATE_REVIEW' : score >= 60 ? 'VERIFY_WITH_PORTAL' : 'SCHEDULE_RECHECK';

  return { score, risk, action };
}

main().catch(console.error);
