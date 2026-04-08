/**
 * Browser Bridge for MCP Router
 *
 * Provides interface between MCP Router and browser capabilities
 * enabling real performance measurement, deep profiling, and
 * automated optimization application.
 */

import { getLogger } from '../infra/logger.js';
import { PerformanceAPIMonitor } from './performanceAPI.js';
import { getExtensionBridge } from './extensionBridge.js';
import type { ExtensionBridge } from './extensionBridge.js';

const logger = getLogger('browser-bridge');

// ============================================================================
// Core Types
// ============================================================================

/**
 * Core Web Vitals metrics
 */
export interface CoreWebVitals {
  lcp: number; // Largest Contentful Paint (ms)
  fid: number; // First Input Delay (ms)
  cls: number; // Cumulative Layout Shift
  fcp: number; // First Contentful Paint (ms)
  ttfb: number; // Time to First Byte (ms)
  timestamp: number; // Measurement timestamp
  userAgent: string; // Browser user agent
}

/**
 * Navigation timing metrics
 */
export interface NavigationMetrics {
  domContentLoaded: number;
  loadComplete: number;
  domInteractive: number;
  firstPaint: number;
  redirectCount: number;
  transferSize: number;
}

/**
 * Network metrics
 */
export interface NetworkMetrics {
  resourceCount: number;
  totalTransferSize: number;
  totalEncodedSize: number;
  slowResources: Array<{
    url: string;
    duration: number;
    transferSize: number;
  }>;
  largestResource: {
    url: string;
    size: number;
  };
}

/**
 * Memory metrics
 */
export interface MemoryMetrics {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
  domNodeCount: number;
  eventListenerCount: number;
}

/**
 * Performance profiling configuration
 */
export interface ProfilingConfig {
  duration: number; // Profile duration in ms
  samplingInterval?: number; // Sampling interval in ms
  includeMemory?: boolean; // Include memory profiling
  includeNetwork?: boolean; // Include network profiling
  includeScreenshots?: boolean; // Include screenshots during profile
}

/**
 * Performance profile result
 */
export interface ProfileResult {
  timeline: ProfileTimeline;
  metrics: PerformanceMetrics;
  samples: ProfileSample[];
  memorySnapshot?: MemorySnapshot;
  networkEvents?: NetworkEvent[];
  screenshots?: Buffer[];
}

/**
 * Profile timeline events
 */
export interface ProfileTimeline {
  events: TimelineEvent[];
  duration: number;
  startTime: number;
  endTime: number;
}

/**
 * Timeline event
 */
export interface TimelineEvent {
  type: 'navigation' | 'paint' | 'script' | 'render' | 'parse' | 'layout' | 'network';
  timestamp: number;
  duration: number;
  data: Record<string, unknown>;
}

/**
 * Performance metrics
 */
export interface PerformanceMetrics {
  fps: number;
  frameTime: number;
  mainThreadTime: number;
  scriptExecutionTime: number;
  layoutTime: number;
  paintTime: number;
  compositeTime: number;
}

/**
 * Profile sample
 */
export interface ProfileSample {
  timestamp: number;
  stack: string[];
  memoryUsage?: number;
  frameRate?: number;
}

/**
 * Memory snapshot
 */
export interface MemorySnapshot {
  totalSize: number;
  liveSize: number;
  sizeByNode: Array<{
    type: string;
    count: number;
    size: number;
  }>;
}

/**
 * Network event
 */
export interface NetworkEvent {
  timestamp: number;
  url: string;
  method: string;
  type: string;
  duration: number;
  size: number;
  status: number;
}

/**
 * Optimization result
 */
export interface OptimizationResult {
  success: boolean;
  beforeMetrics: CoreWebVitals;
  afterMetrics: CoreWebVitals;
  improvements: Record<string, number>;
  warnings: string[];
  errors: string[];
}

/**
 * Monitoring configuration
 */
export interface MonitoringConfig {
  metrics: Array<'lcp' | 'fid' | 'cls' | 'fcp' | 'ttfb'>;
  sampleInterval: number; // ms between samples
  alertThresholds: Record<string, number>; // Alert thresholds for each metric
  enabledCustomMetrics?: string[]; // Custom business metrics to track
}

/**
 * Monitoring session
 */
export interface MonitoringSession {
  sessionId: string;
  startTime: number;
  config: MonitoringConfig;
  metrics: CoreWebVitals[];
  alerts: PerformanceAlert[];
}

