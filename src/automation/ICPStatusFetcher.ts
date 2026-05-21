// ============================================================
// ICP Status Fetcher — Core Playwright scraper for ICP portal
// Navigates to File Validity page, fills form, waits for
// manual CAPTCHA, extracts results.
// ============================================================

import { Page } from 'playwright';
import { logger } from '../lib/logger';
import { config } from '../config';
import { prisma } from '../lib/prisma';
import { icpSessionManager } from './ICPSessionManager';
import { icpCircuitBreaker } from './CircuitBreaker';
import { getSelectorList } from './icp-selectors';

// ========================
// TYPES
// ========================

export interface ICPCheckInput {
  passportNumber: string;
  passportExpiry: string;    // YYYY-MM-DD format
  nationality: string;
  permitType: 'RESIDENCY' | 'VISA';
  applicationId?: string;    // Optional: link result to a visa application
}

export interface ICPCheckResult {
  success: boolean;
  passportNumber: string;
  status: string;            // VALID, EXPIRED, CANCELLED, UNDER_PROCESS, CLOSED, NOT_FOUND, ERROR
  icpFileNumber?: string;
  expiryDate?: string;
  holderName?: string;
  rawText?: string;
  screenshotPath?: string;
  fetchedAt: Date;
  durationMs: number;
  errorMessage?: string;
  errorType?: string;
}

// ICP status → our internal status mapping
const STATUS_MAP: Record<string, string> = {
  'valid': 'ACTIVE',
  'expired': 'EXPIRED',
  'cancelled': 'CANCELLED',
  'canceled': 'CANCELLED',
  'under process': 'PENDING',
  'under_process': 'PENDING',
  'closed': 'CLOSED',
  'used': 'USED',
};

// ========================
// RATE LIMITER (simple)
// ========================

let lastCheckTime = 0;
let checksThisHour = 0;
let hourStart = Date.now();

function canProceed(): { allowed: boolean; reason?: string } {
  const now = Date.now();

  // Reset hourly counter
  if (now - hourStart > 3600000) {
    checksThisHour = 0;
    hourStart = now;
  }

  // Check hourly limit
  if (checksThisHour >= config.icp.maxChecksPerHour) {
    return { allowed: false, reason: `Hourly limit reached (${config.icp.maxChecksPerHour}/hour)` };
  }

  // Check minimum delay
  const elapsed = now - lastCheckTime;
  if (elapsed < config.icp.delayBetweenChecks) {
    const waitSec = Math.ceil((config.icp.delayBetweenChecks - elapsed) / 1000);
    return { allowed: false, reason: `Please wait ${waitSec}s between checks` };
  }

  return { allowed: true };
}

// ========================
// CORE FETCHER
// ========================

export class ICPStatusFetcher {

  /**
   * Check a single passport against the ICP portal
   */
  async checkStatus(input: ICPCheckInput): Promise<ICPCheckResult> {
    const startTime = Date.now();

    // Rate limit check
    const rateCheck = canProceed();
    if (!rateCheck.allowed) {
      return {
        success: false,
        passportNumber: input.passportNumber,
        status: 'ERROR',
        fetchedAt: new Date(),
        durationMs: Date.now() - startTime,
        errorMessage: rateCheck.reason,
        errorType: 'RATE_LIMITED',
      };
    }

    // Circuit breaker check
    try {
      return await icpCircuitBreaker.execute(async () => {
        return this.doCheck(input, startTime);
      });
    } catch (error: any) {
      if (error.name === 'CircuitBreakerError') {
        return {
          success: false,
          passportNumber: input.passportNumber,
          status: 'ERROR',
          fetchedAt: new Date(),
          durationMs: Date.now() - startTime,
          errorMessage: error.message,
          errorType: 'CIRCUIT_OPEN',
        };
      }
      throw error;
    }
  }

