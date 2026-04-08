/**
 * Response Cache Layer
 *
 * LRU cache with TTL for normalized chat responses.
 * Provides deterministic cache key generation via SHA-256
 * and integrates with MetricsCollector for observability.
 */

import { createHash } from 'node:crypto';
import { getLogger } from '../infra/logger.js';
import { getMetricsCollector } from '../infra/metrics.js';
import type { NormalizedChatRequest, NormalizedChatResponse, CacheStats } from './types.js';

export type { CacheStats } from './types.js';

const logger = getLogger('cache');

// ============================================================================
// Cache Entry
// ============================================================================

interface CacheEntry {
  /** The cached response */
  response: NormalizedChatResponse;
  /** When the entry was created (ms timestamp) */
  createdAt: number;
  /** TTL for this entry in milliseconds */
  ttlMs: number;
}

// ============================================================================
// Cache Key Generation
// ============================================================================

/**
 * Generate a deterministic cache key from a normalized chat request.
 * Uses SHA-256 hash of a canonical JSON serialization of the
 * cache-relevant fields: provider, model, messages, temperature, maxTokens.
 */
export function generateCacheKey(request: NormalizedChatRequest): string {
  const keyPayload = {
    provider: request.provider ?? null,
    model: request.model ?? null,
    messages: request.messages.map((m) => ({
      role: m.role,
      content: m.content,
      name: m.name ?? null,
    })),
    temperature: request.temperature ?? null,
    maxTokens: request.maxTokens ?? null,
  };

  const canonical = JSON.stringify(keyPayload);
  return createHash('sha256').update(canonical).digest('hex');
}

// ============================================================================
// ResponseCache
// ============================================================================

/**
 * LRU response cache with per-entry TTL and metrics integration.
 */
export class ResponseCache {
  private readonly maxSize: number;
  private readonly defaultTtlMs: number;

  /** Map preserves insertion order; we rely on that for LRU eviction. */
  private readonly entries: Map<string, CacheEntry> = new Map();

  // Stats
  private hitCount: number = 0;
  private missCount: number = 0;
  private evictionCount: number = 0;

  constructor(options?: {
    maxSize?: number | undefined;
    defaultTtlMs?: number | undefined;
  }) {
    this.maxSize = options?.maxSize ?? 100;
    this.defaultTtlMs = options?.defaultTtlMs ?? 300_000; // 5 minutes
  }

  /**
   * Retrieve a cached response by key.
   * Returns undefined on miss or if the entry has expired.
   * Updates LRU order on hit.
   */
  get(key: string): NormalizedChatResponse | undefined {
    const entry = this.entries.get(key);

    if (!entry) {
      this.missCount++;
      getMetricsCollector().incrementCacheMissCount();
      logger.debug('Cache miss', { key: key.slice(0, 12) });
      return undefined;
    }

    // Check TTL expiration
    if (Date.now() - entry.createdAt > entry.ttlMs) {
      this.entries.delete(key);
      this.missCount++;
      getMetricsCollector().incrementCacheMissCount();
      logger.debug('Cache entry expired', { key: key.slice(0, 12) });
      return undefined;
    }

    // Move to end (most-recently used) by re-inserting
    this.entries.delete(key);
    this.entries.set(key, entry);

    this.hitCount++;
    getMetricsCollector().incrementCacheHitCount();
    logger.debug('Cache hit', { key: key.slice(0, 12) });

    return entry.response;
  }

  /**
   * Store a response in the cache.
   * Evicts the least-recently-used entry if at capacity.
   */
  set(key: string, response: NormalizedChatResponse, ttlMs?: number): void {
    // If key already exists, delete first so re-insert moves it to end
    if (this.entries.has(key)) {
      this.entries.delete(key);
    }

    // Evict LRU if at capacity
    while (this.entries.size >= this.maxSize) {
      const oldestKey = this.entries.keys().next().value as string;
      this.entries.delete(oldestKey);
      this.evictionCount++;
      logger.debug('Cache eviction (LRU)', { evictedKey: oldestKey.slice(0, 12) });
    }

    this.entries.set(key, {
      response,
      createdAt: Date.now(),
      ttlMs: ttlMs ?? this.defaultTtlMs,
    });

    logger.debug('Cache set', { key: key.slice(0, 12), size: this.entries.size });
  }

  /**
   * Remove a specific entry from the cache.
   * Returns true if the entry existed and was removed.
   */
  invalidate(key: string): boolean {
    const existed = this.entries.delete(key);
    if (existed) {
      logger.debug('Cache invalidated', { key: key.slice(0, 12) });
    }
    return existed;
  }

  /**
   * Remove all entries from the cache.
   */
  clear(): void {
    const previousSize = this.entries.size;
    this.entries.clear();
    logger.debug('Cache cleared', { previousSize });
  }

  /**
   * Return current cache statistics.
   */
  getStats(): CacheStats {
    const total = this.hitCount + this.missCount;
    return {
      size: this.entries.size,
      maxSize: this.maxSize,
      hits: this.hitCount,
      misses: this.missCount,
      hitRate: total > 0 ? this.hitCount / total : 0,
      evictions: this.evictionCount,
    };
  }
}

// ============================================================================
// Singleton access
// ============================================================================

let instance: ResponseCache | null = null;

/**
 * Get the global ResponseCache instance.
 * Creates one on first call.
 */
export function getResponseCache(): ResponseCache {
  if (!instance) {
    instance = new ResponseCache();
  }
  return instance;
}

/**
 * Replace the global ResponseCache (useful for testing).
 */
export function setResponseCache(cache: ResponseCache): void {
  instance = cache;
}

/**
 * Reset the global ResponseCache singleton (useful for testing).
 */
export function resetResponseCache(): void {
  if (instance) {
    instance.clear();
  }
  instance = null;
}
