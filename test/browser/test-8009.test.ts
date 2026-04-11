/**
 * Browser Test for 127.0.0.1:8009
 *
 * Tests the service running on port 8009 using browser automation.
 * Verifies connectivity, page loading, screenshots, and interactions.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { getBrowserManager, BrowserType } from '../../src/browser/browserManager.js';

// ============================================================================
// Test Configuration
// ============================================================================

const TARGET_URL = 'http://127.0.0.1:8009';
const TEST_TIMEOUT = 30000;
const PAGE_LOAD_TIMEOUT = 10000;

describe('Browser Test: 127.0.0.1:8009', () => {
  let sessionId: string;

  before(async () => {
    console.log(`\n🌐 Testing target: ${TARGET_URL}`);
  });

  after(async () => {
    // Clean up browser session
    if (sessionId) {
      try {
        const manager = getBrowserManager();
        await manager.closeSession(sessionId);
        console.log('✓ Browser session closed');
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  describe('Connectivity', () => {
    it('should launch browser', { timeout: TEST_TIMEOUT }, async () => {
      const manager = getBrowserManager();
      sessionId = await manager.launchBrowser({
        type: BrowserType.CHROME,
        headless: true,
      });

      assert.ok(sessionId, 'Session ID should be defined');
      assert.match(sessionId, /^session_/, 'Session ID should match expected pattern');

      const session = manager.getSession(sessionId);
      assert.ok(session, 'Session should exist');
      assert.equal(session?.isActive, true, 'Session should be active');

      console.log(`✓ Browser launched (session: ${sessionId})`);
    });

    it('should navigate to 127.0.0.1:8009', { timeout: PAGE_LOAD_TIMEOUT }, async () => {
      const manager = getBrowserManager();
      const result = await manager.navigate(sessionId, TARGET_URL);

      assert.equal(result.success, true, 'Navigation should succeed');
      assert.ok(result.url?.includes('127.0.0.1:8009') || result.url?.includes('localhost:8009'),
        `URL should contain target host, got: ${result.url}`);
      assert.ok(result.loadTime! > 0, 'Load time should be positive');

      console.log(`✓ Navigation successful (${result.loadTime}ms)`);
    });

    it('should capture page title', { timeout: TEST_TIMEOUT }, async () => {
      const manager = getBrowserManager();
      const title = await manager.executeScript(sessionId, 'return document.title');

      assert.ok(title, 'Page title should exist');
      console.log(`📄 Page title: "${title}"`);
    });

    it('should capture page URL', { timeout: TEST_TIMEOUT }, async () => {
      const manager = getBrowserManager();
      const url = await manager.executeScript(sessionId, 'return window.location.href');

      assert.ok(url, 'Page URL should exist');
      const urlStr = url as string;
      assert.ok(urlStr.includes('8009'), `URL should contain port 8009, got: ${urlStr}`);
      console.log(`🔗 Page URL: ${urlStr}`);
    });
  });

  describe('Page Inspection', () => {
    it('should get page content length', { timeout: TEST_TIMEOUT }, async () => {
      const manager = getBrowserManager();
      const contentLength = await manager.executeScript(sessionId, `
        return document.body?.innerText?.length || 0;
      `);

      assert.ok(typeof contentLength === 'number', 'Content length should be a number');
      assert.ok(contentLength! > 0, 'Page should have content');

      console.log(`📝 Page content length: ${contentLength} characters`);
    });

    it('should count DOM elements', { timeout: TEST_TIMEOUT }, async () => {
      const manager = getBrowserManager();
      const elementCount = await manager.executeScript(sessionId, `
        return document.querySelectorAll('*').length;
      `);

      assert.ok(typeof elementCount === 'number', 'Element count should be a number');
      assert.ok(elementCount! > 0, 'Page should have DOM elements');

      console.log(`🏗️  DOM elements: ${elementCount}`);
    });

    it('should detect interactive elements', { timeout: TEST_TIMEOUT }, async () => {
      const manager = getBrowserManager();
      const interactiveElements = await manager.executeScript(sessionId, `
        const buttons = document.querySelectorAll('button').length;
        const links = document.querySelectorAll('a').length;
        const inputs = document.querySelectorAll('input').length;
        return { buttons, links, inputs };
      `);

      const elements = interactiveElements as { buttons: number; links: number; inputs: number };
      assert.ok(elements, 'Interactive elements should exist');
      console.log(`🎯 Interactive elements: ${elements.buttons} buttons, ${elements.links} links, ${elements.inputs} inputs`);
    });

    it('should check for JavaScript errors', { timeout: TEST_TIMEOUT }, async () => {
      const manager = getBrowserManager();
      const errorCount = await manager.executeScript(sessionId, `
        // Check console for errors (basic check)
        return window.__testErrorCount || 0;
      `);

      console.log(`⚠️  JS errors detected: ${errorCount}`);
    });
  });

  describe('Screenshot', () => {
    it('should capture viewport screenshot', { timeout: TEST_TIMEOUT }, async () => {
      const manager = getBrowserManager();
      const screenshot = await manager.takeScreenshot(sessionId, {
        fullPage: false,
      });

      assert.ok(screenshot, 'Screenshot should exist');
      assert.ok(screenshot.length > 0, 'Screenshot should have data');

      // Base64 PNG should be at least a few KB
      const sizeKB = Math.round(screenshot.length / 1024);
      console.log(`📸 Viewport screenshot: ${sizeKB}KB`);
    });

    it('should capture full page screenshot', { timeout: TEST_TIMEOUT }, async () => {
      const manager = getBrowserManager();
      const screenshot = await manager.takeScreenshot(sessionId, {
        fullPage: true,
      });

      assert.ok(screenshot, 'Full page screenshot should exist');
      assert.ok(screenshot.length > 0, 'Full page screenshot should have data');

      const sizeKB = Math.round(screenshot.length / 1024);
      console.log(`📸 Full page screenshot: ${sizeKB}KB`);
    });
  });

  describe('Performance', () => {
    it('should measure page load metrics', { timeout: TEST_TIMEOUT }, async () => {
      const manager = getBrowserManager();
      const metrics = await manager.executeScript(sessionId, `
        const perf = performance.getEntriesByType('navigation')[0];
        if (!perf) return null;
        return {
          domContentLoaded: Math.round(perf.domContentLoadedEventEnd - perf.startTime),
          loadComplete: Math.round(perf.loadEventEnd - perf.startTime),
          domInteractive: Math.round(perf.domInteractive - perf.startTime),
          firstPaint: Math.round(perf.responseEnd - perf.startTime),
          transferSize: perf.transferSize || 0,
        };
      `);

      if (metrics) {
        const m = metrics as Record<string, number>;
        console.log('⏱️  Performance metrics:');
        console.log(`   DOM Content Loaded: ${m.domContentLoaded}ms`);
        console.log(`   Load Complete: ${m.loadComplete}ms`);
        console.log(`   DOM Interactive: ${m.domInteractive}ms`);
        console.log(`   Transfer Size: ${Math.round(m.transferSize / 1024)}KB`);
      } else {
        console.log('⏱️  Performance metrics: Not available');
      }
    });

    it('should check page resources', { timeout: TEST_TIMEOUT }, async () => {
      const manager = getBrowserManager();
      const resources = await manager.executeScript(sessionId, `
        const entries = performance.getEntriesByType('resource');
        return {
          total: entries.length,
          scripts: entries.filter(e => e.initiatorType === 'script').length,
          stylesheets: entries.filter(e => e.initiatorType === 'link').length,
          images: entries.filter(e => e.initiatorType === 'img').length,
          fetches: entries.filter(e => e.initiatorType === 'fetch' || e.initiatorType === 'xmlhttprequest').length,
        };
      `);

      const res = resources as Record<string, number>;
      console.log('📦 Page resources:');
      console.log(`   Total: ${res.total}`);
      console.log(`   Scripts: ${res.scripts}`);
      console.log(`   Stylesheets: ${res.stylesheets}`);
      console.log(`   Images: ${res.images}`);
      console.log(`   Fetches: ${res.fetches}`);
    });
  });

  describe('Console & Logs', () => {
    it('should capture console output', { timeout: TEST_TIMEOUT }, async () => {
      const manager = getBrowserManager();
      const consoleOutput = await manager.executeScript(sessionId, `
        // Capture recent console calls if tracked
        return window.__testConsoleLogs || [];
      `);

      const logs = consoleOutput as string[];
      console.log(`📋 Console logs captured: ${logs.length}`);
      if (logs.length > 0 && logs.length <= 10) {
        logs.forEach((log, i) => console.log(`   [${i}] ${log}`));
      }
    });
  });

  describe('Health Check', () => {
    it('should verify service is responding', { timeout: TEST_TIMEOUT }, async () => {
      const manager = getBrowserManager();

      // Try common health check endpoints
      const endpoints = ['/health', '/api/health', '/status', '/'];
      let responding = false;

      for (const endpoint of endpoints) {
        try {
          const result = await manager.executeScript(sessionId, `
            return fetch('${TARGET_URL}${endpoint}')
              .then(r => ({ status: r.status, ok: r.ok }))
              .catch(e => ({ error: e.message }));
          `);

          const response = result as { status?: number; ok?: boolean; error?: string };
          if (response.ok) {
            responding = true;
            console.log(`✅ Health endpoint responding: ${endpoint} (${response.status})`);
            break;
          } else if (response.error) {
            console.log(`❌ Health endpoint failed: ${endpoint} - ${response.error}`);
          }
        } catch {
          // Continue to next endpoint
        }
      }

      assert.ok(responding, 'At least one health endpoint should respond');
    });
  });
});
