/**
 * Circuit Breaker
 *
 * Prevents hammering of persistently failing providers
 * Implements open/closed/half-open state machine
 */

import { getLogger } from '../infra/logger.js';
import { RouterError } from '../core/errors.js';
import { CircuitBreakerState } from '../core/types.js';

const logger = getLogger('circuit-breaker');

export interface CircuitBreakerConfig {
  failureThreshold: number;
  cooldownMs: number;
  halfOpenSuccessCount: number;
  failureRateWindowMs: number;
}

export class CircuitBreaker {
  private provider: string;
  private state: CircuitBreakerState = CircuitBreakerState.CLOSED;
  private failureCount: number = 0;
  private successCount: number = 0;
  private lastFailureAt: number = 0;
  private lastSuccessAt: number = 0;
  private openedAt: number = 0;
  private halfOpenSuccesses: number = 0;
  private config: CircuitBreakerConfig;

  constructor(provider: string, config: CircuitBreakerConfig) {
    this.provider = provider;
    this.config = config;
    this.state = CircuitBreakerState.CLOSED;

    logger.debug(`Circuit breaker initialized for ${provider}`, {
      failureThreshold: config.failureThreshold,
      cooldownMs: config.cooldownMs,
      halfOpenSuccessCount: config.halfOpenSuccessCount,
    });
  }

  recordSuccess(): void {
    this.successCount++;
    this.lastSuccessAt = Date.now();

    if (this.state === CircuitBreakerState.HALF_OPEN) {
      this.halfOpenSuccesses++;
      if (this.halfOpenSuccesses >= this.config.halfOpenSuccessCount) {
        this.close();
      }
    }

    logger.debug(`Circuit breaker success recorded for ${this.provider}`, {
      failureCount: this.failureCount,
      successCount: this.successCount,
      state: this.state,
    });
  }

  recordFailure(error: RouterError): void {
    this.failureCount++;
    this.lastFailureAt = Date.now();

    logger.warn(`Circuit breaker failure recorded for ${this.provider}`, {
      errorCode: error.code,
      failureCount: this.failureCount,
      state: this.state,
    });

    if (this.state === CircuitBreakerState.HALF_OPEN) {
      this.open();
    } else if (this.failureCount >= this.config.failureThreshold) {
      this.open();
    }
  }

  private open(): void {
    if (this.state !== CircuitBreakerState.OPEN) {
      this.state = CircuitBreakerState.OPEN;
      this.openedAt = Date.now();
      this.halfOpenSuccesses = 0;

      logger.warn(`Circuit breaker opened for ${this.provider}`, {
        failureCount: this.failureCount,
        successCount: this.successCount,
        cooldownUntil: new Date(Date.now() + this.config.cooldownMs),
      });
    }
  }

  private close(): void {
    this.state = CircuitBreakerState.CLOSED;
    this.failureCount = 0;
    this.halfOpenSuccesses = 0;
    this.lastSuccessAt = Date.now();

    logger.info(`Circuit breaker closed for ${this.provider}`, {
      successCount: this.successCount,
    });
  }

  getState(): CircuitBreakerState {
    if (this.state === CircuitBreakerState.OPEN && this.isCooldownExpired()) {
      this.state = CircuitBreakerState.HALF_OPEN;
      this.halfOpenSuccesses = 0;
      logger.info(`Circuit breaker moved to half-open for ${this.provider}`);
    }
    return this.state;
  }

  isAllowing(): boolean {
    const state = this.getState();
    return state === CircuitBreakerState.CLOSED || state === CircuitBreakerState.HALF_OPEN;
  }

  getFailureRate(): number {
    const totalAttempts = this.failureCount + this.successCount;
    if (totalAttempts === 0) {
      return 0;
    }
    return this.failureCount / totalAttempts;
  }

  getTimeUntilCooldown(): number {
    if (this.state !== CircuitBreakerState.OPEN) {
      return 0;
    }

    const cooldownEnd = this.openedAt + this.config.cooldownMs;
    return Math.max(0, cooldownEnd - Date.now());
  }

  isCooldownExpired(): boolean {
    if (this.state !== CircuitBreakerState.OPEN) {
      return false;
    }

    return Date.now() >= this.openedAt + this.config.cooldownMs;
  }

  reset(): void {
    this.state = CircuitBreakerState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.halfOpenSuccesses = 0;
    this.lastFailureAt = 0;
    this.lastSuccessAt = 0;
    this.openedAt = 0;

    logger.info(`Circuit breaker reset for ${this.provider}`);
  }
}
