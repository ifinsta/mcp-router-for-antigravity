#!/usr/bin/env node

/**
 * Interactive Browsing Demo for ifinsta.com
 *
 * Demonstrates the full MCP testing system capabilities:
 * - Navigate to pages
 * - Simulate user scrolling
 * - Hover and click elements
 * - Capture screenshots
 * - Run design audits
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { resolve as pathResolve } from 'node:path';
import { getExtensionBridge } from '../dist/browser/extensionBridge.js';
import { getBrowserManager } from '../dist/browser/browserManager.js';
import { getBrowserBridge } from '../dist/browser/browserBridge.js';
import { BrowserType } from '../dist/browser/browserManager.js';

const TARGET_URL = 'https://ifinsta.com';
const SCREENSHOTS_DIR = pathResolve(process.cwd(), 'screenshots');

// Helper for delays
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Helper to log progress
function log(step, message) {
  const timestamp = new Date().toISOString().split('T')[1].slice(0, 12);
  console.log(`[${timestamp}] [${step}] ${message}`);
}

async function main() {
  console.log('='.repeat(70));
  console.log('Interactive Browsing Demo - ifinsta.com');
  console.log('='.repeat(70));
  console.log();

  // Ensure screenshots directory exists
  await mkdir(SCREENSHOTS_DIR, { recursive: true });

  const bridge = getExtensionBridge();
  const browserManager = getBrowserManager();
  const browserBridge = getBrowserBridge();

  let sessionId = null;
  let extensionId = null;
  let tabId = null;

  try {
    // Step 1: Start WebSocket bridge
    log('INIT', 'Starting WebSocket bridge on port 9315...');
    await bridge.startServer(9315);
    log('INIT', 'WebSocket bridge started');

    // Step 2: Launch Chrome with extension
    log('LAUNCH', 'Launching Chrome with extension...');
    sessionId = await browserManager.launchBrowser({
      type: BrowserType.CHROME,
      headless: false,
      viewport: { width: 1440, height: 900 },
    });

    const session = browserManager.getSession(sessionId);
    extensionId = session?.extensionId;
    log('LAUNCH', `Chrome launched - sessionId: ${sessionId}, extensionId: ${extensionId}`);

    // Wait for extension to stabilize
    await delay(3000);

    // Step 3: Navigate to ifinsta.com
    log('NAVIGATE', `Navigating to ${TARGET_URL}...`);
    try {
      const navResult = await browserManager.navigate(sessionId, TARGET_URL);
      tabId = navResult.tabId;
      log('NAVIGATE', `Navigation complete - loadTime: ${navResult.loadTime}ms, title: ${navResult.title || 'N/A'}`);
    } catch (navError) {
      log('NAVIGATE', `Navigation warning: ${navError.message}`);
      // Continue anyway - page might have loaded
    }

    // Wait for page to settle
    log('WAIT', 'Waiting for page to settle (3 seconds)...');
    await delay(3000);

    // Step 4: Take initial screenshot
    log('SCREENSHOT', 'Capturing initial screenshot...');
    try {
      const screenshot1 = await browserManager.takeScreenshot(sessionId);
      const filepath1 = pathResolve(SCREENSHOTS_DIR, `ifinsta_home_${Date.now()}.png`);
      await writeFile(filepath1, Buffer.from(screenshot1, 'base64'));
      log('SCREENSHOT', `Saved: ${filepath1}`);
    } catch (ssError) {
      log('SCREENSHOT', `Screenshot warning: ${ssError.message}`);
    }

    // Step 5: Simulate user scroll (slow speed for demo)
    log('SCROLL', 'Simulating user scroll (slow speed)...');
    try {
      // Get fresh extension ID in case of reconnection
      const connectedExts = bridge.getConnectedExtensions();
      if (connectedExts.length > 0) {
        extensionId = connectedExts[0];
        log('SCROLL', `Using extension: ${extensionId}`);
      }

      // List tabs to get current tab
      const tabsResult = await bridge.sendCommand(extensionId, 'listTabs', {});
      const tabs = tabsResult?.tabs || [];
      const activeTab = tabs.find(t => t.active) || tabs[0];
      if (activeTab) {
        tabId = activeTab.tabId;
        log('SCROLL', `Active tab: ${tabId} - ${activeTab.url}`);
      }

      // Scroll the page
      const scrollResult = await browserBridge.simulateUserScroll(tabId, 'slow', true);
      if (scrollResult) {
        log('SCROLL', `Scroll complete - duration: ${scrollResult.duration || 'N/A'}ms`);
        if (scrollResult.pausePoints) {
          log('SCROLL', `Pause points: ${scrollResult.pausePoints.length || 0}`);
        }
      }
    } catch (scrollError) {
      log('SCROLL', `Scroll warning: ${scrollError.message}`);
    }

    // Take screenshot after scroll
    await delay(1000);
    log('SCREENSHOT', 'Capturing post-scroll screenshot...');
    try {
      const screenshot2 = await browserManager.takeScreenshot(sessionId);
      const filepath2 = pathResolve(SCREENSHOTS_DIR, `ifinsta_scrolled_${Date.now()}.png`);
      await writeFile(filepath2, Buffer.from(screenshot2, 'base64'));
      log('SCREENSHOT', `Saved: ${filepath2}`);
    } catch (ssError) {
      log('SCREENSHOT', `Screenshot warning: ${ssError.message}`);
    }

    // Step 6: Scroll back to top
    log('SCROLL', 'Scrolling back to top...');
    try {
      const connectedExts = bridge.getConnectedExtensions();
      if (connectedExts.length > 0 && tabId) {
        await bridge.sendCommand(connectedExts[0], 'executeScript', {
          tabId,
          code: 'window.scrollTo({ top: 0, behavior: "smooth" });',
        });
        await delay(1000);
        log('SCROLL', 'Scrolled to top');
      }
    } catch (scrollTopError) {
      log('SCROLL', `Scroll to top warning: ${scrollTopError.message}`);
    }

    // Step 7: Find and hover over navigation elements
    log('HOVER', 'Looking for navigation elements to hover...');
    try {
      const connectedExts = bridge.getConnectedExtensions();
      if (connectedExts.length > 0 && tabId) {
        const extId = connectedExts[0];
        
        // Common nav selectors to try
        const navSelectors = [
          'nav a',
          'header a',
          '.nav-link',
          '.navbar a',
          'a[href*="features"]',
          'a[href*="pricing"]',
          'a[href*="about"]',
        ];

        for (const selector of navSelectors) {
          try {
            await bridge.sendCommand(extId, 'hoverElement', { tabId, selector });
            log('HOVER', `Hovered over: ${selector}`);
            await delay(500);
          } catch {
            // Selector not found, continue
          }
        }
      }
    } catch (hoverError) {
      log('HOVER', `Hover warning: ${hoverError.message}`);
    }

    // Step 8: Look for and click a CTA button
    log('CLICK', 'Looking for CTA buttons to click...');
    let clickedButton = false;
    try {
      const connectedExts = bridge.getConnectedExtensions();
      if (connectedExts.length > 0 && tabId) {
        const extId = connectedExts[0];

        // Common CTA selectors
        const ctaSelectors = [
          'a[href*="get-started"]',
          'a[href*="signup"]',
          'a[href*="register"]',
          'button[type="submit"]',
          '.cta-button',
          '.btn-primary',
          'a.btn',
          'button.btn',
        ];

        for (const selector of ctaSelectors) {
          try {
            await bridge.sendCommand(extId, 'clickElement', { tabId, selector });
            log('CLICK', `Clicked: ${selector}`);
            clickedButton = true;
            break;
          } catch {
            // Selector not found or not clickable, continue
          }
        }

        if (!clickedButton) {
          // Try to find any button
          try {
            await bridge.sendCommand(extId, 'clickElement', { tabId, selector: 'button' });
            log('CLICK', 'Clicked first button found');
            clickedButton = true;
          } catch {
            log('CLICK', 'No buttons found to click');
          }
        }
      }
    } catch (clickError) {
      log('CLICK', `Click warning: ${clickError.message}`);
    }

    // Step 9: Wait for any page transition
    if (clickedButton) {
      log('WAIT', 'Waiting for page transition (3 seconds)...');
      await delay(3000);
    }

    // Step 10: Take screenshot of result
    log('SCREENSHOT', 'Capturing final screenshot...');
    try {
      const screenshot3 = await browserManager.takeScreenshot(sessionId);
      const filepath3 = pathResolve(SCREENSHOTS_DIR, `ifinsta_final_${Date.now()}.png`);
      await writeFile(filepath3, Buffer.from(screenshot3, 'base64'));
      log('SCREENSHOT', `Saved: ${filepath3}`);
    } catch (ssError) {
      log('SCREENSHOT', `Screenshot warning: ${ssError.message}`);
    }

    // Step 11: Navigate back to homepage
    if (clickedButton) {
      log('NAVIGATE', 'Navigating back to homepage...');
      try {
        const connectedExts = bridge.getConnectedExtensions();
        if (connectedExts.length > 0 && tabId) {
          await bridge.sendCommand(connectedExts[0], 'executeScript', {
            tabId,
            code: 'history.back();',
          });
          await delay(2000);
          log('NAVIGATE', 'Navigated back');
        }
      } catch (backError) {
        log('NAVIGATE', `Navigate back warning: ${backError.message}`);
      }
    }

    // Step 12: Run design audit
    log('AUDIT', 'Running design audit...');
    let auditResult = null;
    try {
      const connectedExts = bridge.getConnectedExtensions();
      if (connectedExts.length > 0 && tabId) {
        const extId = connectedExts[0];
        
        // Refresh tab ID
        const tabsResult = await bridge.sendCommand(extId, 'listTabs', {});
        const tabs = tabsResult?.tabs || [];
        const activeTab = tabs.find(t => t.active) || tabs[0];
        const currentTabId = activeTab?.tabId || tabId;

        auditResult = await bridge.sendCommand(extId, 'runDesignAudit', { tabId: currentTabId });
        log('AUDIT', 'Design audit completed');

        // Print audit summary
        if (auditResult) {
          console.log();
          console.log('--- Design Audit Summary ---');
          
          if (auditResult.colorContrast) {
            const violations = auditResult.colorContrast.violations || [];
            console.log(`  Color Contrast Violations: ${violations.length}`);
          }
          
          if (auditResult.touchTargets) {
            console.log(`  Touch Targets: ${auditResult.touchTargets.passing || 0}/${auditResult.touchTargets.total || 0} passing`);
          }
          
          if (auditResult.images) {
            console.log(`  Images: ${auditResult.images.total || 0} total, ${auditResult.images.missingAlt?.length || 0} missing alt`);
          }
          
          if (auditResult.typography) {
            console.log(`  Typography Readability Score: ${auditResult.typography.readabilityScore || 'N/A'}`);
          }
          
          if (auditResult.forms) {
            console.log(`  Forms: ${auditResult.forms.total || 0} total, ${auditResult.forms.withoutLabels || 0} without labels`);
          }

          console.log();
        }
      } else {
        log('AUDIT', 'No extension connected for design audit');
      }
    } catch (auditError) {
      log('AUDIT', `Design audit warning: ${auditError.message}`);
    }

    // Step 13: Get Web Vitals
    log('VITALS', 'Measuring Web Vitals...');
    try {
      const connectedExts = bridge.getConnectedExtensions();
      if (connectedExts.length > 0 && tabId) {
        const extId = connectedExts[0];
        const vitals = await bridge.sendCommand(extId, 'getWebVitals', { tabId });
        
        if (vitals) {
          console.log();
          console.log('--- Web Vitals ---');
          if (vitals.lcp !== null && vitals.lcp !== undefined) console.log(`  LCP: ${vitals.lcp}ms`);
          if (vitals.fcp !== null && vitals.fcp !== undefined) console.log(`  FCP: ${vitals.fcp}ms`);
          if (vitals.cls !== null && vitals.cls !== undefined) console.log(`  CLS: ${vitals.cls}`);
          if (vitals.fid !== null && vitals.fid !== undefined) console.log(`  FID: ${vitals.fid}ms`);
          if (vitals.ttfb !== null && vitals.ttfb !== undefined) console.log(`  TTFB: ${vitals.ttfb}ms`);
          if (vitals.inp !== null && vitals.inp !== undefined) console.log(`  INP: ${vitals.inp}ms`);
          console.log();
        }
      }
    } catch (vitalsError) {
      log('VITALS', `Web Vitals warning: ${vitalsError.message}`);
    }

    // Summary
    console.log('='.repeat(70));
    console.log('INTERACTIVE BROWSING SUMMARY');
    console.log('='.repeat(70));
    console.log(`Target URL: ${TARGET_URL}`);
    console.log(`Session ID: ${sessionId}`);
    console.log(`Extension ID: ${extensionId}`);
    console.log(`Tab ID: ${tabId}`);
    console.log(`Screenshots saved to: ${SCREENSHOTS_DIR}`);
    console.log('='.repeat(70));

  } catch (error) {
    console.error();
    console.error('Error during interactive browsing:');
    console.error(error);
  } finally {
    // Cleanup
    if (sessionId) {
      log('CLEANUP', 'Closing browser session...');
      try {
        await browserManager.closeSession(sessionId);
        log('CLEANUP', 'Browser session closed');
      } catch (closeError) {
        log('CLEANUP', `Close warning: ${closeError.message}`);
      }
    }

    // Stop the bridge
    log('CLEANUP', 'Stopping WebSocket bridge...');
    try {
      await bridge.stopServer();
      log('CLEANUP', 'WebSocket bridge stopped');
    } catch (stopError) {
      log('CLEANUP', `Stop bridge warning: ${stopError.message}`);
    }
  }

  console.log();
  console.log('Demo completed!');
}

main().catch(console.error);
