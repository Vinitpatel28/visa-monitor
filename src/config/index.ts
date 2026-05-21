// ============================================================
// Environment Configuration — Type-safe config with validation
// ============================================================

import dotenv from 'dotenv';
dotenv.config();

export const config = {
  // Server
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  apiPrefix: process.env.API_PREFIX || '/api/v1',

  // Database
  databaseUrl: process.env.DATABASE_URL!,

  // Redis
  redis: {
    url: process.env.REDIS_URL || undefined,
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
  },

  // JWT
  jwt: {
    secret: process.env.JWT_SECRET || 'fallback-dev-secret',
    accessExpiry: process.env.JWT_ACCESS_EXPIRY || '15m',
    refreshExpiry: process.env.JWT_REFRESH_EXPIRY || '7d',
  },

  // OTP
  otp: {
    length: parseInt(process.env.OTP_LENGTH || '6', 10),
    expirySeconds: parseInt(process.env.OTP_EXPIRY_SECONDS || '300', 10),
    maxAttempts: parseInt(process.env.OTP_MAX_ATTEMPTS || '3', 10),
  },

  // Rate Limiting
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
  },

  // Encryption
  encryption: {
    key: process.env.ENCRYPTION_KEY || '32-byte-hex-key-change-in-prod-00',
    iv: process.env.ENCRYPTION_IV || '16-byte-iv-change',
  },

  // Logging
  log: {
    level: process.env.LOG_LEVEL || 'debug',
    format: process.env.LOG_FORMAT || 'json',
  },

  // CORS
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3001',

  // BullMQ Cron schedules
  bull: {
    reconciliationCron: process.env.BULL_RECONCILIATION_CRON || '0 */6 * * *',
    ghostCheckCron: process.env.BULL_GHOST_CHECK_CRON || '*/30 * * * *',
  },

  // ICP Portal Scraper Config
  icp: {
    portalUrl: process.env.ICP_PORTAL_URL || 'http://localhost:4001/#/fileValidity', // Defaults to Mock Portal!
    headless: process.env.ICP_HEADLESS === 'true', // Headful by default for manual CAPTCHA solving
    captchaTimeoutMs: parseInt(process.env.ICP_CAPTCHA_TIMEOUT || '60000', 10),
    resultTimeoutMs: parseInt(process.env.ICP_RESULT_TIMEOUT || '15000', 10),
    delayBetweenChecks: parseInt(process.env.ICP_DELAY_BETWEEN || '10000', 10),
    maxChecksPerHour: parseInt(process.env.ICP_MAX_PER_HOUR || '20', 10),
    screenshotDir: process.env.ICP_SCREENSHOT_DIR || './screenshots/icp',
  },
} as const;
