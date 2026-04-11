/**
 * Evidence Capsule Collector
 *
 * Captures browser state snapshots for debugging and failure analysis.
 * Creates structured evidence bundles when browser operations fail.
 */

import { randomUUID } from 'node:crypto';
import { getLogger } from '../infra/logger.js';
import { getExtensionBridge } from '../browser/extensionBridge.js';
import type {
  EvidenceCapsule,
  CapsuleFailureInfo,
  BrowserEvidence,
  BrowserConsoleEntry,
  BrowserNetworkEntry,
  BrowserSessionMetadata,
} from './types.js';

const logger = getLogger('evidence-capsule');
const MAX_CAPSULES = 50;

/**
 * Evidence Capsule Collector
 *
 * Collects and stores browser evidence capsules for failure analysis.
 * Uses LRU eviction to limit memory usage.
 */
export class EvidenceCapsuleCollector {
  private capsules: Map<string, EvidenceCapsule> = new Map();

  /**
   * Capture a new evidence capsule
   */
  async capture(failure: CapsuleFailureInfo): Promise<EvidenceCapsule> {
    const capsuleId = randomUUID();
    const timestamp = new Date().toISOString();

    logger.info('Capturing evidence capsule', { capsuleId, failureType: failure.type });

    let browserEvidence: BrowserEvidence;
    try {
      browserEvidence = await this.collectBrowserEvidence();
    } catch (err) {
      logger.warn('Failed to collect full browser evidence', { capsuleId, error: String(err) });
      browserEvidence = this.emptyBrowserEvidence();
    }

    const capsule: EvidenceCapsule = {
      capsuleId,
      timestamp,
      failure,
      browser: browserEvidence,
    };

    // Store with LRU eviction
    this.capsules.set(capsuleId, capsule);
    if (this.capsules.size > MAX_CAPSULES) {
      const oldestKey = this.capsules.keys().next().value;
      if (oldestKey !== undefined) {
        this.capsules.delete(oldestKey);
        logger.debug('Evicted oldest capsule', { evictedCapsuleId: oldestKey });
      }
    }

    logger.info('Evidence capsule captured', { capsuleId, screenshotCount: browserEvidence.screenshots.length });
    return capsule;
  }

  /**
   * Get a capsule by ID
   */
  get(capsuleId: string): EvidenceCapsule | undefined {
    return this.capsules.get(capsuleId);
  }

  /**
   * List all capsule IDs
   */
  list(): Array<{ capsuleId: string; timestamp: string; failureType: string }> {
    return Array.from(this.capsules.values()).map(c => ({
      capsuleId: c.capsuleId,
      timestamp: c.timestamp,
      failureType: c.failure.type,
    }));
  }