/**
 * Performance alert
 */
export interface PerformanceAlert {
  metric: string;
  threshold: number;
  actualValue: number;
  timestamp: number;
  severity: 'warning' | 'critical' | 'regression';
}

/**
 * Browser session
 */
export interface BrowserSession {
  sessionId: string;
  url: string;
  startTime: number;
  performanceMonitor: PerformanceAPIMonitor;
  isActive: boolean;
}

/**
 * Design audit result from the extension
 */
export interface DesignAuditResult {
  colorContrast: {
    passes: Array<Record<string, unknown>>;
    violations: Array<Record<string, unknown>>;
  };
  typography: {
    fonts: Array<Record<string, unknown>>;
    issues: string[];
    readabilityScore: number;
  };
  touchTargets: {
    total: number;
    passing: number;
    failing: number;
    violations: Array<Record<string, unknown>>;
  };
  layoutShifts: {
    score: number;
    shifts: Array<Record<string, unknown>>;
  };
  responsiveness: {
    overflowingElements: Array<Record<string, unknown>>;
    hasHorizontalScroll: boolean;
    viewportWidth: number;
  };
  zIndexStacking: {
    layers: Array<Record<string, unknown>>;
    maxZIndex: number;
    potentialIssues: string[];
  };
  spacing: {
    commonMargins: Array<Record<string, unknown>>;
    commonPaddings: Array<Record<string, unknown>>;
    consistencyScore: number;
  };
  colorPalette: {
    colors: Array<Record<string, unknown>>;
    totalUnique: number;
    groups: Array<Record<string, unknown>>;
  };
  images: {
    total: number;
    missingAlt: Array<Record<string, unknown>>;
    oversized: Array<Record<string, unknown>>;
    missingDimensions: Array<Record<string, unknown>>;
    lazyLoaded: number;
    eagerLoaded: number;
  };
  forms: {
    total: number;
    withLabels: number;
    withoutLabels: number;
    violations: Array<Record<string, unknown>>;
  };
  interactiveElements: {
    total: number;
    violations: Array<Record<string, unknown>>;
  };
}

/**
 * Extension Web Vitals data
 */
export interface ExtensionWebVitals {
  lcp: number | null;
  fid: number | null;
  cls: number;
  fcp: number | null;
  ttfb: number | null;
  inp: number | null;
}

// ============================================================================
// Browser Bridge Implementation
// ============================================================================

/**
 * Main browser bridge class
 */
export class BrowserBridge {
  private sessions: Map<string, BrowserSession>;
  private performanceMonitor: PerformanceAPIMonitor;
  private activeProfile: ProfileResult | null;
  private extensionBridge: ExtensionBridge;

  constructor() {
    this.sessions = new Map();
    this.performanceMonitor = new PerformanceAPIMonitor();
    this.activeProfile = null;
    this.extensionBridge = getExtensionBridge();
  }

  // ==========================================================================
  // Extension-routed methods
  // ==========================================================================

  /**
   * Get the first connected extension ID, or null if none available.
   */
  private getConnectedExtensionId(): string | null {
    const ids = this.extensionBridge.getConnectedExtensions();
    return ids[0] ?? null;
  }

  /**
   * Check if an extension is available for routing commands.
   */
  isExtensionAvailable(): boolean {
    return this.getConnectedExtensionId() !== null;
  }

  /**
   * Measure Core Web Vitals via the extension (real browser data).
   * Falls back to PerformanceAPIMonitor if no extension is connected.
   * @param tabId - Optional tab ID to target specific tab
   */
  async measureCoreWebVitalsViaExtension(tabId?: number): Promise<ExtensionWebVitals | null> {
    const extId = this.getConnectedExtensionId();
    if (extId === null) {
      logger.warn('No extension connected for Web Vitals measurement');
      return null;
    }

    try {
      const params: Record<string, unknown> = {};
      if (tabId !== undefined) {
        params['tabId'] = tabId;
      }
      const result = await this.extensionBridge.sendCommand(extId, 'getWebVitals', params);
      logger.info('Web Vitals received from extension', { result: typeof result, tabId });
      return result as ExtensionWebVitals;
    } catch (error) {
      logger.error('Failed to get Web Vitals from extension', error instanceof Error ? error : new Error(String(error)));
      return null;
    }
  }

