/**
 * Metrics Collector
 *
 * Lightweight in-memory metrics collection for observability.
 * Tracks counters, gauges, histograms, and state transitions.
 * Surfaces data through the health endpoint.
 */

import { getLogger } from './logger.js';
import type { CircuitBreakerState, MetricsSnapshot } from '../core/types.js';

const logger = getLogger('metrics');

// ============================================================================
// Metric Types
// ============================================================================

/**
 * A recorded breaker state transition
 */
export interface BreakerTransitionRecord {
  provider: string;
  from: CircuitBreakerState;
  to: CircuitBreakerState;
  timestamp: number;
}

// Re-export MetricsSnapshot from types for external consumers
export type { MetricsSnapshot } from '../core/types.js';

/**
 * Concurrency gauge snapshot
 */
export interface ConcurrencyGauge {
  global: number;
  providers: Record<string, number>;
}

/**
 * Latency percentiles
 */
export interface LatencyPercentiles {
  p50: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  count: number;
  mean: number;
}

/**
 * Full metrics snapshot returned by getSnapshot()
 */
// Uses MetricsSnapshot from core/types.ts

// ============================================================================
// MetricsCollector
// ============================================================================

export class MetricsCollector {
  // Counters
  private requestCount: number = 0;
  private successCount: number = 0;
  private failureCount: number = 0;
  private retryCount: number = 0;
  private fallbackCount: number = 0;
  private overloadRejectionCount: number = 0;
  private cacheHitCount: number = 0;
  private cacheMissCount: number = 0;

  // Gauges
  private globalActiveConcurrency: number = 0;
  private providerActiveConcurrency: Map<string, number> = new Map();

  // Histogram (sorted insert for percentile calculation)
  private latencySamples: number[] = [];
  private static readonly MAX_LATENCY_SAMPLES = 10_000;

  // State transitions
  private breakerTransitions: BreakerTransitionRecord[] = [];
  private static readonly MAX_BREAKER_RECORDS = 1_000;

  // Metadata
  private collectedSince: number = Date.now();

  // ---- Counter increments ----

  incrementRequestCount(): void {
    this.requestCount++;
  }

  incrementSuccessCount(): void {
    this.successCount++;
  }

  incrementFailureCount(): void {
    this.failureCount++;
  }

  incrementRetryCount(): void {
    this.retryCount++;
  }

  incrementFallbackCount(): void {
    this.fallbackCount++;
  }

  incrementOverloadRejectionCount(): void {
    this.overloadRejectionCount++;
  }

  incrementCacheHitCount(): void {
    this.cacheHitCount++;
  }

  incrementCacheMissCount(): void {
    this.cacheMissCount++;
  }

  getCacheHitCount(): number {
    return this.cacheHitCount;
  }

  getCacheMissCount(): number {
    return this.cacheMissCount;
  }

  // ---- Latency recording ----

  recordLatencyMs(ms: number): void {
    if (this.latencySamples.length >= MetricsCollector.MAX_LATENCY_SAMPLES) {
      // Drop oldest sample (ring-buffer style)
      this.latencySamples.shift();
    }
    this.latencySamples.push(ms);
  }

  // ---- Concurrency gauge ----

  setActiveConcurrency(global: number, provider: string, providerActive: number): void {
    this.globalActiveConcurrency = global;
    this.providerActiveConcurrency.set(provider, providerActive);
  }

  // ---- Breaker transitions ----

  recordBreakerTransition(
    provider: string,
    from: CircuitBreakerState,
    to: CircuitBreakerState,
  ): void {
    if (this.breakerTransitions.length >= MetricsCollector.MAX_BREAKER_RECORDS) {
      this.breakerTransitions.shift();
    }

    const record: BreakerTransitionRecord = {
      provider,
      from,
      to,
      timestamp: Date.now(),
    };

    this.breakerTransitions.push(record);

    logger.info('Circuit breaker transition recorded', {
      provider,
      from,
      to,
    });
  }

  // ---- Snapshot ----

  getSnapshot(): MetricsSnapshot {
    const providers: Record<string, number> = {};
    for (const [name, count] of this.providerActiveConcurrency) {
      providers[name] = count;
    }

    return {
      counters: {
        requestCount: this.requestCount,
        successCount: this.successCount,
        failureCount: this.failureCount,
        retryCount: this.retryCount,
        fallbackCount: this.fallbackCount,
        overloadRejectionCount: this.overloadRejectionCount,
      },
      gauges: {
        activeConcurrency: {
          global: this.globalActiveConcurrency,
          providers,
        },
      },
      latency: this.calculateLatencyPercentiles(),
      breakerTransitions: [...this.breakerTransitions],
      collectedSince: this.collectedSince,
    };
  }

  // ---- Reset ----

  reset(): void {
    this.requestCount = 0;
    this.successCount = 0;
    this.failureCount = 0;
    this.retryCount = 0;
    this.fallbackCount = 0;
    this.overloadRejectionCount = 0;
    this.cacheHitCount = 0;
    this.cacheMissCount = 0;
    this.globalActiveConcurrency = 0;
    this.providerActiveConcurrency.clear();
    this.latencySamples = [];
    this.breakerTransitions = [];
    this.collectedSince = Date.now();

    logger.debug('Metrics collector reset');
  }

  // ---- Private helpers ----

  private calculateLatencyPercentiles(): LatencyPercentiles {
    if (this.latencySamples.length === 0) {
      return { p50: 0, p95: 0, p99: 0, min: 0, max: 0, count: 0, mean: 0 };
    }

    const sorted = [...this.latencySamples].sort((a, b) => a - b);
    const count = sorted.length;
    const sum = sorted.reduce((acc, v) => acc + v, 0);

    return {
      p50: sorted[Math.floor(count * 0.5)] ?? 0,
      p95: sorted[Math.floor(count * 0.95)] ?? 0,
      p99: sorted[Math.floor(count * 0.99)] ?? 0,
      min: sorted[0] ?? 0,
      max: sorted[count - 1] ?? 0,
      count,
      mean: Math.round(sum / count),
    };
  }
}

// ============================================================================
// Singleton access
// ============================================================================

let instance: MetricsCollector | null = null;

/**
 * Get the global MetricsCollector instance.
 * Creates one on first call.
 */
export function getMetricsCollector(): MetricsCollector {
  if (!instance) {
    instance = new MetricsCollector();
  }
  return instance;
}

/**
 * Replace the global MetricsCollector (useful for testing).
 */
export function setMetricsCollector(collector: MetricsCollector): void {
  instance = collector;
}

/**
 * Reset the global MetricsCollector singleton (useful for testing).
 */
export function resetMetricsCollector(): void {
  if (instance) {
    instance.reset();
  }
  instance = null;
}