  /**
   * Internal: perform the actual ICP check
   */
  private async doCheck(input: ICPCheckInput, startTime: number): Promise<ICPCheckResult> {
    let screenshotPath = '';

    try {
      // Update rate limiter
      lastCheckTime = Date.now();
      checksThisHour++;

      // Get browser page
      await icpSessionManager.initialize();
      const page = await icpSessionManager.getPage();

      logger.info('🌐 Navigating to ICP portal...', {
        passport: input.passportNumber.substring(0, 3) + '***',
      });

      // Step 1: Navigate to portal
      await page.goto(config.icp.portalUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      // Step 2: Wait for AngularJS to bootstrap
      await this.waitForAngular(page);
      logger.info('✅ ICP portal loaded');

      // Step 3: Click Passport Information tab
      await this.clickPassportTab(page);

      // Step 4: Fill the form
      await this.fillForm(page, input);
      logger.info('📝 Form filled successfully');

      // If pointing to localhost (mock portal), auto-fill captcha and click search
      if (config.icp.portalUrl.includes('localhost') || config.icp.portalUrl.includes('127.0.0.1')) {
        logger.info('🤖 Mock portal detected: Auto-solving CAPTCHA...');
        const captchaInputSelectors = getSelectorList('captchaInput');
        let captchaFilled = false;
        for (const sel of captchaInputSelectors) {
          try {
            const el = await page.$(sel);
            if (el) {
              await el.fill('ABC123');
              logger.info('🤖 Filled CAPTCHA input with mock answer');
              captchaFilled = true;
              break;
            }
          } catch (err: any) {
            logger.debug(`Could not fill captcha input using ${sel}: ${err.message}`);
          }
        }
        
        if (captchaFilled) {
          const searchButtonSelectors = getSelectorList('searchButton');
          for (const sel of searchButtonSelectors) {
            try {
              const el = await page.$(sel);
              if (el) {
                await el.click();
                logger.info('🤖 Clicked Search button');
                break;
              }
            } catch (err: any) {
              logger.debug(`Could not click search button using ${sel}: ${err.message}`);
            }
          }
        }
      }

      // Step 5: Wait for manual CAPTCHA solving
      logger.info('');
      logger.info('═══════════════════════════════════════════════');
      logger.info('🔐 CAPTCHA DETECTED — Please solve it manually');
      logger.info('   Look at the browser window and type the CAPTCHA');
      logger.info('   Then click the Search button');
      logger.info(`   Timeout: ${config.icp.captchaTimeoutMs / 1000} seconds`);
      logger.info('═══════════════════════════════════════════════');
      logger.info('');

      // Wait for results to appear (operator solves CAPTCHA + clicks search)
      const hasResult = await this.waitForResults(page);

      if (!hasResult) {
        screenshotPath = await icpSessionManager.screenshot('captcha-timeout');
        return {
          success: false,
          passportNumber: input.passportNumber,
          status: 'ERROR',
          screenshotPath,
          fetchedAt: new Date(),
          durationMs: Date.now() - startTime,
          errorMessage: 'Timeout waiting for results. Did you solve the CAPTCHA and click Search?',
          errorType: 'CAPTCHA_TIMEOUT',
        };
      }

      // Step 6: Check for "no record" message
      const noRecord = await this.checkNoRecord(page);
      if (noRecord) {
        screenshotPath = await icpSessionManager.screenshot('no-record');
        logger.info('📭 No record found for passport', {
          passport: input.passportNumber.substring(0, 3) + '***',
        });

        const result: ICPCheckResult = {
          success: true,
          passportNumber: input.passportNumber,
          status: 'NOT_FOUND',
          screenshotPath,
          fetchedAt: new Date(),
          durationMs: Date.now() - startTime,
        };

        // Save to database
        await this.saveResult(input, result);
        await this.logAutomation(input, result);

        return result;
      }

      // Step 7: Extract result data
      const extracted = await this.extractResults(page);
      screenshotPath = await icpSessionManager.screenshot('result-success');

      const normalizedStatus = this.normalizeStatus(extracted.status);

      const result: ICPCheckResult = {
        success: true,
        passportNumber: input.passportNumber,
        status: normalizedStatus,
        icpFileNumber: extracted.fileNumber,
        expiryDate: extracted.expiryDate,
        holderName: extracted.holderName,
        rawText: extracted.rawText,
        screenshotPath,
        fetchedAt: new Date(),
        durationMs: Date.now() - startTime,
      };

      logger.info('✅ ICP status fetched successfully', {
        passport: input.passportNumber.substring(0, 3) + '***',
        status: normalizedStatus,
        icpFileNumber: extracted.fileNumber,
        durationMs: result.durationMs,
      });

      // Save to database
      await this.saveResult(input, result);
      await this.logAutomation(input, result);

      return result;

    } catch (error: any) {
      screenshotPath = await icpSessionManager.screenshot('error');

      logger.error('❌ ICP check failed', {
        passport: input.passportNumber.substring(0, 3) + '***',
        error: error.message,
      });

      const result: ICPCheckResult = {
        success: false,
        passportNumber: input.passportNumber,
        status: 'ERROR',
        screenshotPath,
        fetchedAt: new Date(),
        durationMs: Date.now() - startTime,
        errorMessage: error.message,
        errorType: this.classifyError(error),
      };

      await this.logAutomation(input, result);

      return result;
    }
  }

  // ════════════════════════════════════════
  // PAGE INTERACTION HELPERS
  // ════════════════════════════════════════

  /**
   * Wait for AngularJS to fully bootstrap
   */
  private async waitForAngular(page: Page): Promise<void> {
    try {
      await page.waitForFunction(() => {
        const angular = (window as any).angular;
        if (!angular) return false;
        const el = document.querySelector('[ng-app]');
        if (!el) return false;
        try {
          const injector = angular.element(el).injector();
          if (!injector) return false;
          const $http = injector.get('$http');
          return $http.pendingRequests.length === 0;
        } catch {
          return true; // Angular exists but injector quirk — proceed
        }
      }, { timeout: 15000 });
    } catch {
      // Fallback: just wait for DOM to be ready
      logger.warn('AngularJS wait timed out — proceeding with DOM ready');
      await page.waitForLoadState('domcontentloaded');
    }
  }

  /**
   * Click the "Passport Information" search type tab
   */
  private async clickPassportTab(page: Page): Promise<void> {
    const selectors = getSelectorList('passportTab');

    for (const sel of selectors) {
      try {
        const element = await page.$(sel);
        if (element) {
          await element.click();
          logger.debug('Clicked passport tab', { selector: sel });
          await page.waitForTimeout(500);
          return;
        }
      } catch {
        continue;
      }
    }

    // Tab might already be selected — continue anyway
    logger.debug('Passport tab not found or already selected — continuing');
  }

  /**
   * Fill all form fields
   */
  private async fillForm(page: Page, input: ICPCheckInput): Promise<void> {
    // Permit Type (select dropdown)
    await this.selectDropdown(page, 'permitType', input.permitType);
    await page.waitForTimeout(300);

    // Passport Number (text input with human-like typing)
    await this.fillInput(page, 'passportNumber', input.passportNumber);
    await page.waitForTimeout(300);

    // Passport Expiry Date
    await this.fillInput(page, 'passportExpiry', input.passportExpiry);
    await page.waitForTimeout(300);

    // Nationality (select dropdown)
    await this.selectDropdown(page, 'nationality', input.nationality);
    await page.waitForTimeout(300);
  }

  /**
   * Try to fill a text input using multiple selectors
   */
  private async fillInput(page: Page, selectorKey: 'passportNumber' | 'passportExpiry', value: string): Promise<void> {
    const selectors = getSelectorList(selectorKey);

    for (const sel of selectors) {
      try {
        const element = await page.$(sel);
        if (element) {
          await element.click();
          await element.fill('');
          // Type with human-like delay
          await element.type(value, { delay: 50 + Math.random() * 50 });
          logger.debug(`Filled ${selectorKey}`, { selector: sel });
          return;
        }
      } catch {
        continue;
      }
    }

    logger.warn(`Could not find input for ${selectorKey}`);
  }

  /**
   * Try to select a dropdown option using multiple selectors
   */
  private async selectDropdown(page: Page, selectorKey: 'permitType' | 'nationality', value: string): Promise<void> {
    const selectors = getSelectorList(selectorKey);

    for (const sel of selectors) {
      try {
        const element = await page.$(sel);
        if (element) {
          await page.selectOption(sel, { value });
          logger.debug(`Selected ${selectorKey} = ${value}`, { selector: sel });
          return;
        }
      } catch {
        // Try selecting by label text instead
        try {
          await page.selectOption(sel, { label: value });
          logger.debug(`Selected ${selectorKey} by label = ${value}`, { selector: sel });
          return;
        } catch {
          continue;
        }
      }
    }

    logger.warn(`Could not find dropdown for ${selectorKey}`);
  }

  /**
   * Wait for results to appear after CAPTCHA solving
   * The operator solves CAPTCHA and clicks Search — we wait for the result container
   */
  private async waitForResults(page: Page): Promise<boolean> {
    const resultSelectors = getSelectorList('resultContainer');
    const noRecordSelectors = getSelectorList('noRecordMessage');
    const allSelectors = [...resultSelectors, ...noRecordSelectors].join(', ');

    try {
      // Wait for either result or no-record message to appear
      await page.waitForSelector(allSelectors, {
        state: 'visible',
        timeout: config.icp.captchaTimeoutMs + config.icp.resultTimeoutMs,
      });

      // Also wait for Angular to finish rendering
      await this.waitForAngular(page);
      await page.waitForTimeout(1000); // Extra buffer for rendering

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if "No record found" message is showing
   */
  private async checkNoRecord(page: Page): Promise<boolean> {
    const selectors = getSelectorList('noRecordMessage');

    for (const sel of selectors) {
      try {
        const element = await page.$(sel);
        if (element) {
          const visible = await element.isVisible();
          if (visible) return true;
        }
      } catch {
        continue;
      }
    }

    // Also check page text content
    const bodyText = await page.textContent('body') || '';
    if (bodyText.toLowerCase().includes('no record found') ||
        bodyText.includes('لا توجد نتائج')) {
      return true;
    }

    return false;
  }

  /**
   * Extract result data from the rendered page
   */
  private async extractResults(page: Page): Promise<{
    status: string;
    fileNumber: string;
    expiryDate: string;
    holderName: string;
    rawText: string;
  }> {
    const extract = async (selectorKey: 'statusField' | 'fileNumberField' | 'expiryField' | 'nameField'): Promise<string> => {
      const selectors = getSelectorList(selectorKey);
      for (const sel of selectors) {
        try {
          const element = await page.$(sel);
          if (element) {
            const text = await element.textContent();
            if (text && text.trim()) return text.trim();
          }
        } catch {
          continue;
        }
      }
      return '';
    };

    // Get full result container text for debugging
    let rawText = '';
    const resultSelectors = getSelectorList('resultContainer');
    for (const sel of resultSelectors) {
      try {
        const el = await page.$(sel);
        if (el) {
          rawText = (await el.textContent()) || '';
          if (rawText.trim()) break;
        }
      } catch {
        continue;
      }
    }

    return {
      status: await extract('statusField'),
      fileNumber: await extract('fileNumberField'),
      expiryDate: await extract('expiryField'),
      holderName: await extract('nameField'),
      rawText: rawText.substring(0, 500), // Limit for storage
    };
  }

  // ════════════════════════════════════════
  // STATUS NORMALIZATION
  // ════════════════════════════════════════

  /**
   * Map ICP portal status text to our internal status
   */
  private normalizeStatus(raw: string): string {
    const lower = raw.toLowerCase().trim();
    return STATUS_MAP[lower] || raw.toUpperCase().replace(/\s+/g, '_');
  }

  // ════════════════════════════════════════
  // DATABASE PERSISTENCE
  // ════════════════════════════════════════

  /**
   * Save ICP check result to database
   */
  private async saveResult(input: ICPCheckInput, result: ICPCheckResult): Promise<void> {
    if (!input.applicationId) {
      logger.debug('No applicationId — skipping DB save');
      return;
    }

    try {
      await prisma.visaApplication.update({
        where: { id: input.applicationId },
        data: {
          portalStatus: result.status !== 'ERROR' ? result.status : undefined,
          icpStatus: result.status,
          lastPortalSync: new Date(),
        },
      });

      // Update passenger ICP file number if found
      if (result.icpFileNumber) {
        const app = await prisma.visaApplication.findUnique({
          where: { id: input.applicationId },
          select: { passengerId: true },
        });
        if (app) {
          await prisma.passenger.update({
            where: { id: app.passengerId },
            data: { icpFileNumber: result.icpFileNumber },
          });
        }
      }

      logger.info('💾 ICP result saved to database', {
        applicationId: input.applicationId,
        status: result.status,
      });
    } catch (error: any) {
      logger.error('Failed to save ICP result', { error: error.message });
    }
  }

  /**
   * Log the automation action
   */
  private async logAutomation(input: ICPCheckInput, result: ICPCheckResult): Promise<void> {
    try {
      await prisma.automationLog.create({
        data: {
          workerId: 'icp-fetcher',
          jobQueue: 'icp_status_check',
          action: 'ICP_STATUS_CHECK',
          status: result.success ? 'SUCCESS' : 'FAILED',
          durationMs: result.durationMs,
          errorMessage: result.errorMessage || null,
          passportHash: input.passportNumber.substring(0, 3) + '***',
        },
      });
    } catch (error: any) {
      logger.error('Failed to log automation', { error: error.message });
    }
  }

  // ════════════════════════════════════════
  // ERROR CLASSIFICATION
  // ════════════════════════════════════════

  private classifyError(error: any): string {
    const msg = error.message?.toLowerCase() || '';
    if (msg.includes('timeout') || msg.includes('timed out')) return 'RESULT_TIMEOUT';
    if (msg.includes('net::') || msg.includes('navigation')) return 'PORTAL_UNREACHABLE';
    if (msg.includes('selector') || msg.includes('not found')) return 'FORM_NOT_FOUND';
    if (msg.includes('session') || msg.includes('context')) return 'SESSION_EXPIRED';
    return 'UNKNOWN_ERROR';
  }

  /**
   * Get scraper status for admin dashboard
   */
  getStatus() {
    return {
      session: icpSessionManager.getStatus(),
      circuitBreaker: icpCircuitBreaker.getStatus(),
      rateLimit: {
        checksThisHour,
        maxPerHour: config.icp.maxChecksPerHour,
        lastCheck: lastCheckTime ? new Date(lastCheckTime).toISOString() : null,
      },
    };
  }

  /**
   * Shutdown the browser
   */
  async shutdown(): Promise<void> {
    await icpSessionManager.shutdown();
  }
}

// Singleton
export const icpStatusFetcher = new ICPStatusFetcher();
