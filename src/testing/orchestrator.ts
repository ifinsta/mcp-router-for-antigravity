/**
 * Orchestrator — Automated Test Pipeline
 *
 * Accepts a URL and test profile, launches Chrome ONCE with the extension,
 * runs test steps for all viewports by resizing the window (not relaunching Chrome),
 * collects results into a structured report, and generates actionable recommendations.
 *
 * Key improvement: Single Chrome instance for all viewports to avoid
 * extension disconnection issues between viewport switches.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { resolve as pathResolve } from 'node:path';
import { getLogger } from '../infra/logger.js';
import { getBrowserManager } from '../browser/browserManager.js';
import { BrowserType } from '../browser/browserManager.js';
import type { BrowserConfig } from '../browser/browserManager.js';
import { getExtensionBridge } from '../browser/extensionBridge.js';
import { createConnection } from 'node:net';

const logger = getLogger('orchestrator');

// ============================================================================
// Types
// ============================================================================

/** Test profile determines which steps run and at which viewports. */
export type TestProfile = 'quick' | 'standard' | 'comprehensive';

/** Viewport preset */
export interface ViewportPreset {
  label: string;
  width: number;
  height: number;
}

/** Single step result */
export interface StepResult {
  name: string;
  status: 'passed' | 'failed' | 'skipped';
  duration: number;
  error?: string | undefined;
  data?: Record<string, unknown> | undefined;
}

/** Final orchestration report */
export interface OrchestratorReport {
  url: string;
  profile: string;
  startTime: string;
  endTime: string;
  totalDuration: number;
  steps: StepResult[];
  summary: { total: number; passed: number; failed: number; skipped: number };
  webVitals?: Record<string, unknown> | undefined;
  designAudit?: Record<string, unknown> | undefined;
  screenshots: string[];
  recommendations: string[];
  overallVerdict: 'pass' | 'fail' | 'warning';
}

/** Options accepted by runOrchestration */
export interface OrchestrationOptions {
  url: string;
  profile: TestProfile;
  viewports?: ViewportPreset[] | undefined;
  timeout?: number | undefined;
}

// ============================================================================
// Constants
// ============================================================================

const VIEWPORT_DESKTOP: ViewportPreset = { label: 'Desktop', width: 1440, height: 900 };
const VIEWPORT_TABLET: ViewportPreset = { label: 'Tablet', width: 768, height: 1024 };
const VIEWPORT_MOBILE: ViewportPreset = { label: 'Mobile', width: 375, height: 812 };

const PROFILE_VIEWPORTS: Record<TestProfile, ViewportPreset[]> = {
  quick: [VIEWPORT_DESKTOP],
  standard: [VIEWPORT_DESKTOP, VIEWPORT_MOBILE],
  comprehensive: [VIEWPORT_DESKTOP, VIEWPORT_TABLET, VIEWPORT_MOBILE],
};

const PROFILE_STEPS: Record<TestProfile, string[]> = {
  quick: ['launch', 'navigate', 'webVitals', 'screenshot'],
  standard: ['launch', 'navigate', 'userScroll', 'webVitals', 'screenshot', 'designAudit', 'performanceProfile'],
  comprehensive: [
    'launch',
    'navigate',
    'userScroll',
    'webVitals',
    'screenshot',
    'designAudit',
    'performanceProfile',
    'networkAnalysis',
    'accessibility',
  ],
};

// ============================================================================
// Helpers
// ============================================================================

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if a port is already in use (i.e., a server is listening).
 */
function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection(port, '127.0.0.1');
    socket.once('connect', () => {
      socket.end();
      resolve(true);
    });
    socket.once('error', () => {
      resolve(false);
    });
  });
}

