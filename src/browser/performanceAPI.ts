/**
 * Performance API Integration
 *
 * Provides native browser Performance API integration for accurate
 * Core Web Vitals measurement and real-time performance monitoring.
 */

import { getLogger } from '../infra/logger.js';
import { getExtensionBridge } from './extensionBridge.js';
import type { ExtensionBridge } from './extensionBridge.js';

const logger = getLogger('performance-api');

// ============================================================================
// Core Types
// ============================================================================

/**
 * Performance metric value
 */
export interface PerformanceMetricValue {
  value: number;
  timestamp: number;
  rating: 'good' | 'needs-improvement' | 'poor';
}

/**
 * Resource timing data
 */
export interface ResourceTimingData {
  url: string;
  duration: number;
  transferSize: number;
  encodedBodySize: number;
  startTime: number;
  type: string;
}

/**
 * Navigation timing data
 */
export interface NavigationTimingData {
  domContentLoaded: number;
  loadComplete: number;
  domInteractive: number;
  firstPaint: number;
  firstContentfulPaint: number;
  redirectCount: number;
  transferSize: number;
}

/**
 * Custom metric definition
 */
export interface CustomMetric {
  name: string;
  value: number;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Core Web Vitals Thresholds
// ============================================================================

const WEB_VITALS_THRESHOLDS = {
  LCP: {
    GOOD: 2500,
    NEEDS_IMPROVEMENT: 4000,
  },
  FID: {
    GOOD: 100,
    NEEDS_IMPROVEMENT: 300,
  },
  CLS: {
    GOOD: 0.1,
    NEEDS_IMPROVEMENT: 0.25,
  },
  FCP: {
    GOOD: 1800,
    NEEDS_IMPROVEMENT: 3000,
  },
  TTFB: {
    GOOD: 800,
    NEEDS_IMPROVEMENT: 1800,
  },
} as const;

// ============================================================================
// Performance API Monitor Implementation
// ============================================================================

/**
 * Performance API Monitor
 *
 * Provides accurate Core Web Vitals measurement using
 * native browser Performance APIs and web-vitals patterns.
 */
export class PerformanceAPIMonitor {
  private lcpObserver: PerformanceObserver | null;
  private fidObserver: PerformanceObserver | null;
  private clsObserver: PerformanceObserver | null;
  private customObservers: Map<string, PerformanceObserver>;
  private lcpValue: PerformanceMetricValue | null;
  private fidValue: PerformanceMetricValue | null;
  private clsValue: PerformanceMetricValue | null;
  private customMetrics: Map<string, CustomMetric>;
  private extensionBridge: ExtensionBridge;

  constructor() {
    this.lcpObserver = null;
    this.fidObserver = null;
    this.clsObserver = null;
    this.customObservers = new Map();
    this.lcpValue = null;
    this.fidValue = null;
    this.clsValue = null;
    this.customMetrics = new Map();
    this.extensionBridge = getExtensionBridge();
  }

  /**
   * Check if the extension is available for real browser measurements.
   */
  isExtensionAvailable(): boolean {
    const ids = this.extensionBridge.getConnectedExtensions();
    return ids.length > 0;
  }

