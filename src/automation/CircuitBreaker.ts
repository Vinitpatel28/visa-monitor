// ============================================================
// Circuit Breaker — Prevents cascading failures with ICP portal
// Opens circuit after consecutive failures, auto-recovers
// ============================================================

import { logger } from '../lib/logger';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface CircuitBreakerOptions {
  maxFailures: number;      // Failures before opening circuit
  cooldownMs: number;       // Cooldown before trying again
  halfOpenMaxAttempts: number; // Attempts allowed in half-open state
  name: string;
}

const DEFAULT_OPTIONS: CircuitBreakerOptions = {
  maxFailures: 3,
  cooldownMs: 3600000,       // 1 hour cooldown
  halfOpenMaxAttempts: 1,
  name: 'icp_portal',
};

/**
 * CircuitBreaker
 * 
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Failures exceeded threshold, all requests blocked
 * - HALF_OPEN: After cooldown, allow limited requests to test recovery
 */
export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime: Date | null = null;
  private lastStateChange: Date = new Date();
  private halfOpenAttempts = 0;
  private options: CircuitBreakerOptions;

  // Lifetime stats
  private stats = {
    totalRequests: 0,
    totalSuccesses: 0,
    totalFailures: 0,
    totalRejected: 0,
    circuitOpenCount: 0,
  };

  constructor(options: Partial<CircuitBreakerOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Execute a function through the circuit breaker
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.stats.totalRequests++;

    if (!this.canProceed()) {
      this.stats.totalRejected++;
      throw new CircuitBreakerError(
        `Circuit breaker "${this.options.name}" is OPEN. ` +
        `${this.getTimeUntilRetry()} until next retry.`
      );
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  /**
   * Check if a request can proceed
   */
  canProceed(): boolean {
    switch (this.state) {
      case 'CLOSED':
        return true;

      case 'OPEN':
        // Check if cooldown has elapsed
        if (this.lastFailureTime) {
          const elapsed = Date.now() - this.lastFailureTime.getTime();
          if (elapsed >= this.options.cooldownMs) {
            this.transitionTo('HALF_OPEN');
            return true;
          }
        }
        return false;

      case 'HALF_OPEN':
        return this.halfOpenAttempts < this.options.halfOpenMaxAttempts;
    }
  }

  /**
   * Record a successful request
   */
  recordSuccess(): void {
    this.stats.totalSuccesses++;
    this.successCount++;
    this.failureCount = 0;

    if (this.state === 'HALF_OPEN') {
      logger.info(`🟢 Circuit breaker "${this.options.name}" recovered — closing circuit`);
      this.transitionTo('CLOSED');
    }
  }

  /**
   * Record a failed request
   */
  recordFailure(): void {
    this.stats.totalFailures++;
    this.failureCount++;
    this.lastFailureTime = new Date();

    if (this.state === 'HALF_OPEN') {
      logger.warn(`🔴 Circuit breaker "${this.options.name}" half-open test failed — reopening`);
      this.transitionTo('OPEN');
    } else if (this.failureCount >= this.options.maxFailures) {
      logger.error(`🔴 Circuit breaker "${this.options.name}" opened — ${this.failureCount} consecutive failures`);
      this.transitionTo('OPEN');
    }
  }

  /**
   * Transition to a new state
   */
  private transitionTo(newState: CircuitState): void {
    const oldState = this.state;
    this.state = newState;
    this.lastStateChange = new Date();

    if (newState === 'OPEN') {
      this.stats.circuitOpenCount++;
    }
    if (newState === 'HALF_OPEN') {
      this.halfOpenAttempts = 0;
    }
    if (newState === 'CLOSED') {
      this.failureCount = 0;
      this.halfOpenAttempts = 0;
    }

    logger.info(`Circuit breaker "${this.options.name}": ${oldState} → ${newState}`);
  }

  /**
   * Get time until next retry attempt
   */
  getTimeUntilRetry(): string {
    if (this.state !== 'OPEN' || !this.lastFailureTime) return '0s';
    const remaining = this.options.cooldownMs - (Date.now() - this.lastFailureTime.getTime());
    if (remaining <= 0) return '0s';
    const minutes = Math.ceil(remaining / 60000);
    return minutes > 60 ? `${Math.ceil(minutes / 60)}h` : `${minutes}m`;
  }

  /**
   * Get circuit breaker status
   */
  getStatus() {
    return {
      name: this.options.name,
      state: this.state,
      failureCount: this.failureCount,
      maxFailures: this.options.maxFailures,
      lastFailure: this.lastFailureTime?.toISOString() || null,
      lastStateChange: this.lastStateChange.toISOString(),
      timeUntilRetry: this.state === 'OPEN' ? this.getTimeUntilRetry() : null,
      stats: { ...this.stats },
    };
  }

  /**
   * Force reset (for admin use)
   */
  reset(): void {
    this.transitionTo('CLOSED');
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
    logger.info(`Circuit breaker "${this.options.name}" manually reset`);
  }
}

/**
 * Custom error for circuit breaker rejections
 */
export class CircuitBreakerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CircuitBreakerError';
  }
}

// Export singleton for ICP portal
export const icpCircuitBreaker = new CircuitBreaker({
  name: 'icp_portal',
  maxFailures: 3,
  cooldownMs: 60 * 60 * 1000,  // 1 hour
  halfOpenMaxAttempts: 1,
});