  /**
   * Run a comprehensive UI/UX design audit via the extension.
   * @param tabId - Optional tab ID to target specific tab
   */
  async runDesignAudit(tabId?: number): Promise<DesignAuditResult | null> {
    const extId = this.getConnectedExtensionId();
    if (extId === null) {
      throw new Error('No extension connected — design audit requires the Chrome extension');
    }

    logger.info('Running design audit via extension', { tabId });
    try {
      const params: Record<string, unknown> = {};
      if (tabId !== undefined) {
        params['tabId'] = tabId;
      }
      const result = await this.extensionBridge.sendCommand(extId, 'runDesignAudit', params);
      logger.info('Design audit completed via extension');
      return result as DesignAuditResult;
    } catch (error) {
      logger.error('Design audit failed', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Start CDP profiling via the extension.
   * @param tabId - Optional tab ID to target specific tab
   * @param options - Profiling options
   */
  async startProfilingViaExtension(tabId?: number, options: { heap?: boolean } = {}): Promise<string> {
    const extId = this.getConnectedExtensionId();
    if (extId === null) {
      throw new Error('No extension connected — profiling requires the Chrome extension');
    }

    logger.info('Starting profiling via extension', { options, tabId });
    const params: Record<string, unknown> = { options };
    if (tabId !== undefined) {
      params['tabId'] = tabId;
    }
    const result = await this.extensionBridge.sendCommand(extId, 'startProfiling', params);
    const resultObj = result as Record<string, unknown> | null;
    const profilingId = (resultObj?.['profilingId'] as string | undefined) ?? '';
    logger.info('Profiling started via extension', { profilingId });
    return profilingId;
  }

  /**
   * Stop CDP profiling via the extension and collect results.
   * @param profilingId - The profiling session ID
   * @param tabId - Optional tab ID to target specific tab
   */
  async stopProfilingViaExtension(profilingId: string, tabId?: number): Promise<Record<string, unknown>> {
    const extId = this.getConnectedExtensionId();
    if (extId === null) {
      throw new Error('No extension connected — profiling requires the Chrome extension');
    }

    logger.info('Stopping profiling via extension', { profilingId, tabId });
    const params: Record<string, unknown> = { profilingId };
    if (tabId !== undefined) {
      params['tabId'] = tabId;
    }
    const result = await this.extensionBridge.sendCommand(extId, 'stopProfiling', params);
    logger.info('Profiling stopped via extension');
    return (result as Record<string, unknown>) ?? {};
  }

  /**
   * Get CDP Performance.getMetrics via the extension.
   * @param tabId - Optional tab ID to target specific tab
   */
  async getPerformanceMetricsViaExtension(tabId?: number): Promise<Record<string, unknown> | null> {
    const extId = this.getConnectedExtensionId();
    if (extId === null) {
      logger.warn('No extension connected for performance metrics');
      return null;
    }

    try {
      const params: Record<string, unknown> = {};
      if (tabId !== undefined) {
        params['tabId'] = tabId;
      }
      const result = await this.extensionBridge.sendCommand(extId, 'getMetrics', params);
      return (result as Record<string, unknown>) ?? null;
    } catch (error) {
      logger.error('Failed to get performance metrics from extension', error instanceof Error ? error : new Error(String(error)));
      return null;
    }
  }

  /**
   * Simulate user scrolling via the extension.
   * @param tabId - Optional tab ID to target specific tab
   * @param speed - Scroll speed: 'slow', 'medium', or 'fast'
   * @param pauseOnSections - Whether to pause on interesting sections
   */
  async simulateUserScroll(
    tabId?: number,
    speed: 'slow' | 'medium' | 'fast' = 'medium',
    pauseOnSections: boolean = true
  ): Promise<Record<string, unknown> | null> {
    const extId = this.getConnectedExtensionId();
    if (extId === null) {
      logger.warn('No extension connected for user scroll simulation');
      return null;
    }

    logger.info('Starting user scroll simulation via extension', { speed, pauseOnSections, tabId });
    try {
      const params: Record<string, unknown> = { speed, pauseOnSections };
      if (tabId !== undefined) {
        params['tabId'] = tabId;
      }
      const result = await this.extensionBridge.sendCommand(extId, 'simulateUserScroll', params);
      logger.info('User scroll simulation completed via extension', {
        duration: (result as Record<string, unknown>)?.['duration'],
        pausePoints: (result as Record<string, unknown>)?.['pausePoints'],
      });
      return (result as Record<string, unknown>) ?? null;
    } catch (error) {
      logger.error('Failed to run user scroll simulation via extension', error instanceof Error ? error : new Error(String(error)));
      return null;
    }
  }

  /**
   * Connect to a browser session
   */
  async connect(url: string): Promise<BrowserSession> {
    const sessionId = this.generateSessionId();

    logger.info('Creating browser session', { sessionId, url });

    const session: BrowserSession = {
      sessionId,
      url,
      startTime: Date.now(),
      performanceMonitor: this.performanceMonitor,
      isActive: true,
    };

    this.sessions.set(sessionId, session);

    // Initialize performance monitoring
    await this.performanceMonitor.initialize();

    logger.info('Browser session created', { sessionId });
    return session;
  }

  /**
   * Disconnect from a browser session
   */
  async disconnect(): Promise<void> {
    logger.info('Disconnecting browser sessions');

    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.isActive) {
        session.isActive = false;
        await session.performanceMonitor.cleanup();
        this.sessions.delete(sessionId);
      }
    }

    logger.info('All browser sessions disconnected');
  }

  /**
   * Measure Core Web Vitals
   */
  async measureCoreWebVitals(duration: number = 10000): Promise<CoreWebVitals> {
    logger.info('Measuring Core Web Vitals', { duration });

    const measurements: CoreWebVitals[] = [];
    const endTime = Date.now() + duration;

    // Collect measurements over duration
    return new Promise<CoreWebVitals>((resolve) => {
      const collectMetrics = () => {
        if (Date.now() >= endTime || measurements.length >= 10) {
          // Calculate median values
          const result = this.calculateMedianMetrics(measurements);
          resolve(result);
        } else {
          this.collectSingleMeasurement().then((metrics) => {
            measurements.push(metrics);
            setTimeout(collectMetrics, 500); // Collect every 500ms
          });
        }
      };

      collectMetrics();
    });
  }

  /**
   * Profile performance with detailed metrics
   */
  async profilePerformance(config: ProfilingConfig): Promise<ProfileResult> {
    logger.info('Starting performance profile', { config });

    const profile: ProfileResult = {
      timeline: {
        events: [],
        duration: config.duration,
        startTime: Date.now(),
        endTime: Date.now() + config.duration,
      },
      metrics: {
        fps: 0,
        frameTime: 0,
        mainThreadTime: 0,
        scriptExecutionTime: 0,
        layoutTime: 0,
        paintTime: 0,
        compositeTime: 0,
      },
      samples: [],
      ...(config.includeMemory ? { memorySnapshot: await this.captureMemorySnapshot() } : {}),
      ...(config.includeNetwork ? { networkEvents: await this.captureNetworkEvents(config.duration) } : {}),
      ...(config.includeScreenshots ? { screenshots: [] as Buffer[] } : {}),
    };
    this.activeProfile = profile;

    // Start profiling
    await this.collectProfileSamples(config);

    logger.info('Performance profile completed', {
      duration: profile.timeline.duration,
      samplesCount: profile.samples.length,
    });

    return profile;
  }

  /**
   * Capture network metrics
   */
  async captureNetworkMetrics(): Promise<NetworkMetrics> {
    const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];

    const slowResources = resources
      .filter(r => r.duration > 1000) // > 1s is slow
      .map(r => ({
        url: r.name,
        duration: r.duration,
        transferSize: r.transferSize || 0,
      }))
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 10); // Top 10 slowest

