/**
 * Browser Manager
 *
 * Core browser management for MCP Router as master testing system.
 * Uses hybrid CDP + extension architecture:
 *
 * CDP handles (reliable, no extension dependency):
 * - navigation, screenshots, viewport changes, script execution,
 *   network monitoring, profiling
 *
 * Extension handles (needs content script):
 * - design audit, web vitals collection, DOM inspection,
 *   user scroll simulation, form interactions
 */

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { resolve as pathResolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { getLogger } from '../infra/logger.js';
import { getExtensionBridge } from './extensionBridge.js';
import { createCDPClient, getTargets, waitForCDP } from './cdpClient.js';
import type { CDPClient } from './cdpClient.js';
import { FirefoxDriver, type FirefoxSession, type FirefoxConfig } from './firefoxDriver.js';
import { SafariDriver, type SafariSession, type SafariConfig } from './safariDriver.js';
import { EdgeDriver, type EdgeSession, type EdgeConfig } from './edgeDriver.js';
import { createNetworkControlManager, type NetworkConditions } from './networkControl.js';

// ES module compatibility - derive __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const logger = getLogger('browser-manager');

// ============================================================================
// Core Types
// ============================================================================

/**
 * Browser type
 */
export enum BrowserType {
  CHROME = 'chrome',
  FIREFOX = 'firefox',
  SAFARI = 'safari',
  EDGE = 'edge',
}

/**
 * Browser instance configuration
 */
export interface BrowserConfig {
  type: BrowserType;
  headless: boolean;
  viewport?: {
    width: number;
    height: number;
    deviceScaleFactor?: number;
  };
  userAgent?: string;
  locale?: string;
  timezone?: string;
  permissions?: string[];
}

/**
 * Browser session
 */
export interface BrowserSession {
  sessionId: string;
  browserType: BrowserType;
  config: BrowserConfig;
  instance: ChromeDriverInstance;
  pages: Map<string, unknown>;
  isActive: boolean;
  createdAt: number;
  lastActivity: number;
  extensionId?: string;
}

export interface BrowserSessionTransportInfo {
  browserType: BrowserType;
  extensionId?: string;
  extensionConnected: boolean;
  hasCdp: boolean;
  remoteDebuggingPort: number;
  targetId?: string;
}

/**
 * Navigation result
 */
export interface NavigationResult {
  success: boolean;
  url: string;
  loadTime: number;
  statusCode?: number;
  error?: string;
  screenshots?: string[];
  title?: string;
  tabId?: number;
}

/**
 * Screenshot options
 */
export interface ScreenshotOptions {
  fullPage?: boolean;
  selector?: string;
  encoding?: 'base64' | 'binary';
  type?: 'png' | 'jpeg';
  quality?: number;
}

/**
 * Chrome driver instance returned from launchChrome
 */
/**
 * Profiling result from CDP
 */
export interface ProfilingResult {
  cpuProfile: unknown;
  metrics: Array<{ name: string; value: number }>;
  method: 'cdp' | 'extension';
}

interface ChromeDriverInstance {
  extensionId: string;
  process: ChildProcess;
  tabId: number | null;
  remoteDebuggingPort: number;
  cdpClient: CDPClient | null;
  navigate: (url: string, options?: { waitFor?: string; timeout?: number }) => Promise<NavigationResult>;
  screenshot: (options?: ScreenshotOptions) => Promise<string>;
  executeScript: (code: string, timeout?: number) => Promise<unknown>;
  setViewport: (width: number, height: number, deviceScaleFactor?: number, mobile?: boolean) => Promise<void>;
  getMetrics: () => Promise<unknown>;
  getWebVitals: () => Promise<unknown>;
  runDesignAudit: () => Promise<unknown>;
  simulateUserScroll: (speed?: 'slow' | 'medium' | 'fast', pauseOnSections?: boolean) => Promise<unknown>;
  startProfiling: () => Promise<string>;
  stopProfiling: (profilingId: string) => Promise<ProfilingResult>;
  close: () => Promise<void>;
}

// ============================================================================
// Chrome executable lookup
// ============================================================================

const CHROME_PATHS_WINDOWS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

function findChromeExecutable(): string {
  // Check LOCALAPPDATA first
  const localAppData = process.env['LOCALAPPDATA'];
  if (localAppData) {
    const localPath = pathResolve(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe');
    if (existsSync(localPath)) return localPath;
  }

  for (const p of CHROME_PATHS_WINDOWS) {
    if (existsSync(p)) return p;
  }

  // Also check PATH-resolved 'chrome' / 'google-chrome' on other platforms
  const programFiles = process.env['PROGRAMFILES'];
  if (programFiles) {
    const pf = pathResolve(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe');
    if (existsSync(pf)) return pf;
  }

  // Fallback: hope it's on PATH
  return 'chrome';
}

// ============================================================================
// Extension directory lookup
// ============================================================================

function getExtensionDir(): string {
  // When running from dist/browser/browserManager.js
  const fromDistBrowser = pathResolve(__dirname, '..', '..', 'chrome-extension');
  if (existsSync(fromDistBrowser)) return fromDistBrowser;

  // When running from dist/src/browser/browserManager.js (if compiled to dist/src/)
  const fromDistSrc = pathResolve(__dirname, '..', '..', '..', 'chrome-extension');
  if (existsSync(fromDistSrc)) return fromDistSrc;

  // Last resort: CWD
  const fromCwd = pathResolve(process.cwd(), 'chrome-extension');
  if (existsSync(fromCwd)) return fromCwd;

  throw new Error('Could not locate chrome-extension/ directory');
}

async function getWebVitalsViaCdp(cdp: CDPClient): Promise<unknown> {
  const script = `
    (function() {
      return new Promise((resolve) => {
        const vitals = { lcp: null, fid: null, cls: 0, fcp: null, ttfb: null, inp: null };
        const navEntries = performance.getEntriesByType('navigation');
        if (navEntries.length > 0) {
          const nav = navEntries[0];
          vitals.ttfb = nav.responseStart - nav.requestStart;
        }
        const paintEntries = performance.getEntriesByType('paint');
        const fcp = paintEntries.find((entry) => entry.name === 'first-contentful-paint');
        if (fcp) {
          vitals.fcp = fcp.startTime;
        }
        const lcpEntries = performance.getEntriesByType('largest-contentful-paint');
        if (lcpEntries.length > 0) {
          vitals.lcp = lcpEntries[lcpEntries.length - 1].startTime;
        }
        const layoutShifts = performance.getEntriesByType('layout-shift');
        layoutShifts.forEach((entry) => {
          if (!entry.hadRecentInput) {
            vitals.cls += entry.value;
          }
        });
        if (vitals.lcp !== null) {
          resolve(vitals);
          return;
        }
        try {
          const observer = new PerformanceObserver((list) => {
            const entries = list.getEntries();
            if (entries.length > 0) {
              vitals.lcp = entries[entries.length - 1].startTime;
            }
            observer.disconnect();
            resolve(vitals);
          });
          observer.observe({ type: 'largest-contentful-paint', buffered: true });
        } catch {
          resolve(vitals);
        }
        setTimeout(() => resolve(vitals), 2000);
      });
    })()
  `;

  return cdp.executeScript(script, { returnByValue: true, awaitPromise: true });
}

async function runDesignAuditViaCdp(cdp: CDPClient): Promise<unknown> {
  const script = `
    (function() {
      const results = {
        colorContrast: { passes: 0, violations: [] },
        typography: { fonts: [], issues: [], readabilityScore: 100 },
        touchTargets: { total: 0, passing: 0, failing: 0, violations: [] },
        layoutShifts: { score: 0, shifts: [] },
        responsiveness: { overflowingElements: [], hasHorizontalScroll: false, viewportWidth: window.innerWidth },
        zIndexStacking: { layers: [], maxZIndex: 0, potentialIssues: [] },
        spacing: { commonMargins: [], commonPaddings: [], consistencyScore: 100 },
        colorPalette: { colors: [], totalUnique: 0, groups: [] },
        images: { total: 0, missingAlt: [], oversized: [], missingDimensions: [], lazyLoaded: 0, eagerLoaded: 0 },
        forms: { total: 0, withLabels: 0, withoutLabels: 0, violations: [] },
        interactiveElements: { total: 0, violations: [] },
        score: 100
      };
      function getSelector(el) {
        if (el.id) return '#' + el.id;
        if (el.className && typeof el.className === 'string') {
          const classes = el.className.trim().split(/\\s+/).slice(0, 2).join('.');
          return el.tagName.toLowerCase() + (classes ? '.' + classes : '');
        }
        return el.tagName.toLowerCase();
      }
      function parseColor(color) {
        if (!color || color === 'transparent' || color === 'rgba(0, 0, 0, 0)') return null;
        const match = color.match(/rgba?\\(\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)/);
        return match ? [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])] : null;
      }
      function luminance(r, g, b) {
        const values = [r, g, b].map((value) => value / 255);
        const mapped = values.map((value) => value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4));
        return 0.2126 * mapped[0] + 0.7152 * mapped[1] + 0.0722 * mapped[2];
      }
      const interactiveEls = document.querySelectorAll('a, button, input, select, textarea, [role="button"], [onclick]');
      results.touchTargets.total = interactiveEls.length;
      interactiveEls.forEach((el) => {
        if (el.type === 'hidden') return;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return;
        if (rect.width >= 48 && rect.height >= 48) {
          results.touchTargets.passing++;
        } else {
          results.touchTargets.failing++;
          if (results.touchTargets.violations.length < 20) {
            results.touchTargets.violations.push({ selector: getSelector(el), width: Math.round(rect.width), height: Math.round(rect.height) });
          }
        }
      });
      const images = document.querySelectorAll('img');
      results.images.total = images.length;
      images.forEach((img) => {
        const src = (img.src || '').substring(0, 200);
        if (!img.getAttribute('alt') && img.getAttribute('alt') !== '') {
          if (results.images.missingAlt.length < 20) results.images.missingAlt.push({ src, selector: getSelector(img) });
        }
        if (!img.hasAttribute('width') || !img.hasAttribute('height')) {
          if (results.images.missingDimensions.length < 20) results.images.missingDimensions.push({ src, selector: getSelector(img) });
        }
        if (img.naturalWidth > 0 && img.width > 0 && img.naturalWidth > img.width * 2) {
          if (results.images.oversized.length < 20) {
            results.images.oversized.push({ src, selector: getSelector(img), naturalWidth: img.naturalWidth, displayWidth: img.width });
          }
        }
        if (img.loading === 'lazy') results.images.lazyLoaded++;
        else results.images.eagerLoaded++;
      });
      results.responsiveness.hasHorizontalScroll = document.documentElement.scrollWidth > document.documentElement.clientWidth;
      const textElements = document.querySelectorAll('p, span, a, li, h1, h2, h3, h4, h5, h6, label, button');
      const checked = Math.min(textElements.length, 100);
      for (let i = 0; i < checked; i++) {
        const el = textElements[i];
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0 || !el.textContent || el.textContent.trim().length === 0) continue;
        try {
          const computed = getComputedStyle(el);
          const fgColor = parseColor(computed.color);
          const bgColor = parseColor(computed.backgroundColor);
          if (!fgColor || !bgColor) continue;
          const fgLum = luminance(fgColor[0], fgColor[1], fgColor[2]);
          const bgLum = luminance(bgColor[0], bgColor[1], bgColor[2]);
          const ratio = (Math.max(fgLum, bgLum) + 0.05) / (Math.min(fgLum, bgLum) + 0.05);
          const fontSize = parseFloat(computed.fontSize);
          const isBold = parseInt(computed.fontWeight) >= 700;
          const requiredAA = fontSize >= 18.66 || (fontSize >= 14 && isBold) ? 3 : 4.5;
          if (ratio < requiredAA) {
            results.colorContrast.violations.push({ selector: getSelector(el), ratio: Math.round(ratio * 100) / 100, required: requiredAA });
          } else {
            results.colorContrast.passes++;
          }
        } catch {
          // ignore audit calculation failures
        }
      }
      const typographyElements = document.querySelectorAll('p, span, a, li, h1, h2, h3, h4, h5, h6');
      const fontMap = new Map();
      const typeChecked = Math.min(typographyElements.length, 100);
      for (let i = 0; i < typeChecked; i++) {
        const el = typographyElements[i];
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0 || !el.textContent || el.textContent.trim().length === 0) continue;
        const computed = getComputedStyle(el);
        const fontSize = parseFloat(computed.fontSize);
        const lineHeight = parseFloat(computed.lineHeight) || fontSize * 1.2;
        const fontFamily = computed.fontFamily;
        const key = fontSize + '|' + lineHeight + '|' + fontFamily;
        if (!fontMap.has(key)) {
          fontMap.set(key, { fontSize, lineHeight, fontFamily, count: 0 });
        }
        fontMap.get(key).count++;
        if (fontSize < 12) results.typography.issues.push('Font size below 12px: ' + getSelector(el));
      }
      results.typography.fonts = Array.from(fontMap.values()).slice(0, 10);
      const forms = document.querySelectorAll('form');
      results.forms.total = forms.length;
      const inputs = document.querySelectorAll('input, select, textarea');
      inputs.forEach((input) => {
        const hasLabel = input.id && document.querySelector('label[for="' + input.id + '"]');
        const hasAriaLabel = input.getAttribute('aria-label') || input.getAttribute('aria-labelledby');
        if (hasLabel || hasAriaLabel) {
          results.forms.withLabels++;
        } else {
          results.forms.withoutLabels++;
          if (results.forms.violations.length < 10) {
            results.forms.violations.push({ selector: getSelector(input), type: input.type || 'text' });
          }
        }
      });
      const deductions = (results.touchTargets.violations.length * 2)
        + (results.images.missingAlt.length * 3)
        + (results.colorContrast.violations.length * 5)
        + (results.responsiveness.hasHorizontalScroll ? 10 : 0)
        + (results.forms.withoutLabels * 2);
      results.score = Math.max(0, 100 - deductions);
      return results;
    })()
  `;

  return cdp.executeScript(script, { returnByValue: true });
}

async function simulateUserScrollViaCdp(
  cdp: CDPClient,
  speed: 'slow' | 'medium' | 'fast' = 'medium'
): Promise<unknown> {
  const speedPresets = {
    slow: { scrollStep: 100, betweenScroll: 180 },
    medium: { scrollStep: 150, betweenScroll: 100 },
    fast: { scrollStep: 200, betweenScroll: 50 },
  };
  const preset = speedPresets[speed];
  const script = `
    (async function() {
      const stats = {
        totalScrollDistance: 0,
        duration: 0,
        pageHeight: document.documentElement.scrollHeight,
        viewportHeight: window.innerHeight,
        reachedBottom: false
      };
      const startTime = Date.now();
      const pageHeight = Math.max(
        document.body.scrollHeight,
        document.documentElement.scrollHeight,
        document.body.offsetHeight,
        document.documentElement.offsetHeight
      );
      const viewportHeight = window.innerHeight;
      let scrolled = 0;
      let lastScrollY = window.scrollY;
      let stuckCount = 0;
      while (scrolled < pageHeight - viewportHeight) {
        window.scrollBy({ top: ${preset.scrollStep}, behavior: 'instant' });
        scrolled += ${preset.scrollStep};
        stats.totalScrollDistance = scrolled;
        if (window.scrollY === lastScrollY) {
          stuckCount++;
          if (stuckCount > 5) break;
        } else {
          stuckCount = 0;
        }
        lastScrollY = window.scrollY;
        await new Promise((resolve) => setTimeout(resolve, ${preset.betweenScroll}));
      }
      stats.reachedBottom = window.scrollY + viewportHeight >= pageHeight - 100;
      stats.duration = Date.now() - startTime;
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return stats;
    })()
  `;

  return cdp.executeScript(script, { returnByValue: true, awaitPromise: true, timeout: 60000 });
}

// ============================================================================
// Browser Manager Implementation
// ============================================================================

/**
 * Browser Manager
 *
 * Manages browser instances using hybrid CDP + extension architecture.
 */
export class BrowserManager {
  private sessions: Map<string, BrowserSession>;
  private maxSessions: number;

  constructor() {
    this.sessions = new Map();
    this.maxSessions = 10;
  }

  /**
   * Launch new browser instance
   */
  async launchBrowser(config: BrowserConfig): Promise<string> {
    const sessionId = this.generateSessionId();

    logger.info('Launching browser', { sessionId, browserType: config.type });

    try {
      let instance: ChromeDriverInstance;
      let extensionId: string | undefined;

      switch (config.type) {
        case BrowserType.CHROME:
          instance = await this.launchChrome(config);
          extensionId = instance.extensionId;
          break;
        case BrowserType.FIREFOX:
          return this.launchFirefox(config, sessionId);
        case BrowserType.SAFARI:
          return this.launchSafari(config, sessionId);
        case BrowserType.EDGE:
          return this.launchEdge(config, sessionId);
        default:
          throw new Error(`Unsupported browser type: ${config.type}`);
      }

      const session: BrowserSession = {
        sessionId,
        browserType: config.type,
        config,
        instance,
        pages: new Map(),
        isActive: true,
        createdAt: Date.now(),
        lastActivity: Date.now(),
        extensionId,
      };

      this.sessions.set(sessionId, session);

      logger.info('Browser launched successfully', { sessionId, extensionId });
      return sessionId;
    } catch (error) {
      logger.error('Failed to launch browser', error instanceof Error ? error : new Error(String(error)), { config });
      throw new Error(`Browser launch failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Close browser session
   */
  async closeSession(sessionId: string): Promise<void> {
    logger.info('Closing browser session', { sessionId });

    const session = this.sessions.get(sessionId);
    if (!session) {
      logger.warn('Session not found', { sessionId });
      return;
    }

    try {
      await session.instance.close();
      this.sessions.delete(sessionId);
      session.isActive = false;
      logger.info('Browser session closed', { sessionId });
    } catch (error) {
      logger.error('Failed to close browser session', error instanceof Error ? error : new Error(String(error)), { sessionId });
      // Still remove the session from tracking
      this.sessions.delete(sessionId);
      session.isActive = false;
    }
  }

  /**
   * Navigate to URL
   */
  async navigate(sessionId: string, url: string, options?: { waitFor?: string; timeout?: number }): Promise<NavigationResult> {
    logger.debug('Navigating to URL', { sessionId, url });

    const session = this.sessions.get(sessionId);
    if (!session || !session.isActive) {
      throw new Error(`Session not found or inactive: ${sessionId}`);
    }

    try {
      const result = await session.instance.navigate(url, options);
      session.lastActivity = Date.now();

      // Track the tab ID
      if (result.tabId !== undefined) {
        session.instance.tabId = result.tabId;
      }

      logger.info('Navigation completed', { sessionId, url, loadTime: result.loadTime });
      return result;
    } catch (error) {
      logger.error('Navigation failed', error instanceof Error ? error : new Error(String(error)), { sessionId, url });
      return {
        success: false,
        url,
        loadTime: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Take screenshot
   */
  async takeScreenshot(sessionId: string, options: ScreenshotOptions = {}): Promise<string> {
    logger.debug('Taking screenshot', { sessionId, options });

    const session = this.sessions.get(sessionId);
    if (!session || !session.isActive) {
      throw new Error(`Session not found or inactive: ${sessionId}`);
    }

    try {
      const screenshot = await session.instance.screenshot(options);
      session.lastActivity = Date.now();
      logger.info('Screenshot taken', { sessionId });
      return screenshot;
    } catch (error) {
      logger.error('Screenshot failed', error instanceof Error ? error : new Error(String(error)), { sessionId });
      throw new Error(`Screenshot failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Execute script in browser
   */
  async executeScript(sessionId: string, script: string): Promise<unknown> {
    logger.debug('Executing script in browser', { sessionId, scriptLength: script.length });

    const session = this.sessions.get(sessionId);
    if (!session || !session.isActive) {
      throw new Error(`Session not found or inactive: ${sessionId}`);
    }

    try {
      const result = await session.instance.executeScript(script);
      session.lastActivity = Date.now();
      logger.info('Script executed successfully', { sessionId });
      return result;
    } catch (error) {
      logger.error('Script execution failed', error instanceof Error ? error : new Error(String(error)), { sessionId });
      throw new Error(`Script execution failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Set viewport dimensions for a session
   */
  async setViewport(sessionId: string, width: number, height: number, deviceScaleFactor?: number, mobile?: boolean): Promise<void> {
    logger.debug('Setting viewport', { sessionId, width, height, deviceScaleFactor, mobile });

    const session = this.sessions.get(sessionId);
    if (!session || !session.isActive) {
      throw new Error(`Session not found or inactive: ${sessionId}`);
    }

    try {
      await session.instance.setViewport(width, height, deviceScaleFactor, mobile);
      session.lastActivity = Date.now();
      logger.info('Viewport set', { sessionId, width, height });
    } catch (error) {
      logger.error('Set viewport failed', error instanceof Error ? error : new Error(String(error)), { sessionId });
      throw new Error(`Set viewport failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  getSessionTransportInfo(sessionId: string): BrowserSessionTransportInfo {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isActive) {
      throw new Error(`Session not found or inactive: ${sessionId}`);
    }

    const targetId = session.instance.cdpClient?.isConnected() === true
      ? session.instance.cdpClient.getTargetId()
      : undefined;

    return {
      browserType: session.browserType,
      ...(session.extensionId !== undefined ? { extensionId: session.extensionId } : {}),
      extensionConnected:
        session.extensionId !== undefined &&
        session.extensionId !== 'cdp-only' &&
        session.extensionId !== 'edge-only' &&
        session.extensionId !== 'firefox-only' &&
        session.extensionId !== 'safari-only',
      hasCdp: session.instance.cdpClient?.isConnected() === true,
      remoteDebuggingPort: session.instance.remoteDebuggingPort,
      ...(targetId !== undefined ? { targetId } : {}),
    };
  }

  async listTabs(sessionId: string): Promise<Array<{ tabId: string; url: string; title: string; isActive: boolean }>> {
    const transport = this.getSessionTransportInfo(sessionId);
    if (!transport.hasCdp) {
      throw new Error(`Tab management is not available for ${transport.browserType}`);
    }

    const targets = await getTargets(transport.remoteDebuggingPort);
    return targets
      .filter((target) => target.type === 'page')
      .map((target) => ({
        tabId: target.id,
        url: target.url,
        title: target.title,
        isActive: target.id === transport.targetId,
      }));
  }

  async createTab(sessionId: string, url?: string): Promise<{ tabId: string; url: string }> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isActive || !session.instance.cdpClient?.isConnected()) {
      throw new Error(`Tab creation is not available for session '${sessionId}'`);
    }

    const result = await session.instance.cdpClient.send('Target.createTarget', {
      url: url ?? 'about:blank',
      background: false,
    }) as { targetId: string };

    return {
      tabId: result.targetId,
      url: url ?? 'about:blank',
    };
  }

  async activateTab(sessionId: string, tabId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isActive || !session.instance.cdpClient?.isConnected()) {
      throw new Error(`Tab activation is not available for session '${sessionId}'`);
    }

    await session.instance.cdpClient.send('Target.activateTarget', { targetId: tabId });
  }

  async closeTab(sessionId: string, tabId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isActive || !session.instance.cdpClient?.isConnected()) {
      throw new Error(`Tab closing is not available for session '${sessionId}'`);
    }

    await session.instance.cdpClient.send('Target.closeTarget', { targetId: tabId });
  }

  async setNetworkPreset(sessionId: string, preset: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isActive || !session.instance.cdpClient?.isConnected()) {
      throw new Error(`Network control is not available for session '${sessionId}'`);
    }

    const manager = createNetworkControlManager(session.instance.cdpClient);
    await manager.applyNetworkPreset(preset);
  }

  async resetNetworkConditions(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isActive || !session.instance.cdpClient?.isConnected()) {
      throw new Error(`Network control is not available for session '${sessionId}'`);
    }

    const manager = createNetworkControlManager(session.instance.cdpClient);
    await manager.resetNetworkConditions();
  }

  async click(sessionId: string, selector: string): Promise<Record<string, unknown>> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isActive) {
      throw new Error(`Session not found or inactive: ${sessionId}`);
    }

    const result = await session.instance.executeScript(`
      (function() {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!element) {
          throw new Error('Element not found: ' + ${JSON.stringify(selector)});
        }
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || rect.width === 0 || rect.height === 0) {
          throw new Error('Element is not interactable: ' + ${JSON.stringify(selector)});
        }
        element.click();
        return {
          selector: ${JSON.stringify(selector)},
          tagName: element.tagName.toLowerCase(),
          text: (element.textContent || '').trim().slice(0, 120),
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2
        };
      })()
    `) as Record<string, unknown>;

    session.lastActivity = Date.now();
    return result;
  }

  async type(
    sessionId: string,
    selector: string,
    text: string,
    options: { clearFirst?: boolean; pressEnter?: boolean } = {}
  ): Promise<Record<string, unknown>> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isActive) {
      throw new Error(`Session not found or inactive: ${sessionId}`);
    }

    const clearFirst = options.clearFirst ?? true;
    const pressEnter = options.pressEnter ?? false;
    const result = await session.instance.executeScript(`
      (function() {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!element) {
          throw new Error('Element not found: ' + ${JSON.stringify(selector)});
        }
        if (!('value' in element)) {
          throw new Error('Element does not accept text input: ' + ${JSON.stringify(selector)});
        }
        element.focus();
        if (${clearFirst}) {
          element.value = '';
        }
        element.value = ${JSON.stringify(text)};
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        if (${pressEnter}) {
          element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
          element.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
        }
        return {
          selector: ${JSON.stringify(selector)},
          textLength: ${text.length},
          pressEnter: ${pressEnter}
        };
      })()
    `) as Record<string, unknown>;

    session.lastActivity = Date.now();
    return result;
  }

  async fillForm(
    sessionId: string,
    fields: Array<{ selector: string; value: string; type: 'text' | 'select' | 'checkbox' | 'radio' | 'click' }>
  ): Promise<Record<string, unknown>> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isActive) {
      throw new Error(`Session not found or inactive: ${sessionId}`);
    }

    const result = await session.instance.executeScript(`
      (async function() {
        const fields = ${JSON.stringify(fields)};
        const completed = [];
        for (const field of fields) {
          const element = document.querySelector(field.selector);
          if (!element) {
            throw new Error('Field not found: ' + field.selector);
          }
          switch (field.type) {
            case 'text':
            case 'select':
              element.value = field.value;
              element.dispatchEvent(new Event('input', { bubbles: true }));
              element.dispatchEvent(new Event('change', { bubbles: true }));
              break;
            case 'checkbox':
            case 'radio':
              element.checked = field.value === 'true';
              element.dispatchEvent(new Event('change', { bubbles: true }));
              break;
            case 'click':
              element.click();
              break;
          }
          completed.push({ selector: field.selector, type: field.type });
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        return { fieldCount: fields.length, completed };
      })()
    `, 10000) as Record<string, unknown>;

    session.lastActivity = Date.now();
    return result;
  }

  async hover(sessionId: string, selector: string): Promise<Record<string, unknown>> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isActive) {
      throw new Error(`Session not found or inactive: ${sessionId}`);
    }

    const result = await session.instance.executeScript(`
      (function() {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!element) {
          throw new Error('Element not found: ' + ${JSON.stringify(selector)});
        }
        const rect = element.getBoundingClientRect();
        const options = {
          bubbles: true,
          cancelable: true,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
        };
        element.dispatchEvent(new MouseEvent('mouseenter', options));
        element.dispatchEvent(new MouseEvent('mouseover', options));
        return {
          selector: ${JSON.stringify(selector)},
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2
        };
      })()
    `) as Record<string, unknown>;

    session.lastActivity = Date.now();
    return result;
  }

  async waitFor(sessionId: string, selector: string, timeoutMs: number): Promise<Record<string, unknown>> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isActive) {
      throw new Error(`Session not found or inactive: ${sessionId}`);
    }

    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const result = await session.instance.executeScript(`
        (function() {
          const element = document.querySelector(${JSON.stringify(selector)});
          if (!element) {
            return { found: false };
          }
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return {
            found: true,
            visible: style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
          };
        })()
      `) as Record<string, unknown>;

      if (result['found'] === true) {
        session.lastActivity = Date.now();
        return {
          selector,
          found: true,
          visible: result['visible'] === true,
          waitedMs: Date.now() - start,
        };
      }

      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    throw new Error(`Timed out waiting for selector '${selector}' after ${timeoutMs}ms`);
  }

  /**
   * Get performance metrics for a session
   */
  async getMetrics(sessionId: string): Promise<unknown> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isActive) {
      throw new Error(`Session not found or inactive: ${sessionId}`);
    }
    return session.instance.getMetrics();
  }

  /**
   * Get Web Vitals for a session
   */
  async getWebVitals(sessionId: string): Promise<unknown> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isActive) {
      throw new Error(`Session not found or inactive: ${sessionId}`);
    }
    return session.instance.getWebVitals();
  }

  /**
   * Run design audit for a session (extension-first with CDP fallback)
   */
  async runDesignAudit(sessionId: string): Promise<unknown> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isActive) {
      throw new Error(`Session not found or inactive: ${sessionId}`);
    }
    return session.instance.runDesignAudit();
  }

  /**
   * Simulate user scroll for a session (extension-first with CDP fallback)
   */
  async simulateUserScroll(sessionId: string, speed: 'slow' | 'medium' | 'fast' = 'medium', pauseOnSections = true): Promise<unknown> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isActive) {
      throw new Error(`Session not found or inactive: ${sessionId}`);
    }
    return session.instance.simulateUserScroll(speed, pauseOnSections);
  }

  /**
   * Start performance profiling for a session (extension-first with CDP fallback)
   */
  async startProfiling(sessionId: string): Promise<string> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isActive) {
      throw new Error(`Session not found or inactive: ${sessionId}`);
    }
    return session.instance.startProfiling();
  }

  /**
   * Stop performance profiling for a session and return results
   */
  async stopProfiling(sessionId: string, profilingId: string): Promise<ProfilingResult> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isActive) {
      throw new Error(`Session not found or inactive: ${sessionId}`);
    }
    return session.instance.stopProfiling(profilingId);
  }

  /**
   * Get all active sessions
   */
  getActiveSessions(): BrowserSession[] {
    return Array.from(this.sessions.values()).filter(session => session.isActive);
  }

  /**
   * Get session by ID
   */
  getSession(sessionId: string): BrowserSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Cleanup inactive sessions
   */
  async cleanupInactiveSessions(maxAge: number = 3600000): Promise<number> {
    logger.info('Cleaning up inactive sessions', { maxAge });

    const now = Date.now();
    const toCleanup: string[] = [];

    for (const [sessionId, session] of this.sessions.entries()) {
      const age = now - session.lastActivity;
      if (age > maxAge || !session.isActive) {
        toCleanup.push(sessionId);
      }
    }

    for (const sessionId of toCleanup) {
      await this.closeSession(sessionId);
    }

    logger.info('Cleanup completed', { cleanedCount: toCleanup.length });
    return toCleanup.length;
  }

  /**
   * Get active session count
   */
  getActiveSessionCount(): number {
    return Array.from(this.sessions.values()).filter(session => session.isActive).length;
  }

  /**
   * Check if can launch new session
   */
  canLaunchNewSession(): boolean {
    return this.getActiveSessionCount() < this.maxSessions;
  }

  /**
   * Get resource usage
   */
  getResourceUsage(): {
    activeSessions: number;
    totalSessions: number;
    memoryUsage: number;
  } {
    return {
      activeSessions: this.getActiveSessionCount(),
      totalSessions: this.sessions.size,
      memoryUsage: this.sessions.size * 150,
    };
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down browser manager');

    const sessionIds = Array.from(this.sessions.keys());
    for (const sessionId of sessionIds) {
      try {
        await this.closeSession(sessionId);
      } catch (error) {
        logger.error('Failed to close session during shutdown', error instanceof Error ? error : new Error(String(error)), { sessionId });
      }
    }

    logger.info('Browser manager shutdown complete');
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Launch Chrome with the extension loaded and establish CDP connection.
   * Uses hybrid architecture: CDP for reliable operations, extension for content script access.
   */
  private async launchChrome(config: BrowserConfig): Promise<ChromeDriverInstance> {
    const bridge = getExtensionBridge();

    // Ensure WebSocket server is running for extension communication
    if (!bridge.isRunning()) {
      await bridge.startServer();
    }

    const chromePath = findChromeExecutable();
    const extensionDir = getExtensionDir();

    // Create a unique user data directory for this Chrome instance
    const userDataDir = await mkdtemp(pathResolve(tmpdir(), 'mcp-chrome-'));

    logger.info('Launching Chrome', { chromePath, extensionDir, userDataDir });

    // Generate a random port for remote debugging
    const remoteDebuggingPort = 9222 + Math.floor(Math.random() * 1000);

    const args: string[] = [
      `--user-data-dir=${userDataDir}`,
      `--load-extension=${extensionDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-default-apps',
      '--auto-open-devtools-for-tabs',
      // Allow extensions to work in automation mode
      '--enable-automation',
      '--disable-popup-blocking',
      // Enable remote debugging for direct CDP access
      `--remote-debugging-port=${remoteDebuggingPort}`,
    ];

    if (config.headless) {
      args.push('--headless=new');
    }

    if (config.viewport) {
      args.push(`--window-size=${config.viewport.width},${config.viewport.height}`);
    }

    if (config.userAgent) {
      args.push(`--user-agent=${config.userAgent}`);
    }

    const chromeProcess = spawn(chromePath, args, {
      stdio: 'ignore',
      detached: false,
    });

    chromeProcess.on('error', (err) => {
      logger.error('Chrome process error', err);
    });

    chromeProcess.on('exit', (code) => {
      logger.info('Chrome process exited', { code, userDataDir });
    });

    // Wait for CDP port to be ready
    const cdpReady = await waitForCDP(remoteDebuggingPort, 15_000);
    if (!cdpReady) {
      throw new Error(`CDP port ${remoteDebuggingPort} not ready in time`);
    }
    logger.info('CDP port ready', { remoteDebuggingPort });

    // Create CDP client for reliable browser control
    let cdpClient: CDPClient | null = null;
    try {
      cdpClient = await createCDPClient(remoteDebuggingPort);
      logger.info('CDP client connected', { remoteDebuggingPort });
    } catch (err) {
      logger.warn('Failed to create CDP client, will rely on extension', { error: err instanceof Error ? err.message : String(err) });
    }

    // Wait for the extension to connect via WebSocket
    // Give the extension more time since service worker may need to wake up
    let extensionId: string;
    try {
      extensionId = await this.waitForExtensionConnection(bridge, 20_000);
      logger.info('Extension connected', { extensionId });
    } catch {
      // Extension not available - use a placeholder, CDP will handle most operations
      extensionId = 'cdp-only';
      logger.warn('Extension not connected, using CDP-only mode');
    }

    logger.info('Chrome launched with hybrid CDP+extension architecture', { extensionId, userDataDir, remoteDebuggingPort });

    // ========================================================================
    // CDP Fallback Scripts
    // ========================================================================

    /**
     * Get Web Vitals via CDP script injection.
     */
    async function getWebVitalsCDP(cdp: CDPClient): Promise<unknown> {
      const script = `
        (function() {
          return new Promise((resolve) => {
            const vitals = { lcp: null, fid: null, cls: 0, fcp: null, ttfb: null, inp: null };
            
            // TTFB from Navigation Timing
            const navEntries = performance.getEntriesByType('navigation');
            if (navEntries.length > 0) {
              const nav = navEntries[0];
              vitals.ttfb = nav.responseStart - nav.requestStart;
            }
            
            // FCP from Paint Timing
            const paintEntries = performance.getEntriesByType('paint');
            const fcp = paintEntries.find(e => e.name === 'first-contentful-paint');
            if (fcp) vitals.fcp = fcp.startTime;
            
            // LCP
            const lcpEntries = performance.getEntriesByType('largest-contentful-paint');
            if (lcpEntries.length > 0) {
              vitals.lcp = lcpEntries[lcpEntries.length - 1].startTime;
            }
            
            // CLS
            let clsValue = 0;
            const layoutShifts = performance.getEntriesByType('layout-shift');
            layoutShifts.forEach(entry => {
              if (!entry.hadRecentInput) clsValue += entry.value;
            });
            vitals.cls = clsValue;
            
            // If we have LCP data, resolve immediately
            if (vitals.lcp !== null) {
              resolve(vitals);
            } else {
              // Try PerformanceObserver for LCP with timeout
              try {
                const observer = new PerformanceObserver((list) => {
                  const entries = list.getEntries();
                  if (entries.length > 0) {
                    vitals.lcp = entries[entries.length - 1].startTime;
                  }
                  observer.disconnect();
                  resolve(vitals);
                });
                observer.observe({ type: 'largest-contentful-paint', buffered: true });
              } catch(e) {
                resolve(vitals);
              }
              // Timeout after 2 seconds
              setTimeout(() => resolve(vitals), 2000);
            }
          });
        })()
      `;
      const result = await cdp.executeScript(script, { returnByValue: true, awaitPromise: true });
      return result;
    }

    /**
     * Run Design Audit via CDP script injection.
     */
    async function runDesignAuditCDP(cdp: CDPClient): Promise<unknown> {
      const script = `
        (function() {
          const results = {
            colorContrast: { passes: 0, violations: [] },
            typography: { fonts: [], issues: [], readabilityScore: 100 },
            touchTargets: { total: 0, passing: 0, failing: 0, violations: [] },
            layoutShifts: { score: 0, shifts: [] },
            responsiveness: { overflowingElements: [], hasHorizontalScroll: false, viewportWidth: window.innerWidth },
            zIndexStacking: { layers: [], maxZIndex: 0, potentialIssues: [] },
            spacing: { commonMargins: [], commonPaddings: [], consistencyScore: 100 },
            colorPalette: { colors: [], totalUnique: 0, groups: [] },
            images: { total: 0, missingAlt: [], oversized: [], missingDimensions: [], lazyLoaded: 0, eagerLoaded: 0 },
            forms: { total: 0, withLabels: 0, withoutLabels: 0, violations: [] },
            interactiveElements: { total: 0, violations: [] },
            score: 100
          };
          
          // Helper: get selector for element
          function getSelector(el) {
            if (el.id) return '#' + el.id;
            if (el.className && typeof el.className === 'string') {
              const classes = el.className.trim().split(/\\s+/).slice(0, 2).join('.');
              return el.tagName.toLowerCase() + (classes ? '.' + classes : '');
            }
            return el.tagName.toLowerCase();
          }
          
          // Helper: parse color to RGB
          function parseColor(color) {
            if (!color || color === 'transparent' || color === 'rgba(0, 0, 0, 0)') return null;
            const match = color.match(/rgba?\\(\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)/);
            return match ? [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])] : null;
          }
          
          // Helper: calculate luminance
          function luminance(r, g, b) {
            const a = [r, g, b].map(v => v / 255);
            return a.map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))
              .reduce((t, c) => t + 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2], 0);
          }
          
          // Touch Target Check (48x48 minimum)
          const MIN = 48;
          const interactiveEls = document.querySelectorAll('a, button, input, select, textarea, [role="button"], [onclick]');
          results.touchTargets.total = interactiveEls.length;
          interactiveEls.forEach(el => {
            if (el.type === 'hidden') return;
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) return;
            if (rect.width >= MIN && rect.height >= MIN) {
              results.touchTargets.passing++;
            } else {
              results.touchTargets.failing++;
              if (results.touchTargets.violations.length < 20) {
                results.touchTargets.violations.push({
                  selector: getSelector(el),
                  width: Math.round(rect.width),
                  height: Math.round(rect.height)
                });
              }
            }
          });
          
          // Image Audit
          const images = document.querySelectorAll('img');
          results.images.total = images.length;
          images.forEach(img => {
            const src = (img.src || '').substring(0, 200);
            if (!img.getAttribute('alt') && img.getAttribute('alt') !== '') {
              if (results.images.missingAlt.length < 20) {
                results.images.missingAlt.push({ src, selector: getSelector(img) });
              }
            }
            if (!img.hasAttribute('width') || !img.hasAttribute('height')) {
              if (results.images.missingDimensions.length < 20) {
                results.images.missingDimensions.push({ src, selector: getSelector(img) });
              }
            }
            if (img.naturalWidth > 0 && img.width > 0 && img.naturalWidth > img.width * 2) {
              if (results.images.oversized.length < 20) {
                results.images.oversized.push({
                  src,
                  selector: getSelector(img),
                  naturalWidth: img.naturalWidth,
                  displayWidth: img.width,
                  ratio: Math.round((img.naturalWidth / img.width) * 10) / 10
                });
              }
            }
            if (img.loading === 'lazy') results.images.lazyLoaded++;
            else results.images.eagerLoaded++;
          });
          
          // Responsiveness
          results.responsiveness.hasHorizontalScroll = document.documentElement.scrollWidth > document.documentElement.clientWidth;
          
          // Color Contrast (simplified - check visible text elements)
          const textSelectors = 'p, span, a, li, h1, h2, h3, h4, h5, h6, label, button';
          const textElements = document.querySelectorAll(textSelectors);
          const checked = Math.min(textElements.length, 100);
          for (let i = 0; i < checked; i++) {
            const el = textElements[i];
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) continue;
            if (!el.textContent || el.textContent.trim().length === 0) continue;
            
            try {
              const computed = getComputedStyle(el);
              const fgColor = parseColor(computed.color);
              if (!fgColor) continue;
              
              // Simplified background color check
              const bgColor = parseColor(computed.backgroundColor);
              if (bgColor) {
                const fgLum = luminance(...fgColor);
                const bgLum = luminance(...bgColor);
                const ratio = (Math.max(fgLum, bgLum) + 0.05) / (Math.min(fgLum, bgLum) + 0.05);
                
                const fontSize = parseFloat(computed.fontSize);
                const isBold = parseInt(computed.fontWeight) >= 700;
                const isLargeText = fontSize >= 18.66 || (fontSize >= 14 && isBold);
                const requiredAA = isLargeText ? 3.0 : 4.5;
                
                if (ratio < requiredAA) {
                  results.colorContrast.violations.push({
                    selector: getSelector(el),
                    ratio: Math.round(ratio * 100) / 100,
                    required: requiredAA
                  });
                } else {
                  results.colorContrast.passes++;
                }
              }
            } catch(e) { /* skip */ }
          }
          
          // Typography Analysis
          const fontMap = new Map();
          const typographyElements = document.querySelectorAll('p, span, a, li, h1, h2, h3, h4, h5, h6');
          const typeChecked = Math.min(typographyElements.length, 100);
          for (let i = 0; i < typeChecked; i++) {
            const el = typographyElements[i];
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) continue;
            if (!el.textContent || el.textContent.trim().length === 0) continue;
            
            const computed = getComputedStyle(el);
            const fontSize = parseFloat(computed.fontSize);
            const lineHeight = parseFloat(computed.lineHeight) || fontSize * 1.2;
            const fontFamily = computed.fontFamily;
            const key = fontSize + '|' + lineHeight + '|' + fontFamily;
            
            if (!fontMap.has(key)) {
              fontMap.set(key, { fontSize, lineHeight, fontFamily, count: 0 });
            }
            fontMap.get(key).count++;
            
            // Check readability
            const lhRatio = lineHeight / fontSize;
            if (fontSize < 12) {
              results.typography.issues.push('Font size below 12px: ' + getSelector(el));
            }
            if (lhRatio < 1.2 || lhRatio > 2.0) {
              results.typography.issues.push('Line height ratio outside 1.2-2.0: ' + getSelector(el));
            }
          }
          results.typography.fonts = Array.from(fontMap.values()).slice(0, 10);
          
          // Forms audit
          const forms = document.querySelectorAll('form');
          results.forms.total = forms.length;
          const inputs = document.querySelectorAll('input, select, textarea');
          inputs.forEach(input => {
            const hasLabel = input.id && document.querySelector('label[for="' + input.id + '"]');
            const hasAriaLabel = input.getAttribute('aria-label') || input.getAttribute('aria-labelledby');
            const hasPlaceholder = input.placeholder;
            
            if (hasLabel || hasAriaLabel) {
              results.forms.withLabels++;
            } else if (!hasPlaceholder) {
              results.forms.withoutLabels++;
              if (results.forms.violations.length < 10) {
                results.forms.violations.push({
                  selector: getSelector(input),
                  type: input.type || 'text'
                });
              }
            }
          });
          
          // Score calculation
          let deductions = 0;
          deductions += results.touchTargets.violations.length * 2;
          deductions += results.images.missingAlt.length * 3;
          deductions += results.colorContrast.violations.length * 5;
          deductions += results.responsiveness.hasHorizontalScroll ? 10 : 0;
          deductions += results.forms.withoutLabels * 2;
          results.score = Math.max(0, 100 - deductions);
          
          return results;
        })()
      `;
      const result = await cdp.executeScript(script, { returnByValue: true });
      return result;
    }

    /**
     * Simulate User Scroll via CDP script injection.
     */
    async function simulateUserScrollCDP(cdp: CDPClient, speed: 'slow' | 'medium' | 'fast' = 'medium'): Promise<unknown> {
      const speedPresets = {
        slow: { scrollStep: 100, betweenScroll: 180, sectionPause: 1000 },
        medium: { scrollStep: 150, betweenScroll: 100, sectionPause: 500 },
        fast: { scrollStep: 200, betweenScroll: 50, sectionPause: 250 },
      };
      const preset = speedPresets[speed] || speedPresets.medium;

      const script = `
        (async function() {
          const stats = {
            totalScrollDistance: 0,
            duration: 0,
            pausePoints: 0,
            pageHeight: document.documentElement.scrollHeight,
            viewportHeight: window.innerHeight,
            sectionsVisited: [],
            reachedBottom: false
          };
          
          const startTime = Date.now();
          const pageHeight = Math.max(
            document.body.scrollHeight,
            document.documentElement.scrollHeight,
            document.body.offsetHeight,
            document.documentElement.offsetHeight
          );
          const viewportHeight = window.innerHeight;
          stats.pageHeight = pageHeight;
          stats.viewportHeight = viewportHeight;
          
          const maxScroll = Math.min(pageHeight, viewportHeight * 10);
          const scrollStep = ${preset.scrollStep};
          const scrollDelay = ${preset.betweenScroll};
          
          // Find section headers to note
          const sections = document.querySelectorAll('h1, h2, h3, section, article, [role="main"]');
          sections.forEach(el => {
            if (stats.sectionsVisited.length < 20) {
              stats.sectionsVisited.push(el.tagName.toLowerCase());
            }
          });
          
          // Scroll down incrementally
          let scrolled = 0;
          let lastScrollY = window.scrollY;
          let stuckCount = 0;
          
          while (scrolled < maxScroll - viewportHeight) {
            const oldY = window.scrollY;
            window.scrollBy({ top: scrollStep, behavior: 'instant' });
            scrolled += scrollStep;
            stats.totalScrollDistance = scrolled;
            
            // Check if stuck (infinite scroll detection)
            if (window.scrollY === lastScrollY) {
              stuckCount++;
              if (stuckCount > 5) break;
            } else {
              stuckCount = 0;
            }
            lastScrollY = window.scrollY;
            
            await new Promise(r => setTimeout(r, scrollDelay + Math.random() * 30));
          }
          
          stats.reachedBottom = window.scrollY + viewportHeight >= pageHeight - 100;
          stats.duration = Date.now() - startTime;
          
          // Scroll back to top smoothly
          window.scrollTo({ top: 0, behavior: 'smooth' });
          await new Promise(r => setTimeout(r, 500));
          
          return stats;
        })()
      `;
      const result = await cdp.executeScript(script, { returnByValue: true, awaitPromise: true, timeout: 60000 });
      return result;
    }

    // Build the driver object with CDP-first approach
    const driver: ChromeDriverInstance = {
      extensionId,
      process: chromeProcess,
      tabId: null,
      remoteDebuggingPort,
      cdpClient,

      async navigate(url, options) {
        const timeout = options?.timeout ?? 30_000;

        // Prefer CDP for reliable navigation
        if (cdpClient?.isConnected()) {
          try {
            const result = await cdpClient.navigateTo(url, { timeout });
            logger.debug('Navigation via CDP successful', { url, loadTime: result.loadTime });
            return {
              success: true,
              url: result.url,
              loadTime: result.loadTime,
            };
          } catch (err) {
            logger.warn('CDP navigation failed, falling back to extension', { error: err instanceof Error ? err.message : String(err) });
          }
        }

        // Fallback to extension
        if (extensionId !== 'cdp-only') {
          const params: Record<string, unknown> = { url };
          if (options?.waitFor !== undefined) {
            params['waitUntil'] = options.waitFor;
          }
          if (driver.tabId !== null) {
            params['tabId'] = driver.tabId;
          }
          const result = await bridge.sendCommand(extensionId, 'navigate', params) as Record<string, unknown>;
          const tabId = typeof result['tabId'] === 'number' ? result['tabId'] : undefined;
          if (tabId !== undefined) {
            driver.tabId = tabId;
          }
          return {
            success: true,
            url: (result['url'] as string) ?? url,
            loadTime: (result['loadTime'] as number) ?? 0,
            ...(result['title'] !== undefined ? { title: result['title'] as string } : {}),
            ...(tabId !== undefined ? { tabId } : {}),
          };
        }

        throw new Error('No navigation method available (CDP and extension both failed)');
      },

      async screenshot(options) {
        // Prefer CDP for reliable screenshots
        if (cdpClient?.isConnected()) {
          try {
            const screenshot = await cdpClient.captureScreenshot({
              format: options?.type ?? 'png',
              ...(options?.quality !== undefined ? { quality: options.quality } : {}),
              fullPage: options?.fullPage ?? false,
            });
            logger.debug('Screenshot via CDP successful');
            return screenshot;
          } catch (err) {
            logger.warn('CDP screenshot failed, falling back to extension', { error: err instanceof Error ? err.message : String(err) });
          }
        }

        // Fallback to extension
        if (extensionId !== 'cdp-only') {
          const params: Record<string, unknown> = {};
          if (driver.tabId !== null) {
            params['tabId'] = driver.tabId;
          }
          if (options?.fullPage !== undefined) params['fullPage'] = options.fullPage;
          if (options?.selector !== undefined) params['selector'] = options.selector;
          if (options?.type !== undefined) params['format'] = options.type;
          if (options?.quality !== undefined) params['quality'] = options.quality;

          const result = await bridge.sendCommand(extensionId, 'screenshot', params) as Record<string, unknown>;
          return (result['data'] as string) ?? '';
        }

        throw new Error('No screenshot method available (CDP and extension both failed)');
      },

      async executeScript(code, _timeout) {
        // Prefer CDP for script execution
        if (cdpClient?.isConnected()) {
          try {
            const result = await cdpClient.executeScript(code, { returnByValue: true });
            logger.debug('Script execution via CDP successful');
            return result;
          } catch (err) {
            logger.warn('CDP script execution failed, falling back to extension', { error: err instanceof Error ? err.message : String(err) });
          }
        }

        // Fallback to extension
        if (extensionId !== 'cdp-only') {
          const params: Record<string, unknown> = { code };
          if (driver.tabId !== null) {
            params['tabId'] = driver.tabId;
          }
          const result = await bridge.sendCommand(extensionId, 'executeScript', params) as Record<string, unknown>;
          return result['result'] ?? null;
        }

        throw new Error('No script execution method available (CDP and extension both failed)');
      },

      async setViewport(width, height, deviceScaleFactor, mobile) {
        // CDP is the primary method for viewport changes
        if (cdpClient?.isConnected()) {
          try {
            await cdpClient.setViewport({
              width,
              height,
              deviceScaleFactor: deviceScaleFactor ?? 1,
              mobile: mobile ?? false,
            });
            logger.debug('Viewport set via CDP', { width, height });
            return;
          } catch (err) {
            logger.warn('CDP setViewport failed', { error: err instanceof Error ? err.message : String(err) });
          }
        }

        // Extension doesn't support setViewport natively
        throw new Error('setViewport requires CDP connection');
      },

      async getMetrics() {
        // Prefer CDP for metrics
        if (cdpClient?.isConnected()) {
          try {
            const metrics = await cdpClient.getPerformanceMetrics();
            return { metrics };
          } catch (err) {
            logger.warn('CDP getMetrics failed, falling back to extension', { error: err instanceof Error ? err.message : String(err) });
          }
        }

        // Fallback to extension
        if (extensionId !== 'cdp-only') {
          const params: Record<string, unknown> = {};
          if (driver.tabId !== null) {
            params['tabId'] = driver.tabId;
          }
          return bridge.sendCommand(extensionId, 'getMetrics', params);
        }

        throw new Error('No metrics method available');
      },

      async getWebVitals() {
        // Try extension first (has richer data with ongoing observation)
        if (extensionId !== 'cdp-only') {
          const params: Record<string, unknown> = {};
          if (driver.tabId !== null) {
            params['tabId'] = driver.tabId;
          }
          try {
            const result = await bridge.sendCommand(extensionId, 'getWebVitals', params);
            logger.debug('getWebVitals via extension successful');
            return result;
          } catch (err) {
            logger.warn('Extension getWebVitals failed, falling back to CDP', { error: err instanceof Error ? err.message : String(err) });
          }
        }

        // CDP fallback
        if (cdpClient?.isConnected()) {
          try {
            return await getWebVitalsCDP(cdpClient);
          } catch (err) {
            logger.warn('CDP web vitals fallback failed', { error: err instanceof Error ? err.message : String(err) });
          }
        }

        return { lcp: null, fid: null, cls: null, fcp: null, ttfb: null, note: 'Web vitals unavailable - no extension or CDP connection' };
      },

      async runDesignAudit() {
        // Try extension first (has richer DOM access and color parsing)
        if (extensionId !== 'cdp-only') {
          const params: Record<string, unknown> = {};
          if (driver.tabId !== null) {
            params['tabId'] = driver.tabId;
          }
          try {
            const result = await bridge.sendCommand(extensionId, 'runDesignAudit', params);
            logger.debug('runDesignAudit via extension successful');
            return result;
          } catch (err) {
            logger.warn('Extension runDesignAudit failed, falling back to CDP', { error: err instanceof Error ? err.message : String(err) });
          }
        }

        // CDP fallback
        if (cdpClient?.isConnected()) {
          try {
            return await runDesignAuditCDP(cdpClient);
          } catch (err) {
            logger.warn('CDP design audit fallback failed', { error: err instanceof Error ? err.message : String(err) });
          }
        }

        return { score: 0, note: 'Design audit unavailable - no extension or CDP connection' };
      },

      async simulateUserScroll(speed: 'slow' | 'medium' | 'fast' = 'medium', pauseOnSections = true) {
        // Try extension first (has visual cursor animation)
        if (extensionId !== 'cdp-only') {
          const params: Record<string, unknown> = { speed, pauseOnSections };
          if (driver.tabId !== null) {
            params['tabId'] = driver.tabId;
          }
          try {
            const result = await bridge.sendCommand(extensionId, 'simulateUserScroll', params);
            logger.debug('simulateUserScroll via extension successful');
            return result;
          } catch (err) {
            logger.warn('Extension simulateUserScroll failed, falling back to CDP', { error: err instanceof Error ? err.message : String(err) });
          }
        }

        // CDP fallback
        if (cdpClient?.isConnected()) {
          try {
            return await simulateUserScrollCDP(cdpClient, speed);
          } catch (err) {
            logger.warn('CDP user scroll fallback failed', { error: err instanceof Error ? err.message : String(err) });
          }
        }

        return { totalScrollDistance: 0, duration: 0, note: 'User scroll unavailable - no extension or CDP connection' };
      },

      async startProfiling() {
        // Try extension first
        if (extensionId !== 'cdp-only') {
          const params: Record<string, unknown> = {};
          if (driver.tabId !== null) {
            params['tabId'] = driver.tabId;
          }
          try {
            const result = await bridge.sendCommand(extensionId, 'startProfiling', params) as Record<string, unknown>;
            const profilingId = (result['profilingId'] as string | undefined) ?? '';
            if (profilingId) {
              logger.debug('Profiling started via extension', { profilingId });
              return profilingId;
            }
          } catch (err) {
            logger.warn('Extension startProfiling failed, falling back to CDP', { error: err instanceof Error ? err.message : String(err) });
          }
        }

        // CDP fallback - use the cdpClient directly
        if (cdpClient?.isConnected()) {
          try {
            await cdpClient.startCPUProfile();
            // Also enable Performance domain for metrics
            await cdpClient.send('Performance.enable', {});
            const profilingId = `cdp-${Date.now()}`;
            logger.debug('Profiling started via CDP', { profilingId });
            return profilingId;
          } catch (err) {
            logger.warn('CDP startProfiling failed', { error: err instanceof Error ? err.message : String(err) });
          }
        }

        throw new Error('No profiling method available (CDP and extension both unavailable)');
      },

      async stopProfiling(profilingId: string): Promise<ProfilingResult> {
        // Try extension first if the profilingId looks like an extension ID
        if (extensionId !== 'cdp-only' && !profilingId.startsWith('cdp-')) {
          const params: Record<string, unknown> = { profilingId };
          if (driver.tabId !== null) {
            params['tabId'] = driver.tabId;
          }
          try {
            const result = await bridge.sendCommand(extensionId, 'stopProfiling', params) as Record<string, unknown>;
            logger.debug('Profiling stopped via extension', { profilingId });
            return {
              cpuProfile: result['cpuProfile'],
              metrics: (result['metrics'] as Array<{ name: string; value: number }>) ?? [],
              method: 'extension',
            };
          } catch (err) {
            logger.warn('Extension stopProfiling failed, falling back to CDP', { error: err instanceof Error ? err.message : String(err) });
          }
        }

        // CDP fallback
        if (cdpClient?.isConnected()) {
          try {
            const cpuProfile = await cdpClient.stopCPUProfile();
            const metrics = await cdpClient.getPerformanceMetrics();
            await cdpClient.send('Performance.disable', {});
            logger.debug('Profiling stopped via CDP', { profilingId });
            return {
              cpuProfile,
              metrics,
              method: 'cdp',
            };
          } catch (err) {
            logger.warn('CDP stopProfiling failed', { error: err instanceof Error ? err.message : String(err) });
          }
        }

        throw new Error('No profiling method available (CDP and extension both unavailable)');
      },

      async close() {
        // Close CDP connection first
        if (cdpClient) {
          try {
            cdpClient.close();
          } catch {
            // ignore
          }
        }

        // Close tabs via extension if available
        if (driver.tabId !== null && extensionId !== 'cdp-only') {
          try {
            await bridge.sendCommand(extensionId, 'closeTabs', { tabIds: [driver.tabId] });
          } catch {
            // Tab may already be closed
          }
        }

        // Kill Chrome process
        try {
          if (!chromeProcess.killed) {
            chromeProcess.kill();
          }
        } catch {
          // ignore kill errors
        }

        // Disconnect from bridge
        if (extensionId !== 'cdp-only') {
          await bridge.disconnect(extensionId);
        }
      },
    };

    return driver;
  }

  /**
   * Launch Firefox browser
   */
  private async launchFirefox(config: BrowserConfig, sessionId: string): Promise<string> {
    const firefoxDriver = FirefoxDriver.getInstance();
    const firefoxConfig: FirefoxConfig = {
      headless: config.headless,
      ...(config.viewport !== undefined ? { viewport: { width: config.viewport.width, height: config.viewport.height } } : {}),
      ...(config.userAgent !== undefined ? { userAgent: config.userAgent } : {}),
    };

    const firefoxSessionId = await firefoxDriver.launch(firefoxConfig);
    const firefoxSession = firefoxDriver.getSession(firefoxSessionId);

    const session: BrowserSession = {
      sessionId,
      browserType: config.type,
      config,
      instance: {
        extensionId: 'firefox-only',
        process: firefoxSession?.process ?? spawn('echo', ['firefox-placeholder']),
        tabId: null,
        remoteDebuggingPort: 0,
        cdpClient: null,
        navigate: async (url) => {
          await firefoxDriver.navigate(firefoxSessionId, url);
          return { success: true, url, loadTime: 0 };
        },
        screenshot: async (options) => {
          const result = await firefoxDriver.screenshot(firefoxSessionId);
          return result ?? '';
        },
        executeScript: async (code) => {
          return await firefoxDriver.executeScript(firefoxSessionId, code);
        },
        setViewport: async (width, height) => {
          throw new Error('Viewport control is not available in Firefox mode');
        },
        getMetrics: async () => {
          throw new Error('Metrics are not available in Firefox mode');
        },
        getWebVitals: async () => {
          throw new Error('Web vitals are not available in Firefox mode');
        },
        runDesignAudit: async () => {
          throw new Error('Design audit is not available in Firefox mode');
        },
        simulateUserScroll: async (speed) => {
          throw new Error('Scroll simulation is not available in Firefox mode');
        },
        startProfiling: async () => {
          throw new Error('Profiling not available in Firefox mode');
        },
        stopProfiling: async () => {
          throw new Error('Profiling not available in Firefox mode');
        },
        close: async () => {
          await firefoxDriver.close(firefoxSessionId);
        },
      },
      pages: new Map(),
      isActive: true,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      extensionId: 'firefox-only',
    };

    this.sessions.set(sessionId, session);
    logger.info('Firefox launched successfully', { sessionId });
    return sessionId;
  }

  /**
   * Launch Safari browser
   */
  private async launchSafari(config: BrowserConfig, sessionId: string): Promise<string> {
    const safariDriver = SafariDriver.getInstance();
    const safariConfig: SafariConfig = {
      headless: config.headless,
      ...(config.viewport !== undefined ? { viewport: { width: config.viewport.width, height: config.viewport.height } } : {}),
      ...(config.userAgent !== undefined ? { userAgent: config.userAgent } : {}),
      enableRemoteAutomation: true,
    };

    const safariSessionId = await safariDriver.launch(safariConfig);
    const safariSession = safariDriver.getSession(safariSessionId);

    const session: BrowserSession = {
      sessionId,
      browserType: config.type,
      config,
      instance: {
        extensionId: 'safari-only',
        process: safariSession?.process ?? spawn('echo', ['safari-placeholder']),
        tabId: null,
        remoteDebuggingPort: 0,
        cdpClient: null,
        navigate: async (url) => {
          await safariDriver.navigate(safariSessionId, url);
          return { success: true, url, loadTime: 0 };
        },
        screenshot: async (options) => {
          const result = await safariDriver.screenshot(safariSessionId);
          return result ?? '';
        },
        executeScript: async (code) => {
          return await safariDriver.executeScript(safariSessionId, code);
        },
        setViewport: async (width, height) => {
          throw new Error('Viewport control is not available in Safari mode');
        },
        getMetrics: async () => {
          throw new Error('Metrics are not available in Safari mode');
        },
        getWebVitals: async () => {
          throw new Error('Web vitals are not available in Safari mode');
        },
        runDesignAudit: async () => {
          throw new Error('Design audit is not available in Safari mode');
        },
        simulateUserScroll: async (speed) => {
          throw new Error('Scroll simulation is not available in Safari mode');
        },
        startProfiling: async () => {
          throw new Error('Profiling not available in Safari mode');
        },
        stopProfiling: async () => {
          throw new Error('Profiling not available in Safari mode');
        },
        close: async () => {
          await safariDriver.close(safariSessionId);
        },
      },
      pages: new Map(),
      isActive: true,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      extensionId: 'safari-only',
    };

    this.sessions.set(sessionId, session);
    logger.info('Safari launched successfully', { sessionId });
    return sessionId;
  }

  /**
   * Launch Edge browser
   */
  private async launchEdge(config: BrowserConfig, sessionId: string): Promise<string> {
    const edgeDriver = EdgeDriver.getInstance();
    const edgeConfig: EdgeConfig = {
      headless: config.headless,
      ...(config.viewport !== undefined ? {
        viewport: {
          width: config.viewport.width,
          height: config.viewport.height,
          ...(config.viewport.deviceScaleFactor !== undefined ? { deviceScaleFactor: config.viewport.deviceScaleFactor } : {}),
        }
      } : {}),
      ...(config.userAgent !== undefined ? { userAgent: config.userAgent } : {}),
      ...(config.locale !== undefined ? { locale: config.locale } : {}),
      ...(config.timezone !== undefined ? { timezone: config.timezone } : {}),
    };

    const edgeSessionId = await edgeDriver.launch(edgeConfig);
    const edgeSession = edgeDriver.getSession(edgeSessionId);

    if (!edgeSession) {
      throw new Error('Failed to get Edge session');
    }

    const session: BrowserSession = {
      sessionId,
      browserType: config.type,
      config,
      instance: {
        extensionId: 'edge-only',
        process: edgeSession.process,
        tabId: null,
        remoteDebuggingPort: edgeSession.remoteDebuggingPort,
        cdpClient: edgeSession.cdpClient,
        navigate: async (url) => {
          const result = await edgeDriver.navigate(edgeSessionId, url);
          return { success: true, ...result };
        },
        screenshot: async (options) => {
          const screenshotOpts: { format?: 'png' | 'jpeg'; quality?: number; fullPage?: boolean } = {};
          if (options?.type !== undefined) screenshotOpts.format = options.type;
          if (options?.quality !== undefined) screenshotOpts.quality = options.quality;
          if (options?.fullPage !== undefined) screenshotOpts.fullPage = options.fullPage;
          const result = await edgeDriver.screenshot(edgeSessionId, screenshotOpts);
          return result;
        },
        executeScript: async (code) => {
          return await edgeDriver.executeScript(edgeSessionId, code);
        },
        setViewport: async (width, height, deviceScaleFactor, mobile) => {
          const viewportOpts: { width: number; height: number; deviceScaleFactor?: number; mobile?: boolean } = { width, height };
          if (deviceScaleFactor !== undefined) viewportOpts.deviceScaleFactor = deviceScaleFactor;
          if (mobile !== undefined) viewportOpts.mobile = mobile;
          await edgeDriver.setViewport(edgeSessionId, viewportOpts);
        },
        getMetrics: async () => {
          return { metrics: await edgeDriver.getMetrics(edgeSessionId) };
        },
        getWebVitals: async () => {
          return await getWebVitalsViaCdp(edgeSession.cdpClient);
        },
        runDesignAudit: async () => {
          return await runDesignAuditViaCdp(edgeSession.cdpClient);
        },
        simulateUserScroll: async (speed) => {
          return await simulateUserScrollViaCdp(edgeSession.cdpClient, speed);
        },
        startProfiling: async () => {
          await edgeSession.cdpClient.startCPUProfile();
          await edgeSession.cdpClient.send('Performance.enable', {});
          return `edge-cdp-${Date.now()}`;
        },
        stopProfiling: async () => {
          const cpuProfile = await edgeSession.cdpClient.stopCPUProfile();
          const metrics = await edgeSession.cdpClient.getPerformanceMetrics();
          await edgeSession.cdpClient.send('Performance.disable', {});
          return {
            cpuProfile,
            metrics,
            method: 'cdp',
          };
        },
        close: async () => {
          await edgeDriver.close(edgeSessionId);
        },
      },
      pages: new Map(),
      isActive: true,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      extensionId: 'edge-only',
    };

    this.sessions.set(sessionId, session);
    logger.info('Edge launched successfully', { sessionId });
    return sessionId;
  }

  /**
   * Wait for any extension to connect via WebSocket.
   * If an extension is already connected, returns it immediately.
   * Otherwise waits for a new connection.
   */
  private async waitForExtensionConnection(
    bridge: ReturnType<typeof getExtensionBridge>,
    timeoutMs: number
  ): Promise<string> {
    const start = Date.now();
    const pollInterval = 250;

    // Check if an extension is already connected (use existing Chrome instance)
    const alreadyConnected = bridge.getConnectedExtensions();
    if (alreadyConnected.length > 0) {
      const extId = alreadyConnected[0];
      if (extId !== undefined) {
        logger.info('Using already-connected extension', { extensionId: extId });
        return extId;
      }
    }

    // Capture any extensions already connected before we started
    const preExisting = new Set(alreadyConnected);

    while (Date.now() - start < timeoutMs) {
      const connected = bridge.getConnectedExtensions();
      // Look for a newly connected extension
      for (const extId of connected) {
        if (!preExisting.has(extId)) {
          return extId;
        }
      }
      // Also accept first connection if none existed before
      if (preExisting.size === 0 && connected.length > 0) {
        const first = connected[0];
        if (first !== undefined) return first;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, pollInterval));
    }

    throw new Error(`Timed out waiting for Chrome extension to connect (${timeoutMs}ms)`);
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let browserManagerInstance: BrowserManager | null = null;

/**
 * Get singleton browser manager instance
 */
export function getBrowserManager(): BrowserManager {
  if (!browserManagerInstance) {
    browserManagerInstance = new BrowserManager();
  }
  return browserManagerInstance;
}
