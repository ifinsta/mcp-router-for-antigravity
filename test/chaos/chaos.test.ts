/**
 * Chaos and Fault Injection Test Suite
 *
 * Validates resilience mechanisms under failure conditions:
 * 1. Timeout injection
 * 2. Malformed JSON response
 * 3. Empty successful response
 * 4. Partial/truncated response
 * 5. Rate limit burst
 * 6. DNS/network failure
 * 7. Fallback loop prevention
 * 8. Budget exhaustion boundary
 * 9. Circuit breaker probe
 * 10. Concurrent fallback storms
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  NormalizedChatRequest,
  NormalizedChatResponse,
  ProviderAdapter,
  ProviderCapabilities,
  ModelInfo,
  ProviderHealthStatus,
  AttemptPhase,
  CircuitBreakerState,
  ErrorCode,
} from '../../src/core/types.js';
import {
  createTimeoutError,
  createNetworkError,
  createRateLimitedError,
  createUpstreamError,
  isRouterError,
} from '../../src/core/errors.js';
import { ProtectedExecutor, ExecutorConfig } from '../../src/resilience/executor.js';
import { AttemptHistoryRecorder } from '../../src/resilience/attemptHistory.js';
import { CircuitBreaker, CircuitBreakerConfig } from '../../src/resilience/circuitBreaker.js';
import { RequestBudgetManager } from '../../src/resilience/requestBudget.js';
import { ConcurrencyManager, ConcurrencyConfig } from '../../src/resilience/concurrency.js';
import { validateProviderResponse } from '../../src/core/validation.js';
import { AttemptPlanner, ExecutionPlan } from '../../src/core/planner.js';

// ============================================================================
// Mock Adapter
// ============================================================================

class ChaosAdapter implements ProviderAdapter {
  readonly name: string;
  readonly capabilities: ProviderCapabilities = {
    chat: true,
    structured: false,
    embeddings: false,
    streaming: false,
    vision: false,
  };

  private behavior: (req: NormalizedChatRequest) => Promise<NormalizedChatResponse>;
  callCount = 0;

  constructor(name: string, behavior?: (req: NormalizedChatRequest) => Promise<NormalizedChatResponse>) {
    this.name = name;
    this.behavior = behavior ?? ChaosAdapter.defaultBehavior(name);
  }

  static defaultBehavior(name: string): (req: NormalizedChatRequest) => Promise<NormalizedChatResponse> {
    return async (req) => ({
      provider: name,
      model: req.model ?? 'mock-model',
      outputText: `Response from ${name}`,
      finishReason: 'stop',
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, accuracy: 'exact' as const },
      latencyMs: 0,
      costEstimate: null,
      warnings: [],
      fallbackUsed: false,
    });
  }

  setBehavior(fn: (req: NormalizedChatRequest) => Promise<NormalizedChatResponse>): void {
    this.behavior = fn;
  }

  async chat(request: NormalizedChatRequest): Promise<NormalizedChatResponse> {
    this.callCount++;
    return this.behavior(request);
  }

  async listModels(): Promise<ModelInfo[]> {
    return [{
      id: 'mock-model',
      name: 'Mock Model',
      provider: this.name,
      capabilities: this.capabilities,
    }];
  }

  async healthCheck(): Promise<ProviderHealthStatus> {
    return { provider: this.name, status: 'healthy', lastCheckAt: Date.now() };
  }
}

// ============================================================================
// Test helpers
// ============================================================================

function makeRequest(overrides?: Partial<NormalizedChatRequest>): NormalizedChatRequest {
  return {
    messages: [{ role: 'user', content: 'Hello' }],
    provider: 'chaos-primary',
    model: 'mock-model',
    ...overrides,
  };
}

function fastExecutorConfig(overrides?: Partial<ExecutorConfig>): ExecutorConfig {
  return {
    timeoutMs: 500,
    retry: {
      maxAttempts: 3,
      baseDelayMs: 10,
      maxDelayMs: 50,
      backoffMultiplier: 2,
      jitterFactor: 0,
    },
    circuitBreaker: {
      failureThreshold: 3,
      cooldownMs: 200,
      halfOpenSuccessCount: 1,
      failureRateWindowMs: 60000,
    },
    concurrency: {
      globalLimit: 10,
      providerLimits: {},
      queueSize: 0,
    },
    budget: {
      totalBudgetMs: 5000,
      minRemainingMs: 100,
    },
    ...overrides,
  };
}

// ============================================================================
// Scenario 1: Timeout Injection
// ============================================================================

describe('Chaos: Timeout Injection', () => {
  it('should throw TimeoutError when adapter delays beyond the timeout', async () => {
    const adapter = new ChaosAdapter('timeout-provider');
    adapter.setBehavior(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return ChaosAdapter.defaultBehavior('timeout-provider')(makeRequest());
    });

    const executor = new ProtectedExecutor(fastExecutorConfig({ timeoutMs: 100 }));
    const history = new AttemptHistoryRecorder();

    await assert.rejects(
      () => executor.execute(adapter, makeRequest(), AttemptPhase.PRIMARY, 1, history),
      (err: unknown) => {
        assert.ok(isRouterError(err));
        assert.strictEqual(err.code, ErrorCode.TIMEOUT_ERROR);
        return true;
      }
    );
  });
});

// ============================================================================
// Scenario 2: Malformed JSON Response
// ============================================================================

describe('Chaos: Malformed JSON Response', () => {
  it('should reject a response with garbage data via validation', () => {
    const garbageResponse = {
      success: true,
      data: 'this is garbage text, not an object',
      provider: 'broken-provider',
      model: 'broken-model',
      latencyMs: 50,
    };

    const result = validateProviderResponse(garbageResponse);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.length > 0, 'Should have validation errors');
  });

  it('should reject when adapter returns response failing outputText type check', () => {
    const badResponse = {
      success: true,
      data: { outputText: 12345, finishReason: 'stop' },
      provider: 'broken-provider',
      model: 'broken-model',
      latencyMs: 50,
    };

    const result = validateProviderResponse(badResponse);
    assert.strictEqual(result.valid, false);
  });
});

// ============================================================================
// Scenario 3: Empty Successful Response
// ============================================================================

describe('Chaos: Empty Successful Response', () => {
  it('should reject a response with empty outputText', () => {
    const emptyResponse = {
      success: true,
      data: { outputText: '', finishReason: 'stop' },
      provider: 'empty-provider',
      model: 'empty-model',
      latencyMs: 50,
    };

    const result = validateProviderResponse(emptyResponse);
    assert.strictEqual(result.valid, false);
    assert.ok(
      result.errors.some((e) => e.message.includes('outputText')),
      'Error should mention outputText'
    );
  });

  it('should reject a response with whitespace-only outputText', () => {
    const wsResponse = {
      success: true,
      data: { outputText: '   ', finishReason: 'stop' },
      provider: 'ws-provider',
      model: 'ws-model',
      latencyMs: 50,
    };

    const result = validateProviderResponse(wsResponse);
    assert.strictEqual(result.valid, false);
  });
});

// ============================================================================
// Scenario 4: Partial / Truncated Response
// ============================================================================

describe('Chaos: Partial/Truncated Response', () => {
  it('should reject a response missing finishReason', () => {
    const partial = {
      success: true,
      data: { outputText: 'Some text' },
      provider: 'partial-provider',
      model: 'partial-model',
      latencyMs: 50,
    };

    const result = validateProviderResponse(partial);
    assert.strictEqual(result.valid, false);
    assert.ok(
      result.errors.some((e) => e.message.includes('finishReason')),
      'Error should mention finishReason'
    );
  });

  it('should reject a response with null data field', () => {
    const noData = {
      success: true,
      data: null,
      provider: 'partial-provider',
      model: 'partial-model',
      latencyMs: 50,
    };

    const result = validateProviderResponse(noData);
    assert.strictEqual(result.valid, false);
  });
});

// ============================================================================
// Scenario 5: Rate Limit Burst
// ============================================================================

describe('Chaos: Rate Limit Burst', () => {
  it('should survive rate limiting then succeed after retries', async () => {
    let calls = 0;
    const rateLimitCount = 2;

    const adapter = new ChaosAdapter('rate-limited-provider');
    adapter.setBehavior(async (req) => {
      calls++;
      if (calls <= rateLimitCount) {
        throw createRateLimitedError('rate-limited-provider');
      }
      return {
        provider: 'rate-limited-provider',
        model: req.model ?? 'mock-model',
        outputText: 'Success after rate limits',
        finishReason: 'stop',
        usage: { inputTokens: 5, outputTokens: 10, totalTokens: 15, accuracy: 'exact' as const },
        latencyMs: 0,
        costEstimate: null,
        warnings: [],
        fallbackUsed: false,
      };
    });

    // Execute multiple attempts manually to simulate the retry loop
    const executor = new ProtectedExecutor(fastExecutorConfig());
    const history = new AttemptHistoryRecorder();
    let response: NormalizedChatResponse | null = null;
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        response = await executor.execute(
          adapter,
          makeRequest(),
          attempt === 1 ? AttemptPhase.PRIMARY : AttemptPhase.RETRY,
          attempt,
          history
        );
        break;
      } catch (err) {
        lastError = err;
      }
    }

    assert.ok(response, 'Should have eventually succeeded');
    assert.strictEqual(response.outputText, 'Success after rate limits');
    assert.strictEqual(calls, rateLimitCount + 1);
  });
});

// ============================================================================
// Scenario 6: DNS / Network Failure → Circuit Breaker Opens
// ============================================================================

describe('Chaos: DNS/Network Failure', () => {
  it('should open circuit breaker after repeated network failures', async () => {
    const adapter = new ChaosAdapter('network-fail-provider');
    adapter.setBehavior(async () => {
      throw createNetworkError('network-fail-provider', 'ECONNREFUSED');
    });

    const cbConfig: CircuitBreakerConfig = {
      failureThreshold: 3,
      cooldownMs: 5000,
      halfOpenSuccessCount: 1,
      failureRateWindowMs: 60000,
    };

    const executor = new ProtectedExecutor(fastExecutorConfig({
      circuitBreaker: cbConfig,
    }));

    const request = makeRequest();

    // Drive failures until the breaker opens
    for (let i = 1; i <= cbConfig.failureThreshold; i++) {
      const history = new AttemptHistoryRecorder();
      try {
        await executor.execute(adapter, request, AttemptPhase.PRIMARY, i, history);
      } catch {
        // expected
      }
    }

    // Next request should be blocked by open circuit breaker
    const history = new AttemptHistoryRecorder();
    await assert.rejects(
      () => executor.execute(adapter, request, AttemptPhase.PRIMARY, cbConfig.failureThreshold + 1, history),
      (err: unknown) => {
        assert.ok(isRouterError(err));
        assert.strictEqual(err.code, ErrorCode.PROVIDER_UNAVAILABLE);
        assert.ok(err.message.includes('Circuit breaker'));
        return true;
      }
    );
  });
});

// ============================================================================
// Scenario 7: Fallback Loop Prevention
// ============================================================================

describe('Chaos: Fallback Loop Prevention', () => {
  it('should exhaust attempts and not loop infinitely when both primary and fallback fail', async () => {
    const primaryAdapter = new ChaosAdapter('failing-primary');
    primaryAdapter.setBehavior(async () => {
      throw createUpstreamError('failing-primary', 'primary down');
    });

    const fallbackAdapter = new ChaosAdapter('failing-fallback');
    fallbackAdapter.setBehavior(async () => {
      throw createUpstreamError('failing-fallback', 'fallback down');
    });

    const maxAttempts = 3;
    const executor = new ProtectedExecutor(fastExecutorConfig({
      retry: {
        maxAttempts,
        baseDelayMs: 5,
        maxDelayMs: 20,
        backoffMultiplier: 2,
        jitterFactor: 0,
      },
    }));

    // Simulate a retry + fallback loop manually (like the Router would)
    const adapters: Record<string, ChaosAdapter> = {
      'failing-primary': primaryAdapter,
      'failing-fallback': fallbackAdapter,
    };

    const plan: ExecutionPlan = {
      primary: { provider: 'failing-primary', model: 'mock-model', phase: AttemptPhase.PRIMARY, attemptNumber: 1 },
      retries: [
        { provider: 'failing-primary', model: 'mock-model', phase: AttemptPhase.RETRY, attemptNumber: 2 },
        { provider: 'failing-primary', model: 'mock-model', phase: AttemptPhase.RETRY, attemptNumber: 3 },
      ],
      fallback: { provider: 'failing-fallback', model: 'mock-model', phase: AttemptPhase.FALLBACK, attemptNumber: 4 },
      maxAttempts,
      totalBudgetMs: 5000,
    };

    const startTime = Date.now();
    let attemptsMade = 0;
    let lastError: unknown = null;

    // Primary + retries
    const allAttempts = [plan.primary, ...plan.retries, plan.fallback!];
    for (const attempt of allAttempts) {
      const adapter = adapters[attempt.provider];
      if (!adapter) break;
      attemptsMade++;
      const history = new AttemptHistoryRecorder();
      try {
        await executor.execute(adapter, makeRequest(), attempt.phase, attempt.attemptNumber, history);
        break; // success - won't happen here
      } catch (err) {
        lastError = err;
      }
    }

    const elapsed = Date.now() - startTime;

    // Should have tried primary (1) + retries (2) + fallback (1) = 4, then stopped
    assert.strictEqual(attemptsMade, allAttempts.length);
    assert.ok(isRouterError(lastError));
    // Should finish quickly, not be stuck in a loop
    assert.ok(elapsed < 3000, `Took too long (${elapsed}ms), possible infinite loop`);
  });
});

// ============================================================================
// Scenario 8: Budget Exhaustion Boundary
// ============================================================================

describe('Chaos: Budget Exhaustion Boundary', () => {
  it('should reject execution when budget is too tight', async () => {
    const adapter = new ChaosAdapter('slow-provider');
    adapter.setBehavior(async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      return ChaosAdapter.defaultBehavior('slow-provider')(makeRequest());
    });

    // Very tight budget: 100ms total, 100ms min remaining
    const executor = new ProtectedExecutor(fastExecutorConfig({
      budget: { totalBudgetMs: 100, minRemainingMs: 100 },
    }));

    const history = new AttemptHistoryRecorder();

    // First call creates budget; hasSufficientBudget checks elapsed time
    // With 100ms total and 100ms min, any time elapsed > 0 means insufficient
    // The executor creates a fresh budget each call so the first call may pass.
    // We need to burn time first, then try.
    // Actually, the budget is created at the start of execute() with Date.now(),
    // so totalBudget=100 and minRemaining=100 means: remaining must be >= 100.
    // At creation time, remaining = 100, elapsed = ~0, so 100 >= 100 => true.
    // The call will proceed but timeout at 500ms. Let's instead make it even tighter.

    const tightExecutor = new ProtectedExecutor(fastExecutorConfig({
      budget: { totalBudgetMs: 50, minRemainingMs: 100 },
    }));

    const history2 = new AttemptHistoryRecorder();

    // Now totalBudget=50 but minRemaining=100, so budget check fails immediately
    await assert.rejects(
      () => tightExecutor.execute(adapter, makeRequest(), AttemptPhase.PRIMARY, 1, history2),
      (err: unknown) => {
        assert.ok(isRouterError(err));
        assert.strictEqual(err.code, ErrorCode.OVERLOAD_ERROR);
        return true;
      }
    );

    // Adapter should not have been called
    assert.strictEqual(adapter.callCount, 0);
  });
});

// ============================================================================
// Scenario 9: Circuit Breaker Probe (half-open)
// ============================================================================

describe('Chaos: Circuit Breaker Probe', () => {
  it('should transition to half-open after cooldown and allow a probe request', async () => {
    const cbConfig: CircuitBreakerConfig = {
      failureThreshold: 2,
      cooldownMs: 100, // very short for testing
      halfOpenSuccessCount: 1,
      failureRateWindowMs: 60000,
    };

    const breaker = new CircuitBreaker('probe-provider', cbConfig);

    // Drive to open
    for (let i = 0; i < cbConfig.failureThreshold; i++) {
      breaker.recordFailure(createNetworkError('probe-provider', 'fail'));
    }
    assert.strictEqual(breaker.getState(), CircuitBreakerState.OPEN);
    assert.strictEqual(breaker.isAllowing(), false);

    // Wait for cooldown
    await new Promise((resolve) => setTimeout(resolve, cbConfig.cooldownMs + 50));

    // Should now be half-open
    assert.strictEqual(breaker.getState(), CircuitBreakerState.HALF_OPEN);
    assert.strictEqual(breaker.isAllowing(), true);

    // A successful probe should close the breaker
    breaker.recordSuccess();
    assert.strictEqual(breaker.getState(), CircuitBreakerState.CLOSED);
  });

  it('should re-open on failure during half-open', async () => {
    const cbConfig: CircuitBreakerConfig = {
      failureThreshold: 2,
      cooldownMs: 100,
      halfOpenSuccessCount: 1,
      failureRateWindowMs: 60000,
    };

    const breaker = new CircuitBreaker('probe-provider-2', cbConfig);

    // Drive to open
    for (let i = 0; i < cbConfig.failureThreshold; i++) {
      breaker.recordFailure(createNetworkError('probe-provider-2', 'fail'));
    }
    assert.strictEqual(breaker.getState(), CircuitBreakerState.OPEN);

    // Wait for cooldown
    await new Promise((resolve) => setTimeout(resolve, cbConfig.cooldownMs + 50));

    assert.strictEqual(breaker.getState(), CircuitBreakerState.HALF_OPEN);

    // A failure during half-open should re-open
    breaker.recordFailure(createNetworkError('probe-provider-2', 'still failing'));
    assert.strictEqual(breaker.getState(), CircuitBreakerState.OPEN);
  });
});

// ============================================================================
// Scenario 10: Concurrent Fallback Storms
// ============================================================================

describe('Chaos: Concurrent Fallback Storms', () => {
  it('should enforce concurrency limits when fallback receives burst traffic', async () => {
    const concurrencyLimit = 2;

    const concurrencyConfig: ConcurrencyConfig = {
      globalLimit: concurrencyLimit,
      providerLimits: { 'fallback-provider': concurrencyLimit },
      queueSize: 0, // reject immediately when full
    };

    const manager = new ConcurrencyManager(concurrencyConfig);

    // Acquire all slots
    const slots = [];
    for (let i = 0; i < concurrencyLimit; i++) {
      slots.push(await manager.acquire('fallback-provider'));
    }

    // Verify stats
    const stats = manager.getStats();
    assert.strictEqual(stats.global.active, concurrencyLimit);

    // Next acquisition should fail with overload
    await assert.rejects(
      () => manager.acquire('fallback-provider'),
      (err: unknown) => {
        assert.ok(isRouterError(err));
        assert.strictEqual(err.code, ErrorCode.OVERLOAD_ERROR);
        return true;
      }
    );

    // Release and verify one more can proceed
    slots[0]!.release();
    const newSlot = await manager.acquire('fallback-provider');
    assert.ok(newSlot);
    newSlot.release();
    slots[1]!.release();
  });

  it('should limit concurrent fallback executions through the executor', async () => {
    let activeCount = 0;
    let peakActive = 0;
    const concurrencyLimit = 2;

    const fallbackAdapter = new ChaosAdapter('fallback-provider');
    fallbackAdapter.setBehavior(async (req) => {
      activeCount++;
      if (activeCount > peakActive) peakActive = activeCount;
      // Simulate some work
      await new Promise((resolve) => setTimeout(resolve, 50));
      activeCount--;
      return {
        provider: 'fallback-provider',
        model: req.model ?? 'mock-model',
        outputText: 'Fallback response',
        finishReason: 'stop',
        usage: null,
        latencyMs: 50,
        costEstimate: null,
        warnings: [],
        fallbackUsed: true,
      };
    });

    const executor = new ProtectedExecutor(fastExecutorConfig({
      concurrency: {
        globalLimit: concurrencyLimit,
        providerLimits: { 'fallback-provider': concurrencyLimit },
        queueSize: 0,
      },
    }));

    // Launch more requests than the limit; some must be rejected
    const requests = Array.from({ length: 5 }, (_, i) => {
      const history = new AttemptHistoryRecorder();
      return executor.execute(
        fallbackAdapter,
        makeRequest({ provider: 'fallback-provider' }),
        AttemptPhase.FALLBACK,
        i + 1,
        history
      ).catch((err) => err);
    });

    const results = await Promise.all(requests);

    const successes = results.filter(
      (r) => r && typeof r === 'object' && 'outputText' in r
    );
    const failures = results.filter(
      (r) => isRouterError(r)
    );

    // At most concurrencyLimit requests should have run concurrently
    assert.ok(peakActive <= concurrencyLimit, `Peak active ${peakActive} exceeded limit ${concurrencyLimit}`);
    // Some should have been rejected since queueSize=0
    assert.ok(failures.length > 0, 'Some requests should be rejected when concurrency is exceeded');
    assert.ok(successes.length > 0, 'Some requests should succeed');
  });
});
