/**
 * Unit tests for ResponseCache
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  ResponseCache,
  generateCacheKey,
  resetResponseCache,
  getResponseCache,
} from '../../../src/core/cache.js';
import { resetMetricsCollector, getMetricsCollector } from '../../../src/infra/metrics.js';
import type { NormalizedChatRequest, NormalizedChatResponse } from '../../../src/core/types.js';

// ============================================================================
// Helpers
// ============================================================================

function makeRequest(overrides?: Partial<NormalizedChatRequest>): NormalizedChatRequest {
  return {
    provider: 'openai',
    model: 'gpt-4.1-mini',
    messages: [{ role: 'user', content: 'Hello' }],
    temperature: 0.7,
    maxTokens: 100,
    ...overrides,
  };
}

function makeResponse(overrides?: Partial<NormalizedChatResponse>): NormalizedChatResponse {
  return {
    provider: 'openai',
    model: 'gpt-4.1-mini',
    outputText: 'Hi there!',
    finishReason: 'stop',
    usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8, accuracy: 'exact' },
    latencyMs: 120,
    costEstimate: 0.001,
    warnings: [],
    fallbackUsed: false,
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('ResponseCache', () => {
  beforeEach(() => {
    resetResponseCache();
    resetMetricsCollector();
  });

  describe('set and get', () => {
    it('should return cached response for a stored key', () => {
      const cache = new ResponseCache();
      const key = 'test-key-1';
      const response = makeResponse();
      cache.set(key, response);

      const result = cache.get(key);
      assert.ok(result);
      assert.strictEqual(result.outputText, 'Hi there!');
      assert.strictEqual(result.provider, 'openai');
    });

    it('should return undefined for a cache miss', () => {
      const cache = new ResponseCache();
      const result = cache.get('nonexistent-key');
      assert.strictEqual(result, undefined);
    });
  });

  describe('TTL expiration', () => {
    it('should return undefined after TTL expires', async () => {
      const cache = new ResponseCache({ defaultTtlMs: 50 });
      const key = 'ttl-key';
      cache.set(key, makeResponse());

      // Verify it exists before expiry
      assert.ok(cache.get(key));

      // Wait for TTL to expire
      await new Promise<void>((resolve) => setTimeout(resolve, 80));

      const result = cache.get(key);
      assert.strictEqual(result, undefined);
    });

    it('should respect per-entry TTL override', async () => {
      const cache = new ResponseCache({ defaultTtlMs: 5000 });
      const key = 'short-ttl';
      cache.set(key, makeResponse(), 50);

      await new Promise<void>((resolve) => setTimeout(resolve, 80));

      assert.strictEqual(cache.get(key), undefined);
    });
  });

  describe('LRU eviction', () => {
    it('should evict oldest entry when at capacity', () => {
      const cache = new ResponseCache({ maxSize: 3 });

      cache.set('a', makeResponse({ outputText: 'A' }));
      cache.set('b', makeResponse({ outputText: 'B' }));
      cache.set('c', makeResponse({ outputText: 'C' }));

      // Cache is full (3/3). Adding a 4th should evict 'a'.
      cache.set('d', makeResponse({ outputText: 'D' }));

      assert.strictEqual(cache.get('a'), undefined); // evicted
      assert.ok(cache.get('b'));
      assert.ok(cache.get('c'));
      assert.ok(cache.get('d'));
    });

    it('should update LRU order on get (accessed entry survives eviction)', () => {
      const cache = new ResponseCache({ maxSize: 3 });

      cache.set('a', makeResponse({ outputText: 'A' }));
      cache.set('b', makeResponse({ outputText: 'B' }));
      cache.set('c', makeResponse({ outputText: 'C' }));

      // Access 'a' so it becomes most-recently used
      cache.get('a');

      // Adding 'd' should evict 'b' (oldest untouched)
      cache.set('d', makeResponse({ outputText: 'D' }));

      assert.ok(cache.get('a')); // survived
      assert.strictEqual(cache.get('b'), undefined); // evicted
      assert.ok(cache.get('c'));
      assert.ok(cache.get('d'));
    });
  });

  describe('generateCacheKey', () => {
    it('should produce deterministic keys for identical requests', () => {
      const req1 = makeRequest();
      const req2 = makeRequest();

      assert.strictEqual(generateCacheKey(req1), generateCacheKey(req2));
    });

    it('should produce different keys for different requests', () => {
      const req1 = makeRequest({ model: 'gpt-4.1-mini' });
      const req2 = makeRequest({ model: 'gpt-4.1' });

      assert.notStrictEqual(generateCacheKey(req1), generateCacheKey(req2));
    });

    it('should produce different keys for different messages', () => {
      const req1 = makeRequest({ messages: [{ role: 'user', content: 'Hello' }] });
      const req2 = makeRequest({ messages: [{ role: 'user', content: 'Goodbye' }] });

      assert.notStrictEqual(generateCacheKey(req1), generateCacheKey(req2));
    });

    it('should produce different keys for different temperatures', () => {
      const req1 = makeRequest({ temperature: 0.5 });
      const req2 = makeRequest({ temperature: 1.0 });

      assert.notStrictEqual(generateCacheKey(req1), generateCacheKey(req2));
    });

    it('should return a hex string of 64 characters (SHA-256)', () => {
      const key = generateCacheKey(makeRequest());
      assert.strictEqual(key.length, 64);
      assert.match(key, /^[0-9a-f]{64}$/);
    });
  });

  describe('invalidate', () => {
    it('should remove a specific entry and return true', () => {
      const cache = new ResponseCache();
      cache.set('k1', makeResponse());
      const result = cache.invalidate('k1');

      assert.strictEqual(result, true);
      assert.strictEqual(cache.get('k1'), undefined);
    });

    it('should return false for a non-existent key', () => {
      const cache = new ResponseCache();
      assert.strictEqual(cache.invalidate('nope'), false);
    });
  });

  describe('clear', () => {
    it('should remove all entries', () => {
      const cache = new ResponseCache();
      cache.set('a', makeResponse());
      cache.set('b', makeResponse());
      cache.clear();

      assert.strictEqual(cache.getStats().size, 0);
      assert.strictEqual(cache.get('a'), undefined);
      assert.strictEqual(cache.get('b'), undefined);
    });
  });

  describe('getStats', () => {
    it('should return correct initial stats', () => {
      const cache = new ResponseCache({ maxSize: 50 });
      const stats = cache.getStats();

      assert.strictEqual(stats.size, 0);
      assert.strictEqual(stats.maxSize, 50);
      assert.strictEqual(stats.hits, 0);
      assert.strictEqual(stats.misses, 0);
      assert.strictEqual(stats.hitRate, 0);
      assert.strictEqual(stats.evictions, 0);
    });

    it('should track hits and misses correctly', () => {
      const cache = new ResponseCache();
      cache.set('k1', makeResponse());

      cache.get('k1'); // hit
      cache.get('k1'); // hit
      cache.get('missing'); // miss

      const stats = cache.getStats();
      assert.strictEqual(stats.hits, 2);
      assert.strictEqual(stats.misses, 1);
      assert.ok(Math.abs(stats.hitRate - 2 / 3) < 0.001);
    });

    it('should track evictions', () => {
      const cache = new ResponseCache({ maxSize: 2 });
      cache.set('a', makeResponse());
      cache.set('b', makeResponse());
      cache.set('c', makeResponse()); // evicts 'a'

      assert.strictEqual(cache.getStats().evictions, 1);
    });
  });

  describe('metrics integration', () => {
    it('should increment cache hit counter on MetricsCollector', () => {
      const cache = new ResponseCache();
      cache.set('k1', makeResponse());

      cache.get('k1');

      const metrics = getMetricsCollector();
      assert.strictEqual(metrics.getCacheHitCount(), 1);
      assert.strictEqual(metrics.getCacheMissCount(), 0);
    });

    it('should increment cache miss counter on MetricsCollector', () => {
      const cache = new ResponseCache();
      cache.get('missing');

      const metrics = getMetricsCollector();
      assert.strictEqual(metrics.getCacheHitCount(), 0);
      assert.strictEqual(metrics.getCacheMissCount(), 1);
    });
  });

  describe('singleton', () => {
    it('should return the same instance from getResponseCache()', () => {
      const a = getResponseCache();
      const b = getResponseCache();
      assert.strictEqual(a, b);
    });

    it('should return a fresh instance after resetResponseCache()', () => {
      const a = getResponseCache();
      a.set('k1', makeResponse());

      resetResponseCache();

      const b = getResponseCache();
      assert.notStrictEqual(a, b);
      assert.strictEqual(b.getStats().size, 0);
    });
  });
});
