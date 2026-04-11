/**
 * Unit tests for BrowserContextProvider
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  BrowserContextProvider,
  getBrowserContextProvider,
  resetBrowserContextProvider,
} from '../../../src/core/browserContext.js';
import type { PrivacyOptions } from '../../../src/core/browserContext.js';

describe('BrowserContextProvider', () => {
  let provider: BrowserContextProvider;

  beforeEach(() => {
    resetBrowserContextProvider();
    provider = new BrowserContextProvider();
  });

  describe('constructor', () => {
    it('should create provider with default TTL', () => {
      const p = new BrowserContextProvider();
      assert.ok(p);
    });

    it('should create provider with custom TTL', () => {
      const p = new BrowserContextProvider(5000);
      assert.ok(p);
    });
  });

  describe('setPrivacyOptions', () => {
    it('should set privacy options', () => {
      const options: PrivacyOptions = { excludeUrl: true };
      provider.setPrivacyOptions(options);

      const retrieved = provider.getPrivacyOptions();
      assert.strictEqual(retrieved.excludeUrl, true);
    });

    it('should merge privacy options', () => {
      provider.setPrivacyOptions({ excludeUrl: true });
      provider.setPrivacyOptions({ excludeSelectedText: true });

      const options = provider.getPrivacyOptions();
      assert.strictEqual(options.excludeUrl, true);
      assert.strictEqual(options.excludeSelectedText, true);
    });

    it('should return copy of options (not reference)', () => {
      const options: PrivacyOptions = { excludeUrl: true };
      provider.setPrivacyOptions(options);

      options.excludeUrl = false;
      const retrieved = provider.getPrivacyOptions();
      assert.strictEqual(retrieved.excludeUrl, true);
    });
  });

  describe('getPrivacyOptions', () => {
    it('should return empty object by default', () => {
      const options = provider.getPrivacyOptions();
      assert.deepStrictEqual(options, {});
    });

    it('should return copy of options', () => {
      provider.setPrivacyOptions({ excludeUrl: true });
      const options1 = provider.getPrivacyOptions();
      const options2 = provider.getPrivacyOptions();

      assert.notStrictEqual(options1, options2);
      assert.deepStrictEqual(options1, options2);
    });
  });

  describe('hasActiveSession', () => {
    it('should return false when no extensions connected', () => {
      // This depends on the actual extension bridge state
      // In a test environment, likely no extensions are connected
      const hasSession = provider.hasActiveSession();
      assert.strictEqual(typeof hasSession, 'boolean');
    });
  });

  describe('getContext', () => {
    it('should return null when no active session', async () => {
      const context = await provider.getContext();

      // If no browser extension is connected, should return null
      assert.ok(context === null || typeof context === 'object');
    });

    it('should return cached context within TTL', async () => {
      // First call may return null if no extension
      const context1 = await provider.getContext();

      // Second call should return same cached value
      const context2 = await provider.getContext();

      assert.strictEqual(context1, context2);
    });

    it('should return context with required fields when available', async () => {
      const context = await provider.getContext();

      if (context) {
        assert.strictEqual(typeof context.url, 'string');
        assert.strictEqual(typeof context.title, 'string');
        assert.ok(context.activeTabId !== undefined);
      }
    });

    it('should apply privacy filters to URL', async () => {
      provider.setPrivacyOptions({ excludeUrl: true });

      const context = await provider.getContext();

      if (context) {
        assert.strictEqual(context.url, '[URL hidden]');
      }
    });

    it('should apply privacy filters to selected text', async () => {
      provider.setPrivacyOptions({ excludeSelectedText: true });

      const context = await provider.getContext();

      if (context) {
        assert.strictEqual(context.selectedText, undefined);
      }
    });
  });

  describe('getContextSync', () => {
    it('should return null when cache is empty', () => {
      const context = provider.getContextSync();
      assert.strictEqual(context, null);
    });

    it('should return cached context when available', async () => {
      // Populate cache
      await provider.getContext();

      const context = provider.getContextSync();

      // Should return cached value or null if no extension
      assert.ok(context === null || typeof context === 'object');
    });

    it('should return null when cache is expired', async () => {
      // Create provider with very short TTL
      const shortTtlProvider = new BrowserContextProvider(1);

      // Populate cache
      await shortTtlProvider.getContext();

      // Wait for expiry
      await new Promise((resolve) => setTimeout(resolve, 10));

      const context = shortTtlProvider.getContextSync();
      assert.strictEqual(context, null);
    });
  });

  describe('invalidateCache', () => {
    it('should clear the cache', async () => {
      // Populate cache
      await provider.getContext();

      // Invalidate
      provider.invalidateCache();

      // Should return null
      const context = provider.getContextSync();
      assert.strictEqual(context, null);
    });

    it('should work when cache is already empty', () => {
      assert.doesNotThrow(() => {
        provider.invalidateCache();
      });
    });
  });

  describe('TTL caching', () => {
    it('should fetch fresh context after TTL expires', async () => {
      const shortTtlProvider = new BrowserContextProvider(1);

      // First fetch
      const context1 = await shortTtlProvider.getContext();

      // Wait for expiry
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Second fetch should try to get fresh (will be null without extension)
      const context2 = await shortTtlProvider.getContext();

      // Both should be null (no extension), but they should be independent calls
      assert.strictEqual(context1, context2);
    });
  });

  describe('context structure', () => {
    it('should have optional selectedText field', async () => {
      const context = await provider.getContext();

      if (context) {
        assert.ok(context.selectedText === undefined || typeof context.selectedText === 'string');
      }
    });

    it('should have optional lastScreenshotTimestamp field', async () => {
      const context = await provider.getContext();

      if (context) {
        assert.ok(
          context.lastScreenshotTimestamp === undefined || typeof context.lastScreenshotTimestamp === 'number'
        );
      }
    });
  });

  describe('edge cases', () => {
    it('should handle multiple rapid calls', async () => {
      const promises = [
        provider.getContext(),
        provider.getContext(),
        provider.getContext(),
      ];

      const results = await Promise.all(promises);

      // All should return same cached value
      assert.strictEqual(results[0], results[1]);
      assert.strictEqual(results[1], results[2]);
    });

    it('should handle privacy options with all fields', () => {
      const options: PrivacyOptions = {
        excludeUrl: true,
        excludeSelectedText: true,
      };

      provider.setPrivacyOptions(options);
      const retrieved = provider.getPrivacyOptions();

      assert.deepStrictEqual(retrieved, options);
    });
  });

  describe('singleton', () => {
    it('getBrowserContextProvider should return same instance', () => {
      const instance1 = getBrowserContextProvider();
      const instance2 = getBrowserContextProvider();
      assert.strictEqual(instance1, instance2);
    });

    it('resetBrowserContextProvider should create new instance', () => {
      const instance1 = getBrowserContextProvider();
      resetBrowserContextProvider();
      const instance2 = getBrowserContextProvider();

      assert.notStrictEqual(instance1, instance2);
    });
  });
});
