// ============================================================
// ICP Session Manager — Single browser lifecycle for ICP portal
// Simple: one browser, one page, reusable across checks
// Headful by default for manual CAPTCHA solving
// ============================================================

import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { logger } from '../lib/logger';
import { config } from '../config';
import path from 'path';
import fs from 'fs';

export class ICPSessionManager {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private screenshotDir: string;

  constructor() {
    this.screenshotDir = config.icp.screenshotDir;
    // Ensure screenshot directory exists
    if (!fs.existsSync(this.screenshotDir)) {
      fs.mkdirSync(this.screenshotDir, { recursive: true });
    }
  }

  /**
   * Launch the browser (headful for CAPTCHA solving)
   */
  async initialize(): Promise<void> {
    if (this.browser && this.browser.isConnected()) {
      logger.debug('ICP browser already running');
      return;
    }

    logger.info('🚀 Launching ICP browser...');

    this.browser = await chromium.launch({
      headless: config.icp.headless,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        '--window-size=1280,900',
      ],
      slowMo: 50, // Slight delay for human-like behavior
    });

    this.context = await this.browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 900 },
      locale: 'en-US',
      timezoneId: 'Asia/Dubai',
      javaScriptEnabled: true,
    });

    // Remove webdriver flag
    await this.context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    this.page = await this.context.newPage();

    logger.info('✅ ICP browser launched successfully', {
      headless: config.icp.headless,
    });
  }

  /**
   * Get the active page (creates one if needed)
   */
  async getPage(): Promise<Page> {
    if (!this.browser || !this.browser.isConnected()) {
      await this.initialize();
    }

    if (!this.page || this.page.isClosed()) {
      this.page = await this.context!.newPage();
    }

    return this.page!;
  }

  /**
   * Take a screenshot for debugging
   */
  async screenshot(name: string): Promise<string> {
    if (!this.page || this.page.isClosed()) {
      logger.warn('Cannot take screenshot — no active page');
      return '';
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${timestamp}-${name}.png`;
    const filepath = path.join(this.screenshotDir, filename);

    try {
      await this.page.screenshot({ path: filepath, fullPage: true });
      logger.info(`📸 Screenshot saved: ${filename}`);
      return filepath;
    } catch (error: any) {
      logger.error('Screenshot failed', { error: error.message });
      return '';
    }
  }

  /**
   * Check if browser is ready
   */
  isReady(): boolean {
    return !!(this.browser && this.browser.isConnected() && this.page && !this.page.isClosed());
  }

  /**
   * Get session status info
   */
  getStatus(): { ready: boolean; browserConnected: boolean; pageOpen: boolean } {
    return {
      ready: this.isReady(),
      browserConnected: !!(this.browser && this.browser.isConnected()),
      pageOpen: !!(this.page && !this.page.isClosed()),
    };
  }

  /**
   * Close everything cleanly
   */
  async shutdown(): Promise<void> {
    try {
      if (this.page && !this.page.isClosed()) {
        await this.page.close();
      }
      if (this.context) {
        await this.context.close();
      }
      if (this.browser) {
        await this.browser.close();
      }
    } catch (error: any) {
      logger.error('Error during ICP browser shutdown', { error: error.message });
    } finally {
      this.page = null;
      this.context = null;
      this.browser = null;
      logger.info('ICP browser shut down');
    }
  }
}

// Singleton
export const icpSessionManager = new ICPSessionManager();
