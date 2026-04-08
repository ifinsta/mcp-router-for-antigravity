/**
 * Load and Concurrency Test Suite
 *
 * Validates concurrency control, overload rejection, provider isolation,
 * latency overhead, and throughput under load.
 *
 * Scenarios:
 * 1. Global concurrency saturation
 * 2. Per-provider concurrency exhaustion
 * 3. Provider isolation verification
 * 4. Graceful overload rejection
 * 5. Latency overhead benchmark
 * 6. Throughput baseline
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { performance } from 'node:perf_hooks';
import {
  NormalizedChatRequest,
  NormalizedChatResponse,
  ProviderAdapter,
  ProviderCapabilities,
  ModelInfo,
  ProviderHealthStatus,
  AttemptPhase,
  ErrorCode,
} from '../../src/core/types.js';
import { isRouterError } from '../../src/core/errors.js';
import { ProtectedExecutor, ExecutorConfig } from '../../src/resilience/executor.js';
import { AttemptHistoryRecorder } from '../../src/resilience/attemptHistory.js';
import { ConcurrencyManager, ConcurrencyConfig } from '../../src/resilience/concurrency.js';

// ============================================================================
// Mock Adapter
// ============================================================================

class LoadTestAdapter implements ProviderAdapter {
  readonly name: string;
  readonly capabilities: ProviderCapabilities = {
    chat: true,
    structured: false,
    embeddings: false,
    streaming: false,
    vision: false,
  };

  private delayMs: number;
  callCount = 0;

  constructor(name: string, delayMs: number = 0) {
    this.name = name;
    this.delayMs = delayMs;
  }

  async chat(request: NormalizedChatRequest): Promise<NormalizedChatResponse> {
    this.callCount++;
    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }
    return {
      provider: this.name,
      model: request.model ?? 'mock-model',
      outputText: `Response from ${this.name}`,
      finishReason: 'stop',
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, accuracy: 'exact' as const },
      latencyMs: 0,
      costEstimate: null,
      warnings: [],
      fallbackUsed: false,
    };
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
// Helpers
// ============================================================================

function makeRequest(overrides?: Partial<NormalizedChatRequest>): NormalizedChatRequest {
  return {
    messages: [{ role: 'user', content: 'Hello' }],
    provider: 'load-provider',
    model: 'mock-model',
    ...overrides,
  };
}

function makeExecutorConfig(concurrency: ConcurrencyConfig): ExecutorConfig {
  return {
    timeoutMs: 5000,
    retry: {
      maxAttempts: 1,
      baseDelayMs: 10,
      maxDelayMs: 50,
      backoffMultiplier: 2,
      jitterFactor: 0,
    },
    circuitBreaker: {
      failureThreshold: 100, // high threshold so breaker never opens during load tests
      cooldownMs: 60000,
      halfOpenSuccessCount: 1,
      failureRateWindowMs: 60000,
    },
    concurrency,
    budget: {
      totalBudgetMs: 30000,
      minRemainingMs: 100,
    },
  };
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)]!;
}

// ============================================================================
// Scenario 1: Global Concurrency Saturation
// ============================================================================

describe('Load: Global concurrency saturation', () => {
  it('should reject requests beyond the global concurrency limit', async () => {
    const globalLimit = 3;
    const manager = new ConcurrencyManager({
      globalLimit,
      providerLimits: {},
      queueSize: 0,
    });

    // Acquire all global slots
    const slots: Array<{ release: () => void }> = [];
    for (let i = 0; i < globalLimit; i++) {
      slots.push(await manager.acquire(`provider-${i}`));
    }

    assert.strictEqual(manager.getStats().global.active, globalLimit);
    assert.strictEqual(manager.isOverloaded(), true);

    // Additional requests to different providers should all fail (global limit)
    const extraResults = await Promise.allSettled([
      manager.acquire('provider-extra-1'),
      manager.acquire('provider-extra-2'),
      manager.acquire('provider-extra-3'),
    ]);

    for (const result of extraResults) {
      assert.strictEqual(result.status, 'rejected');
      const err = (result as PromiseRejectedResult).reason;
      assert.ok(isRouterError(err));
      assert.strictEqual(err.code, ErrorCode.OVERLOAD_ERROR);
    }

    // Cleanup
    for (const slot of slots) {
      slot.release();
    }

    assert.strictEqual(manager.getStats().global.active, 0);
  });

  it('should allow requests after slots are released', async () => {
    const globalLimit = 2;
    const manager = new ConcurrencyManager({
      globalLimit,
      providerLimits: {},
      queueSize: 0,
    });

    const slot1 = await manager.acquire('provider-a');
    const slot2 = await manager.acquire('provider-b');

    // Should be full
    await assert.rejects(() => manager.acquire('provider-c'), (err: unknown) => {
      assert.ok(isRouterError(err));
      return true;
    });

    // Release one slot
    slot1.release();

    // Now should succeed
    const slot3 = await manager.acquire('provider-c');
    assert.ok(slot3);
    slot3.release();
    slot2.release();
  });
});

// ============================================================================
// Scenario 2: Per-provider Concurrency Exhaustion
// ============================================================================

describe('Load: Per-provider concurrency exhaustion', () => {
  it('should block a saturated provider while others remain available', async () => {
    const manager = new ConcurrencyManager({
      globalLimit: 10,
      providerLimits: { 'slow-provider': 2 },
      queueSize: 0,
    });

    // Saturate slow-provider's per-provider limit
    const slowSlots = [
      await manager.acquire('slow-provider'),
      await manager.acquire('slow-provider'),
    ];

    // slow-provider should be blocked
    await assert.rejects(
      () => manager.acquire('slow-provider'),
      (err: unknown) => {
        assert.ok(isRouterError(err));
        assert.strictEqual(err.code, ErrorCode.OVERLOAD_ERROR);
        return true;
      }
    );

    // Other provider should still work fine
    const fastSlot = await manager.acquire('fast-provider');
    assert.ok(fastSlot);

    const stats = manager.getStats();
    assert.strictEqual(stats.providers['slow-provider']?.active, 2);
    assert.strictEqual(stats.providers['fast-provider']?.active, 1);
    assert.strictEqual(stats.global.active, 3);

    // Cleanup
    fastSlot.release();
    for (const s of slowSlots) s.release();
  });
});

// ============================================================================
// Scenario 3: Provider Isolation Verification
// ============================================================================

describe('Load: Provider isolation verification', () => {
  it('should not let slow Provider A starve fast Provider B', async () => {
    const slowDelayMs = 200;
    const providerALimit = 5;
    const globalLimit = 10;

    const executorConfig = makeExecutorConfig({
      globalLimit,
      providerLimits: { 'provider-a': providerALimit, 'provider-b': 5 },
      queueSize: 0,
    });

    const slowAdapter = new LoadTestAdapter('provider-a', slowDelayMs);
    const fastAdapter = new LoadTestAdapter('provider-b', 1);
    const executor = new ProtectedExecutor(executorConfig);

    // Launch slow requests to Provider A (fill its slots)
    const slowPromises = Array.from({ length: providerALimit }, (_, i) => {
      const history = new AttemptHistoryRecorder();
      return executor.execute(
        slowAdapter,
        makeRequest({ provider: 'provider-a' }),
        AttemptPhase.PRIMARY,
        i + 1,
        history
      );
    });

    // Immediately launch fast requests to Provider B
    const fastStart = performance.now();
    const fastPromises = Array.from({ length: 3 }, (_, i) => {
      const history = new AttemptHistoryRecorder();
      return executor.execute(
        fastAdapter,
        makeRequest({ provider: 'provider-b' }),
        AttemptPhase.PRIMARY,
        i + 1,
        history
      );
    });

    // Fast requests should complete well before slow ones
    const fastResults = await Promise.all(fastPromises);
    const fastElapsed = performance.now() - fastStart;

    // Wait for slow requests to also finish
    await Promise.all(slowPromises);

    // All fast requests should succeed
    for (const r of fastResults) {
      assert.strictEqual(r.provider, 'provider-b');
    }

    // Fast requests should complete much faster than the slow delay
    // Allow generous overhead but should be well under slowDelayMs
    console.log(`  [Isolation] Fast provider completed in ${fastElapsed.toFixed(1)}ms (slow delay: ${slowDelayMs}ms)`);
    assert.ok(
      fastElapsed < slowDelayMs + 50,
      `Fast provider took ${fastElapsed.toFixed(1)}ms, expected < ${slowDelayMs + 50}ms`
    );
  });
});

// ============================================================================
// Scenario 4: Graceful Overload Rejection
// ============================================================================

describe('Load: Graceful overload rejection', () => {
  it('should reject immediately with OverloadError when all slots are full and queueSize=0', async () => {
    const globalLimit = 2;
    const manager = new ConcurrencyManager({
      globalLimit,
      providerLimits: {},
      queueSize: 0,
    });

    // Fill all slots with long-lived holds
    const slots = [
      await manager.acquire('provider-x'),
      await manager.acquire('provider-x'),
    ];

    // Measure rejection latency for multiple requests
    const rejectionLatencies: number[] = [];

    const rejectPromises = Array.from({ length: 10 }, async () => {
      const start = performance.now();
      try {
        await manager.acquire('provider-x');
        assert.fail('Should have thrown OverloadError');
      } catch (err) {
        const elapsed = performance.now() - start;
        rejectionLatencies.push(elapsed);
        assert.ok(isRouterError(err));
        assert.strictEqual(err.code, ErrorCode.OVERLOAD_ERROR);
      }
    });

    await Promise.all(rejectPromises);

    rejectionLatencies.sort((a, b) => a - b);
    const p50 = percentile(rejectionLatencies, 50);
    const p95 = percentile(rejectionLatencies, 95);
    const max = rejectionLatencies[rejectionLatencies.length - 1]!;

    console.log(`  [Overload Rejection] p50=${p50.toFixed(2)}ms p95=${p95.toFixed(2)}ms max=${max.toFixed(2)}ms`);

    // Rejection should be near-instant (< 5ms)
    assert.ok(p95 < 5, `Rejection p95 latency ${p95.toFixed(2)}ms exceeds 5ms`);

    // Cleanup
    for (const s of slots) s.release();
  });

  it('should reject via executor with OverloadError when concurrency is full', async () => {
    const globalLimit = 2;
    const executorConfig = makeExecutorConfig({
      globalLimit,
      providerLimits: {},
      queueSize: 0,
    });

    const adapter = new LoadTestAdapter('overload-provider', 200);
    const executor = new ProtectedExecutor(executorConfig);

    // Launch requests that fill up concurrency
    const fillerPromises = Array.from({ length: globalLimit }, (_, i) => {
      const history = new AttemptHistoryRecorder();
      return executor.execute(adapter, makeRequest(), AttemptPhase.PRIMARY, i + 1, history);
    });

    // Small delay to ensure fillers have acquired slots
    await new Promise((resolve) => setTimeout(resolve, 10));

    // This request should be rejected
    const history = new AttemptHistoryRecorder();
    await assert.rejects(
      () => executor.execute(adapter, makeRequest(), AttemptPhase.PRIMARY, 99, history),
      (err: unknown) => {
        assert.ok(isRouterError(err));
        assert.strictEqual(err.code, ErrorCode.OVERLOAD_ERROR);
        return true;
      }
    );

    await Promise.allSettled(fillerPromises);
  });
});

// ============================================================================
// Scenario 5: Latency Overhead Benchmark
// ============================================================================

describe('Load: Latency overhead benchmark', () => {
  it('should add < 50ms p95 overhead vs direct adapter calls', async () => {
    const iterations = 50;
    const adapter = new LoadTestAdapter('bench-provider', 0); // zero-delay adapter

    // Measure direct adapter call latency
    const directLatencies: number[] = [];
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      await adapter.chat(makeRequest());
      directLatencies.push(performance.now() - start);
    }

    // Measure executor-wrapped call latency
    const executorConfig = makeExecutorConfig({
      globalLimit: 50,
      providerLimits: {},
      queueSize: 0,
    });
    const executor = new ProtectedExecutor(executorConfig);

    const executorLatencies: number[] = [];
    for (let i = 0; i < iterations; i++) {
      const history = new AttemptHistoryRecorder();
      const start = performance.now();
      await executor.execute(adapter, makeRequest(), AttemptPhase.PRIMARY, 1, history);
      executorLatencies.push(performance.now() - start);
    }

    directLatencies.sort((a, b) => a - b);
    executorLatencies.sort((a, b) => a - b);

    const directP50 = percentile(directLatencies, 50);
    const directP95 = percentile(directLatencies, 95);
    const executorP50 = percentile(executorLatencies, 50);
    const executorP95 = percentile(executorLatencies, 95);
    const overheadP50 = executorP50 - directP50;
    const overheadP95 = executorP95 - directP95;

    console.log(`  [Latency Benchmark] Direct:   p50=${directP50.toFixed(2)}ms  p95=${directP95.toFixed(2)}ms`);
    console.log(`  [Latency Benchmark] Executor: p50=${executorP50.toFixed(2)}ms  p95=${executorP95.toFixed(2)}ms`);
    console.log(`  [Latency Benchmark] Overhead: p50=${overheadP50.toFixed(2)}ms  p95=${overheadP95.toFixed(2)}ms`);

    assert.ok(
      overheadP95 < 50,
      `Executor p95 overhead ${overheadP95.toFixed(2)}ms exceeds 50ms target`
    );
  });
});

// ============================================================================
// Scenario 6: Throughput Baseline
// ============================================================================

describe('Load: Throughput baseline', () => {
  it('should measure throughput at various concurrency levels', async () => {
    const concurrencyLevels = [1, 5, 10, 20];
    const requestsPerLevel = 50;

    console.log('  [Throughput Baseline]');

    for (const concurrency of concurrencyLevels) {
      const adapter = new LoadTestAdapter('throughput-provider', 1); // 1ms simulated work
      const executorConfig = makeExecutorConfig({
        globalLimit: concurrency,
        providerLimits: {},
        queueSize: 0,
      });
      const executor = new ProtectedExecutor(executorConfig);

      const startTime = performance.now();
      let completed = 0;
      let rejected = 0;

      // Launch requests in batches that match the concurrency level
      const batchSize = concurrency;
      const batches = Math.ceil(requestsPerLevel / batchSize);

      for (let batch = 0; batch < batches; batch++) {
        const batchCount = Math.min(batchSize, requestsPerLevel - batch * batchSize);
        const promises = Array.from({ length: batchCount }, (_, i) => {
          const history = new AttemptHistoryRecorder();
          return executor.execute(
            adapter,
            makeRequest(),
            AttemptPhase.PRIMARY,
            batch * batchSize + i + 1,
            history
          ).then(() => { completed++; })
           .catch(() => { rejected++; });
        });
        await Promise.all(promises);
      }

      const elapsed = performance.now() - startTime;
      const throughput = (completed / elapsed) * 1000; // requests per second

      console.log(
        `    concurrency=${String(concurrency).padStart(2)} ` +
        `completed=${String(completed).padStart(3)} ` +
        `rejected=${String(rejected).padStart(2)} ` +
        `elapsed=${elapsed.toFixed(0).padStart(5)}ms ` +
        `throughput=${throughput.toFixed(1).padStart(8)} req/s`
      );

      // Basic sanity: all requests should complete (batched within limits)
      assert.strictEqual(completed, requestsPerLevel);
      assert.strictEqual(rejected, 0);
    }
  });
});
