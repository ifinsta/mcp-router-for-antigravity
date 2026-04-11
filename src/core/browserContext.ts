/**
 * Browser Context Provider
 *
 * Provides auto-captured compact browser context for AI conversation injection.
 * Pulls from the browser extension bridge and caches results with short TTL.
 */

import { getExtensionBridge } from '../browser/extensionBridge.js';
import { getLogger } from '../infra/logger.js';

const logger = getLogger('browser-context');

// ============================================================================
// Types
// ============================================================================

/**
 * Compact browser context for AI injection
 */
export interface CompactBrowserContext {
  /** Current page URL */
  url: string;
  /** Current page title */
  title: string;
  /** Active tab identifier */
  activeTabId: string | number;
  /** User-selected text on the page (if any) */
  selectedText?: string | undefined;
  /** Timestamp of last screenshot capture */
  lastScreenshotTimestamp?: number | undefined;
}

/**
 * Privacy options for context filtering
 */
export interface PrivacyOptions {
  /** Exclude URL from context */
  excludeUrl?: boolean | undefined;
  /** Exclude selected text from context */
  excludeSelectedText?: boolean | undefined;
}

/**
 * Cached context entry with TTL
 */
interface CachedContext {
  context: CompactBrowserContext;
  timestamp: number;
}

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_CACHE_TTL_MS = 2000; // 2 seconds

// ============================================================================
// Browser Context Provider
// ============================================================================

/**
 * Browser Context Provider
 *
 * Manages auto-captured browser context with caching and privacy controls.
 * Singleton pattern - use getBrowserContextProvider() to access.
 */
export class BrowserContextProvider {
  private cache: CachedContext | null = null;
  private privacyOptions: PrivacyOptions = {};
  private cacheTtlMs: number;

  constructor(cacheTtlMs: number = DEFAULT_CACHE_TTL_MS) {
    this.cacheTtlMs = cacheTtlMs;
  }

  /**
   * Set privacy options for context filtering
   */
  setPrivacyOptions(options: PrivacyOptions): void {
    this.privacyOptions = { ...this.privacyOptions, ...options };
    logger.debug('Privacy options updated', { options: this.privacyOptions });
  }

  /**
   * Get current privacy options
   */
  getPrivacyOptions(): PrivacyOptions {
    return { ...this.privacyOptions };
  }

  /**
   * Check if browser bridge has an active session
   */
  hasActiveSession(): boolean {
    const bridge = getExtensionBridge();
    const connectedExtensions = bridge.getConnectedExtensions();
    return connectedExtensions.length > 0;
  }

  /**
   * Get compact browser context
   * Returns cached context if within TTL, otherwise fetches fresh
   */
  async getContext(): Promise<CompactBrowserContext | null> {
    // Check cache first
    if (this.cache && !this.isCacheExpired()) {
      logger.debug('Returning cached browser context');
      return this.applyPrivacyFilters(this.cache.context);
    }

    // Fetch fresh context
    try {
      const context = await this.fetchContext();
      if (context) {
        this.cache = {
          context,
          timestamp: Date.now(),
        };
        return this.applyPrivacyFilters(context);
      }
      return null;
    } catch (error) {
      logger.error('Failed to fetch browser context', error instanceof Error ? error : new Error(String(error)));
      return null;
    }
  }

  /**
   * Get context synchronously (returns cached or null)
   * Use getContext() for fresh data
   */
  getContextSync(): CompactBrowserContext | null {
    if (this.cache && !this.isCacheExpired()) {
      return this.applyPrivacyFilters(this.cache.context);
    }
    return null;
  }

  /**
   * Invalidate the cache to force fresh fetch on next call
   */
  invalidateCache(): void {
    this.cache = null;
    logger.debug('Browser context cache invalidated');
  }

  /**
   * Check if cache is expired
   */
  private isCacheExpired(): boolean {
    if (!this.cache) return true;
    return Date.now() - this.cache.timestamp > this.cacheTtlMs;
  }

  /**
   * Fetch fresh context from browser bridge
   */
  private async fetchContext(): Promise<CompactBrowserContext | null> {
    const bridge = getExtensionBridge();
    const connectedExtensions = bridge.getConnectedExtensions();

    if (connectedExtensions.length === 0) {
      logger.debug('No browser extension connected');
      return null;
    }

    const extensionId = connectedExtensions[0]!;

    try {
      // Get page info from extension
      const pageInfo = await bridge.sendCommand(extensionId, 'getPageInfo', {});
      const pageInfoObj = pageInfo as Record<string, unknown> | null;

      if (!pageInfoObj) {
        logger.warn('Empty page info received from extension');
        return null;
      }

      // Get active tab info
      const activeTabResult = await bridge.sendCommand(extensionId, 'getActiveTab', {});
      const activeTabObj = activeTabResult as Record<string, unknown> | null;

      const context: CompactBrowserContext = {
        url: (pageInfoObj['url'] as string) ?? '',
        title: (pageInfoObj['title'] as string) ?? '',
        activeTabId: (activeTabObj?.['tabId'] as string | number) ?? 0,
        selectedText: (pageInfoObj['selectedText'] as string) ?? undefined,
        lastScreenshotTimestamp: (pageInfoObj['lastScreenshotTimestamp'] as number) ?? undefined,
      };

      logger.debug('Browser context fetched successfully', {
        url: context.url,
        title: context.title,
        hasSelectedText: !!context.selectedText,
      });

      return context;
    } catch (error) {
      logger.error('Failed to fetch context from extension', error instanceof Error ? error : new Error(String(error)));
      return null;
    }
  }

  /**
   * Apply privacy filters to context
   */
  private applyPrivacyFilters(context: CompactBrowserContext): CompactBrowserContext {
    const filtered: CompactBrowserContext = {
      ...context,
    };

    if (this.privacyOptions.excludeUrl) {
      filtered.url = '[URL hidden]';
    }

    if (this.privacyOptions.excludeSelectedText) {
      filtered.selectedText = undefined;
    }

    return filtered;
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let browserContextProviderInstance: BrowserContextProvider | null = null;

/**
 * Get the singleton BrowserContextProvider instance
 */
export function getBrowserContextProvider(): BrowserContextProvider {
  if (!browserContextProviderInstance) {
    browserContextProviderInstance = new BrowserContextProvider();
  }
  return browserContextProviderInstance;
}

/**
 * Reset the singleton instance (primarily for testing)
 */
export function resetBrowserContextProvider(): void {
  browserContextProviderInstance = null;
}
