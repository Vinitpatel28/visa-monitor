// ============================================================
// Status Fetcher — Extracts visa status from government portal
// Uses XHR interception (more reliable than HTML scraping)
// ============================================================

import { Page, Response as PlaywrightResponse } from 'playwright';
import { logger } from '../lib/logger';
import { sessionManager, PortalCredentials } from './BrowserSessionManager';

export interface PortalStatusResult {
  passportNumber: string;
  portalStatus: string;
  visaNumber?: string;
  expiryDate?: string;
  entryDate?: string;
  rawData?: Record<string, any>;
  fetchedAt: Date;
  source: 'XHR_INTERCEPT' | 'HTML_PARSE' | 'MOCK';
}

export interface StatusFetchOptions {
  timeout?: number;
  retries?: number;
  captureScreenshot?: boolean;
}

const DEFAULT_OPTIONS: StatusFetchOptions = {
  timeout: 30000,
  retries: 3,
  captureScreenshot: true,
};

/**
 * StatusFetcher
 * 
 * Fetches visa status from the government portal by:
 * 1. Navigating to the status lookup page
 * 2. Intercepting XHR/API responses (preferred — structured JSON)
 * 3. Falling back to HTML parsing if XHR intercept fails
 */
export class StatusFetcher {
  private credentials: PortalCredentials;

  constructor(credentials: PortalCredentials) {
    this.credentials = credentials;
  }

