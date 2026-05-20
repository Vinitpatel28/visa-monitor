// ============================================================
// Browser Session Manager — Manages authenticated browser pools
// Handles login, session persistence, keep-alive, and rotation
// ============================================================

import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { logger } from '../lib/logger';
import { cache } from '../lib/redis';
import { config } from '../config';
import path from 'path';
import fs from 'fs';

export interface PortalCredentials {
  accountId: string;
  username: string;
  password: string;
  portalUrl: string;
}

export interface SessionInfo {
  accountId: string;
  context: BrowserContext;
  page: Page;
  createdAt: Date;
  lastUsed: Date;
  isAlive: boolean;
}

/**
 * BrowserSessionManager
 * 
 * Maintains a pool of authenticated browser sessions against
 * government portals. Features:
 * - Session pooling and reuse
 * - Cookie persistence in Redis
 * - Keep-alive pings
 * - Automatic re-authentication on session expiry
 * - Screenshot capture on failures
 */
export class BrowserSessionManager {
  private browser: Browser | null = null;
  private sessions: Map<string, SessionInfo> = new Map();
  private keepAliveIntervals: Map<string, NodeJS.Timeout> = new Map();

  private readonly screenshotDir: string;
  private readonly sessionTTL = 25 * 60; // 25 minutes
  private readonly keepAliveInterval = 10 * 60 * 1000; // 10 minutes

  constructor() {
    this.screenshotDir = path.join(process.cwd(), 'screenshots');
    if (!fs.existsSync(this.screenshotDir)) {
      fs.mkdirSync(this.screenshotDir, { recursive: true });
    }
  }

