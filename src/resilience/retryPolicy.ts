/**
 * Retry Policy Engine
 *
 * Manages retry decisions with exponential backoff, jitter, and provider-specific rules
 */

import { getLogger } from '../infra/logger.js';
import { isRetryableError, RouterError } from '../core/types.js';

const logger = getLogger('retry-policy');

export interface RetryConfig {
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  jitterFactor: number;
}

export interface RetryPolicyConfig {
  maxAttempts: number;
  retry: RetryConfig;
}

export class RetryPolicyEngine {
  private config: RetryPolicyConfig;

  constructor(config: RetryPolicyConfig) {
    this.config = config;
  }

  shouldRetry(error: RouterError): boolean {
    if (error.retryable === false) {
      logger.debug('Error marked as non-retryable', { code: error.code });
      return false;
    }

    const retryable = isRetryableError(error.code);
    if (retryable) {
      logger.debug('Error classified as retryable', { code: error.code });
      return true;
    }

    return false;
  }

  calculateDelay(attemptNumber: number): number {
    const baseDelay = this.config.retry.baseDelayMs;
    const maxDelay = this.config.retry.maxDelayMs;
    const multiplier = this.config.retry.backoffMultiplier;
    const jitterFactor = this.config.retry.jitterFactor;

    const exponentialDelay = baseDelay * Math.pow(multiplier, attemptNumber - 1);
    const jitterMs = Math.random() * jitterFactor * baseDelay;
    const backoffDelay = Math.min(exponentialDelay + jitterMs, maxDelay);

    logger.debug('Calculated retry delay', {
      attemptNumber,
      baseDelay,
      multiplier,
      jitterMs,
      delay: backoffDelay,
    });

    return backoffDelay;
  }

  getMaxAttempts(): number {
    return this.config.maxAttempts;
  }

  getJitterFactor(): number {
    return this.config.retry.jitterFactor;
  }

  getBackoffMultiplier(): number {
    return this.config.retry.backoffMultiplier;
  }
}
