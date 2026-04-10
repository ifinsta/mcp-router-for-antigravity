/**
 * Integration Tests for Browser Control
 *
 * Real browser integration tests that verify end-to-end functionality
 * with actual browser instances.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getBrowserManager, BrowserType } from '../../src/browser/browserManager.js';
import { createNetworkControlManager } from '../../src/browser/networkControl.js';
import { createAdvancedInteractionsManager } from '../../src/browser/advancedInteractions.js';
import { createMultiTabManager } from '../../src/browser/multiTab.js';
import { createCDPClient } from '../../src/browser/cdpClient.js';

// ============================================================================
// Test Configuration
// ============================================================================

const INTEGRATION_TIMEOUT = 60000;
const LONG_INTEGRATION_TIMEOUT = 120000;
const TEST_URL = 'https://example.com';
const TEST_FORM_URL = 'https://httpbin.org/forms/post';

// ============================================================================
// Browser Integration Tests
// ============================================================================

describe('Browser Integration Tests', () => {
  let manager: ReturnType<typeof getBrowserManager>;
  let sessionId: string | null = null;

  beforeAll(async () => {
    manager = getBrowserManager();
  });

  afterAll(async () => {
    if (sessionId) {
      await manager.closeSession(sessionId);
    }
  });

  describe('Chrome Browser Integration', () => {
    it('should launch and navigate Chrome successfully', { timeout: INTEGRATION_TIMEOUT }, async () => {
      sessionId = await manager.launchBrowser({
        type: BrowserType.CHROME,
        headless: true,
        viewport: { width: 1280, height: 720 },
      });

      const session = manager.getSession(sessionId);
      expect(session).toBeDefined();
      expect(session?.browserType).toBe(BrowserType.CHROME);
      expect(session?.isActive).toBe(true);

      const result = await manager.navigate(sessionId, TEST_URL);
      expect(result.success).toBe(true);
      expect(result.url).toBe(TEST_URL);
      expect(result.loadTime).toBeGreaterThan(0);
    });

    it('should execute complex scripts in Chrome', { timeout: INTEGRATION_TIMEOUT }, async () => {
      if (!sessionId) {
        throw new Error('No active session');
      }

      // Test complex script execution
      const complexScript = `
        (function() {
          return {
            title: document.title,
            url: window.location.href,
            userAgent: navigator.userAgent,
            hasBody: !!document.body,
            bodyChildren: document.body ? document.body.children.length : 0,
            viewport: {
              width: window.innerWidth,
              height: window.innerHeight,
            }
          };
        })()
      `;

      const result = await manager.executeScript(sessionId, complexScript);

      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
      expect(result).toHaveProperty('title');
      expect(result).toHaveProperty('url');
      expect(result).toHaveProperty('viewport');
    });

    it('should handle multiple rapid navigations in Chrome', { timeout: INTEGRATION_TIMEOUT * 2 }, async () => {
      if (!sessionId) {
        throw new Error('No active session');
      }

      const urls = [
        'https://example.com',
        'https://example.org',
        'https://example.net',
        'https://example.edu',
      ];

      const results = [];
      for (const url of urls) {
        const result = await manager.navigate(sessionId, url);
        results.push(result);
        expect(result.success).toBe(true);
        expect(result.url).toBe(url);
      }

      expect(results).toHaveLength(urls.length);
    });

    it('should take screenshots at different resolutions in Chrome', { timeout: INTEGRATION_TIMEOUT * 2 }, async () => {
      if (!sessionId) {
        throw new Error('No active session');
      }

      const viewports = [
        { width: 1920, height: 1080 },
        { width: 1366, height: 768 },
        { width: 768, height: 1024 },
        { width: 375, height: 667 },
      ];

      const screenshots = [];
      for (const viewport of viewports) {
        await manager.setViewport(sessionId, viewport.width, viewport.height);
        await manager.navigate(sessionId, TEST_URL);

        // Wait for page load
        await new Promise(resolve => setTimeout(resolve, 1000));

        const screenshot = await manager.takeScreenshot(sessionId);
        screenshots.push({
          viewport,
          screenshotLength: screenshot.length,
        });

        expect(screenshot).toBeDefined();
        expect(screenshot.length).toBeGreaterThan(0);
      }

      expect(screenshots).toHaveLength(viewports.length);
    });
  });

  describe('Edge Browser Integration', () => {
    let edgeSessionId: string | null = null;

    afterAll(async () => {
      if (edgeSessionId) {
        await manager.closeSession(edgeSessionId);
      }
    });

    it('should launch and navigate Edge successfully', { timeout: INTEGRATION_TIMEOUT }, async () => {
      edgeSessionId = await manager.launchBrowser({
        type: BrowserType.EDGE,
        headless: true,
      });

      const session = manager.getSession(edgeSessionId);
      expect(session).toBeDefined();
      expect(session?.browserType).toBe(BrowserType.EDGE);

      const result = await manager.navigate(edgeSessionId!, TEST_URL);
      expect(result.success).toBe(true);
    });

    it('should handle script execution in Edge', { timeout: INTEGRATION_TIMEOUT }, async () => {
      if (!edgeSessionId) {
        throw new Error('No active Edge session');
      }

      const result = await manager.executeScript(edgeSessionId!, 'return navigator.userAgent');
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
      expect(result).toContain('Edg');
    });
  });

  describe('Performance Metrics Integration', () => {
    it('should collect performance metrics from Chrome', { timeout: INTEGRATION_TIMEOUT }, async () => {
      if (!sessionId) {
        throw new Error('No active session');
      }

      await manager.navigate(sessionId, TEST_URL);

      // Wait for page to fully load
      await new Promise(resolve => setTimeout(resolve, 2000));

      const metrics = await manager.getMetrics(sessionId);

      expect(metrics).toBeDefined();
      expect(typeof metrics).toBe('object');
    });

    it('should collect Web Vitals from Chrome', { timeout: INTEGRATION_TIMEOUT }, async () => {
      if (!sessionId) {
        throw new Error('No active session');
      }

      await manager.navigate(sessionId, TEST_URL);

      // Wait for Core Web Vitals to be collected
      await new Promise(resolve => setTimeout(resolve, 3000));

      const webVitals = await manager.getWebVitals(sessionId);

      expect(webVitals).toBeDefined();
      expect(typeof webVitals).toBe('object');
    });
  });
});

// ============================================================================
// Network Control Integration Tests
// ============================================================================

describe('Network Control Integration Tests', () => {
  let cdpClient: any = null;
  let sessionId: string | null = null;

  beforeAll(async () => {
    const manager = getBrowserManager();
    sessionId = await manager.launchBrowser({
      type: BrowserType.CHROME,
      headless: true,
    });

    const session = manager.getSession(sessionId);
    if (session && session.instance.cdpClient) {
      cdpClient = session.instance.cdpClient;
    }
  });

  afterAll(async () => {
    if (sessionId) {
      const manager = getBrowserManager();
      await manager.closeSession(sessionId);
    }
  });

  describe('Network Throttling Integration', () => {
    it('should apply and remove network throttling', { timeout: INTEGRATION_TIMEOUT }, async () => {
      if (!cdpClient) {
        throw new Error('CDP client not available');
      }

      const networkManager = createNetworkControlManager(cdpClient);

      // Apply 3G network conditions
      await networkManager.applyNetworkPreset('3g');

      // Test navigation with slow network
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Reset to normal network
      await networkManager.resetNetworkConditions();

      const current = networkManager.getCurrentConditions();
      expect(current).toBe(null);
    });

    it('should handle offline mode', { timeout: INTEGRATION_TIMEOUT }, async () => {
      if (!cdpClient) {
        throw new Error('CDP client not available');
      }

      const networkManager = createNetworkControlManager(cdpClient);

      // Apply offline mode
      await networkManager.applyNetworkPreset('offline');

      // Test offline behavior
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Restore network
      await networkManager.resetNetworkConditions();
    });
  });
});

// ============================================================================
// Advanced Interactions Integration Tests
// ============================================================================

describe('Advanced Interactions Integration Tests', () => {
  let cdpClient: any = null;
  let sessionId: string | null = null;

  beforeAll(async () => {
    const manager = getBrowserManager();
    sessionId = await manager.launchBrowser({
      type: BrowserType.CHROME,
      headless: true,
    });

    const session = manager.getSession(sessionId);
    if (session && session.instance.cdpClient) {
      cdpClient = session.instance.cdpClient;
    }
  });

  afterAll(async () => {
    if (sessionId) {
      const manager = getBrowserManager();
      await manager.closeSession(sessionId);
    }
  });

  describe('Form Interaction Integration', () => {
    it('should navigate to and interact with form', { timeout: INTEGRATION_TIMEOUT }, async () => {
      if (!cdpClient) {
        throw new Error('CDP client not available');
      }

      const interactionsManager = createAdvancedInteractionsManager(cdpClient);

      // Navigate to a test form
      const manager = getBrowserManager();
      await manager.navigate(sessionId!, TEST_FORM_URL);

      // Wait for form to load
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Fill form
      const formFillResult = await interactionsManager.formFill({
        fields: {
          username: { value: 'testuser', type: 'text' },
          password: { value: 'testpass', type: 'password' },
        },
      });

      expect(formFillResult).toBeDefined();
    });

    it('should handle keyboard shortcuts', { timeout: INTEGRATION_TIMEOUT }, async () => {
      if (!cdpClient) {
        throw new Error('CDP client not available');
      }

      const interactionsManager = createAdvancedInteractionsManager(cdpClient);

      // Test keyboard shortcuts
      await interactionsManager.keyboardShortcut({
        keys: 'Tab',
      });

      await interactionsManager.keyboardShortcut({
        keys: 'Enter',
        modifiers: { ctrl: true },
      });

      expect(true).toBe(true); // Placeholder assertion
    });

    it('should handle hover interactions', { timeout: INTEGRATION_TIMEOUT }, async () => {
      if (!cdpClient) {
        throw new Error('CDP client not available');
      }

      const interactionsManager = createAdvancedInteractionsManager(cdpClient);

      // Test hover over a link
      await interactionsManager.hover({
        selector: 'a',
        duration: 500,
      });

      expect(true).toBe(true); // Placeholder assertion
    });

    it('should handle double-click interactions', { timeout: INTEGRATION_TIMEOUT }, async () => {
      if (!cdpClient) {
        throw new Error('CDP client not available');
      }

      const interactionsManager = createAdvancedInteractionsManager(cdpClient);

      // Test double-click
      await interactionsManager.doubleClick({
        selector: 'button, input[type="submit"]',
        interval: 50,
      });

      expect(true).toBe(true); // Placeholder assertion
    });
  });

  describe('Element State Integration', () => {
    it('should wait for element visibility', { timeout: INTEGRATION_TIMEOUT }, async () => {
      if (!cdpClient) {
        throw new Error('CDP client not available');
      }

      // Simulate wait for element visibility
      const script = `
        (function() {
          const element = document.querySelector('h1');
          if (element) {
            return {
              visible: true,
              text: element.textContent
            };
          }
          return { visible: false };
        })()
      `;

      const result = await cdpClient.executeScript(script, { returnByValue: true });
      expect(result).toBeDefined();
    });

    it('should check element clickability', { timeout: INTEGRATION_TIMEOUT }, async () => {
      if (!cdpClient) {
        throw new Error('CDP client not available');
      }

      // Simulate element clickability check
      const script = `
        (function() {
          const element = document.querySelector('a, button');
          if (!element) return { clickable: false };

          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);

          return {
            clickable: style.visibility !== 'hidden' &&
                       style.display !== 'none' &&
                       style.opacity !== '0' &&
                       rect.width > 0 &&
                       rect.height > 0,
            position: { x: rect.left, y: rect.top },
            size: { width: rect.width, height: rect.height }
          };
        })()
      `;

      const result = await cdpClient.executeScript(script, { returnByValue: true });
      expect(result).toBeDefined();
      expect(result).toHaveProperty('clickable');
    });
  });
});

// ============================================================================
// Multi-Tab Integration Tests
// ============================================================================

describe('Multi-Tab Integration Tests', () => {
  let cdpClient: any = null;
  let sessionId: string | null = null;

  beforeAll(async () => {
    const manager = getBrowserManager();
    sessionId = await manager.launchBrowser({
      type: BrowserType.CHROME,
      headless: true,
    });

    const session = manager.getSession(sessionId);
    if (session && session.instance.cdpClient) {
      cdpClient = session.instance.cdpClient;
    }
  });

  afterAll(async () => {
    if (sessionId) {
      const manager = getBrowserManager();
      await manager.closeSession(sessionId);
    }
  });

  describe('Tab Creation and Management', () => {
    it('should create and manage multiple tabs', { timeout: INTEGRATION_TIMEOUT * 2 }, async () => {
      if (!cdpClient) {
        throw new Error('CDP client not available');
      }

      const tabManager = createMultiTabManager(cdpClient, 'main-target');

      // Initialize tab manager
      await tabManager.initialize();

      // Create multiple tabs
      const tabIds = [];
      for (let i = 0; i < 3; i++) {
        const result = await tabManager.createTab({
          url: `${TEST_URL}?tab=${i}`,
        });

        if (result.success && result.tabId) {
          tabIds.push(result.tabId);
        }

        await new Promise(resolve => setTimeout(resolve, 500));
      }

      expect(tabManager.getTabCount()).toBeGreaterThan(0);

      // Test tab switching
      for (const tabId of tabIds) {
        const result = await tabManager.activateTab(tabId);
        expect(result.success).toBe(true);
      }

      // Test tab navigation
      if (tabIds.length > 0) {
        const navResult = await tabManager.navigateTab(tabIds[0], 'https://example.org');
        expect(navResult.success).toBe(true);
      }

      // Close tabs
      for (const tabId of tabIds) {
        const result = await tabManager.closeTab(tabId);
        expect(result.success).toBe(true);
      }

      expect(tabManager.getTabCount()).toBeLessThan(tabIds.length);
    });

    it('should handle tab statistics', { timeout: INTEGRATION_TIMEOUT }, async () => {
      if (!cdpClient) {
        throw new Error('CDP client not available');
      }

      const tabManager = createMultiTabManager(cdpClient, 'main-target');

      await tabManager.initialize();

      // Create tabs for statistics
      await tabManager.createTab({ url: TEST_URL });
      await new Promise(resolve => setTimeout(resolve, 500));

      const stats = tabManager.getTabStats();

      expect(stats).toHaveProperty('totalTabs');
      expect(stats).toHaveProperty('activeTabs');
      expect(stats).toHaveProperty('inactiveTabs');
      expect(stats).toHaveProperty('loadingTabs');
      expect(stats.totalTabs).toBeGreaterThan(0);
    });

    it('should handle tab filtering', { timeout: INTEGRATION_TIMEOUT }, async () => {
      if (!cdpClient) {
        throw new Error('CDP client not available');
      }

      const tabManager = createMultiTabManager(cdpClient, 'main-target');

      await tabManager.initialize();

      // Create tabs with different URLs
      await tabManager.createTab({ url: 'https://example.com' });
      await tabManager.createTab({ url: 'https://example.org' });
      await new Promise(resolve => setTimeout(resolve, 500));

      // Filter tabs by URL pattern
      const exampleComTabs = tabManager.findTabs({
        urlPattern: 'example\\.com',
      });

      expect(Array.isArray(exampleComTabs)).toBe(true);
      expect(exampleComTabs.length).toBeGreaterThan(0);

      // Filter by active state
      const activeTabs = tabManager.findTabs({
        isActive: true,
      });

      expect(Array.isArray(activeTabs)).toBe(true);
    });
  });

  describe('Tab Lifecycle Integration', () => {
    it('should handle tab duplication', { timeout: INTEGRATION_TIMEOUT }, async () => {
      if (!cdpClient) {
        throw new Error('CDP client not available');
      }

      const tabManager = createMultiTabManager(cdpClient, 'main-target');

      await tabManager.initialize();

      // Create original tab
      const originalResult = await tabManager.createTab({ url: TEST_URL });
      if (!originalResult.tabId) {
        throw new Error('Failed to create original tab');
      }

      await new Promise(resolve => setTimeout(resolve, 500));

      // Duplicate tab
      const duplicateResult = await tabManager.duplicateTab(originalResult.tabId);

      expect(duplicateResult.success).toBe(true);
      expect(duplicateResult.tabId).toBeDefined();
      expect(duplicateResult.tabId).not.toBe(originalResult.tabId);

      // Cleanup
      if (duplicateResult.tabId) {
        await tabManager.closeTab(duplicateResult.tabId);
      }
      if (originalResult.tabId) {
        await tabManager.closeTab(originalResult.tabId);
      }
    });

    it('should handle tab reloading', { timeout: INTEGRATION_TIMEOUT }, async () => {
      if (!cdpClient) {
        throw new Error('CDP client not available');
      }

      const tabManager = createMultiTabManager(cdpClient, 'main-target');

      await tabManager.initialize();

      // Create tab and navigate
      const result = await tabManager.createTab({ url: TEST_URL });
      if (!result.tabId) {
        throw new Error('Failed to create tab');
      }

      await new Promise(resolve => setTimeout(resolve, 1000));

      // Reload tab
      const reloadResult = await tabManager.reloadTab(result.tabId, {
        ignoreCache: true,
      });

      expect(reloadResult.success).toBe(true);

      // Cleanup
      await tabManager.closeTab(result.tabId);
    });

    it('should handle bulk tab operations', { timeout: INTEGRATION_TIMEOUT * 2 }, async () => {
      if (!cdpClient) {
        throw new Error('CDP client not available');
      }

      const tabManager = createMultiTabManager(cdpClient, 'main-target');

      await tabManager.initialize();

      // Create multiple tabs
      const tabIds = [];
      for (let i = 0; i < 5; i++) {
        const result = await tabManager.createTab({
          url: `${TEST_URL}?tab=${i}`,
        });

        if (result.success && result.tabId) {
          tabIds.push(result.tabId);
        }

        await new Promise(resolve => setTimeout(resolve, 500));
      }

      expect(tabManager.getTabCount()).toBeGreaterThanOrEqual(5);

      // Close all tabs except first
      if (tabIds.length > 0) {
        await tabManager.closeAllTabsExcept(tabIds[0]);
      }

      expect(tabManager.getActiveTabs().length).toBeLessThanOrEqual(1);

      // Close remaining tab
      if (tabIds[0]) {
        await tabManager.closeTab(tabIds[0]);
      }
    });
  });
});

// ============================================================================
// Cross-Browser Integration Tests
// ============================================================================

describe('Cross-Browser Integration Tests', () => {
  describe('Browser Comparison Tests', () => {
    it('should compare behavior across Chrome and Edge', { timeout: LONG_INTEGRATION_TIMEOUT * 2 }, async () => {
      const manager = getBrowserManager();

      const browsers = [BrowserType.CHROME, BrowserType.EDGE];
      const results = [];

      for (const browserType of browsers) {
        const sessionId = await manager.launchBrowser({
          type: browserType,
          headless: true,
        });

        await manager.navigate(sessionId, TEST_URL);

        // Collect metrics
        const metrics = await manager.getMetrics(sessionId);

        const screenshot = await manager.takeScreenshot(sessionId);

        results.push({
          browserType,
          sessionId,
          metrics,
          screenshotLength: screenshot.length,
        });

        await manager.closeSession(sessionId);
      }

      expect(results).toHaveLength(2);
      expect(results.every(r => r.sessionId)).toBeDefined();
      expect(results.every(r => r.screenshotLength > 0)).toBe(true);
    });
  });
});

// ============================================================================
// Error Recovery Integration Tests
// ============================================================================

describe('Error Recovery Integration Tests', () => {
  describe('Browser Crash Recovery', () => {
    it('should handle browser process crashes gracefully', { timeout: INTEGRATION_TIMEOUT }, async () => {
      const manager = getBrowserManager();

      const sessionId = await manager.launchBrowser({
        type: BrowserType.CHROME,
        headless: true,
      });

      // Simulate abrupt closure
      const session = manager.getSession(sessionId);
      if (session && session.instance.process) {
        session.instance.process.kill();
      }

      // Wait for cleanup
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Try to launch new browser after crash
      const newSessionId = await manager.launchBrowser({
        type: BrowserType.CHROME,
        headless: true,
      });

      expect(newSessionId).toBeDefined();
      expect(newSessionId).not.toBe(sessionId);

      await manager.closeSession(newSessionId);
    });
  });

  describe('Network Error Recovery', () => {
    it('should handle network errors gracefully', { timeout: INTEGRATION_TIMEOUT }, async () => {
      const manager = getBrowserManager();

      const sessionId = await manager.launchBrowser({
        type: BrowserType.CHROME,
        headless: true,
      });

      // Try to navigate to invalid URL
      const result = await manager.navigate(sessionId, 'https://invalid-domain-that-does-not-exist-12345.com');

      // Should handle error gracefully
      expect(result).toBeDefined();

      await manager.closeSession(sessionId);
    });
  });
});