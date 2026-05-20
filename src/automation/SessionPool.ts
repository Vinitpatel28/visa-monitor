// ============================================================
// Session Pool — Multi-account session manager with locking
// Manages concurrent browser sessions across portal accounts
// ============================================================

import { cache } from '../lib/redis';
import { logger } from '../lib/logger';
import { sessionManager, PortalCredentials, SessionInfo } from './BrowserSessionManager';

interface PooledAccount {
  credentials: PortalCredentials;
  inUse: boolean;
  lockId: string | null;
  lockExpiresAt: number;
  totalRequests: number;
  failureCount: number;
  lastUsed: Date;
  cooldownUntil: Date | null;
}

interface LockResult {
  acquired: boolean;
  lockId: string;
  accountId: string;
}

/**
 * SessionPool
 * 
 * Manages a pool of portal accounts for distributed automation.
 * Features:
 * - Round-robin account selection with load balancing
 * - Distributed locking via Redis (redlock pattern)
 * - Account cooldowns after failures
 * - Health monitoring and auto-rotation
 * - Rate limiting per account
 */
export class SessionPool {
  private accounts: Map<string, PooledAccount> = new Map();
  private readonly lockTTL = 5 * 60 * 1000; // 5 minute lock
  private readonly maxFailures = 3;
  private readonly cooldownDuration = 15 * 60 * 1000; // 15 min cooldown
  private readonly maxRequestsPerHour = 50;

  /**
   * Register a portal account in the pool
   */
  addAccount(credentials: PortalCredentials): void {
    this.accounts.set(credentials.accountId, {
      credentials,
      inUse: false,
      lockId: null,
      lockExpiresAt: 0,
      totalRequests: 0,
      failureCount: 0,
      lastUsed: new Date(0),
      cooldownUntil: null,
    });
    logger.info('Account added to session pool', { accountId: credentials.accountId });
  }

  /**
   * Acquire a session from the pool (with distributed lock)
   */
  async acquireSession(): Promise<{ session: SessionInfo; lockId: string; accountId: string } | null> {
    const account = this.selectBestAccount();
    if (!account) {
      logger.warn('No available accounts in session pool');
      return null;
    }

    // Try to acquire distributed lock
    const lock = await this.acquireLock(account.credentials.accountId);
    if (!lock.acquired) {
      logger.warn('Failed to acquire lock', { accountId: account.credentials.accountId });
      return null;
    }

    try {
      // Get or create browser session
      const session = await sessionManager.getSession(account.credentials);
      account.inUse = true;
      account.lastUsed = new Date();
      account.totalRequests++;

      return { session, lockId: lock.lockId, accountId: account.credentials.accountId };
    } catch (error: any) {
      account.failureCount++;
      await this.releaseLock(account.credentials.accountId, lock.lockId);

      // Cooldown on excessive failures
      if (account.failureCount >= this.maxFailures) {
        account.cooldownUntil = new Date(Date.now() + this.cooldownDuration);
        logger.warn('Account in cooldown due to failures', {
          accountId: account.credentials.accountId,
          until: account.cooldownUntil.toISOString(),
        });
      }

      throw error;
    }
  }

  /**
   * Release a session back to the pool
   */
  async releaseSession(accountId: string, lockId: string, success: boolean = true): Promise<void> {
    const account = this.accounts.get(accountId);
    if (!account) return;

    account.inUse = false;
    if (success) {
      account.failureCount = 0; // Reset on success
    }

    await this.releaseLock(accountId, lockId);
    logger.debug('Session released', { accountId });
  }

  /**
   * Select the best available account (round-robin + load balancing)
   */
  private selectBestAccount(): PooledAccount | null {
    const now = Date.now();
    let bestAccount: PooledAccount | null = null;
    let oldestUsed = Infinity;

    for (const account of this.accounts.values()) {
      // Skip if in use
      if (account.inUse) continue;

      // Skip if in cooldown
      if (account.cooldownUntil && account.cooldownUntil.getTime() > now) continue;

      // Skip if lock still valid
      if (account.lockExpiresAt > now) continue;

      // Skip if rate limited
      if (account.totalRequests >= this.maxRequestsPerHour) continue;

      // Select least recently used
      if (account.lastUsed.getTime() < oldestUsed) {
        oldestUsed = account.lastUsed.getTime();
        bestAccount = account;
      }
    }

    return bestAccount;
  }

  /**
   * Acquire a distributed lock using Redis
   * Implements simplified redlock pattern
   */
  private async acquireLock(accountId: string): Promise<LockResult> {
    const lockKey = `session_lock:${accountId}`;
    const lockId = `${process.pid}-${Date.now()}-${Math.random().toString(36).substring(2)}`;

    try {
      // Try to set lock with NX (only if not exists)
      const existing = await cache.get(lockKey);
      if (existing) {
        return { acquired: false, lockId: '', accountId };
      }

      await cache.set(lockKey, lockId, 'EX', Math.ceil(this.lockTTL / 1000));

      // Verify we got the lock
      const verify = await cache.get(lockKey);
      if (verify !== lockId) {
        return { acquired: false, lockId: '', accountId };
      }

      const account = this.accounts.get(accountId);
      if (account) {
        account.lockId = lockId;
        account.lockExpiresAt = Date.now() + this.lockTTL;
      }

      logger.debug('Lock acquired', { accountId, lockId: lockId.substring(0, 8) });
      return { acquired: true, lockId, accountId };

    } catch (error) {
      logger.error('Lock acquisition error', { accountId, error });
      return { acquired: false, lockId: '', accountId };
    }
  }

  /**
   * Release a distributed lock
   */
  private async releaseLock(accountId: string, lockId: string): Promise<void> {
    const lockKey = `session_lock:${accountId}`;

    try {
      // Only delete if we hold the lock
      const currentLock = await cache.get(lockKey);
      if (currentLock === lockId) {
        await cache.del(lockKey);
      }

      const account = this.accounts.get(accountId);
      if (account) {
        account.lockId = null;
        account.lockExpiresAt = 0;
      }
    } catch (error) {
      logger.error('Lock release error', { accountId, error });
    }
  }

  /**
   * Get pool health status
   */
  getPoolStatus(): {
    total: number;
    available: number;
    inUse: number;
    cooldown: number;
    accounts: Array<{
      accountId: string;
      inUse: boolean;
      totalRequests: number;
      failures: number;
      cooldown: boolean;
    }>;
  } {
    const now = Date.now();
    let available = 0;
    let inUse = 0;
    let cooldown = 0;
    const accounts: any[] = [];

    for (const [id, acc] of this.accounts) {
      const isCooldown = acc.cooldownUntil ? acc.cooldownUntil.getTime() > now : false;
      if (acc.inUse) inUse++;
      else if (isCooldown) cooldown++;
      else available++;

      accounts.push({
        accountId: id,
        inUse: acc.inUse,
        totalRequests: acc.totalRequests,
        failures: acc.failureCount,
        cooldown: isCooldown,
      });
    }

    return { total: this.accounts.size, available, inUse, cooldown, accounts };
  }

  /**
   * Reset hourly request counters (call via cron)
   */
  resetCounters(): void {
    for (const account of this.accounts.values()) {
      account.totalRequests = 0;
    }
  }

  /**
   * Shutdown all sessions
   */
  async shutdown(): Promise<void> {
    for (const [accountId, account] of this.accounts) {
      if (account.lockId) {
        await this.releaseLock(accountId, account.lockId);
      }
    }
    await sessionManager.shutdown();
    this.accounts.clear();
    logger.info('Session pool shut down');
  }
}

// Singleton instance
export const sessionPool = new SessionPool();
