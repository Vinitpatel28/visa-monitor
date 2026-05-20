// ============================================================
// GDRFA Status Fetcher — Real Dubai Government Portal Scraper
// Targets: smart.gdrfad.gov.ae/Public_Th/StatusInquiry_New.aspx
// No login required — uses the public Status Inquiry page
// ============================================================

import { chromium, Browser, Page, BrowserContext } from 'playwright';
import { logger } from '../lib/logger';

// ========================
// TYPES
// ========================

export interface GDRFAStatusResult {
  passportNumber: string;
  fileNumber?: string;
  portalStatus: string;
  visaType?: string;
  expiryDate?: string;
  profession?: string;
  nationality?: string;
  sponsorName?: string;
  rawText?: string;
  fetchedAt: Date;
  source: 'GDRFA_PUBLIC';
  success: boolean;
  errorMessage?: string;
}

export interface GDRFAFetchOptions {
  timeout?: number;
  retries?: number;
  headless?: boolean;
  delayBetweenActions?: [number, number]; // [min, max] ms
}

const DEFAULT_OPTIONS: GDRFAFetchOptions = {
  timeout: 45000,
  retries: 3,
  headless: true,
  delayBetweenActions: [1500, 4000],
};

// ========================
// GDRFA PUBLIC STATUS URL
// ========================
const GDRFA_STATUS_URL =
  'https://smart.gdrfad.gov.ae/Public_Th/StatusInquiry_New.aspx?GdfraLocale=en-US';

/**
 * GDRFAStatusFetcher
 *
 * Automates the public GDRFA "Status Inquiry" page using Playwright.
 * This page does NOT require login — it accepts a File Number
 * and returns visa/permit status, expiry dates, etc.
 *
 * Technical notes:
 *  - The portal runs ASP.NET Web Forms (__doPostBack, __VIEWSTATE)
 *  - Forms are rendered client-side via JavaScript
 *  - Cloudflare protection is present — we use stealth techniques
 *  - Default language is Arabic — we force English via ?GdfraLocale=en-US
 */
export class GDRFAStatusFetcher {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;

  /**
   * Initialize the browser with stealth settings
   */
  async initialize(headless = true): Promise<void> {
    if (this.browser) return;

    logger.info('🚀 Launching stealth browser for GDRFA...');

    this.browser = await chromium.launch({
      headless,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        '--window-size=1920,1080',
      ],
    });

