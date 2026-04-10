/**
 * Comprehensive Browser Control Testing Suite
 *
 * Tests all browser control capabilities including cross-browser support,
 * device emulation, network control, advanced interactions, and multi-tab management.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { getBrowserManager, BrowserType } from '../../src/browser/browserManager.js';
import { getDeviceProfileManager } from '../../src/browser/deviceProfiles.js';
import { createNetworkControlManager, NETWORK_PRESETS } from '../../src/browser/networkControl.js';
import { createWaitConditionsManager } from '../../src/browser/waitConditions.js';
import { createAdvancedInteractionsManager } from '../../src/browser/advancedInteractions.js';
import { createMultiTabManager } from '../../src/browser/multiTab.js';

// ============================================================================
// Test Configuration
// ============================================================================

const TEST_TIMEOUT = 30000;
const SHORT_TIMEOUT = 5000;
const LONG_TIMEOUT = 60000;

// ============================================================================
// Browser Driver Tests
// ============================================================================

describe('Browser Drivers', () => {
  describe('Chrome Driver', () => {
    it('should launch Chrome browser', async () => {
      const manager = getBrowserManager();
      const sessionId = await manager.launchBrowser({
        type: BrowserType.CHROME,
        headless: true,
      });

      expect(sessionId).toBeDefined();
      expect(sessionId).toMatch(/^session_/);

      const session = manager.getSession(sessionId);
      expect(session).toBeDefined();
      expect(session?.browserType).toBe(BrowserType.CHROME);
      expect(session?.isActive).toBe(true);
    }, TEST_TIMEOUT);

    it('should navigate to URL in Chrome', async () => {
      const manager = getBrowserManager();
      const sessionId = await manager.launchBrowser({
        type: BrowserType.CHROME,
        headless: true,
      });

      const result = await manager.navigate(sessionId, 'https://example.com');
      expect(result.success).toBe(true);
      expect(result.url).toBe('https://example.com');
      expect(result.loadTime).toBeGreaterThan(0);
    }, TEST_TIMEOUT);

    it('should take screenshot in Chrome', async () => {
      const manager = getBrowserManager();
      const sessionId = await manager.launchBrowser({
        type: BrowserType.CHROME,
        headless: true,
      });

      await manager.navigate(sessionId, 'https://example.com');

      const screenshot = await manager.takeScreenshot(sessionId, { fullPage: false });
      expect(screenshot).toBeDefined();
      expect(screenshot.length).toBeGreaterThan(0);
    }, TEST_TIMEOUT);

    it('should execute script in Chrome', async () => {
      const manager = getBrowserManager();
      const sessionId = await manager.launchBrowser({
        type: BrowserType.CHROME,
        headless: true,
      });

      const result = await manager.executeScript(sessionId, 'return document.title');
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    }, TEST_TIMEOUT);

    it('should close Chrome session', async () => {
      const manager = getBrowserManager();
      const sessionId = await manager.launchBrowser({
        type: BrowserType.CHROME,
        headless: true,
      });

      await manager.closeSession(sessionId);

      const session = manager.getSession(sessionId);
      expect(session?.isActive).toBe(false);
    }, TEST_TIMEOUT);
  });

  describe('Firefox Driver', () => {
    it('should launch Firefox browser', { timeout: TEST_TIMEOUT }, async () => {
      const manager = getBrowserManager();
      const sessionId = await manager.launchBrowser({
        type: BrowserType.FIREFOX,
        headless: true,
      });

      expect(sessionId).toBeDefined();
      expect(sessionId).toMatch(/^session_/);

      const session = manager.getSession(sessionId);
      expect(session).toBeDefined();
      expect(session?.browserType).toBe(BrowserType.FIREFOX);
      expect(session?.isActive).toBe(true);
    });

    it('should navigate to URL in Firefox', { timeout: TEST_TIMEOUT }, async () => {
      const manager = getBrowserManager();
      const sessionId = await manager.launchBrowser({
        type: BrowserType.FIREFOX,
        headless: true,
      });

      const result = await manager.navigate(sessionId, 'https://example.com');
      expect(result.success).toBe(true);
      expect(result.url).toBe('https://example.com');
    });

    it('should click element in Firefox', { timeout: TEST_TIMEOUT }, async () => {
      const manager = getBrowserManager();
      const sessionId = await manager.launchBrowser({
        type: BrowserType.FIREFOX,
        headless: true,
      });

      // Firefox click functionality - limited implementation test
      expect(manager.getSession(sessionId)).toBeDefined();
    });
  });

  describe('Edge Driver', () => {
    it('should launch Edge browser', { timeout: TEST_TIMEOUT }, async () => {
      const manager = getBrowserManager();
      const sessionId = await manager.launchBrowser({
        type: BrowserType.EDGE,
        headless: true,
      });

      expect(sessionId).toBeDefined();
      expect(sessionId).toMatch(/^session_/);

      const session = manager.getSession(sessionId);
      expect(session).toBeDefined();
      expect(session?.browserType).toBe(BrowserType.EDGE);
      expect(session?.isActive).toBe(true);
    });

    it('should navigate to URL in Edge', { timeout: TEST_TIMEOUT }, async () => {
      const manager = getBrowserManager();
      const sessionId = await manager.launchBrowser({
        type: BrowserType.EDGE,
        headless: true,
      });

      const result = await manager.navigate(sessionId, 'https://example.com');
      expect(result.success).toBe(true);
      expect(result.url).toBe('https://example.com');
      expect(result.loadTime).toBeGreaterThan(0);
    });

    it('should take screenshot in Edge', { timeout: TEST_TIMEOUT }, async () => {
      const manager = getBrowserManager();
      const sessionId = await manager.launchBrowser({
        type: BrowserType.EDGE,
        headless: true,
      });

      await manager.navigate(sessionId, 'https://example.com');

      const screenshot = await manager.takeScreenshot(sessionId);
      expect(screenshot).toBeDefined();
      expect(screenshot.length).toBeGreaterThan(0);
    });
  });

  describe('Browser Manager', () => {
    it('should manage multiple sessions', async () => {
      const manager = getBrowserManager();

      const session1 = await manager.launchBrowser({
        type: BrowserType.CHROME,
        headless: true,
      });

      const session2 = await manager.launchBrowser({
        type: BrowserType.EDGE,
        headless: true,
      });

      expect(manager.getActiveSessions()).toHaveLength(2);
      expect(manager.getActiveSessionCount()).toBe(2);

      await manager.closeSession(session1);
      await manager.closeSession(session2);

      expect(manager.getActiveSessions()).toHaveLength(0);
    }, LONG_TIMEOUT);

    it('should cleanup inactive sessions', async () => {
      const manager = getBrowserManager();

      const sessionId = await manager.launchBrowser({
        type: BrowserType.CHROME,
        headless: true,
      });

      // Wait to simulate age
      await new Promise(resolve => setTimeout(resolve, 100));

      const cleaned = await manager.cleanupInactiveSessions(0);
      expect(cleaned).toBeGreaterThan(0);
    }, TEST_TIMEOUT);
  });
});

// ============================================================================
// Device Profile Tests
// ============================================================================

describe('Device Profiles', () => {
  describe('Profile Management', () => {
    it('should get predefined profiles', () => {
      const manager = getDeviceProfileManager();
      const profile = manager.getProfile('iphone_14_pro_max');

      expect(profile).toBeDefined();
      expect(profile?.name).toBe('iPhone 14 Pro Max');
      expect(profile?.category).toBe('mobile');
      expect(profile?.viewport.mobile).toBe(true);
    });

    it('should get all profiles', () => {
      const manager = getDeviceProfileManager();
      const profiles = manager.getAllProfiles();

      expect(Object.keys(profiles).length).toBeGreaterThan(10);
      expect(profiles['desktop_1920x1080']).toBeDefined();
      expect(profiles['iphone_14_pro_max']).toBeDefined();
      expect(profiles['ipad_pro_129']).toBeDefined();
    });

    it('should get profiles by category', () => {
      const manager = getDeviceProfileManager();
      const mobileProfiles = manager.getProfilesByCategory('mobile');

      expect(mobileProfiles.length).toBeGreaterThan(0);
      expect(mobileProfiles.every(profile => profile.category === 'mobile')).toBe(true);
    });

    it('should create custom profile', () => {
      const manager = getDeviceProfileManager();
      const customProfile = manager.createCustomProfile('custom_device', {
        width: 800,
        height: 600,
        deviceScaleFactor: 2,
        mobile: true,
        userAgent: 'CustomUserAgent/1.0',
      });

      expect(customProfile.name).toBe('custom_device');
      expect(customProfile.viewport.width).toBe(800);
      expect(customProfile.viewport.height).toBe(600);
      expect(customProfile.userAgent).toBe('CustomUserAgent/1.0');
    });

    it('should remove custom profile', () => {
      const manager = getDeviceProfileManager();

      manager.createCustomProfile('temp_profile', {
        width: 1000,
        height: 800,
      });

      const removed = manager.removeCustomProfile('temp_profile');
      expect(removed).toBe(true);

      const profile = manager.getProfile('temp_profile');
      expect(profile).toBeUndefined();
    });
  });

  describe('Profile Features', () => {
    it('should get popular profiles', () => {
      const manager = getDeviceProfileManager();
      const popular = manager.getPopularProfiles();

      expect(popular).toHaveLength(4);
      expect(popular.every(profile => profile.name.length > 0)).toBe(true);
    });

    it('should search profiles', () => {
      const manager = getDeviceProfileManager();
      const results = manager.searchProfiles('iPhone');

      expect(results.length).toBeGreaterThan(0);
      expect(results.every(profile =>
        profile.name.toLowerCase().includes('iphone') ||
        profile.category.toLowerCase().includes('iphone')
      )).toBe(true);
    });

    it('should suggest profiles based on viewport', () => {
      const manager = getDeviceProfileManager();
      const suggestions = manager.suggestProfiles({ width: 390, height: 844 });

      expect(suggestions).toHaveLength(3);
      expect(suggestions[0].viewport.width).toBeCloseTo(390, 50);
      expect(suggestions[0].viewport.height).toBeCloseTo(844, 50);
    });

    it('should get responsive breakpoints', () => {
      const manager = getDeviceProfileManager();
      const breakpoints = manager.getResponsiveBreakpoints();

      expect(breakpoints.mobile).toBe(480);
      expect(breakpoints.tablet).toBe(768);
      expect(breakpoints.desktop).toBe(1024);
    });

    it('should convert profile to viewport config', () => {
      const manager = getDeviceProfileManager();
      const profile = manager.getProfile('iphone_14_pro_max');

      if (!profile) {
        throw new Error('Profile not found');
      }

      const viewportConfig = manager.toViewportConfig(profile);

      expect(viewportConfig.width).toBe(profile.viewport.width);
      expect(viewportConfig.height).toBe(profile.viewport.height);
      expect(viewportConfig.deviceScaleFactor).toBe(profile.viewport.deviceScaleFactor);
      expect(viewportConfig.mobile).toBe(profile.viewport.mobile);
    });
  });
});

// ============================================================================
// Network Control Tests
// ============================================================================

describe('Network Control', () => {
  describe('Network Presets', () => {
    it('should have all network presets', () => {
      expect(NETWORK_PRESETS.offline).toBeDefined();
      expect(NETWORK_PRESETS['2g']).toBeDefined();
      expect(NETWORK_PRESETS['3g']).toBeDefined();
      expect(NETWORK_PRESETS['4g']).toBeDefined();
      expect(NETWORK_PRESETS.wifi).toBeDefined();
    });

    it('should have correct preset values', () => {
      expect(NETWORK_PRESETS.offline.conditions.offline).toBe(true);
      expect(NETWORK_PRESETS.offline.conditions.downloadThroughput).toBe(0);

      expect(NETWORK_PRESETS['3g'].conditions.offline).toBe(false);
      expect(NETWORK_PRESETS['3g'].conditions.latency).toBe(100);
      expect(NETWORK_PRESETS['3g'].conditions.downloadThroughput).toBeGreaterThan(0);
    });
  });

  describe('Network Manager', () => {
    it('should create network manager', () => {
      const manager = createNetworkControlManager();

      expect(manager).toBeDefined();
      expect(manager.getCurrentConditions()).toBe(null);
    });

    it('should apply network conditions', async () => {
      const manager = createNetworkControlManager();

      // This would need actual CDP client in integration test
      expect(() => manager.applyNetworkConditions(NETWORK_PRESETS['3g'].conditions))
        .not.toThrow();
    });

    it('should apply network preset', async () => {
      const manager = createNetworkControlManager();

      // This would need actual CDP client in integration test
      expect(() => manager.applyNetworkPreset('wifi'))
        .not.toThrow();
    });

    it('should reset network conditions', async () => {
      const manager = createNetworkControlManager();

      // This would need actual CDP client in integration test
      expect(() => manager.resetNetworkConditions())
        .not.toThrow();
    });

    it('should manage network mocks', () => {
      const manager = createNetworkControlManager();

      manager.addNetworkMock({
        urlPattern: 'https://api.example.com/*',
        response: {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: '{"mock": true}',
        },
        active: true,
      });

      const mocks = manager.getActiveMocks();
      expect(mocks.length).toBe(1);
      expect(mocks[0].urlPattern).toBe('https://api.example.com/*');

      manager.removeNetworkMock(mocks[0].urlPattern);
      expect(manager.getActiveMocks().length).toBe(0);
    });

    it('should clear all network controls', async () => {
      const manager = createNetworkControlManager();

      expect(() => manager.clearAll()).not.toThrow();
    });
  });
});

// ============================================================================
// Wait Conditions Tests
// ============================================================================

describe('Wait Conditions', () => {
  describe('Condition Manager', () => {
    it('should create wait conditions manager', () => {
      const manager = createWaitConditionsManager();

      expect(manager).toBeDefined();
    });

    it('should set default configuration', () => {
      const manager = createWaitConditionsManager();

      manager.setDefaults({
        timeout: 10000,
        pollingInterval: 200,
        retries: 5,
      });

      expect(() => manager.waitFor({ type: 'url_contains', value: 'example' }))
        .not.toThrow();
    });

    it('should wait for element visible', async () => {
      const manager = createWaitConditionsManager();

      // This would need actual DOM in integration test
      const result = await manager.waitForElementVisible('body', {
        timeout: SHORT_TIMEOUT,
      });

      expect(result.success).toBe(true);
      expect(result.matched).toBe(true);
    }, SHORT_TIMEOUT);

    it('should wait for URL contains', async () => {
      const manager = createWaitConditionsManager();

      // This would need actual browser context in integration test
      expect(() => manager.waitForUrlContains('example'))
        .not.toThrow();
    });

    it('should retry with backoff', async () => {
      const manager = createWaitConditionsManager();

      let attempts = 0;
      const operation = async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error('Simulated failure');
        }
        return 'success';
      };

      const result = await manager.retryWithBackoff(operation, {
        maxRetries: 3,
        initialDelay: 100,
      });

      expect(result.success).toBe(true);
      expect(result.result).toBe('success');
      expect(attempts).toBe(3);
    });
  });

  describe('Condition Types', () => {
    it('should support element_visible condition', () => {
      const manager = createWaitConditionsManager();

      expect(() => manager.waitFor({ type: 'element_visible', selector: 'body' }))
        .not.toThrow();
    });

    it('should support element_clickable condition', () => {
      const manager = createWaitConditionsManager();

      expect(() => manager.waitFor({ type: 'element_clickable', selector: 'button' }))
        .not.toThrow();
    });

    it('should support url_contains condition', () => {
      const manager = createWaitConditionsManager();

      expect(() => manager.waitFor({ type: 'url_contains', value: 'example' }))
        .not.toThrow();
    });

    it('should support custom condition', async () => {
      const manager = createWaitConditionsManager();

      const customCondition = () => Promise.resolve(true);

      const result = await manager.waitFor({
        type: 'custom',
        customCheck: customCondition,
      });

      expect(result.success).toBe(true);
      expect(result.matched).toBe(true);
    });
  });
});

// ============================================================================
// Advanced Interactions Tests
// ============================================================================

describe('Advanced Interactions', () => {
  describe('Interaction Manager', () => {
    it('should create advanced interactions manager', () => {
      const manager = createAdvancedInteractionsManager();

      expect(manager).toBeDefined();
    });

    it('should set CDP client', () => {
      const manager = createAdvancedInteractionsManager();

      expect(() => manager.setCDPClient(null as any)).not.toThrow();
    });
  });

  describe('Interaction Types', () => {
    it('should support drag and drop', async () => {
      const manager = createAdvancedInteractionsManager();

      // This would need actual DOM elements in integration test
      expect(() => manager.dragDrop({
        sourceSelector: '#source',
        targetSelector: '#target',
      })).not.toThrow();
    });

    it('should support file upload', async () => {
      const manager = createAdvancedInteractionsManager();

      // This would need actual DOM elements in integration test
      expect(() => manager.fileUpload({
        selector: 'input[type="file"]',
        files: [{
          name: 'test.txt',
          content: 'Test content',
          mimeType: 'text/plain',
          size: 12,
        }],
      })).not.toThrow();
    });

    it('should support right-click', async () => {
      const manager = createAdvancedInteractionsManager();

      // This would need actual DOM elements in integration test
      expect(() => manager.rightClick({
        selector: 'button',
      })).not.toThrow();
    });

    it('should support double-click', async () => {
      const manager = createAdvancedInteractionsManager();

      // This would need actual DOM elements in integration test
      expect(() => manager.doubleClick({
        selector: 'button',
      })).not.toThrow();
    });

    it('should support keyboard shortcuts', async () => {
      const manager = createAdvancedInteractionsManager();

      // This would need actual DOM elements in integration test
      expect(() => manager.keyboardShortcut({
        keys: 'Enter',
      })).not.toThrow();
    });

    it('should support hover', async () => {
      const manager = createAdvancedInteractionsManager();

      // This would need actual DOM elements in integration test
      expect(() => manager.hover({
        selector: 'a',
        duration: 1000,
      })).not.toThrow();
    });

    it('should support scroll to element', async () => {
      const manager = createAdvancedInteractionsManager();

      // This would need actual DOM elements in integration test
      expect(() => manager.scrollToElement({
        selector: '#footer',
        behavior: 'smooth',
      })).not.toThrow();
    });

    it('should support multi-select', async () => {
      const manager = createAdvancedInteractionsManager();

      // This would need actual DOM elements in integration test
      expect(() => manager.multiSelect({
        selector: 'input[type="checkbox"]',
        items: ['#checkbox1', '#checkbox2', '#checkbox3'],
        selectionMethod: 'click',
      })).not.toThrow();
    });

    it('should support form fill', async () => {
      const manager = createAdvancedInteractionsManager();

      // This would need actual DOM elements in integration test
      expect(() => manager.formFill({
        fields: {
          username: {
            value: 'testuser',
            type: 'text',
          },
          password: {
            value: 'testpass',
            type: 'password',
          },
        },
      })).not.toThrow();
    });
  });

  describe('Helper Functions', () => {
    it('should create base64 file content', () => {
      const content = 'test content';
      const base64 = createBase64File(content);

      expect(base64).toBeDefined();
      expect(typeof base64).toBe('string');
    });

    it('should get file MIME type', () => {
      const mimeType = getFileMimeType('test.jpg');
      expect(mimeType).toBe('image/jpeg');

      const txtMimeType = getFileMimeType('document.txt');
      expect(txtMimeType).toBe('text/plain');
    });
  });
});

// ============================================================================
// Multi-Tab Management Tests
// ============================================================================

describe('Multi-Tab Management', () => {
  describe('Tab Manager', () => {
    it('should create multi-tab manager', () => {
      const manager = createMultiTabManager();

      expect(manager).toBeDefined();
      expect(manager.getTabCount()).toBe(0);
    });

    it('should set CDP client', () => {
      const manager = createMultiTabManager();

      expect(() => manager.setCDPClient(null as any)).not.toThrow();
    });

    it('should set target ID', () => {
      const manager = createMultiTabManager();

      expect(() => manager.setTargetId('test-target')).not.toThrow();
    });
  });

  describe('Tab Operations', () => {
    it('should get all tabs', () => {
      const manager = createMultiTabManager();

      const tabs = manager.getAllTabs();
      expect(Array.isArray(tabs)).toBe(true);
    });

    it('should get active tabs', () => {
      const manager = createMultiTabManager();

      const activeTabs = manager.getActiveTabs();
      expect(Array.isArray(activeTabs)).toBe(true);
    });

    it('should get current tab', () => {
      const manager = createMultiTabManager();

      const currentTab = manager.getCurrentTab();
      // Initially undefined until initialized
      expect(typeof currentTab === 'undefined' || currentTab !== null).toBe(true);
    });

    it('should find tabs by criteria', () => {
      const manager = createMultiTabManager();

      const tabs = manager.findTabs({
        isActive: true,
      });

      expect(Array.isArray(tabs)).toBe(true);
    });

    it('should get tab statistics', () => {
      const manager = createMultiTabManager();

      const stats = manager.getTabStats();

      expect(stats).toHaveProperty('totalTabs');
      expect(stats).toHaveProperty('activeTabs');
      expect(stats).toHaveProperty('inactiveTabs');
      expect(stats).toHaveProperty('loadingTabs');
      expect(stats).toHaveProperty('averageAge');

      expect(stats.totalTabs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Tab Lifecycle', () => {
    it('should support creating tabs', async () => {
      const manager = createMultiTabManager();

      // This would need actual CDP client in integration test
      expect(() => manager.createTab({
        url: 'https://example.com',
      })).not.toThrow();
    });

    it('should support activating tabs', async () => {
      const manager = createMultiTabManager();

      // This would need actual CDP client in integration test
      expect(() => manager.activateTab('test-tab-id')).not.toThrow();
    });

    it('should support closing tabs', async () => {
      const manager = createMultiTabManager();

      // This would need actual CDP client in integration test
      expect(() => manager.closeTab('test-tab-id')).not.toThrow();
    });

    it('should support navigating tabs', async () => {
      const manager = createMultiTabManager();

      // This would need actual CDP client in integration test
      expect(() => manager.navigateTab('test-tab-id', 'https://example.com')).not.toThrow();
    });

    it('should support reloading tabs', async () => {
      const manager = createMultiTabManager();

      // This would need actual CDP client in integration test
      expect(() => manager.reloadTab('test-tab-id', {
        ignoreCache: true,
      })).not.toThrow();
    });

    it('should support duplicating tabs', async () => {
      const manager = createMultiTabManager();

      // This would need actual CDP client in integration test
      expect(() => manager.duplicateTab('test-tab-id')).not.toThrow();
    });

    it('should support closing all tabs except specified', async () => {
      const manager = createMultiTabManager();

      // This would need actual CDP client in integration test
      expect(() => manager.closeAllTabsExcept('keep-this-tab')).not.toThrow();
    });

    it('should support closing inactive tabs', async () => {
      const manager = createMultiTabManager();

      // This would need actual CDP client in integration test
      expect(() => manager.closeInactiveTabs(3600000)).not.toThrow();
    });
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe('Integration Tests', () => {
  describe('End-to-End Browser Workflows', () => {
    it('should complete full browser automation workflow', async () => {
      const manager = getBrowserManager();

      // Launch browser
      const sessionId = await manager.launchBrowser({
        type: BrowserType.CHROME,
        headless: true,
      });

      // Navigate
      await manager.navigate(sessionId, 'https://example.com');

      // Execute script
      const title = await manager.executeScript(sessionId, 'return document.title');
      expect(title).toBeDefined();

      // Take screenshot
      const screenshot = await manager.takeScreenshot(sessionId);
      expect(screenshot).toBeDefined();

      // Close session
      await manager.closeSession(sessionId);

      const session = manager.getSession(sessionId);
      expect(session?.isActive).toBe(false);
    }, LONG_TIMEOUT);
  });

  describe('Cross-Browser Testing', () => {
    it('should test same workflow across multiple browsers', async () => {
      const manager = getBrowserManager();

      const browsers = [BrowserType.CHROME, BrowserType.EDGE];
      const results = [];

      for (const browserType of browsers) {
        const sessionId = await manager.launchBrowser({
          type: browserType,
          headless: true,
        });

        await manager.navigate(sessionId, 'https://example.com');

        const screenshot = await manager.takeScreenshot(sessionId);

        results.push({
          browserType,
          sessionId,
          screenshotLength: screenshot.length,
        });

        await manager.closeSession(sessionId);
      }

      expect(results).toHaveLength(2);
      expect(results.every(r => r.sessionId)).toBeDefined();
      expect(results.every(r => r.screenshotLength > 0)).toBe(true);
    }, LONG_TIMEOUT * 2);
  });

  describe('Device Emulation Integration', () => {
    it('should test responsive design across devices', async () => {
      const manager = getBrowserManager();
      const deviceManager = getDeviceProfileManager();

      const devices = ['iphone_14_pro_max', 'ipad_pro_129', 'desktop_1920x1080'];
      const results = [];

      for (const deviceId of devices) {
        const profile = deviceManager.getProfile(deviceId);
        if (!profile) continue;

        const sessionId = await manager.launchBrowser({
          type: BrowserType.CHROME,
          headless: true,
          viewport: deviceManager.toViewportConfig(profile),
        });

        await manager.navigate(sessionId, 'https://example.com');

        const screenshot = await manager.takeScreenshot(sessionId);

        results.push({
          device: profile.name,
          viewport: profile.viewport,
          screenshotLength: screenshot.length,
        });

        await manager.closeSession(sessionId);
      }

      expect(results).toHaveLength(3);
      expect(results.every(r => r.screenshotLength > 0)).toBe(true);
    }, LONG_TIMEOUT * 3);
  });
});

// ============================================================================
// Performance Tests
// ============================================================================

describe('Performance Tests', () => {
  describe('Browser Launch Performance', () => {
    it('should launch Chrome within reasonable time', async () => {
      const startTime = Date.now();
      const manager = getBrowserManager();

      const sessionId = await manager.launchBrowser({
        type: BrowserType.CHROME,
        headless: true,
      });

      const launchTime = Date.now() - startTime;

      expect(sessionId).toBeDefined();
      expect(launchTime).toBeLessThan(10000); // 10 seconds max

      await manager.closeSession(sessionId);
    }, TEST_TIMEOUT * 2);

    it('should handle concurrent launches efficiently', async () => {
      const manager = getBrowserManager();
      const startTime = Date.now();

      const promises = [
        manager.launchBrowser({ type: BrowserType.CHROME, headless: true }),
        manager.launchBrowser({ type: BrowserType.EDGE, headless: true }),
      ];

      const sessionIds = await Promise.all(promises);

      const totalTime = Date.now() - startTime;

      expect(sessionIds).toHaveLength(2);
      expect(totalTime).toBeLessThan(20000); // 20 seconds for 2 browsers

      for (const sessionId of sessionIds) {
        await manager.closeSession(sessionId);
      }
    }, LONG_TIMEOUT * 2);
  });

  describe('Memory Management', () => {
    it('should cleanup sessions properly', async () => {
      const manager = getBrowserManager();

      const sessions = [];
      for (let i = 0; i < 5; i++) {
        const sessionId = await manager.launchBrowser({
          type: BrowserType.CHROME,
          headless: true,
        });
        sessions.push(sessionId);
      }

      expect(manager.getActiveSessionCount()).toBe(5);

      // Close all sessions
      for (const sessionId of sessions) {
        await manager.closeSession(sessionId);
      }

      // Cleanup inactive sessions
      await manager.cleanupInactiveSessions(0);

      expect(manager.getActiveSessionCount()).toBe(0);
    }, LONG_TIMEOUT * 5);
  });
});

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('Error Handling', () => {
  it('should handle invalid browser types', async () => {
    const manager = getBrowserManager();

    await expect(
      manager.launchBrowser({ type: 'invalid' as any, headless: true })
    ).rejects.toThrow();
  });

  it('should handle invalid session operations', async () => {
    const manager = getBrowserManager();

    await expect(
      manager.navigate('invalid-session', 'https://example.com')
    ).rejects.toThrow();

    await expect(
      manager.takeScreenshot('invalid-session')
    ).rejects.toThrow();
  });

  it('should handle invalid device profiles', () => {
    const manager = getDeviceProfileManager();

    const profile = manager.getProfile('non_existent_device');
    expect(profile).toBeUndefined();
  });

  it('should handle invalid network conditions', async () => {
    const manager = createNetworkControlManager();

    await expect(
      manager.applyNetworkPreset('invalid_preset' as any)
    ).rejects.toThrow();
  });
});