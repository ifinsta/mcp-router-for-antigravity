/**
 * Protected Executor
 *
 * Wraps provider execution with resilience mechanisms:
 * - Concurrency control (bulkheads)
 * - Circuit breakers
 * - Timeout handling
 * - Error classification
 */

import { getLogger } from '../infra/logger.js';
import { getMetricsCollector } from '../infra/metrics.js';
import { CircuitBreaker, CircuitBreakerConfig } from './circuitBreaker.js';
import { ConcurrencyManager, ConcurrencyConfig } from './concurrency.js';
import { RequestBudgetManager, RequestBudget } from './requestBudget.js';
import { RetryPolicyEngine } from './retryPolicy.js';
import { AttemptHistoryRecorder } from './attemptHistory.js';
import {
  NormalizedChatRequest,
  NormalizedChatResponse,
  AttemptPhase,
  AttemptStatus,
  ProviderAdapter,
} from '../core/types.js';
import {
  RouterError,
  createTimeoutError,
  createProviderUnavailableError,
  createOverloadError,
  isRouterError,
} from '../core/errors.js';

const logger = getLogger('executor');

export interface ExecutorConfig {
  timeoutMs: number;
  retry: {
    maxAttempts: number;
    baseDelayMs: number;
    maxDelayMs: number;
    backoffMultiplier: number;
    jitterFactor: number;
  };
  circuitBreaker: CircuitBreakerConfig;
  concurrency: ConcurrencyConfig;
  budget: {
    totalBudgetMs: number;
    minRemainingMs: number;
  };
}

export class ProtectedExecutor {
  private circuitBreakers: Map<string, CircuitBreaker> = new Map();
  private concurrencyManager: ConcurrencyManager;
  private retryPolicy: RetryPolicyEngine;
  private budgetManager: RequestBudgetManager;

  constructor(private config: ExecutorConfig) {
    this.concurrencyManager = new ConcurrencyManager(config.concurrency);
    this.retryPolicy = new RetryPolicyEngine({
      maxAttempts: config.retry.maxAttempts,
      retry: {
        baseDelayMs: config.retry.baseDelayMs,
        maxDelayMs: config.retry.maxDelayMs,
        backoffMultiplier: config.retry.backoffMultiplier,
        jitterFactor: config.retry.jitterFactor,
      },
    });
    this.budgetManager = new RequestBudgetManager(config.budget);
  }

  async execute(
    provider: ProviderAdapter,
    request: NormalizedChatRequest,
    phase: AttemptPhase,
    attemptNumber: number,
    history: AttemptHistoryRecorder
  ): Promise<NormalizedChatResponse> {
    const providerName = provider.name;
    const model = request.model ?? 'unknown';

    const breaker = this.getOrCreateBreaker(providerName);
    const budget = this.budgetManager.createBudget(Date.now());

    if (!breaker.isAllowing()) {
      const breakerState = breaker.getState();
      const attempt = history.startAttempt(attemptNumber, providerName, model, phase, breakerState);
      history.completeAttempt(attempt, AttemptStatus.BLOCKED, 'circuit_breaker_open', false);

      throw createProviderUnavailableError(
        providerName,
        `Circuit breaker is open. Retry after ${breaker.getTimeUntilCooldown()}ms`
      );
    }

    if (!this.budgetManager.hasSufficientBudget(budget, this.retryPolicy.getMaxAttempts())) {
      throw createOverloadError('concurrency', 0);
    }

    let slot: { release: () => void } | null = null;
    const attempt = history.startAttempt(
      attemptNumber,
      providerName,
      model,
      phase,
      breaker.getState()
    );

    try {
      slot = await this.concurrencyManager.acquire(providerName);

      const timeoutMs = request.timeoutMs ?? this.config.timeoutMs;
      const response = await this.executeWithTimeout(provider, request, timeoutMs, attempt);

      breaker.recordSuccess();
      history.completeAttempt(attempt, AttemptStatus.SUCCESS);

      if (phase !== AttemptPhase.PRIMARY) {
        response.warnings.push(`Response from ${phase} provider: ${providerName}`);
      }

      return response;
    } catch (error) {
      const routerError = this.classifyError(error, providerName);
      const retryable = this.retryPolicy.shouldRetry(routerError);

      if (retryable) {
        getMetricsCollector().incrementRetryCount();
      }

      breaker.recordFailure(routerError);
      history.completeAttempt(attempt, AttemptStatus.FAILED, routerError.code, retryable);

      throw routerError;
    } finally {
      if (slot) {
        slot.release();
      }
      const duration = Date.now() - attempt.startedAtMs;
      this.budgetManager.recordAttemptUsage(budget, duration);
    }
  }

  private async executeWithTimeout(
    provider: ProviderAdapter,
    request: NormalizedChatRequest,
    timeoutMs: number,
    attempt: ReturnType<AttemptHistoryRecorder['startAttempt']>
  ): Promise<NormalizedChatResponse> {
    const startTime = Date.now();

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(createTimeoutError(provider.name, 'chat', timeoutMs));
      }, timeoutMs);
    });

    try {
      const response = await Promise.race([provider.chat(request), timeoutPromise]);

      response.latencyMs = Date.now() - startTime;

      return response;
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.warn('Provider execution failed', {
        provider: provider.name,
        duration,
        error: error instanceof Error ? error.message : String(error),
      });

      throw error;
    }
  }

  private classifyError(error: unknown, providerName: string): RouterError {
    if (isRouterError(error)) {
      return error;
    }

    const message = error instanceof Error ? error.message : String(error);

    return createProviderUnavailableError(providerName, message);
  }

  private getOrCreateBreaker(providerName: string): CircuitBreaker {
    let breaker = this.circuitBreakers.get(providerName);
    if (!breaker) {
      breaker = new CircuitBreaker(providerName, this.config.circuitBreaker);
      this.circuitBreakers.set(providerName, breaker);
    }
    return breaker;
  }

  getRetryPolicy(): RetryPolicyEngine {
    return this.retryPolicy;
  }

  getBudgetManager(): RequestBudgetManager {
    return this.budgetManager;
  }

  getConcurrencyManager(): ConcurrencyManager {
    return this.concurrencyManager;
  }

  getCircuitBreaker(providerName: string): CircuitBreaker | undefined {
    return this.circuitBreakers.get(providerName);
  }

  getConcurrencyStats(): ReturnType<ConcurrencyManager['getStats']> {
    return this.concurrencyManager.getStats();
  }
}