async function runStep(
  name: string,
  fn: () => Promise<Record<string, unknown> | undefined>
): Promise<StepResult> {
  const start = Date.now();
  try {
    const data = await fn();
    return {
      name,
      status: 'passed',
      duration: Date.now() - start,
      ...(data !== undefined ? { data } : {}),
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(`Step '${name}' failed`, error instanceof Error ? error : new Error(msg));
    return {
      name,
      status: 'failed',
      duration: Date.now() - start,
      error: msg,
    };
  }
}

// ============================================================================
// Recommendation Engine
// ============================================================================

function generateRecommendations(
  webVitals: Record<string, unknown> | undefined,
  designAudit: Record<string, unknown> | undefined,
  accessibilityData: Record<string, unknown> | undefined
): string[] {
  const recs: string[] = [];

  if (webVitals !== undefined) {
    const lcp = typeof webVitals['lcp'] === 'number' ? webVitals['lcp'] : null;
    const cls = typeof webVitals['cls'] === 'number' ? webVitals['cls'] : null;
    const fid = typeof webVitals['fid'] === 'number' ? webVitals['fid'] : null;
    const fcp = typeof webVitals['fcp'] === 'number' ? webVitals['fcp'] : null;
    const ttfb = typeof webVitals['ttfb'] === 'number' ? webVitals['ttfb'] : null;

    if (lcp !== null && lcp > 2500) {
      recs.push(`LCP is ${lcp}ms (threshold 2500ms) — optimize largest contentful paint: compress images, preload critical resources, reduce server response time`);
    }
    if (cls !== null && cls > 0.1) {
      recs.push(`CLS is ${cls.toFixed(3)} (threshold 0.1) — reduce layout shifts: set explicit dimensions on images/ads, avoid dynamic content injection above the fold`);
    }
    if (fid !== null && fid > 100) {
      recs.push(`FID is ${fid}ms (threshold 100ms) — reduce JS execution time: code-split, defer non-critical scripts, move heavy work to web workers`);
    }
    if (fcp !== null && fcp > 1800) {
      recs.push(`FCP is ${fcp}ms (threshold 1800ms) — optimize first contentful paint: inline critical CSS, reduce render-blocking resources`);
    }
    if (ttfb !== null && ttfb > 800) {
      recs.push(`TTFB is ${ttfb}ms (threshold 800ms) — reduce server response time: use CDN, optimize server-side rendering, enable HTTP/2`);
    }
  }

  if (designAudit !== undefined) {
    const colorContrast = designAudit['colorContrast'] as Record<string, unknown> | undefined;
    if (colorContrast !== undefined) {
      const violations = colorContrast['violations'];
      if (Array.isArray(violations) && violations.length > 0) {
        recs.push(`${violations.length} color contrast violation(s) detected — fix for WCAG AA compliance (minimum 4.5:1 ratio for normal text)`);
      }
    }

    const images = designAudit['images'] as Record<string, unknown> | undefined;
    if (images !== undefined) {
      const missingAlt = images['missingAlt'];
      if (Array.isArray(missingAlt) && missingAlt.length > 0) {
        recs.push(`${missingAlt.length} image(s) missing alt text — add descriptive alt attributes for accessibility`);
      }
      const oversized = images['oversized'];
      if (Array.isArray(oversized) && oversized.length > 0) {
        recs.push(`${oversized.length} oversized image(s) — compress and serve in modern formats (WebP/AVIF)`);
      }
    }

    const touchTargets = designAudit['touchTargets'] as Record<string, unknown> | undefined;
    if (touchTargets !== undefined) {
      const failing = typeof touchTargets['failing'] === 'number' ? touchTargets['failing'] : 0;
      if (failing > 0) {
        recs.push(`${failing} undersized touch target(s) — increase to minimum 48x48px for mobile usability`);
      }
    }

    const forms = designAudit['forms'] as Record<string, unknown> | undefined;
    if (forms !== undefined) {
      const withoutLabels = typeof forms['withoutLabels'] === 'number' ? forms['withoutLabels'] : 0;
      if (withoutLabels > 0) {
        recs.push(`${withoutLabels} form field(s) without labels — add associated <label> elements for accessibility`);
      }
    }
  }

  if (accessibilityData !== undefined) {
    const violations = accessibilityData['violations'];
    if (Array.isArray(violations) && violations.length > 0) {
      recs.push(`${violations.length} accessibility violation(s) found — review and fix for WCAG 2.1 compliance`);
    }
  }

  if (recs.length === 0) {
    recs.push('No critical issues detected. Continue monitoring for regressions.');
  }

  return recs;
}

// ============================================================================
// Verdict
// ============================================================================

function computeVerdict(
  steps: StepResult[],
  webVitals: Record<string, unknown> | undefined,
  designAudit: Record<string, unknown> | undefined
): 'pass' | 'fail' | 'warning' {
  const failedSteps = steps.filter((s) => s.status === 'failed').length;
  if (failedSteps >= 3) return 'fail';

  let issues = 0;
  let critical = 0;

  if (webVitals !== undefined) {
    const lcp = typeof webVitals['lcp'] === 'number' ? webVitals['lcp'] : 0;
    const cls = typeof webVitals['cls'] === 'number' ? webVitals['cls'] : 0;
    const fid = typeof webVitals['fid'] === 'number' ? webVitals['fid'] : 0;

    if (lcp > 4000) critical++;
    else if (lcp > 2500) issues++;

    if (cls > 0.25) critical++;
    else if (cls > 0.1) issues++;

    if (fid > 300) critical++;
    else if (fid > 100) issues++;
  }

  if (designAudit !== undefined) {
    const colorContrast = designAudit['colorContrast'] as Record<string, unknown> | undefined;
    if (colorContrast !== undefined) {
      const violations = colorContrast['violations'];
      if (Array.isArray(violations) && violations.length > 5) critical++;
      else if (Array.isArray(violations) && violations.length > 0) issues++;
    }
  }

  if (critical > 0 || failedSteps > 0) return 'fail';
  if (issues > 0) return 'warning';
  return 'pass';
}

// ============================================================================
// Main Orchestration
// ============================================================================

/**
 * Run automated orchestration pipeline.
 * 
 * Key improvement: Launches Chrome ONCE at the start, then resizes for each viewport.
 * This eliminates extension disconnection issues between viewport tests.
 * 
 * Old flow (broken):
 *   Desktop: launch -> test -> close
 *   Tablet:  launch -> test -> close  
 *   Mobile:  launch -> test -> close
 * 
 * New flow (reliable):
 *   launch ONCE
 *     Desktop: setViewport -> navigate -> test
 *     Tablet:  setViewport -> navigate -> test
 *     Mobile:  setViewport -> navigate -> test
 *   close ONCE
 */
export async function runOrchestration(options: OrchestrationOptions): Promise<OrchestratorReport> {
  const { url, profile } = options;
  const viewports = options.viewports ?? PROFILE_VIEWPORTS[profile];
  const stepNames = PROFILE_STEPS[profile];
  const startTime = new Date().toISOString();
  const startMs = Date.now();

  logger.info('Starting orchestration', { url, profile, viewports: viewports.length });

  const allSteps: StepResult[] = [];
  const screenshotPaths: string[] = [];
  let mergedWebVitals: Record<string, unknown> | undefined;
  let mergedDesignAudit: Record<string, unknown> | undefined;
  let mergedAccessibility: Record<string, unknown> | undefined;

  const browserManager = getBrowserManager();
  const bridge = getExtensionBridge();

  // Ensure screenshots directory exists
  const screenshotsDir = pathResolve(process.cwd(), 'screenshots');
  await mkdir(screenshotsDir, { recursive: true });

  // Check if an external WebSocket bridge is already running
  const wsPort = 9315;
  const externalBridgeRunning = await isPortInUse(wsPort);
  
  if (externalBridgeRunning) {
    logger.warn('External WebSocket bridge detected on port', { port: wsPort });
    logger.warn('The orchestrator cannot communicate with extensions connected to an external bridge.');
    logger.warn('Please ensure the external bridge is stopped before running the orchestrator,');
    logger.warn('or use the external bridge directly for testing.');
    
    // Return early with a failure report
    const endTime = new Date().toISOString();
    const totalDuration = Date.now() - startMs;
    
    return {
      url,
      profile,
      startTime,
      endTime,
      totalDuration,
      steps: [{ name: 'launch', status: 'failed', duration: 0, error: 'External WebSocket bridge detected on port 9315. Cannot communicate with extensions connected to external bridge.' }],
      summary: { total: 1, passed: 0, failed: 1, skipped: 0 },
      screenshots: [],
      recommendations: ['Stop the external WebSocket bridge (node bin/start-ws-bridge.js) before running the orchestrator.'],
      overallVerdict: 'fail',
    };
  }

  // ==========================================================================
  // SINGLE LAUNCH: Chrome is launched ONCE for all viewports
  // ==========================================================================
  
  let sessionId: string | null = null;
  let currentTabId: number | undefined = undefined;
  let launchFailed = false;

  // --- launch step (only once, before viewport loop) ---
  if (stepNames.includes('launch')) {
    const step = await runStep('launch', async () => {
      if (!bridge.isRunning()) {
        await bridge.startServer();
      }

      // Use the first viewport's dimensions for initial window size
      const initialViewport = viewports[0];
      if (initialViewport === undefined) {
        throw new Error('No viewports configured');
      }

      const config: BrowserConfig = {
        type: BrowserType.CHROME,
        headless: false,
        viewport: { width: initialViewport.width, height: initialViewport.height },
      };

      sessionId = await browserManager.launchBrowser(config);
      const session = browserManager.getSession(sessionId);
      return {
        sessionId,
        extensionId: session?.extensionId ?? 'unknown',
        viewportCount: viewports.length,
      };
    });
    allSteps.push(step);

    if (step.status === 'failed') {
      launchFailed = true;
      // Skip all remaining steps
      for (const name of stepNames) {
        if (name !== 'launch') {
          allSteps.push({ name, status: 'skipped', duration: 0 });
        }
      }
    }
  }

  // ==========================================================================
  // VIEWPORT LOOP: Resize window for each viewport, don't relaunch Chrome
  // ==========================================================================

  if (!launchFailed && sessionId !== null) {
    for (let viewportIndex = 0; viewportIndex < viewports.length; viewportIndex++) {
      const viewport = viewports[viewportIndex];
      if (viewport === undefined) continue;

      logger.info('Running steps for viewport', { 
        label: viewport.label, 
        width: viewport.width, 
        height: viewport.height,
        viewportIndex: viewportIndex + 1,
        totalViewports: viewports.length
      });

      // --- setViewport: Resize window for this viewport (skip for first viewport - already set) ---
      if (viewportIndex > 0) {
        const setViewportStep = await runStep(`setViewport-${viewport.label}`, async () => {
          await browserManager.setViewport(sessionId!, viewport.width, viewport.height, 1, false);
          // Wait for viewport change to take effect
          await delay(500);
          return { width: viewport.width, height: viewport.height };
        });
        allSteps.push(setViewportStep);

        if (setViewportStep.status === 'failed') {
          logger.warn('setViewport failed, continuing anyway', { viewport: viewport.label });
        }
      }

      // --- navigate ---
      if (stepNames.includes('navigate')) {
        const step = await runStep(`navigate-${viewport.label}`, async () => {
          const result = await browserManager.navigate(sessionId!, url);
          // Track the tabId for subsequent steps
          if (result.tabId !== undefined) {
            currentTabId = result.tabId;
            logger.info('Tab ID captured from navigation', { tabId: currentTabId });
          }
          // Allow page to settle and responsive layout to adjust
          await delay(2000);
          return result as unknown as Record<string, unknown>;
        });
        allSteps.push(step);
      }

      // --- userScroll ---
      if (stepNames.includes('userScroll')) {
        const vp = viewport;
        const step = await runStep(`userScroll-${viewport.label}`, async () => {
          // Use 'medium' speed for standard, 'slow' for comprehensive
          const scrollSpeed = profile === 'comprehensive' ? 'slow' : 'medium';
          const scrollResult = await browserManager.simulateUserScroll(sessionId!, scrollSpeed, true);
          // Take a screenshot at the bottom of the page after scrolling
          try {
            const base64 = await browserManager.takeScreenshot(sessionId!);
            const filename = `orchestration_${vp.label}_bottom_${Date.now()}.png`;
            const filepath = pathResolve(screenshotsDir, filename);
            await writeFile(filepath, Buffer.from(base64, 'base64'));
            screenshotPaths.push(filepath);
          } catch (err) {
            logger.warn('Failed to take bottom-of-page screenshot', { error: err instanceof Error ? err.message : String(err) });
          }
          return (scrollResult as Record<string, unknown>) ?? { note: 'User scroll simulation unavailable' };
        });
        allSteps.push(step);
      }

      // --- webVitals ---
      if (stepNames.includes('webVitals')) {
        const step = await runStep(`webVitals-${viewport.label}`, async () => {
          const vitals = await browserManager.getWebVitals(sessionId!);
          if (vitals !== null && typeof vitals === 'object') {
            mergedWebVitals = vitals as Record<string, unknown>;
          }
          return (vitals as Record<string, unknown>) ?? { note: 'Web vitals unavailable' };
        });
        allSteps.push(step);
      }

      // --- screenshot ---
      if (stepNames.includes('screenshot')) {
        const vp = viewport;
        const step = await runStep(`screenshot-${viewport.label}`, async () => {
          const base64 = await browserManager.takeScreenshot(sessionId!);
          const filename = `orchestration_${vp.label}_${Date.now()}.png`;
          const filepath = pathResolve(screenshotsDir, filename);
          await writeFile(filepath, Buffer.from(base64, 'base64'));
          screenshotPaths.push(filepath);
          return { filepath, filename, viewport: vp.label };
        });
        allSteps.push(step);
      }

      // --- designAudit ---
      if (stepNames.includes('designAudit')) {
        const step = await runStep(`designAudit-${viewport.label}`, async () => {
          const audit = await browserManager.runDesignAudit(sessionId!);
          if (audit !== null && typeof audit === 'object') {
            mergedDesignAudit = audit as Record<string, unknown>;
          }
          return (audit as Record<string, unknown>) ?? { note: 'Design audit unavailable' };
        });
        allSteps.push(step);
      }

      // --- performanceProfile ---
      if (stepNames.includes('performanceProfile')) {
        const step = await runStep(`performanceProfile-${viewport.label}`, async () => {
          const profilingId = await browserManager.startProfiling(sessionId!);
          await delay(3000);
          const profileData = await browserManager.stopProfiling(sessionId!, profilingId);
          return {
            profilingId,
            method: profileData.method,
            metricsCount: profileData.metrics.length,
            hasCPUProfile: profileData.cpuProfile !== null,
          };
        });
        allSteps.push(step);
      }

      // --- networkAnalysis ---
      if (stepNames.includes('networkAnalysis')) {
        const step = await runStep(`networkAnalysis-${viewport.label}`, async () => {
          const metrics = await browserManager.getMetrics(sessionId!);
          return (metrics as Record<string, unknown>) ?? {};
        });
        allSteps.push(step);
      }

      // --- accessibility ---
      if (stepNames.includes('accessibility')) {
        const tabId = currentTabId;
        const step = await runStep(`accessibility-${viewport.label}`, async () => {
          const extIds = bridge.getConnectedExtensions();
          const extId = extIds[0];
          if (extId === undefined) {
            return { note: 'No extension connected for accessibility audit' };
          }
          const params: Record<string, unknown> = {};
          if (tabId !== undefined) {
            params['tabId'] = tabId;
          }
          const result = await bridge.sendCommand(extId, 'runAccessibilityAudit', params);
          const data = (result as Record<string, unknown>) ?? {};
          mergedAccessibility = data;
          return data;
        });
        allSteps.push(step);
      }
    }

    // ==========================================================================
    // SINGLE CLOSE: Chrome is closed ONCE after all viewports are done
    // ==========================================================================
    
    if (sessionId !== null) {
      try {
        await browserManager.closeSession(sessionId);
        logger.info('Chrome session closed (single instance)', { sessionId });
      } catch (err) {
        logger.warn('Failed to close session during orchestration cleanup', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // Build report
  const endTime = new Date().toISOString();
  const totalDuration = Date.now() - startMs;

  const passed = allSteps.filter((s) => s.status === 'passed').length;
  const failed = allSteps.filter((s) => s.status === 'failed').length;
  const skipped = allSteps.filter((s) => s.status === 'skipped').length;

  const recommendations = generateRecommendations(mergedWebVitals, mergedDesignAudit, mergedAccessibility);
  const overallVerdict = computeVerdict(allSteps, mergedWebVitals, mergedDesignAudit);

  const report: OrchestratorReport = {
    url,
    profile,
    startTime,
    endTime,
    totalDuration,
    steps: allSteps,
    summary: { total: allSteps.length, passed, failed, skipped },
    ...(mergedWebVitals !== undefined ? { webVitals: mergedWebVitals } : {}),
    ...(mergedDesignAudit !== undefined ? { designAudit: mergedDesignAudit } : {}),
    screenshots: screenshotPaths,
    recommendations,
    overallVerdict,
  };

  logger.info('Orchestration complete', {
    url,
    profile,
    totalDuration,
    verdict: overallVerdict,
    passed,
    failed,
    skipped,
  });

  return report;
}
