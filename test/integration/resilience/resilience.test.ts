/**
 * Resilience Layer Integration Tests
 *
 * Tests the resilience mechanisms:
 * - Circuit breaker state transitions
 * - Retry policy behavior
 * - Request budget management
 * - Concurrency control
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { CircuitBreaker, CircuitBreakerConfig } from '../../../src/resilience/circuitBreaker.js';
import { CircuitBreakerState } from '../../../src/core/types.js';
import { RetryPolicyEngine, RetryPolicyConfig } from '../../../src/resilience/retryPolicy.js';
import { RequestBudgetManager, RequestBudget } from '../../../src/resilience/requestBudget.js';
import { ConcurrencyManager, ConcurrencyConfig } from '../../../src/resilience/concurrency.js';
import {
  createUpstreamError,
  createValidationError,
  createTimeoutError,
} from '../../../src/core/errors.js';
import { ErrorCode } from '../../../src/core/types.js';

describe('Circuit Breaker', () => {
  let config: CircuitBreakerConfig;
  let breaker: CircuitBreaker;

  beforeEach(() => {
    config = {
      failureThreshold: 3,
      cooldownMs: 1000,
      halfOpenSuccessCount: 2,
      failureRateWindowMs: 60000,
    };
    breaker = new CircuitBreaker('test-provider', config);
  });

  describe('initial state', () => {
    it('should start in closed state', () => {
      assert.strictEqual(breaker.getState(), CircuitBreakerState.CLOSED);
    });

    it('should allow requests in closed state', () => {
      assert.strictEqual(breaker.isAllowing(), true);
    });
  });

  describe('failure threshold', () => {
    it('should open after failure threshold reached', () => {
      for (let i = 0; i < config.failureThreshold; i++) {
        breaker.recordFailure(createUpstreamError('test', 'error'));
      }

      assert.strictEqual(breaker.getState(), CircuitBreakerState.OPEN);
      assert.strictEqual(breaker.isAllowing(), false);
    });

    it('should not open before failure threshold', () => {
      for (let i = 0; i < config.failureThreshold - 1; i++) {
        breaker.recordFailure(createUpstreamError('test', 'error'));
      }

      assert.strictEqual(breaker.getState(), CircuitBreakerState.CLOSED);
      assert.strictEqual(breaker.isAllowing(), true);
    });
  });

  describe('success tracking', () => {
    it('should remain closed on success', () => {
      breaker.recordSuccess();
      breaker.recordSuccess();

      assert.strictEqual(breaker.getState(), CircuitBreakerState.CLOSED);
      assert.strictEqual(breaker.isAllowing(), true);
    });

    it('should reset failure count on success', () => {
      breaker.recordFailure(createUpstreamError('test', 'error'));
      breaker.recordFailure(createUpstreamError('test', 'error'));
      breaker.recordSuccess();

      assert.strictEqual(breaker.getState(), CircuitBreakerState.CLOSED);
    });
  });

  describe('cooldown period', () => {
    it('should return time until cooldown', async () => {
      for (let i = 0; i < config.failureThreshold; i++) {
        breaker.recordFailure(createUpstreamError('test', 'error'));
      }

      const timeUntilCooldown = breaker.getTimeUntilCooldown();
      assert.ok(timeUntilCooldown > 0);
      assert.ok(timeUntilCooldown <= config.cooldownMs);
    });
  });
});

describe('Retry Policy', () => {
  let config: RetryPolicyConfig;
  let policy: RetryPolicyEngine;

  beforeEach(() => {
    config = {
      maxAttempts: 3,
      retry: {
        baseDelayMs: 100,
        maxDelayMs: 1000,
        backoffMultiplier: 2,
        jitterFactor: 0.1,
      },
    };
    policy = new RetryPolicyEngine(config);
  });

  describe('retry decision', () => {
    it('should retry timeout errors', () => {
      const error = createTimeoutError('test', 'chat', 1000);
      assert.strictEqual(policy.shouldRetry(error), true);
    });

    it('should retry upstream errors', () => {
      const error = createUpstreamError('test', 'error');
      assert.strictEqual(policy.shouldRetry(error), true);
    });

    it('should not retry validation errors', () => {
      const error = createValidationError('Invalid input');
      assert.strictEqual(policy.shouldRetry(error), false);
    });

    it('should not retry authentication errors', () => {
      const error = {
        code: ErrorCode.AUTHENTICATION_ERROR,
        message: 'Invalid API key',
        provider: 'test',
        retryable: false,
      };
      assert.strictEqual(policy.shouldRetry(error), false);
    });
  });

  describe('max attempts', () => {
    it('should return configured max attempts', () => {
      assert.strictEqual(policy.getMaxAttempts(), config.maxAttempts);
    });
  });

  describe('delay calculation', () => {
    it('should calculate exponential backoff', () => {
      const delay1 = policy.calculateDelay(1);
      const delay2 = policy.calculateDelay(2);
      const delay3 = policy.calculateDelay(3);

      assert.ok(delay1 >= config.retry.baseDelayMs);
      assert.ok(delay2 > delay1);
      assert.ok(delay3 > delay2);
    });

    it('should cap delay at max delay', () => {
      const delay = policy.calculateDelay(100);
      assert.ok(delay <= config.retry.maxDelayMs);
    });
  });
});

describe('Request Budget Manager', () => {
  let budgetManager: RequestBudgetManager;

  beforeEach(() => {
    budgetManager = new RequestBudgetManager({
      totalBudgetMs: 30000,
      minRemainingMs: 1000,
    });
  });

  describe('budget creation', () => {
    it('should create a budget with start time', () => {
      const startTime = Date.now();
      const budget = budgetManager.createBudget(startTime);

      assert.ok(budget);
      assert.strictEqual(budget.startTime, startTime);
    });
  });

  describe('budget checking', () => {
    it('should have sufficient budget initially', () => {
      const budget = budgetManager.createBudget(Date.now());
      const hasBudget = budgetManager.hasSufficientBudget(budget, 3);

      assert.strictEqual(hasBudget, true);
    });

    it('should record attempt usage', () => {
      const budget = budgetManager.createBudget(Date.now());
      budgetManager.recordAttemptUsage(budget, 5000);

      assert.strictEqual(budget.usedMs, 5000);
      assert.strictEqual(budget.remainingMs, 25000);
    });
  });
});

describe('Concurrency Manager', () => {
  let manager: ConcurrencyManager;

  beforeEach(() => {
    const config: ConcurrencyConfig = {
      globalLimit: 10,
      providerLimits: {
        openai: 5,
        glm: 3,
      },
      queueSize: 0,
    };
    manager = new ConcurrencyManager(config);
  });

  describe('acquisition', () => {
    it('should acquire a slot for a provider', async () => {
      const slot = await manager.acquire('openai');

      assert.ok(slot);
      assert.ok(slot.release);

      slot.release();
    });

    it('should track active requests', async () => {
      const slot1 = await manager.acquire('openai');

      const stats = manager.getStats();
      assert.strictEqual(stats.global.active, 1);

      slot1.release();

      const statsAfter = manager.getStats();
      assert.strictEqual(statsAfter.global.active, 0);
    });
  });

  describe('statistics', () => {
    it('should return current stats', () => {
      const stats = manager.getStats();

      assert.ok(typeof stats.global.active === 'number');
      assert.ok(typeof stats.global.limit === 'number');
      assert.strictEqual(stats.global.limit, 10);
    });
  });
});