  /**
   * Get all Core Web Vitals from the extension in one call.
   * Returns null if no extension is connected.
   */
  async getWebVitalsViaExtension(): Promise<Record<string, number | null> | null> {
    const ids = this.extensionBridge.getConnectedExtensions();
    const extId = ids[0];
    if (extId === undefined) {
      return null;
    }

    try {
      const result = await this.extensionBridge.sendCommand(extId, 'getWebVitals', {});
      return result as Record<string, number | null>;
    } catch (error) {
      logger.warn('Failed to get Web Vitals from extension, using local fallback', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Initialize performance monitoring
   */
  async initialize(): Promise<void> {
    logger.info('Initializing Performance API Monitor');

    // Set up Core Web Vitals observers
    await this.setupLCPObserver();
    await this.setupFIDObserver();
    await this.setupCLSObserver();

    logger.info('Performance API Monitor initialized');
  }

  /**
   * Get LCP (Largest Contentful Paint)
   */
  async getLCP(): Promise<number> {
    if (this.lcpValue) {
      return this.lcpValue.value;
    }

    // Fallback: use Performance API if observer hasn't fired yet
    const paintEntries = performance.getEntriesByType('paint') as PerformancePaintTiming[];
    const largestPaint = paintEntries
      .filter(entry => entry.name === 'largest-contentful-paint')
      .sort((a, b) => b.startTime - a.startTime)[0];

    return largestPaint?.startTime || 0;
  }

  /**
   * Get FID (First Input Delay)
   */
  async getFID(): Promise<number> {
    if (this.fidValue) {
      return this.fidValue.value;
    }

    // Fallback: estimate from Performance API
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    if (navigation) {
      const tti = navigation.domInteractive - navigation.startTime;
      return Math.max(0, tti - 100); // Subtract first paint delay
    }

    return 0;
  }

  /**
   * Get CLS (Cumulative Layout Shift)
   */
  async getCLS(): Promise<number> {
    if (this.clsValue) {
      return this.clsValue.value;
    }

    // Fallback: use Performance API
    const layoutShiftEntries = performance.getEntriesByType('layout-shift') as any[];
    const cls = layoutShiftEntries.reduce((sum, entry) => {
      if (!entry.hadRecentInput) {
        return sum + entry.value;
      }
      return sum;
    }, 0);

    return cls;
  }

  /**
   * Observe multiple metrics
   */
  async observeMetrics(
    metrics: Array<'lcp' | 'fid' | 'cls' | 'fcp' | 'ttfb'>,
    callback: (metrics: Record<string, number>) => void
  ): Promise<void> {
    logger.info('Setting up metrics observation', { metrics });

    const observedMetrics: Record<string, number> = {};

    for (const metric of metrics) {
      switch (metric) {
        case 'lcp':
          observedMetrics['lcp'] = await this.getLCP();
          break;
        case 'fid':
          observedMetrics['fid'] = await this.getFID();
          break;
        case 'cls':
          observedMetrics['cls'] = await this.getCLS();
          break;
        case 'fcp':
          observedMetrics['fcp'] = await this.getFCP();
          break;
        case 'ttfb':
          observedMetrics['ttfb'] = await this.getTTFB();
          break;
      }
    }

    callback(observedMetrics);
  }

  /**
   * Get navigation timing data
   */
  getNavigationTiming(): NavigationTimingData {
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;

    if (!navigation) {
      return {
        domContentLoaded: 0,
        loadComplete: 0,
        domInteractive: 0,
        firstPaint: 0,
        firstContentfulPaint: 0,
        redirectCount: 0,
        transferSize: 0,
      };
    }

    const paintEntries = performance.getEntriesByType('paint') as PerformancePaintTiming[];
    const firstPaint = paintEntries.find(e => e.name === 'first-paint');
    const firstContentfulPaint = paintEntries.find(e => e.name === 'first-contentful-paint');

    return {
      domContentLoaded: navigation.domContentLoadedEventEnd - navigation.startTime,
      loadComplete: navigation.loadEventEnd - navigation.startTime,
      domInteractive: navigation.domInteractive - navigation.startTime,
      firstPaint: firstPaint?.startTime || 0,
      firstContentfulPaint: firstContentfulPaint?.startTime || 0,
      redirectCount: navigation.redirectCount || 0,
      transferSize: navigation.transferSize || 0,
    };
  }

  /**
   * Get resource timing data
   */
  getResourceTimings(): ResourceTimingData[] {
    const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];

    return resources.map(r => ({
      url: r.name,
      duration: r.duration,
      transferSize: r.transferSize || 0,
      encodedBodySize: r.encodedBodySize || 0,
      startTime: r.startTime,
      type: this.getResourceType(r.name),
    }));
  }

  /**
   * Add custom metric
   */
  addCustomMetric(name: string, value: number, metadata?: Record<string, unknown>): void {
    const metric: CustomMetric = {
      name,
      value,
      timestamp: Date.now(),
      ...(metadata !== undefined ? { metadata } : {}),
    };

    this.customMetrics.set(name, metric);
    logger.debug('Custom metric added', { name, value });
  }

  /**
   * Get custom metrics
   */
  getCustomMetrics(): CustomMetric[] {
    return Array.from(this.customMetrics.values());
  }

  /**
   * Clear all metrics
   */
  clearMetrics(): void {
    this.lcpValue = null;
    this.fidValue = null;
    this.clsValue = null;
    this.customMetrics.clear();

    performance.clearResourceTimings();
    performance.clearMarks();
    performance.clearMeasures();

    logger.info('Metrics cleared');
  }

  /**
   * Cleanup observers
   */
  async cleanup(): Promise<void> {
    logger.info('Cleaning up Performance API Monitor');

    if (this.lcpObserver) {
      this.lcpObserver.disconnect();
      this.lcpObserver = null;
    }

    if (this.fidObserver) {
      this.fidObserver.disconnect();
      this.fidObserver = null;
    }

    if (this.clsObserver) {
      this.clsObserver.disconnect();
      this.clsObserver = null;
    }

    for (const observer of this.customObservers.values()) {
      observer.disconnect();
    }

    this.customObservers.clear();

    logger.info('Performance API Monitor cleaned up');
  }

  // ============================================================================
  // Private Setup Methods
  // ============================================================================

  /**
   * Set up LCP observer
   */
  private async setupLCPObserver(): Promise<void> {
    return new Promise<void>((resolve) => {
      try {
        this.lcpObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.entryType === 'largest-contentful-paint') {
              this.lcpValue = {
                value: entry.startTime,
                timestamp: Date.now(),
                rating: this.getRating('LCP', entry.startTime),
              };
              logger.debug('LCP measured', { value: entry.startTime });
            }
          }
        });

        this.lcpObserver.observe({ entryTypes: ['largest-contentful-paint'] });
        resolve();
      } catch (error) {
        // LCP observer not supported, use fallback
        logger.warn('LCP observer not supported, using fallback', error as Record<string, unknown>);
        this.lcpValue = null;
        resolve();
      }
    });
  }

  /**
   * Set up FID observer
   */
  private async setupFIDObserver(): Promise<void> {
    return new Promise<void>((resolve) => {
      try {
        this.fidObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.entryType === 'first-input') {
              this.fidValue = {
                value: (entry as any).processingStart - entry.startTime,
                timestamp: Date.now(),
                rating: this.getRating('FID', (entry as any).processingStart - entry.startTime),
              };
              logger.debug('FID measured', { value: this.fidValue.value });
            }
          }
        });

        this.fidObserver.observe({ entryTypes: ['first-input'] });
        resolve();
      } catch (error) {
        // FID observer not supported, use fallback
        logger.warn('FID observer not supported, using fallback', error as Record<string, unknown>);
        this.fidValue = null;
        resolve();
      }
    });
  }

  /**
   * Set up CLS observer
   */
  private async setupCLSObserver(): Promise<void> {
    let clsValue = 0;

    return new Promise<void>((resolve) => {
      try {
        this.clsObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.entryType === 'layout-shift' && !(entry as any).hadRecentInput) {
              clsValue += (entry as any).value;
              this.clsValue = {
                value: clsValue,
                timestamp: Date.now(),
                rating: this.getRating('CLS', clsValue),
              };
              logger.debug('CLS measured', { value: clsValue });
            }
          }
        });

        this.clsObserver.observe({ entryTypes: ['layout-shift'] });
        resolve();
      } catch (error) {
        // CLS observer not supported, use fallback
        logger.warn('CLS observer not supported, using fallback', error as Record<string, unknown>);
        this.clsValue = null;
        resolve();
      }
    });
  }

  /**
   * Get rating for metric
   */
  private getRating(metric: keyof typeof WEB_VITALS_THRESHOLDS, value: number): 'good' | 'needs-improvement' | 'poor' {
    const thresholds = WEB_VITALS_THRESHOLDS[metric];

    if (value <= thresholds.GOOD) {
      return 'good';
    } else if (value <= thresholds.NEEDS_IMPROVEMENT) {
      return 'needs-improvement';
    } else {
      return 'poor';
    }
  }

  /**
   * Get FCP (First Contentful Paint)
   */
  private async getFCP(): Promise<number> {
    const paintEntries = performance.getEntriesByType('paint') as PerformancePaintTiming[];
    const fcp = paintEntries.find(entry => entry.name === 'first-contentful-paint');
    return fcp?.startTime || 0;
  }

  /**
   * Get TTFB (Time to First Byte)
   */
  private async getTTFB(): Promise<number> {
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    if (navigation) {
      return navigation.responseStart - navigation.startTime;
    }
    return 0;
  }

  /**
   * Get resource type
   */
  private getResourceType(url: string): string {
    const extension = url.split('.').pop()?.toLowerCase();
    if (['js', 'mjs'].includes(extension || '')) return 'script';
    if (['css'].includes(extension || '')) return 'stylesheet';
    if (['png', 'jpg', 'jpeg', 'webp', 'svg', 'gif'].includes(extension || '')) return 'image';
    if (['woff', 'woff2', 'ttf', 'otf'].includes(extension || '')) return 'font';
    if (['html', 'htm'].includes(extension || '')) return 'document';
    if (['json', 'xml'].includes(extension || '')) return 'fetch';
    return 'other';
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if Performance API is supported
 */
export function isPerformanceAPISupported(): boolean {
  return typeof Performance !== 'undefined' &&
         typeof PerformanceObserver !== 'undefined';
}

/**
 * Check if specific entry type is supported
 */
export function isEntryTypeSupported(entryType: string): boolean {
  return PerformanceObserver.supportedEntryTypes?.includes(entryType) || false;
}

/**
 * Get available performance entry types
 */
export function getSupportedEntryTypes(): string[] {
  return [...(PerformanceObserver.supportedEntryTypes || [])];
}

/**
 * Mark performance start
 */
export function markPerformanceStart(name: string): void {
  performance.mark(`${name}-start`);
  logger.debug('Performance mark', { name, type: 'start' });
}

/**
 * Mark performance end
 */
export function markPerformanceEnd(name: string): void {
  performance.mark(`${name}-end`);
  performance.measure(name, `${name}-start`, `${name}-end`);
  logger.debug('Performance mark', { name, type: 'end' });
}

/**
 * Get performance measurement
 */
export function getPerformanceMeasurement(name: string): number | null {
  const measures = performance.getEntriesByName(name, 'measure');
  const first = measures[0];
  return first ? first.duration : null;
}

/**
 * Clear all performance marks and measures
 */
export function clearPerformanceMarks(): void {
  performance.clearMarks();
  performance.clearMeasures();
  logger.debug('Performance marks cleared');
}