  /**
   * Fetch visa status for a single passport number
   */
  async fetchStatus(
    passportNumber: string,
    options: StatusFetchOptions = {}
  ): Promise<PortalStatusResult> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= opts.retries!; attempt++) {
      try {
        logger.info(`📡 Fetching portal status (attempt ${attempt}/${opts.retries})`, {
          passport: passportNumber.substring(0, 3) + '***',
        });

        const result = await this.doFetch(passportNumber, opts);

        logger.info('✅ Portal status fetched', {
          passport: passportNumber.substring(0, 3) + '***',
          status: result.portalStatus,
          source: result.source,
        });

        return result;

      } catch (error: any) {
        lastError = error;
        logger.warn(`⚠️ Fetch attempt ${attempt} failed`, {
          passport: passportNumber.substring(0, 3) + '***',
          error: error.message,
          attempt,
        });

        if (attempt < opts.retries!) {
          // Exponential backoff: 2s, 4s, 8s...
          const delay = Math.pow(2, attempt) * 1000;
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }

    throw new Error(`Status fetch failed after ${opts.retries} attempts: ${lastError?.message}`);
  }

  /**
   * Fetch status for multiple passport numbers (batch)
   */
  async fetchBatch(
    passportNumbers: string[],
    options: StatusFetchOptions = {}
  ): Promise<Map<string, PortalStatusResult>> {
    const results = new Map<string, PortalStatusResult>();

    for (const passport of passportNumbers) {
      try {
        const result = await this.fetchStatus(passport, options);
        results.set(passport, result);

        // Small delay between requests to avoid rate limiting
        await new Promise(r => setTimeout(r, this.randomBetween(2000, 5000)));
      } catch (error: any) {
        logger.error('Failed to fetch status for passport', {
          passport: passport.substring(0, 3) + '***',
          error: error.message,
        });

        results.set(passport, {
          passportNumber: passport,
          portalStatus: 'FETCH_FAILED',
          fetchedAt: new Date(),
          source: 'XHR_INTERCEPT',
          rawData: { error: error.message },
        });
      }
    }

    return results;
  }

  /**
   * Core fetch implementation using XHR interception
   */
  private async doFetch(
    passportNumber: string,
    options: StatusFetchOptions
  ): Promise<PortalStatusResult> {
    const session = await sessionManager.getSession(this.credentials);
    const page = session.page;

    // Set up XHR response interception
    let interceptedData: any = null;

    const responseHandler = async (response: PlaywrightResponse) => {
      const url = response.url();
      // Intercept status API calls from the portal
      if (
        url.includes('/api/visa/status') ||
        url.includes('/visaStatus') ||
        url.includes('/status-check') ||
        url.includes('/passport/lookup') ||
        url.includes('/api/check')
      ) {
        try {
          const contentType = response.headers()['content-type'] || '';
          if (contentType.includes('json')) {
            interceptedData = await response.json();
          }
        } catch {
          // Response might not be JSON
        }
      }
    };

    page.on('response', responseHandler);

    try {
      // Navigate to status lookup page
      const statusUrl = `${this.credentials.portalUrl}/status-check`;
      await page.goto(statusUrl, {
        waitUntil: 'networkidle',
        timeout: options.timeout,
      });

      // Wait for the search form
      await page.waitForSelector(
        'input[name="passport"], #passportNumber, [data-field="passport"]',
        { timeout: 10000 }
      );

      // Fill passport number with human-like typing
      const input = await page.$('input[name="passport"]') ||
        await page.$('#passportNumber') ||
        await page.$('[data-field="passport"]');

      if (input) {
        await input.click();
        await input.fill(''); // Clear existing
        await input.type(passportNumber, { delay: this.randomBetween(30, 80) });
      }

      await new Promise(r => setTimeout(r, this.randomBetween(500, 1000)));

      // Click search button
      const searchBtn = await page.$('button[type="submit"], .search-btn, button:has-text("Search"), button:has-text("Check")');
      if (searchBtn) {
        await searchBtn.click();
      }

      // Wait for results (either XHR intercept or DOM update)
      await Promise.race([
        page.waitForSelector('.status-result, .visa-status, [data-status]', { timeout: 15000 }),
        new Promise(r => setTimeout(r, 10000)), // Fallback timeout
      ]);

      // Wait a bit more for XHR to complete
      await new Promise(r => setTimeout(r, 2000));

      // Method 1: Use intercepted XHR data (preferred)
      if (interceptedData) {
        return this.parseXHRResponse(passportNumber, interceptedData);
      }

      // Method 2: Parse from HTML (fallback)
      return await this.parseHTMLStatus(passportNumber, page);

    } finally {
      page.removeListener('response', responseHandler);
    }
  }

  /**
   * Parse status from intercepted XHR API response
   */
  private parseXHRResponse(passportNumber: string, data: any): PortalStatusResult {
    // Handle various response formats
    const status = data.status || data.visaStatus || data.visa_status ||
      data.data?.status || data.result?.status || 'UNKNOWN';

    return {
      passportNumber,
      portalStatus: this.normalizeStatus(String(status)),
      visaNumber: data.visaNumber || data.visa_number || data.data?.visaNumber,
      expiryDate: data.expiryDate || data.expiry_date || data.data?.expiryDate,
      entryDate: data.entryDate || data.entry_date || data.data?.entryDate,
      rawData: data,
      fetchedAt: new Date(),
      source: 'XHR_INTERCEPT',
    };
  }

  /**
   * Parse status from HTML DOM (fallback method)
   */
  private async parseHTMLStatus(passportNumber: string, page: Page): Promise<PortalStatusResult> {
    const statusText = await page.evaluate(() => {
      // Try various selectors
      const selectors = [
        '.status-result', '.visa-status', '[data-status]',
        '.result-status', '#statusResult', '.status-value',
      ];

      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) {
          return (el as HTMLElement).textContent?.trim() || el.getAttribute('data-status') || '';
        }
      }
      return '';
    });

    if (!statusText) {
      // Take screenshot for debugging
      await sessionManager.captureScreenshot(page, `no-status-${passportNumber.substring(0, 3)}`);
      throw new Error('Could not find status in portal page');
    }

    return {
      passportNumber,
      portalStatus: this.normalizeStatus(statusText),
      fetchedAt: new Date(),
      source: 'HTML_PARSE',
    };
  }

  /**
   * Normalize status strings from various portal formats
   */
  private normalizeStatus(raw: string): string {
    const normalized = raw.toUpperCase().trim();

    // Map common portal statuses to our internal format
    const statusMap: Record<string, string> = {
      'ACTIVE': 'ACTIVE',
      'VALID': 'ACTIVE',
      'IN COUNTRY': 'IN_COUNTRY',
      'IN_COUNTRY': 'IN_COUNTRY',
      'INSIDE': 'IN_COUNTRY',
      'PRESENT': 'IN_COUNTRY',
      'EXITED': 'EXITED',
      'EXIT': 'EXITED',
      'DEPARTED': 'EXITED',
      'LEFT': 'EXITED',
      'OUTSIDE': 'EXITED',
      'EXPIRED': 'EXPIRED',
      'CANCELLED': 'CANCELLED',
      'CANCELED': 'CANCELLED',
      'REVOKED': 'CANCELLED',
      'PENDING': 'PENDING',
      'PROCESSING': 'PENDING',
      'APPROVED': 'APPROVED',
      'REJECTED': 'REJECTED',
      'DENIED': 'REJECTED',
    };

    return statusMap[normalized] || normalized;
  }

  private randomBetween(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
}