  /**
   * Initialize the browser instance
   */
  async initialize(): Promise<void> {
    if (this.browser) return;

    this.browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
      ],
    });

    logger.info('🌐 Browser instance launched');
  }

  /**
   * Get or create an authenticated session for an account
   */
  async getSession(credentials: PortalCredentials): Promise<SessionInfo> {
    // Check existing session
    const existing = this.sessions.get(credentials.accountId);
    if (existing && existing.isAlive) {
      const alive = await this.isSessionAlive(existing);
      if (alive) {
        existing.lastUsed = new Date();
        return existing;
      }
      logger.warn('Session expired, re-authenticating', { accountId: credentials.accountId });
    }

    // Try restore from Redis cache
    const restored = await this.restoreSession(credentials);
    if (restored) return restored;

    // Create new session
    return this.createSession(credentials);
  }

  /**
   * Create a new authenticated browser session
   */
  private async createSession(credentials: PortalCredentials): Promise<SessionInfo> {
    await this.initialize();

    const context = await this.browser!.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1366, height: 768 },
      locale: 'en-US',
      timezoneId: 'Asia/Dubai',
      geolocation: { latitude: 25.2048, longitude: 55.2708 }, // Dubai
      permissions: ['geolocation'],
    });

    const page = await context.newPage();

    // Login to portal
    await this.loginToPortal(page, credentials);

    const session: SessionInfo = {
      accountId: credentials.accountId,
      context,
      page,
      createdAt: new Date(),
      lastUsed: new Date(),
      isAlive: true,
    };

    this.sessions.set(credentials.accountId, session);

    // Persist cookies to Redis
    await this.persistSession(credentials.accountId, context);

    // Start keep-alive
    this.startKeepAlive(credentials);

    logger.info('✅ New browser session created', { accountId: credentials.accountId });
    return session;
  }

  /**
   * Login to the government portal
   */
  private async loginToPortal(page: Page, credentials: PortalCredentials): Promise<void> {
    const startTime = Date.now();

    try {
      // Navigate to portal
      await page.goto(credentials.portalUrl, { waitUntil: 'networkidle', timeout: 30000 });
      await this.humanDelay(1500, 2500);

      // Fill username with human-like typing speed
      await page.waitForSelector('#username, [name="username"], input[type="text"]', { timeout: 10000 });
      const usernameInput = await page.$('#username') || await page.$('[name="username"]') || await page.$('input[type="text"]');
      if (usernameInput) {
        await usernameInput.click();
        await this.humanDelay(300, 600);
        await usernameInput.type(credentials.username, { delay: this.randomBetween(50, 120) });
      }

      await this.humanDelay(500, 1000);

      // Fill password
      const passwordInput = await page.$('#password') || await page.$('[name="password"]') || await page.$('input[type="password"]');
      if (passwordInput) {
        await passwordInput.click();
        await this.humanDelay(200, 500);
        await passwordInput.type(credentials.password, { delay: this.randomBetween(50, 120) });
      }

      await this.humanDelay(300, 800);

      // Check for CAPTCHA
      const hasCaptcha = await page.$('.g-recaptcha, .h-captcha, [data-sitekey], iframe[src*="recaptcha"]');
      if (hasCaptcha) {
        logger.warn('⚠️ CAPTCHA detected — manual intervention may be needed', {
          accountId: credentials.accountId,
        });
        // In production: integrate 2captcha or human-in-the-loop
        // For now, capture screenshot and throw
        await this.captureScreenshot(page, `captcha-${credentials.accountId}`);
        throw new Error('CAPTCHA_DETECTED: Manual intervention required');
      }

      // Submit form
      const submitBtn = await page.$('[type="submit"], button:has-text("Login"), button:has-text("Sign In")');
      if (submitBtn) {
        await submitBtn.click();
      }

      // Wait for navigation to dashboard
      await page.waitForURL('**/dashboard**', { timeout: 15000 }).catch(() => {
        // Some portals don't redirect — check for success indicators
        return page.waitForSelector('.dashboard, .welcome, [data-page="dashboard"]', { timeout: 10000 });
      });

      const duration = Date.now() - startTime;
      logger.info('🔑 Portal login successful', {
        accountId: credentials.accountId,
        durationMs: duration,
      });

    } catch (error: any) {
      await this.captureScreenshot(page, `login-fail-${credentials.accountId}`);
      logger.error('❌ Portal login failed', {
        accountId: credentials.accountId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Check if a session is still alive via lightweight ping
   */
  async isSessionAlive(session: SessionInfo): Promise<boolean> {
    try {
      const page = session.page;
      // Try a lightweight navigation or API call
      const response = await page.evaluate(() => {
        return fetch('/api/session-check', { method: 'HEAD' })
          .then(r => r.status)
          .catch(() => 0);
      });
      return response === 200;
    } catch {
      session.isAlive = false;
      return false;
    }
  }

  /**
   * Persist session cookies to Redis for crash recovery
   */
  private async persistSession(accountId: string, context: BrowserContext): Promise<void> {
    try {
      const cookies = await context.cookies();
      await cache.set(
        `browser_session:${accountId}`,
        JSON.stringify(cookies),
        'EX',
        this.sessionTTL
      );
      logger.debug('Session cookies persisted to cache', { accountId });
    } catch (error) {
      logger.error('Failed to persist session', { accountId, error });
    }
  }

  /**
   * Restore a session from Redis cookies
   */
  private async restoreSession(credentials: PortalCredentials): Promise<SessionInfo | null> {
    try {
      const cached = await cache.get(`browser_session:${credentials.accountId}`);
      if (!cached) return null;

      const cookies = JSON.parse(cached);
      await this.initialize();

      const context = await this.browser!.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        viewport: { width: 1366, height: 768 },
      });

      await context.addCookies(cookies);
      const page = await context.newPage();

      // Verify restored session is valid
      await page.goto(credentials.portalUrl, { waitUntil: 'networkidle', timeout: 15000 });

      // Check if we're still logged in (not redirected to login page)
      const url = page.url();
      if (url.includes('login') || url.includes('signin')) {
        logger.info('Restored session expired, need fresh login', { accountId: credentials.accountId });
        await context.close();
        return null;
      }

      const session: SessionInfo = {
        accountId: credentials.accountId,
        context,
        page,
        createdAt: new Date(),
        lastUsed: new Date(),
        isAlive: true,
      };

      this.sessions.set(credentials.accountId, session);
      this.startKeepAlive(credentials);

      logger.info('♻️ Session restored from cache', { accountId: credentials.accountId });
      return session;
    } catch (error) {
      logger.debug('Session restore failed', { accountId: credentials.accountId });
      return null;
    }
  }

  /**
   * Start keep-alive ping for a session
   */
  private startKeepAlive(credentials: PortalCredentials): void {
    // Clear existing interval
    const existing = this.keepAliveIntervals.get(credentials.accountId);
    if (existing) clearInterval(existing);

    const interval = setInterval(async () => {
      const session = this.sessions.get(credentials.accountId);
      if (!session) {
        clearInterval(interval);
        return;
      }

      const alive = await this.isSessionAlive(session);
      if (!alive) {
        logger.warn('Session expired during keep-alive', { accountId: credentials.accountId });
        session.isAlive = false;
        clearInterval(interval);
        await cache.del(`browser_session:${credentials.accountId}`);
      } else {
        // Refresh TTL
        await this.persistSession(credentials.accountId, session.context);
      }
    }, this.keepAliveInterval);

    this.keepAliveIntervals.set(credentials.accountId, interval);
  }

  /**
   * Capture screenshot for debugging
   */
  async captureScreenshot(page: Page, label: string): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${timestamp}-${label}.png`;
    const filepath = path.join(this.screenshotDir, filename);

    try {
      await page.screenshot({ path: filepath, fullPage: true });
      logger.info('📸 Screenshot captured', { filepath });
      return filepath;
    } catch (error) {
      logger.error('Failed to capture screenshot', { label, error });
      return '';
    }
  }

  /**
   * Close a specific session
   */
  async closeSession(accountId: string): Promise<void> {
    const session = this.sessions.get(accountId);
    if (session) {
      await session.context.close();
      this.sessions.delete(accountId);
    }

    const interval = this.keepAliveIntervals.get(accountId);
    if (interval) {
      clearInterval(interval);
      this.keepAliveIntervals.delete(accountId);
    }

    await cache.del(`browser_session:${accountId}`);
    logger.info('Session closed', { accountId });
  }

  /**
   * Close all sessions and browser
   */
  async shutdown(): Promise<void> {
    for (const [accountId] of this.sessions) {
      await this.closeSession(accountId);
    }

    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }

    logger.info('🔌 Browser session manager shut down');
  }

  /**
   * Get active session count
   */
  getActiveSessionCount(): number {
    return this.sessions.size;
  }

  // === Utility Methods ===

  private humanDelay(min: number, max: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, this.randomBetween(min, max)));
  }

  private randomBetween(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
}

// Singleton instance
export const sessionManager = new BrowserSessionManager();