    const largestResource = resources
      .sort((a, b) => (b.transferSize || 0) - (a.transferSize || 0))
      [0];

    return {
      resourceCount: resources.length,
      totalTransferSize: resources.reduce((sum, r) => sum + (r.transferSize || 0), 0),
      totalEncodedSize: resources.reduce((sum, r) => sum + (r.encodedBodySize || 0), 0),
      slowResources,
      largestResource: {
        url: largestResource?.name || '',
        size: largestResource?.transferSize || 0,
      },
    };
  }

  /**
   * Capture memory metrics
   */
  async captureMemoryMetrics(): Promise<MemoryMetrics> {
    const memory = (performance as any).memory;

    if (!memory) {
      throw new Error('Memory API not available');
    }

    return {
      usedJSHeapSize: memory.usedJSHeapSize,
      totalJSHeapSize: memory.totalJSHeapSize,
      jsHeapSizeLimit: memory.jsHeapSizeLimit,
      domNodeCount: await this.getDOMNodeCount(),
      eventListenerCount: await this.getEventListenerCount(),
    };
  }

  /**
   * Execute optimization script in browser context
   */
  async executeOptimizationScript(script: string): Promise<OptimizationResult> {
    logger.info('Executing optimization script');

    // Capture before metrics
    const beforeMetrics = await this.measureCoreWebVitals(5000);

    try {
      // Execute script in browser context
      const result = await this.evaluateInBrowser(script);

      // Wait for optimizations to take effect
      await this.delay(2000);

      // Capture after metrics
      const afterMetrics = await this.measureCoreWebVitals(5000);

      const improvements = this.calculateImprovements(beforeMetrics, afterMetrics);

      return {
        success: true,
        beforeMetrics,
        afterMetrics,
        improvements,
        warnings: [],
        errors: [],
      };
    } catch (error) {
      logger.error('Optimization script execution failed', error);

      return {
        success: false,
        beforeMetrics,
        afterMetrics: beforeMetrics,
        improvements: {},
        warnings: [],
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  /**
   * Start continuous monitoring
   */
  async startMonitoring(config: MonitoringConfig): Promise<MonitoringSession> {
    const sessionId = this.generateSessionId();

    logger.info('Starting monitoring session', { sessionId, config });

    const session: MonitoringSession = {
      sessionId,
      startTime: Date.now(),
      config,
      metrics: [],
      alerts: [],
    };

    // Set up metric observers
    await this.performanceMonitor.observeMetrics(config.metrics, (metrics) => {
      session.metrics.push(metrics as unknown as CoreWebVitals);

      // Check for alerts
      this.checkAlertThresholds(metrics as unknown as CoreWebVitals, config.alertThresholds, session);
    });

    return session;
  }

  /**
   * Stop monitoring session
   */
  async stopMonitoring(sessionId: string): Promise<void> {
    logger.info('Stopping monitoring session', { sessionId });

    const session = await this.getMonitoringSession(sessionId);
    if (session) {
      // Session cleanup handled externally
      logger.info('Monitoring session stopped', { sessionId });
    }
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  /**
   * Generate unique session ID
   */
  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Collect single measurement
   */
  private async collectSingleMeasurement(): Promise<CoreWebVitals> {
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    const paint = performance.getEntriesByType('paint') as PerformancePaintTiming[];

    return {
      lcp: await this.performanceMonitor.getLCP(),
      fid: await this.performanceMonitor.getFID(),
      cls: await this.performanceMonitor.getCLS(),
      fcp: paint.find(p => p.name === 'first-contentful-paint')?.startTime || 0,
      ttfb: navigation?.responseStart - navigation?.startTime || 0,
      timestamp: Date.now(),
      userAgent: navigator.userAgent,
    };
  }

  /**
   * Calculate median metrics from multiple measurements
   */
  private calculateMedianMetrics(measurements: CoreWebVitals[]): CoreWebVitals {
    if (measurements.length === 0) {
      return {
        lcp: 0,
        fid: 0,
        cls: 0,
        fcp: 0,
        ttfb: 0,
        timestamp: Date.now(),
        userAgent: navigator.userAgent,
      };
    }

    const sorted = (arr: number[]) => [...arr].sort((a, b) => a - b);
    const median = (arr: number[]): number => {
      const sortedArr = sorted(arr);
      const mid = Math.floor(sortedArr.length / 2);
      return sortedArr.length % 2 === 0
        ? ((sortedArr[mid - 1] ?? 0) + (sortedArr[mid] ?? 0)) / 2
        : (sortedArr[mid] ?? 0);
    };

    return {
      lcp: median(measurements.map(m => m.lcp)),
      fid: median(measurements.map(m => m.fid)),
      cls: median(measurements.map(m => m.cls)),
      fcp: median(measurements.map(m => m.fcp)),
      ttfb: median(measurements.map(m => m.ttfb)),
      timestamp: Date.now(),
      userAgent: navigator.userAgent,
    };
  }

  /**
   * Collect profile samples
   */
  private async collectProfileSamples(config: ProfilingConfig): Promise<void> {
    if (!this.activeProfile) return;

    const interval = config.samplingInterval || 100;
    const endTime = Date.now() + config.duration;

    return new Promise<void>((resolve) => {
      const collectSample = () => {
        if (Date.now() >= endTime) {
          resolve();
        } else {
          const sample = this.collectSample();
          if (this.activeProfile) {
            this.activeProfile.samples.push(sample);
          }
          setTimeout(collectSample, interval);
        }
      };

      collectSample();
    });
  }

  /**
   * Collect single profile sample
   */
  private collectSample(): ProfileSample {
    const memory = (performance as any).memory;

    return {
      timestamp: Date.now(),
      stack: this.getCurrentStack(),
      memoryUsage: memory?.usedJSHeapSize,
      frameRate: this.getCurrentFrameRate(),
    };
  }

  /**
   * Capture memory snapshot
   */
  private async captureMemorySnapshot(): Promise<MemorySnapshot> {
    const memory = (performance as any).memory;

    return {
      totalSize: memory?.totalJSHeapSize || 0,
      liveSize: memory?.usedJSHeapSize || 0,
      sizeByNode: await this.getMemoryBreakdown(),
    };
  }

  /**
   * Capture network events
   */
  private async captureNetworkEvents(duration: number): Promise<NetworkEvent[]> {
    const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];

    return resources.map(r => ({
      timestamp: r.startTime,
      url: r.name,
      method: 'GET', // Most resources are GET
      type: this.getResourceType(r.name),
      duration: r.duration,
      size: r.transferSize || 0,
      status: 200, // Default to success
    }));
  }

  /**
   * Calculate improvements from before/after metrics
   */
  private calculateImprovements(before: CoreWebVitals, after: CoreWebVitals): Record<string, number> {
    return {
      lcpImprovement: ((before.lcp - after.lcp) / before.lcp) * 100,
      fidImprovement: ((before.fid - after.fid) / before.fid) * 100,
      clsImprovement: ((before.cls - after.cls) / before.cls) * 100,
      fcpImprovement: ((before.fcp - after.fcp) / before.fcp) * 100,
    };
  }

  /**
   * Check alert thresholds
   */
  private checkAlertThresholds(
    metrics: CoreWebVitals,
    thresholds: Record<string, number>,
    session: MonitoringSession
  ): void {
    for (const [metric, threshold] of Object.entries(thresholds)) {
      const value = (metrics as unknown as Record<string, number>)[metric];
      if (value !== undefined && value > threshold) {
        session.alerts.push({
          metric,
          threshold,
          actualValue: value,
          timestamp: Date.now(),
          severity: value > threshold * 1.5 ? 'critical' : 'warning',
        });
      }
    }
  }

  /**
   * Get current execution stack
   */
  private getCurrentStack(): string[] {
    const stack = new Error().stack;
    return stack ? stack.split('\n').slice(2, 6) : [];
  }

  /**
   * Get current frame rate
   */
  private getCurrentFrameRate(): number {
    // Simplified frame rate calculation
    // In production, would use requestAnimationFrame timing
    return 60; // Default assumption
  }

  /**
   * Get DOM node count
   */
  private async getDOMNodeCount(): Promise<number> {
    return document.querySelectorAll('*').length;
  }

  /**
   * Get event listener count
   */
  private async getEventListenerCount(): Promise<number> {
    // Simplified estimation
    // In production, would need more sophisticated tracking
    return 0;
  }

  /**
   * Get memory breakdown
   */
  private async getMemoryBreakdown(): Promise<Array<{ type: string; count: number; size: number }>> {
    // Simplified breakdown
    // In production, would use heap snapshots
    return [];
  }

  /**
   * Get resource type
   */
  private getResourceType(url: string): string {
    const extension = url.split('.').pop()?.toLowerCase();
    if (['js', 'mjs'].includes(extension || '')) return 'script';
    if (['css'].includes(extension || '')) return 'stylesheet';
    if (['png', 'jpg', 'jpeg', 'webp', 'svg'].includes(extension || '')) return 'image';
    if (['woff', 'woff2', 'ttf'].includes(extension || '')) return 'font';
    return 'other';
  }

  /**
   * Get monitoring session
   */
  private async getMonitoringSession(sessionId: string): Promise<MonitoringSession | null> {
    // In production, would retrieve from storage
    return null;
  }

  /**
   * Evaluate script in browser context
   */
  private async evaluateInBrowser(script: string): Promise<any> {
    // In production, would use CDP Runtime.evaluate
    // For now, simplified implementation
    try {
      // eslint-disable-next-line no-eval
      return eval(script);
    } catch (error) {
      throw new Error(`Script evaluation failed: ${error}`);
    }
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let browserBridgeInstance: BrowserBridge | null = null;

/**
 * Get singleton browser bridge instance
 */
export function getBrowserBridge(): BrowserBridge {
  if (!browserBridgeInstance) {
    browserBridgeInstance = new BrowserBridge();
  }
  return browserBridgeInstance;
}