    this.context = await this.browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      locale: 'en-US',
      timezoneId: 'Asia/Dubai',
      permissions: [],
      javaScriptEnabled: true,
    });

    // Remove the "webdriver" flag that bot detectors check
    await this.context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      // Override plugins length
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
      });
      // Override languages
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en', 'ar'],
      });
    });

    logger.info('✅ Stealth browser ready');
  }

  /**
   * Fetch visa status for a single file number from GDRFA public portal
   */
  async fetchByFileNumber(
    fileNumber: string,
    options: GDRFAFetchOptions = {}
  ): Promise<GDRFAStatusResult> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= opts.retries!; attempt++) {
      try {
        logger.info(
          `📡 GDRFA fetch attempt ${attempt}/${opts.retries} for file: ${fileNumber.substring(0, 4)}***`
        );

        const result = await this.doFetchByFileNumber(fileNumber, opts);

        logger.info('✅ GDRFA status fetched', {
          file: fileNumber.substring(0, 4) + '***',
          status: result.portalStatus,
        });

        return result;
      } catch (error: any) {
        lastError = error;
        logger.warn(`⚠️ GDRFA fetch attempt ${attempt} failed: ${error.message}`);

        if (attempt < opts.retries!) {
          const delay = Math.pow(2, attempt) * 2000; // 4s, 8s, 16s
          logger.info(`   Retrying in ${delay / 1000}s...`);
          await this.sleep(delay);
        }
      }
    }

    return {
      passportNumber: '',
      fileNumber,
      portalStatus: 'FETCH_FAILED',
      fetchedAt: new Date(),
      source: 'GDRFA_PUBLIC',
      success: false,
      errorMessage: lastError?.message || 'Unknown error',
    };
  }

  /**
   * Fetch visa status for a passport number from GDRFA public portal
   */
  async fetchByPassport(
    passportNumber: string,
    options: GDRFAFetchOptions = {}
  ): Promise<GDRFAStatusResult> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= opts.retries!; attempt++) {
      try {
        logger.info(
          `📡 GDRFA fetch attempt ${attempt}/${opts.retries} for passport: ${passportNumber.substring(0, 3)}***`
        );

        const result = await this.doFetchByPassport(passportNumber, opts);

        logger.info('✅ GDRFA status fetched', {
          passport: passportNumber.substring(0, 3) + '***',
          status: result.portalStatus,
        });

        return result;
      } catch (error: any) {
        lastError = error;
        logger.warn(`⚠️ GDRFA fetch attempt ${attempt} failed: ${error.message}`);

        if (attempt < opts.retries!) {
          const delay = Math.pow(2, attempt) * 2000;
          await this.sleep(delay);
        }
      }
    }

    return {
      passportNumber,
      portalStatus: 'FETCH_FAILED',
      fetchedAt: new Date(),
      source: 'GDRFA_PUBLIC',
      success: false,
      errorMessage: lastError?.message || 'Unknown error',
    };
  }

  /**
   * Batch fetch for multiple file numbers
   */
  async fetchBatch(
    fileNumbers: string[],
    options: GDRFAFetchOptions = {}
  ): Promise<Map<string, GDRFAStatusResult>> {
    const results = new Map<string, GDRFAStatusResult>();

    await this.initialize(options.headless ?? true);

    for (const fileNum of fileNumbers) {
      const result = await this.fetchByFileNumber(fileNum, options);
      results.set(fileNum, result);

      // Random delay between requests to avoid rate limiting
      const delay = this.randomBetween(5000, 12000);
      logger.debug(`   Waiting ${(delay / 1000).toFixed(1)}s before next request...`);
      await this.sleep(delay);
    }

    return results;
  }

  // ════════════════════════════════════════
  // CORE FETCH IMPLEMENTATIONS
  // ════════════════════════════════════════

  /**
   * Navigate to GDRFA, fill file number, submit, and extract result
   */
  private async doFetchByFileNumber(
    fileNumber: string,
    options: GDRFAFetchOptions
  ): Promise<GDRFAStatusResult> {
    await this.initialize(options.headless);
    const page = await this.context!.newPage();

    try {
      // Step 1: Navigate to the Status Inquiry page
      logger.debug('   Step 1: Navigating to GDRFA Status Inquiry...');
      await page.goto(GDRFA_STATUS_URL, {
        waitUntil: 'networkidle',
        timeout: options.timeout,
      });

      await this.humanDelay(options.delayBetweenActions!);

      // Step 2: Wait for the form to load (ASP.NET renders it via JS)
      logger.debug('   Step 2: Waiting for form to render...');
      await this.waitForForm(page, options.timeout!);

      // Step 3: Select "File Number" search type if there's a radio/tab
      logger.debug('   Step 3: Selecting search type...');
      await this.selectSearchType(page, 'FILE_NUMBER');
      await this.humanDelay(options.delayBetweenActions!);

      // Step 4: Fill in the file number with human-like typing
      logger.debug(`   Step 4: Typing file number ${fileNumber.substring(0, 4)}***`);
      await this.fillSearchInput(page, fileNumber, options.delayBetweenActions!);
      await this.humanDelay(options.delayBetweenActions!);

      // Step 5: Click the Search button
      logger.debug('   Step 5: Clicking Search...');
      await this.clickSearch(page);

      // Step 6: Wait for results to appear
      logger.debug('   Step 6: Waiting for results...');
      await this.waitForResults(page, options.timeout!);

      // Step 7: Extract the status data from the result area
      logger.debug('   Step 7: Extracting status data...');
      const result = await this.extractStatusResult(page);

      return {
        passportNumber: result.passportNumber || '',
        portalStatus: result.portalStatus || 'UNKNOWN',
        visaType: result.visaType,
        expiryDate: result.expiryDate,
        profession: result.profession,
        nationality: result.nationality,
        sponsorName: result.sponsorName,
        rawText: result.rawText,
        fileNumber,
        fetchedAt: new Date(),
        source: 'GDRFA_PUBLIC',
        success: true,
      };
    } catch (error: any) {
      // Take a debug screenshot on failure
      try {
        const screenshotPath = `screenshots/gdrfa-error-${Date.now()}.png`;
        await page.screenshot({ path: screenshotPath, fullPage: true });
        logger.debug(`   Debug screenshot saved: ${screenshotPath}`);
      } catch { /* ignore screenshot errors */ }

      throw error;
    } finally {
      await page.close();
    }
  }

  /**
   * Navigate to GDRFA, fill passport number, submit, and extract result
   */
  private async doFetchByPassport(
    passportNumber: string,
    options: GDRFAFetchOptions
  ): Promise<GDRFAStatusResult> {
    await this.initialize(options.headless);
    const page = await this.context!.newPage();

    try {
      logger.debug('   Step 1: Navigating to GDRFA Status Inquiry...');
      await page.goto(GDRFA_STATUS_URL, {
        waitUntil: 'networkidle',
        timeout: options.timeout,
      });

      await this.humanDelay(options.delayBetweenActions!);

      logger.debug('   Step 2: Waiting for form to render...');
      await this.waitForForm(page, options.timeout!);

      logger.debug('   Step 3: Selecting passport search type...');
      await this.selectSearchType(page, 'PASSPORT');
      await this.humanDelay(options.delayBetweenActions!);

      logger.debug(`   Step 4: Typing passport ${passportNumber.substring(0, 3)}***`);
      await this.fillSearchInput(page, passportNumber, options.delayBetweenActions!);
      await this.humanDelay(options.delayBetweenActions!);

      logger.debug('   Step 5: Clicking Search...');
      await this.clickSearch(page);

      logger.debug('   Step 6: Waiting for results...');
      await this.waitForResults(page, options.timeout!);

      logger.debug('   Step 7: Extracting status data...');
      const result = await this.extractStatusResult(page);

      return {
        passportNumber,
        portalStatus: result.portalStatus || 'UNKNOWN',
        visaType: result.visaType,
        expiryDate: result.expiryDate,
        profession: result.profession,
        nationality: result.nationality,
        sponsorName: result.sponsorName,
        rawText: result.rawText,
        fileNumber: result.fileNumber,
        fetchedAt: new Date(),
        source: 'GDRFA_PUBLIC',
        success: true,
      };
    } catch (error: any) {
      try {
        const screenshotPath = `screenshots/gdrfa-error-${Date.now()}.png`;
        await page.screenshot({ path: screenshotPath, fullPage: true });
      } catch { /* ignore */ }

      throw error;
    } finally {
      await page.close();
    }
  }

  // ════════════════════════════════════════
  // FORM INTERACTION HELPERS
  // ════════════════════════════════════════

  /**
   * Wait for the ASP.NET form to fully render (JS-loaded)
   */
  private async waitForForm(page: Page, timeout: number): Promise<void> {
    // The GDRFA Smart Services form renders dynamically.
    // We look for common ASP.NET form elements and input fields.
    await page.waitForFunction(
      () => {
        const inputs = document.querySelectorAll('input[type="text"], input[type="search"]');
        const selects = document.querySelectorAll('select');
        const buttons = document.querySelectorAll('input[type="submit"], button[type="submit"], a.ThemeGrid_Width6');
        // Form is ready when we see at least one input and one clickable element
        return inputs.length > 0 || selects.length > 0 || buttons.length > 0;
      },
      { timeout }
    );
  }

  /**
   * Select the search type (File Number vs Passport vs Visa Number)
   * GDRFA typically has radio buttons or tabs to toggle between search modes
   */
  private async selectSearchType(page: Page, type: 'FILE_NUMBER' | 'PASSPORT'): Promise<void> {
    // Try common ASP.NET patterns for search type selection
    const selectors: Record<string, string[]> = {
      FILE_NUMBER: [
        // Radio buttons
        'input[type="radio"][value*="file" i]',
        'input[type="radio"][value*="File" i]',
        'label:has-text("File Number")',
        'label:has-text("file number")',
        // Tabs
        'a:has-text("File Number")',
        'span:has-text("File Number")',
        '[data-tab*="file" i]',
      ],
      PASSPORT: [
        'input[type="radio"][value*="passport" i]',
        'input[type="radio"][value*="Passport" i]',
        'label:has-text("Passport")',
        'a:has-text("Passport")',
        'span:has-text("Passport")',
        '[data-tab*="passport" i]',
      ],
    };

    for (const selector of selectors[type]) {
      try {
        const element = await page.$(selector);
        if (element) {
          await element.click();
          logger.debug(`   Selected search type "${type}" via: ${selector}`);
          return;
        }
      } catch { /* try next selector */ }
    }

    // If no explicit selector found, try the first available search input
    logger.debug(`   No explicit search type toggle found — using default form`);
  }

  /**
   * Fill the search input field with human-like typing
   */
  private async fillSearchInput(
    page: Page,
    value: string,
    delayRange: [number, number]
  ): Promise<void> {
    // Try multiple selectors for the main input field
    const inputSelectors = [
      // ASP.NET-style IDs (common on GDRFA)
      'input[id*="txtSearch" i]',
      'input[id*="FileNumber" i]',
      'input[id*="PassportNumber" i]',
      'input[id*="SearchValue" i]',
      'input[id*="txtValue" i]',
      'input[id*="txtFileNo" i]',
      // Generic patterns
      'input[type="text"]:not([style*="display: none"])',
      'input[type="search"]',
      'input[placeholder*="file" i]',
      'input[placeholder*="passport" i]',
      'input[placeholder*="number" i]',
      'input[placeholder*="search" i]',
      // ASP.NET ContentPlaceHolder pattern
      'input[id*="ContentPlaceHolder"]',
    ];

    for (const selector of inputSelectors) {
      try {
        const input = await page.$(selector);
        if (input && await input.isVisible()) {
          await input.click();
          await this.sleep(300);
          await input.fill(''); // Clear
          // Type with human-like delays
          for (const char of value) {
            await input.type(char, { delay: this.randomBetween(40, 120) });
          }
          logger.debug(`   Filled input via: ${selector}`);
          return;
        }
      } catch { /* try next */ }
    }

    throw new Error('Could not find the search input field on the GDRFA page');
  }

  /**
   * Click the Search/Submit button
   */
  private async clickSearch(page: Page): Promise<void> {
    const buttonSelectors = [
      // ASP.NET button patterns
      'input[type="submit"]',
      'input[value*="Search" i]',
      'input[value*="Inquire" i]',
      'input[value*="Check" i]',
      'input[id*="btnSearch" i]',
      'input[id*="btnSubmit" i]',
      'input[id*="btnInquiry" i]',
      // Link-buttons (common in ASP.NET)
      'a:has-text("Search")',
      'a:has-text("Inquire")',
      'a:has-text("Check Status")',
      'a.ThemeGrid_Width6',
      // Standard buttons
      'button:has-text("Search")',
      'button:has-text("Inquire")',
      'button[type="submit"]',
    ];

    for (const selector of buttonSelectors) {
      try {
        const btn = await page.$(selector);
        if (btn && await btn.isVisible()) {
          await btn.click();
          logger.debug(`   Clicked search via: ${selector}`);
          return;
        }
      } catch { /* try next */ }
    }

    // Last resort: press Enter on the input field
    logger.debug('   No button found — pressing Enter...');
    await page.keyboard.press('Enter');
  }

  /**
   * Wait for results to appear after form submission
   */
  private async waitForResults(page: Page, timeout: number): Promise<void> {
    // ASP.NET typically does a full postback or UpdatePanel partial postback
    // Wait for either: new content to appear, or the page to reload
    try {
      await Promise.race([
        // Wait for a result container
        page.waitForFunction(
          () => {
            const body = document.body.innerText;
            return (
              body.includes('Status') ||
              body.includes('Valid') ||
              body.includes('Active') ||
              body.includes('Expired') ||
              body.includes('Cancelled') ||
              body.includes('No record') ||
              body.includes('not found') ||
              body.includes('الحالة') // Arabic for "status"
            );
          },
          { timeout }
        ),
        // Wait for any loading indicators to disappear
        page.waitForLoadState('networkidle', { timeout }),
      ]);
    } catch {
      // Even if the wait times out, try to extract whatever is on the page
      logger.warn('   Result wait timed out — attempting extraction anyway');
    }

    // Extra wait for AJAX responses to settle
    await this.sleep(2000);
  }

  /**
   * Extract visa status information from the results page
   */
  private async extractStatusResult(page: Page): Promise<Partial<GDRFAStatusResult>> {
    // Try XHR interception first — check if any API call was made
    const pageContent = await page.content();
    const pageText = await page.evaluate(() => document.body.innerText);

    // Check for "no record found" scenarios
    const noRecordPatterns = [
      'no record', 'not found', 'no data', 'no result',
      'لا توجد بيانات', 'لم يتم العثور', // Arabic equivalents
    ];
    for (const pattern of noRecordPatterns) {
      if (pageText.toLowerCase().includes(pattern.toLowerCase())) {
        return {
          passportNumber: '',
          portalStatus: 'NOT_FOUND',
          rawText: pageText.substring(0, 500),
        };
      }
    }

    // Extract structured data from the results
    const extractedData = await page.evaluate(() => {
      const data: Record<string, string> = {};

      // Method 1: Look for table rows with label-value pairs
      const rows = document.querySelectorAll('tr, .row, [class*="row"], [class*="Row"]');
      rows.forEach((row) => {
        const cells = row.querySelectorAll('td, .col, [class*="col"], span, label');
        if (cells.length >= 2) {
          const label = (cells[0] as HTMLElement).innerText?.trim() || '';
          const value = (cells[1] as HTMLElement).innerText?.trim() || '';
          if (label && value && label.length < 50) {
            data[label] = value;
          }
        }
      });

      // Method 2: Look for definition lists or key-value divs
      const labels = document.querySelectorAll('label, .label, [class*="label" i], [class*="Label" i]');
      labels.forEach((label) => {
        const labelText = (label as HTMLElement).innerText?.trim();
        const nextSibling = label.nextElementSibling;
        if (labelText && nextSibling) {
          const valueText = (nextSibling as HTMLElement).innerText?.trim();
          if (valueText) {
            data[labelText] = valueText;
          }
        }
      });

      // Method 3: Look for spans with specific IDs (ASP.NET pattern)
      const spans = document.querySelectorAll('span[id*="lbl"], span[id*="Lbl"], span[id*="txt"]');
      spans.forEach((span) => {
        const id = span.id;
        const text = (span as HTMLElement).innerText?.trim();
        if (id && text) {
          data[id] = text;
        }
      });

      return data;
    });

    // Parse the extracted data into our structured format
    const result = this.parseExtractedData(extractedData, pageText);

    return result;
  }

  /**
   * Parse raw extracted key-value data into a structured GDRFAStatusResult
   */
  private parseExtractedData(
    data: Record<string, string>,
    fullText: string
  ): Partial<GDRFAStatusResult> {
    // Status keywords to look for (English and Arabic)
    const statusKeywords: Record<string, string> = {
      // English
      'valid': 'ACTIVE',
      'active': 'ACTIVE',
      'in force': 'ACTIVE',
      'expired': 'EXPIRED',
      'cancelled': 'CANCELLED',
      'canceled': 'CANCELLED',
      'used': 'USED',
      'closed': 'CLOSED',
      'pending': 'PENDING',
      'under process': 'PENDING',
      'rejected': 'REJECTED',
      // Arabic
      'سارية': 'ACTIVE',       // Valid
      'ساري': 'ACTIVE',        // Valid
      'منتهية': 'EXPIRED',     // Expired
      'ملغاة': 'CANCELLED',    // Cancelled
      'مستخدمة': 'USED',       // Used
      'مغلق': 'CLOSED',       // Closed
      'قيد المعالجة': 'PENDING', // Under process
    };

    // Try to find the status from extracted data
    let portalStatus = 'UNKNOWN';
    let visaType = '';
    let expiryDate = '';
    let profession = '';
    let nationality = '';
    let sponsorName = '';

    // Check all extracted key-value pairs
    for (const [key, value] of Object.entries(data)) {
      const keyLower = key.toLowerCase();
      const valueLower = value.toLowerCase();

      // Status
      if (keyLower.includes('status') || keyLower.includes('الحالة') || keyLower.includes('validity')) {
        for (const [keyword, mappedStatus] of Object.entries(statusKeywords)) {
          if (valueLower.includes(keyword)) {
            portalStatus = mappedStatus;
            break;
          }
        }
        if (portalStatus === 'UNKNOWN') {
          portalStatus = value.toUpperCase().trim();
        }
      }

      // Visa type
      if (keyLower.includes('type') || keyLower.includes('permit') || keyLower.includes('نوع')) {
        visaType = value;
      }

      // Expiry date
      if (keyLower.includes('expir') || keyLower.includes('valid') || keyLower.includes('تاريخ')) {
        if (value.match(/\d{2}[\/\-]\d{2}[\/\-]\d{4}/)) {
          expiryDate = value;
        }
      }

      // Profession
      if (keyLower.includes('profession') || keyLower.includes('المهنة') || keyLower.includes('occupation')) {
        profession = value;
      }

      // Nationality
      if (keyLower.includes('national') || keyLower.includes('الجنسية')) {
        nationality = value;
      }

      // Sponsor
      if (keyLower.includes('sponsor') || keyLower.includes('الكفيل') || keyLower.includes('employer')) {
        sponsorName = value;
      }
    }

    // If we still don't have a status, search the full page text
    if (portalStatus === 'UNKNOWN') {
      const textLower = fullText.toLowerCase();
      for (const [keyword, mappedStatus] of Object.entries(statusKeywords)) {
        if (textLower.includes(keyword)) {
          portalStatus = mappedStatus;
          break;
        }
      }
    }

    return {
      passportNumber: '',
      portalStatus,
      visaType: visaType || undefined,
      expiryDate: expiryDate || undefined,
      profession: profession || undefined,
      nationality: nationality || undefined,
      sponsorName: sponsorName || undefined,
      rawText: fullText.substring(0, 1000),
    };
  }

  // ════════════════════════════════════════
  // UTILITY HELPERS
  // ════════════════════════════════════════

  private async humanDelay(range: [number, number]): Promise<void> {
    const delay = this.randomBetween(range[0], range[1]);
    await this.sleep(delay);
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private randomBetween(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * Gracefully close the browser
   */
  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.context = null;
      logger.info('🔒 GDRFA browser session closed');
    }
  }
}

// Export a singleton instance
export const gdrfaFetcher = new GDRFAStatusFetcher();