  /**
   * Collect browser evidence from the extension bridge
   */
  private async collectBrowserEvidence(): Promise<BrowserEvidence> {
    const bridge = getExtensionBridge();
    const extensions = bridge.getConnectedExtensions();

    if (extensions.length === 0) {
      logger.warn('No browser extensions connected, returning empty evidence');
      return this.emptyBrowserEvidence();
    }

    const extensionId = extensions[0]!;

    // Collect page info
    let sessionMetadata: BrowserSessionMetadata = { url: '', title: '', tabId: '' };
    try {
      const pageInfo = await bridge.getPageInfo() as Record<string, unknown>;
      sessionMetadata = {
        url: String(pageInfo['url'] ?? ''),
        title: String(pageInfo['title'] ?? ''),
        tabId: String(pageInfo['tabId'] ?? ''),
        ...(pageInfo['userAgent'] !== undefined && pageInfo['userAgent'] !== null ? { userAgent: String(pageInfo['userAgent']) } : {}),
      };
    } catch (err) {
      logger.warn('Failed to get page info', { error: String(err) });
    }

    // Collect screenshot
    const screenshots: string[] = [];
    try {
      const screenshotResult = await bridge.sendCommand(extensionId, 'capture-screenshot', {}) as Record<string, unknown>;
      if (screenshotResult && typeof screenshotResult['screenshot'] === 'string') {
        screenshots.push(screenshotResult['screenshot'] as string);
      }
    } catch (err) {
      logger.warn('Failed to capture screenshot', { error: String(err) });
    }

    // Collect console logs
    let consoleEntries: { errors: BrowserConsoleEntry[]; warnings: BrowserConsoleEntry[]; logs: BrowserConsoleEntry[] } = {
      errors: [], warnings: [], logs: [],
    };
    try {
      const consoleResult = await bridge.sendCommand(extensionId, 'get-console-logs', {}) as Record<string, unknown>;
      if (consoleResult && Array.isArray(consoleResult['entries'])) {
        for (const entry of consoleResult['entries'] as Array<Record<string, unknown>>) {
          const parsed: BrowserConsoleEntry = {
            level: (entry['level'] as BrowserConsoleEntry['level']) ?? 'log',
            message: String(entry['message'] ?? ''),
            timestamp: String(entry['timestamp'] ?? new Date().toISOString()),
            ...(entry['source'] !== undefined && entry['source'] !== null ? { source: String(entry['source']) } : {}),
          };
          if (parsed.level === 'error') consoleEntries.errors.push(parsed);
          else if (parsed.level === 'warning') consoleEntries.warnings.push(parsed);
          else consoleEntries.logs.push(parsed);
        }
      }
    } catch (err) {
      logger.warn('Failed to get console logs', { error: String(err) });
    }

    // Collect network requests
    let networkRequests: BrowserNetworkEntry[] = [];
    try {
      const networkResult = await bridge.sendCommand(extensionId, 'get-network-log', {}) as Record<string, unknown>;
      if (networkResult && Array.isArray(networkResult['requests'])) {
        networkRequests = (networkResult['requests'] as Array<Record<string, unknown>>).map(req => ({
          url: String(req['url'] ?? ''),
          method: String(req['method'] ?? 'GET'),
          status: Number(req['status'] ?? 0),
          statusText: String(req['statusText'] ?? ''),
          duration: Number(req['duration'] ?? 0),
          size: Number(req['size'] ?? 0),
          timestamp: String(req['timestamp'] ?? new Date().toISOString()),
        }));
      }
    } catch (err) {
      logger.warn('Failed to get network log', { error: String(err) });
    }

    // Collect performance metrics
    let performanceMetrics: Record<string, number> = {};
    try {
      const perfResult = await bridge.sendCommand(extensionId, 'get-performance-metrics', {}) as Record<string, unknown>;
      if (perfResult && typeof perfResult['metrics'] === 'object' && perfResult['metrics'] !== null) {
        const metrics = perfResult['metrics'] as Record<string, unknown>;
        for (const [key, value] of Object.entries(metrics)) {
          if (typeof value === 'number') {
            performanceMetrics[key] = value;
          }
        }
      }
    } catch (err) {
      logger.warn('Failed to get performance metrics', { error: String(err) });
    }

    return {
      screenshots,
      console: consoleEntries,
      networkRequests,
      performanceMetrics,
      sessionMetadata,
      actionTimeline: [], // Will be populated by workflow recorder in future
    };
  }

  /**
   * Create empty browser evidence for fallback cases
   */
  private emptyBrowserEvidence(): BrowserEvidence {
    return {
      screenshots: [],
      console: { errors: [], warnings: [], logs: [] },
      networkRequests: [],
      performanceMetrics: {},
      sessionMetadata: { url: '', title: '', tabId: '' },
      actionTimeline: [],
    };
  }
}

// Singleton instance
let collector: EvidenceCapsuleCollector | undefined;

/**
 * Get the singleton evidence capsule collector
 */
export function getEvidenceCapsuleCollector(): EvidenceCapsuleCollector {
  if (!collector) {
    collector = new EvidenceCapsuleCollector();
  }
  return collector;
}
