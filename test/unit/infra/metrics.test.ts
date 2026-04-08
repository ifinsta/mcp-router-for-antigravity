/**
 * MetricsCollector unit tests
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MetricsCollector } from '../../../src/infra/metrics.js';
import { CircuitBreakerState } from '../../../src/core/types.js';

describe('MetricsCollector', () => {
  let collector: MetricsCollector;

  beforeEach(() => {
    collector = new MetricsCollector();
  });

  // ---------- Counters ----------

  describe('counters', () => {
    it('increments requestCount', () => {
      collector.incrementRequestCount();
      collector.incrementRequestCount();
      const snap = collector.getSnapshot();
      assert.equal(snap.counters.requestCount, 2);
    });

    it('increments successCount', () => {
      collector.incrementSuccessCount();
      const snap = collector.getSnapshot();
      assert.equal(snap.counters.successCount, 1);
    });

    it('increments failureCount', () => {
      collector.incrementFailureCount();
      collector.incrementFailureCount();
      collector.incrementFailureCount();
      const snap = collector.getSnapshot();
      assert.equal(snap.counters.failureCount, 3);
    });

    it('increments retryCount', () => {
      collector.incrementRetryCount();
      const snap = collector.getSnapshot();
      assert.equal(snap.counters.retryCount, 1);
    });

    it('increments fallbackCount', () => {
      collector.incrementFallbackCount();
      const snap = collector.getSnapshot();
      assert.equal(snap.counters.fallbackCount, 1);
    });

    it('increments overloadRejectionCount', () => {
      collector.incrementOverloadRejectionCount();
      collector.incrementOverloadRejectionCount();
      const snap = collector.getSnapshot();
      assert.equal(snap.counters.overloadRejectionCount, 2);
    });
  });

  // ---------- Latency ----------

  describe('latency recording and percentiles', () => {
    it('returns zeroed percentiles when no samples exist', () => {
      const snap = collector.getSnapshot();
      assert.equal(snap.latency.p50, 0);
      assert.equal(snap.latency.p95, 0);
      assert.equal(snap.latency.p99, 0);
      assert.equal(snap.latency.count, 0);
      assert.equal(snap.latency.mean, 0);
    });

    it('records single latency sample', () => {
      collector.recordLatencyMs(100);
      const snap = collector.getSnapshot();
      assert.equal(snap.latency.count, 1);
      assert.equal(snap.latency.min, 100);
      assert.equal(snap.latency.max, 100);
      assert.equal(snap.latency.mean, 100);
    });

    it('calculates percentiles from multiple samples', () => {
      // Add 100 samples: 1..100
      for (let i = 1; i <= 100; i++) {
        collector.recordLatencyMs(i);
      }
      const snap = collector.getSnapshot();
      assert.equal(snap.latency.count, 100);
      assert.equal(snap.latency.min, 1);
      assert.equal(snap.latency.max, 100);
      // p50 -> sorted[50] = 51 (0-indexed floor(100*0.5)=50 => value 51)
      assert.equal(snap.latency.p50, 51);
      // p95 -> sorted[95] = 96
      assert.equal(snap.latency.p95, 96);
      // p99 -> sorted[99] = 100
      assert.equal(snap.latency.p99, 100);
    });

    it('calculates mean correctly', () => {
      collector.recordLatencyMs(10);
      collector.recordLatencyMs(20);
      collector.recordLatencyMs(30);
      const snap = collector.getSnapshot();
      assert.equal(snap.latency.mean, 20);
    });
  });

  // ---------- Breaker transitions ----------

  describe('breaker transition recording', () => {
    it('records a breaker transition', () => {
      collector.recordBreakerTransition(
        'openai',
        CircuitBreakerState.CLOSED,
        CircuitBreakerState.OPEN,
      );

      const snap = collector.getSnapshot();
      assert.equal(snap.breakerTransitions.length, 1);
      assert.equal(snap.breakerTransitions[0]?.provider, 'openai');
      assert.equal(snap.breakerTransitions[0]?.from, CircuitBreakerState.CLOSED);
      assert.equal(snap.breakerTransitions[0]?.to, CircuitBreakerState.OPEN);
      assert.ok(typeof snap.breakerTransitions[0]?.timestamp === 'number');
    });

    it('records multiple transitions', () => {
      collector.recordBreakerTransition('a', CircuitBreakerState.CLOSED, CircuitBreakerState.OPEN);
      collector.recordBreakerTransition('a', CircuitBreakerState.OPEN, CircuitBreakerState.HALF_OPEN);
      collector.recordBreakerTransition('a', CircuitBreakerState.HALF_OPEN, CircuitBreakerState.CLOSED);

      const snap = collector.getSnapshot();
      assert.equal(snap.breakerTransitions.length, 3);
    });
  });

  // ---------- Concurrency gauge ----------

  describe('concurrency gauge tracking', () => {
    it('tracks global and per-provider concurrency', () => {
      collector.setActiveConcurrency(3, 'openai', 2);
      collector.setActiveConcurrency(3, 'glm', 1);

      const snap = collector.getSnapshot();
      assert.equal(snap.gauges.activeConcurrency.global, 3);
      assert.equal(snap.gauges.activeConcurrency.providers['openai'], 2);
      assert.equal(snap.gauges.activeConcurrency.providers['glm'], 1);
    });

    it('updates gauge on change', () => {
      collector.setActiveConcurrency(1, 'openai', 1);
      collector.setActiveConcurrency(0, 'openai', 0);

      const snap = collector.getSnapshot();
      assert.equal(snap.gauges.activeConcurrency.global, 0);
      assert.equal(snap.gauges.activeConcurrency.providers['openai'], 0);
    });
  });

  // ---------- Snapshot ----------

  describe('getSnapshot()', () => {
    it('returns all metric categories', () => {
      collector.incrementRequestCount();
      collector.incrementSuccessCount();
      collector.recordLatencyMs(50);
      collector.setActiveConcurrency(1, 'test', 1);
      collector.recordBreakerTransition('test', CircuitBreakerState.CLOSED, CircuitBreakerState.OPEN);

      const snap = collector.getSnapshot();

      assert.ok('counters' in snap);
      assert.ok('gauges' in snap);
      assert.ok('latency' in snap);
      assert.ok('breakerTransitions' in snap);
      assert.ok('collectedSince' in snap);

      assert.equal(snap.counters.requestCount, 1);
      assert.equal(snap.counters.successCount, 1);
      assert.equal(snap.latency.count, 1);
      assert.equal(snap.gauges.activeConcurrency.global, 1);
      assert.equal(snap.breakerTransitions.length, 1);
      assert.ok(typeof snap.collectedSince === 'number');
    });

    it('returns a defensive copy of breaker transitions', () => {
      collector.recordBreakerTransition('a', CircuitBreakerState.CLOSED, CircuitBreakerState.OPEN);
      const snap1 = collector.getSnapshot();
      snap1.breakerTransitions.length = 0; // mutate the copy

      const snap2 = collector.getSnapshot();
      assert.equal(snap2.breakerTransitions.length, 1); // original unchanged
    });
  });

  // ---------- Reset ----------

  describe('reset()', () => {
    it('clears all metrics', () => {
      collector.incrementRequestCount();
      collector.incrementSuccessCount();
      collector.incrementFailureCount();
      collector.incrementRetryCount();
      collector.incrementFallbackCount();
      collector.incrementOverloadRejectionCount();
      collector.recordLatencyMs(100);
      collector.setActiveConcurrency(2, 'openai', 2);
      collector.recordBreakerTransition('openai', CircuitBreakerState.CLOSED, CircuitBreakerState.OPEN);

      collector.reset();

      const snap = collector.getSnapshot();
      assert.equal(snap.counters.requestCount, 0);
      assert.equal(snap.counters.successCount, 0);
      assert.equal(snap.counters.failureCount, 0);
      assert.equal(snap.counters.retryCount, 0);
      assert.equal(snap.counters.fallbackCount, 0);
      assert.equal(snap.counters.overloadRejectionCount, 0);
      assert.equal(snap.latency.count, 0);
      assert.equal(snap.gauges.activeConcurrency.global, 0);
      assert.equal(snap.breakerTransitions.length, 0);
    });
  });
});
