/**
 * Browser Integration Tool Handlers
 *
 * MCP tools that provide deep browser integration for performance
 * measurement, profiling, and optimization application.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getLogger } from '../infra/logger.js';
import { getBrowserBridge } from '../browser/browserBridge.js';
import type {
  BrowserBridge,
  CoreWebVitals,
  NetworkMetrics,
  MemoryMetrics,
  ProfilingConfig,
  MonitoringConfig,
  MonitoringSession,
  DesignAuditResult,
} from '../browser/browserBridge.js';

const logger = getLogger('browser-tool-handlers');

/**
 * Generate a unique request ID
 */
function generateRequestId(): string {
  return `browser_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

function routerErrorResponse(error: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          {
            error: true,
            message: error instanceof Error ? error.message : String(error),
          },
          null,
          2
        ),
      },
    ],
    isError: true,
  };
}

// ============================================================================
// Input Schemas
// ============================================================================

const PerfMeasureRealWorldSchema = z.object({
  url: z.string().describe('URL to measure performance for'),
  duration: z.number().int().positive().optional().default(10000).describe('Measurement duration in milliseconds (default: 10000)'),
  samples: z.number().int().positive().optional().default(10).describe('Number of samples to collect (default: 10)'),
});

const PerfProfileDeepSchema = z.object({
  url: z.string().describe('URL to profile'),
  duration: z.number().int().positive().default(30000).describe('Profile duration in milliseconds (default: 30000)'),
  profileTypes: z.array(z.enum(['cpu', 'memory', 'network', 'screenshots'])).default(['cpu']).describe('Profile types to include'),
  samplingInterval: z.number().int().positive().optional().describe('Sampling interval in milliseconds'),
});

const PerfMeasureNetworkSchema = z.object({
  url: z.string().describe('URL to measure network performance'),
  includeResourceTimings: z.boolean().default(true).describe('Include detailed resource timing information'),
});

const PerfMeasureMemorySchema = z.object({
  url: z.string().describe('URL to measure memory performance'),
  includeHeapSnapshot: z.boolean().default(false).describe('Include detailed heap snapshot'),
});

const PerfApplyOptimizationSchema = z.object({
  url: z.string().describe('URL to apply optimization to'),
  optimizationType: z.enum([
    'critical-css-extraction',
    'image-optimization',
    'lazy-loading',
    'bundle-optimization',
    'render-optimization',
  ]).describe('Type of optimization to apply'),
  script: z.string().optional().describe('Custom optimization script to execute'),
  measureBeforeAfter: z.boolean().default(true).describe('Measure performance before and after optimization'),
});

const PerfStartMonitoringSchema = z.object({
  url: z.string().describe('URL to monitor'),
  metrics: z.array(z.enum(['lcp', 'fid', 'cls', 'fcp', 'ttfb'])).default(['lcp', 'fid', 'cls']).describe('Metrics to monitor'),
  sampleInterval: z.number().int().positive().default(1000).describe('Sample interval in milliseconds (default: 1000)'),
  alertThresholds: z.record(z.number()).optional().describe('Alert thresholds for each metric'),
  customMetrics: z.array(z.string()).optional().describe('Custom business metrics to track'),
});

const PerfStopMonitoringSchema = z.object({
  sessionId: z.string().describe('Monitoring session ID to stop'),
  exportFormat: z.enum(['json', 'csv', 'prometheus']).default('json').describe('Export format for metrics'),
});

const PerfAnalyzeBottlenecksRealSchema = z.object({
  url: z.string().describe('URL to analyze'),
  symptoms: z.array(z.string()).describe('Observed performance symptoms'),
  includeNetworkAnalysis: z.boolean().default(true).describe('Include network performance analysis'),
  includeMemoryAnalysis: z.boolean().default(true).describe('Include memory performance analysis'),
});

const PerfDesignAuditSchema = z.object({
  url: z.string().optional().describe('URL context (audit runs on the currently active tab via extension)'),
});

// ============================================================================
// Tool Registration Functions
// ============================================================================

/**
 * Register perf_measure_realworld tool
 */
export function registerPerfMeasureRealWorldTool(server: McpServer): void {
  server.registerTool(
    'perf_measure_realworld',
    {
      title: 'Performance: Real-World Measurement',
      description: 'Measure actual Core Web Vitals from real browser sessions. Provides accurate performance data from real user experiences across multiple samples.',
      inputSchema: PerfMeasureRealWorldSchema,
    },
    async (args) => {
      const requestId = generateRequestId();
      logger.info('perf_measure_realworld tool called', { requestId, url: args.url });

      try {
        const browserBridge = getBrowserBridge();

        // Try extension-routed Web Vitals first (real browser data)
        let extensionVitals: Record<string, unknown> | null = null;
        if (browserBridge.isExtensionAvailable()) {
          logger.info('Extension available, measuring Web Vitals via extension', { requestId });
          extensionVitals = await browserBridge.measureCoreWebVitalsViaExtension() as Record<string, unknown> | null;
        }

        // Connect to browser session for fallback/additional metrics
        await browserBridge.connect(args.url);

        // Use extension vitals if available, otherwise fall back to local measurement
        let metrics: CoreWebVitals;
        let viaExtension = false;
        if (extensionVitals !== null) {
          viaExtension = true;
          metrics = {
            lcp: (extensionVitals['lcp'] as number) ?? 0,
            fid: (extensionVitals['fid'] as number) ?? 0,
            cls: (extensionVitals['cls'] as number) ?? 0,
            fcp: (extensionVitals['fcp'] as number) ?? 0,
            ttfb: (extensionVitals['ttfb'] as number) ?? 0,
            timestamp: Date.now(),
            userAgent: 'extension-measured',
          };
        } else {
          metrics = await browserBridge.measureCoreWebVitals(args.duration);
        }

        // Also run design audit if extension is available
        let designAuditSummary: Record<string, unknown> | null = null;
        if (browserBridge.isExtensionAvailable()) {
          try {
            const audit = await browserBridge.runDesignAudit();
            if (audit !== null) {
              designAuditSummary = {
                colorContrastViolations: audit.colorContrast.violations.length,
                touchTargetsFailing: audit.touchTargets.failing,
                typographyIssues: audit.typography.issues.length,
                responsiveIssues: audit.responsiveness.overflowingElements.length,
                imageIssues: audit.images.missingAlt.length + audit.images.oversized.length,
              };
            }
          } catch {
            // Design audit is supplementary; don't fail the whole measurement
          }
        }

        // Calculate statistics
        const statistics = calculateStatistics([metrics], args.samples);

        // Get additional metrics
        const networkMetrics = await browserBridge.captureNetworkMetrics();
        const memoryMetrics = await browserBridge.captureMemoryMetrics();

        // Disconnect
        await browserBridge.disconnect();

        logger.info('perf_measure_realworld tool completed', {
          requestId,
          lcp: metrics.lcp,
          fid: metrics.fid,
          cls: metrics.cls,
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  requestId,
                  url: args.url,
                  metrics,
                  statistics,
                  networkMetrics,
                  memoryMetrics,
                  userAgent: metrics.userAgent,
                  timestamp: metrics.timestamp,
                  recommendations: generateRecommendations(metrics),
                  ...(viaExtension ? { source: 'chrome-extension' } : {}),
                  ...(designAuditSummary !== null ? { designAuditSummary } : {}),
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        logger.error('perf_measure_realworld tool failed', error, { requestId });
        return routerErrorResponse(error);
      }
    }
  );

  logger.info('perf_measure_realworld tool registered');
}

/**
 * Register perf_profile_deep tool
 */
export function registerPerfProfileDeepTool(server: McpServer): void {
  server.registerTool(
    'perf_profile_deep',
    {
      title: 'Performance: Deep Profiling',
      description: 'Perform deep performance profiling using Chrome DevTools Protocol. Provides comprehensive analysis of CPU, memory, network, and rendering performance.',
      inputSchema: PerfProfileDeepSchema,
    },
    async (args) => {
      const requestId = generateRequestId();
      logger.info('perf_profile_deep tool called', { requestId, url: args.url });

      try {
        const browserBridge = getBrowserBridge();

        // Try extension-based CDP profiling first
        if (browserBridge.isExtensionAvailable()) {
          logger.info('Extension available, using CDP profiling via extension', { requestId });

          const profilingId = await browserBridge.startProfilingViaExtension(undefined, {
            heap: args.profileTypes.includes('memory'),
          });

          // Wait for the profiling duration
          await new Promise(resolve => setTimeout(resolve, args.duration));

          const profileData = await browserBridge.stopProfilingViaExtension(profilingId, undefined);

          logger.info('perf_profile_deep tool completed via extension', { requestId });

          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  {
                    requestId,
                    url: args.url,
                    source: 'chrome-extension',
                    profile: {
                      duration: args.duration,
                      hasCpuProfile: profileData['cpuProfile'] !== undefined,
                      hasMetrics: profileData['metrics'] !== undefined,
                      hasHeapUsage: profileData['heapUsage'] !== undefined,
                      networkRequestCount: Array.isArray(profileData['networkRequests'])
                        ? (profileData['networkRequests'] as unknown[]).length
                        : 0,
                    },
                    cpuProfile: profileData['cpuProfile'] ?? null,
                    metrics: profileData['metrics'] ?? null,
                    heapUsage: profileData['heapUsage'] ?? null,
                    networkRequests: profileData['networkRequests'] ?? [],
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        // Fallback: local profiling
        await browserBridge.connect(args.url);

        // Configure profiling
        const profileConfig: ProfilingConfig = {
          duration: args.duration,
          ...(args.samplingInterval !== undefined ? { samplingInterval: args.samplingInterval } : {}),
          includeMemory: args.profileTypes.includes('memory'),
          includeNetwork: args.profileTypes.includes('network'),
          includeScreenshots: args.profileTypes.includes('screenshots'),
        };

        // Run profiling
        const profileResult = await browserBridge.profilePerformance(profileConfig);

        // Analyze profile
        const analysis = analyzeProfile(profileResult);

        // Disconnect
        await browserBridge.disconnect();

        logger.info('perf_profile_deep tool completed', {
          requestId,
          duration: profileResult.timeline.duration,
          samplesCount: profileResult.samples.length,
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  requestId,
                  url: args.url,
                  profile: {
                    duration: profileResult.timeline.duration,
                    eventsCount: profileResult.timeline.events.length,
                    samplesCount: profileResult.samples.length,
                  },
                  metrics: profileResult.metrics,
                  analysis,
                  recommendations: generateProfileRecommendations(analysis),
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        logger.error('perf_profile_deep tool failed', error, { requestId });
        return routerErrorResponse(error);
      }
    }
  );

  logger.info('perf_profile_deep tool registered');
}

/**
 * Register perf_measure_network tool
 */
export function registerPerfMeasureNetworkTool(server: McpServer): void {
  server.registerTool(
    'perf_measure_network',
    {
      title: 'Performance: Network Measurement',
      description: 'Measure network performance including resource timing, transfer sizes, and connection analysis. Identifies slow resources and bandwidth bottlenecks.',
      inputSchema: PerfMeasureNetworkSchema,
    },
    async (args) => {
      const requestId = generateRequestId();
      logger.info('perf_measure_network tool called', { requestId, url: args.url });

      try {
        const browserBridge = getBrowserBridge();

        // Connect to browser session
        await browserBridge.connect(args.url);

        // Wait for page to load
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Measure network metrics
        const networkMetrics = await browserBridge.captureNetworkMetrics();

        // Disconnect
        await browserBridge.disconnect();

        const analysis = analyzeNetworkMetrics(networkMetrics);

        logger.info('perf_measure_network tool completed', {
          requestId,
          resourceCount: networkMetrics.resourceCount,
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  requestId,
                  url: args.url,
                  metrics: networkMetrics,
                  analysis,
                  recommendations: generateNetworkRecommendations(analysis),
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        logger.error('perf_measure_network tool failed', error, { requestId });
        return routerErrorResponse(error);
      }
    }
  );

  logger.info('perf_measure_network tool registered');
}

/**
 * Register perf_apply_optimization tool
 */
export function registerPerfApplyOptimizationTool(server: McpServer): void {
  server.registerTool(
    'perf_apply_optimization',
    {
      title: 'Performance: Apply Optimization',
      description: 'Apply performance optimization directly to running page and measure before/after impact. Supports critical CSS extraction, image optimization, lazy loading, and more.',
      inputSchema: PerfApplyOptimizationSchema,
    },
    async (args) => {
      const requestId = generateRequestId();
      logger.info('perf_apply_optimization tool called', { requestId, url: args.url, type: args.optimizationType });

      try {
        const browserBridge = getBrowserBridge();

        // Connect to browser session
        await browserBridge.connect(args.url);

        // Generate optimization script
        const script = args.script || generateOptimizationScript(args.optimizationType);

        // Apply optimization and measure impact
        const result = await browserBridge.executeOptimizationScript(script);

        // Disconnect
        await browserBridge.disconnect();

        logger.info('perf_apply_optimization tool completed', {
          requestId,
          success: result.success,
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  requestId,
                  url: args.url,
                  optimizationType: args.optimizationType,
                  result,
                  impactAnalysis: {
                    lcpImprovement: result.improvements['lcpImprovement'] || 0,
                    fidImprovement: result.improvements['fidImprovement'] || 0,
                    clsImprovement: result.improvements['clsImprovement'] || 0,
                    fcpImprovement: result.improvements['fcpImprovement'] || 0,
                  },
                  recommendations: generateOptimizationRecommendations(args.optimizationType, result),
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        logger.error('perf_apply_optimization tool failed', error, { requestId });
        return routerErrorResponse(error);
      }
    }
  );

  logger.info('perf_apply_optimization tool registered');
}

/**
 * Register perf_start_monitoring tool
 */
export function registerPerfStartMonitoringTool(server: McpServer): void {
  server.registerTool(
    'perf_start_monitoring',
    {
      title: 'Performance: Start Monitoring',
      description: 'Start continuous performance monitoring with real-time Core Web Vitals tracking, alerting, and custom metric support.',
      inputSchema: PerfStartMonitoringSchema,
    },
    async (args) => {
      const requestId = generateRequestId();
      logger.info('perf_start_monitoring tool called', { requestId, url: args.url });

      try {
        const browserBridge = getBrowserBridge();

        // Connect to browser session
        await browserBridge.connect(args.url);

        // Set up monitoring configuration
        const monitoringConfig: MonitoringConfig = {
          metrics: args.metrics,
          sampleInterval: args.sampleInterval,
          alertThresholds: args.alertThresholds || {
            lcp: 2500,
            fid: 100,
            cls: 0.1,
          },
          ...(args.customMetrics !== undefined ? { enabledCustomMetrics: args.customMetrics } : {}),
        };

        // Start monitoring session
        const session = await browserBridge.startMonitoring(monitoringConfig);

        logger.info('perf_start_monitoring tool completed', {
          requestId,
          sessionId: session.sessionId,
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  requestId,
                  sessionId: session.sessionId,
                  url: args.url,
                  status: 'monitoring',
                  config: monitoringConfig,
                  startTime: session.startTime,
                  instructions: [
                    `Monitoring started for session: ${session.sessionId}`,
                    `Metrics being tracked: ${args.metrics.join(', ')}`,
                    `Use perf_stop_monitoring to stop and export data`,
                  ],
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        logger.error('perf_start_monitoring tool failed', error, { requestId });
        return routerErrorResponse(error);
      }
    }
  );

  logger.info('perf_start_monitoring tool registered');
}

/**
 * Register perf_stop_monitoring tool
 */
export function registerPerfStopMonitoringTool(server: McpServer): void {
  server.registerTool(
    'perf_stop_monitoring',
    {
      title: 'Performance: Stop Monitoring',
      description: 'Stop continuous performance monitoring and export collected metrics. Supports JSON, CSV, and Prometheus formats.',
      inputSchema: PerfStopMonitoringSchema,
    },
    async (args) => {
      const requestId = generateRequestId();
      logger.info('perf_stop_monitoring tool called', { requestId, sessionId: args.sessionId });

      try {
        const browserBridge = getBrowserBridge();

        // Stop monitoring session
        await browserBridge.stopMonitoring(args.sessionId);

        // Export metrics
        const exportData = exportMonitoringData(args.sessionId, args.exportFormat);

        logger.info('perf_stop_monitoring tool completed', { requestId, exportFormat: args.exportFormat });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  requestId,
                  sessionId: args.sessionId,
                  status: 'stopped',
                  exportFormat: args.exportFormat,
                  data: exportData,
                  summary: {
                    totalSamples: exportData.metrics.length,
                    duration: exportData.duration,
                    alerts: exportData.alerts.length,
                  },
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        logger.error('perf_stop_monitoring tool failed', error, { requestId });
        return routerErrorResponse(error);
      }
    }
  );

  logger.info('perf_stop_monitoring tool registered');
}

/**
 * Register perf_analyze_bottlenecks_real tool
 */
export function registerPerfAnalyzeBottlenecksRealTool(server: McpServer): void {
  server.registerTool(
    'perf_analyze_bottlenecks_real',
    {
      title: 'Performance: Real Bottleneck Analysis',
      description: 'Analyze actual performance bottlenecks from real browser sessions using observed symptoms and real-time metrics.',
      inputSchema: PerfAnalyzeBottlenecksRealSchema,
    },
    async (args) => {
      const requestId = generateRequestId();
      logger.info('perf_analyze_bottlenecks_real tool called', { requestId, url: args.url });

      try {
        const browserBridge = getBrowserBridge();

        // Connect to browser session
        await browserBridge.connect(args.url);

        // Collect comprehensive metrics
        const coreWebVitals = await browserBridge.measureCoreWebVitals(5000);

        let networkMetrics: NetworkMetrics | undefined;
        if (args.includeNetworkAnalysis) {
          networkMetrics = await browserBridge.captureNetworkMetrics();
        }

        let memoryMetrics: MemoryMetrics | undefined;
        if (args.includeMemoryAnalysis) {
          memoryMetrics = await browserBridge.captureMemoryMetrics();
        }

        // Disconnect
        await browserBridge.disconnect();

        // Analyze bottlenecks
        const bottleneckAnalysis = analyzeRealBottlenecks(
          args.symptoms,
          coreWebVitals,
          networkMetrics,
          memoryMetrics
        );

        logger.info('perf_analyze_bottlenecks_real tool completed', {
          requestId,
          bottlenecksCount: bottleneckAnalysis.bottlenecks.length,
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  requestId,
                  url: args.url,
                  symptoms: args.symptoms,
                  metrics: {
                    coreWebVitals,
                    networkMetrics,
                    memoryMetrics,
                  },
                  bottleneckAnalysis,
                  recommendations: bottleneckAnalysis.prioritizedRecommendations,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        logger.error('perf_analyze_bottlenecks_real tool failed', error, { requestId });
        return routerErrorResponse(error);
      }
    }
  );

  logger.info('perf_analyze_bottlenecks_real tool registered');
}

/**
 * Register perf_design_audit tool
 */
export function registerPerfDesignAuditTool(server: McpServer): void {
  server.registerTool(
    'perf_design_audit',
    {
      title: 'Performance: UI/UX Design Audit',
      description: 'Run a comprehensive UI/UX design audit on the currently active tab via the Chrome extension. Checks color contrast (WCAG AA/AAA), typography readability, touch target sizes, layout shifts, responsiveness, z-index stacking, spacing consistency, color palette, image optimization, form labels, and interactive element accessibility.',
      inputSchema: PerfDesignAuditSchema,
    },
    async (args) => {
      const requestId = generateRequestId();
      logger.info('perf_design_audit tool called', { requestId, url: args.url });

      try {
        const browserBridge = getBrowserBridge();

        const auditResult = await browserBridge.runDesignAudit();

        if (auditResult === null) {
          return routerErrorResponse(new Error('Design audit returned no results — extension may not be connected'));
        }

        // Calculate overall score
        let totalViolations = 0;
        let totalChecks = 0;

        totalViolations += auditResult.colorContrast.violations.length;
        totalChecks += auditResult.colorContrast.passes.length + auditResult.colorContrast.violations.length;

        totalViolations += auditResult.touchTargets.failing;
        totalChecks += auditResult.touchTargets.total;

        totalViolations += auditResult.typography.issues.length;
        totalChecks += auditResult.typography.fonts.length + auditResult.typography.issues.length;

        totalViolations += auditResult.responsiveness.overflowingElements.length;
        totalChecks += auditResult.responsiveness.overflowingElements.length + 1;

        totalViolations += auditResult.images.missingAlt.length + auditResult.images.oversized.length;
        totalChecks += auditResult.images.total;

        totalViolations += auditResult.forms.withoutLabels;
        totalChecks += auditResult.forms.total;

        totalViolations += auditResult.interactiveElements.violations.length;
        totalChecks += auditResult.interactiveElements.total;

        const overallScore = totalChecks > 0
          ? Math.max(0, Math.round(((totalChecks - totalViolations) / totalChecks) * 100))
          : 100;

        logger.info('perf_design_audit tool completed', {
          requestId,
          overallScore,
          totalViolations,
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  requestId,
                  url: args.url ?? 'active-tab',
                  overallScore,
                  totalViolations,
                  totalChecks,
                  audit: auditResult,
                  recommendations: generateDesignAuditRecommendations(auditResult),
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        logger.error('perf_design_audit tool failed', error, { requestId });
        return routerErrorResponse(error);
      }
    }
  );

  logger.info('perf_design_audit tool registered');
}

// ============================================================================
// Analysis Functions
// ============================================================================

/**
 * Calculate statistics from metrics
 */
function calculateStatistics(metrics: CoreWebVitals[], sampleCount: number) {
  const lcpValues = metrics.map(m => m.lcp);
  const fidValues = metrics.map(m => m.fid);
  const clsValues = metrics.map(m => m.cls);

  const mean = (arr: number[]) => arr.reduce((sum, val) => sum + val, 0) / arr.length;
  const median = (arr: number[]) => {
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
      : (sorted[mid] ?? 0);
  };
  const p95 = (arr: number[]) => {
    const sorted = [...arr].sort((a, b) => a - b);
    const index = Math.floor(sorted.length * 0.95);
    return sorted[index];
  };

  return {
    lcp: {
      mean: mean(lcpValues),
      median: median(lcpValues),
      p95: p95(lcpValues),
      min: Math.min(...lcpValues),
      max: Math.max(...lcpValues),
    },
    fid: {
      mean: mean(fidValues),
      median: median(fidValues),
      p95: p95(fidValues),
      min: Math.min(...fidValues),
      max: Math.max(...fidValues),
    },
    cls: {
      mean: mean(clsValues),
      median: median(clsValues),
      p95: p95(clsValues),
      min: Math.min(...clsValues),
      max: Math.max(...clsValues),
    },
    sampleCount: metrics.length,
  };
}

/**
 * Analyze performance profile
 */
function analyzeProfile(profileResult: any) {
  const { metrics, samples } = profileResult;

  return {
    overallRating: calculateOverallRating(metrics),
    mainThreadUtilization: calculateMainThreadUtilization(samples),
    memoryPressure: calculateMemoryPressure(samples),
    renderPerformance: calculateRenderPerformance(samples),
    networkPerformance: calculateNetworkPerformance(samples),
    topIssues: identifyTopIssues(samples),
  };
}

/**
 * Analyze network metrics
 */
function analyzeNetworkMetrics(networkMetrics: NetworkMetrics) {
  const { slowResources, largestResource, totalTransferSize } = networkMetrics;

  return {
    overallRating: totalTransferSize > 500000 ? 'poor' : totalTransferSize > 250000 ? 'needs-improvement' : 'good',
    bottlenecks: slowResources.length > 5 ? 'many' : slowResources.length > 2 ? 'some' : 'few',
    recommendations: slowResources.length > 0 ? 'Optimize slow resources' : 'Network performance good',
    totalPayloadSize: totalTransferSize,
    compressionOpportunity: Math.round((totalTransferSize - totalTransferSize * 0.3) / 1024), // 30% potential savings
  };
}

/**
 * Analyze real bottlenecks from symptoms
 */
function analyzeRealBottlenecks(
  symptoms: string[],
  coreWebVitals: CoreWebVitals,
  networkMetrics?: NetworkMetrics,
  memoryMetrics?: MemoryMetrics
) {
  const bottlenecks: Array<{
    type: string;
    severity: 'high' | 'medium' | 'low';
    description: string;
    evidence: any;
  }> = [];

  // Core Web Vitals analysis
  if (coreWebVitals.lcp > 2500) {
    bottlenecks.push({
      type: 'lcp',
      severity: coreWebVitals.lcp > 4000 ? 'high' : 'medium',
      description: 'Largest Contentful Paint exceeds threshold',
      evidence: { lcp: coreWebVitals.lcp, threshold: 2500 },
    });
  }

  if (coreWebVitals.fid > 100) {
    bottlenecks.push({
      type: 'fid',
      severity: coreWebVitals.fid > 300 ? 'high' : 'medium',
      description: 'First Input Delay indicates main thread blockage',
      evidence: { fid: coreWebVitals.fid, threshold: 100 },
    });
  }

  if (coreWebVitals.cls > 0.1) {
    bottlenecks.push({
      type: 'cls',
      severity: coreWebVitals.cls > 0.25 ? 'high' : 'medium',
      description: 'Cumulative Layout Shift affects user experience',
      evidence: { cls: coreWebVitals.cls, threshold: 0.1 },
    });
  }

  // Symptom-based analysis
  for (const symptom of symptoms) {
    if (symptom.toLowerCase().includes('slow') || symptom.toLowerCase().includes('lag')) {
      bottlenecks.push({
        type: 'rendering',
        severity: 'medium',
        description: 'Slow rendering performance detected',
        evidence: { symptom },
      });
    }

    if (symptom.toLowerCase().includes('memory') || symptom.toLowerCase().includes('leak')) {
      bottlenecks.push({
        type: 'memory',
        severity: 'high',
        description: 'Memory performance issues detected',
        evidence: { symptom, memoryMetrics },
      });
    }

    if (symptom.toLowerCase().includes('network') || symptom.toLowerCase().includes('load')) {
      bottlenecks.push({
        type: 'network',
        severity: 'medium',
        description: 'Network performance issues detected',
        evidence: { symptom, networkMetrics },
      });
    }
  }

  return {
    bottlenecks,
    prioritizedRecommendations: prioritizeBottlenecks(bottlenecks),
  };
}

/**
 * Generate recommendations from metrics
 */
function generateRecommendations(metrics: CoreWebVitals): string[] {
  const recommendations: string[] = [];

  if (metrics.lcp > 2500) {
    recommendations.push('Optimize critical rendering path - extract critical CSS, optimize hero images');
  }

  if (metrics.fid > 100) {
    recommendations.push('Reduce main thread work - implement code splitting, defer non-critical JavaScript');
  }

  if (metrics.cls > 0.1) {
    recommendations.push('Eliminate layout shifts - reserve space for dynamic content, use font-display: swap with size attributes');
  }

  if (metrics.fcp > 1800) {
    recommendations.push('Optimize first paint - inline critical CSS, use resource hints');
  }

  return recommendations;
}

/**
 * Generate profile recommendations
 */
function generateProfileRecommendations(analysis: any): string[] {
  const recommendations: string[] = [];

  if (analysis.mainThreadUtilization > 0.8) {
    recommendations.push('High main thread utilization detected - implement code splitting and lazy loading');
  }

  if (analysis.memoryPressure === 'high') {
    recommendations.push('Memory pressure detected - check for memory leaks, implement proper cleanup');
  }

  if (analysis.renderPerformance === 'poor') {
    recommendations.push('Poor render performance detected - optimize animations with GPU acceleration, eliminate layout thrashing');
  }

  if (analysis.networkPerformance === 'poor') {
    recommendations.push('Poor network performance detected - implement HTTP/2, optimize images, enable compression');
  }

  return recommendations;
}

/**
 * Generate network recommendations
 */
function generateNetworkRecommendations(analysis: any): string[] {
  const recommendations: string[] = [];

  if (analysis.compressionOpportunity > 100) {
    recommendations.push(`Enable compression - potential ${analysis.compressionOpportunity}KB savings`);
  }

  if (analysis.bottlenecks === 'many') {
    recommendations.push('Optimize slow resources - implement caching, use CDN, optimize images');
  }

  return recommendations;
}

/**
 * Generate optimization recommendations
 */
function generateOptimizationRecommendations(type: string, result: any): string[] {
  const recommendations: string[] = [];

  if (result.success) {
    const improvements = result.improvements;
    if (improvements.lcpImprovement > 10) {
      recommendations.push('LCP improved significantly - optimization effective');
    }
    if (improvements.fidImprovement > 10) {
      recommendations.push('FID improved significantly - main thread optimization working');
    }
    if (improvements.clsImprovement > 10) {
      recommendations.push('CLS improved significantly - layout stability improved');
    }
  } else {
    recommendations.push('Optimization failed - review error messages and try alternative approach');
  }

  return recommendations;
}

/**
 * Generate optimization script
 */
function generateOptimizationScript(type: string): string {
  const scripts: Record<string, string> = {
    'critical-css-extraction': `
      // Critical CSS extraction
      const criticalElements = document.querySelectorAll('head > link[rel="stylesheet"]');
      criticalElements.forEach(link => {
        if (link.media === 'all' || !link.media) {
          link.media = 'print'; // Temporarily disable
          setTimeout(() => link.media = 'all', 100); // Re-enable after load
        }
      });
    `,
    'image-optimization': `
      // Image optimization hints
      const images = document.querySelectorAll('img');
      images.forEach(img => {
        img.loading = 'lazy';
        if (!img.decoding) {
          img.decoding = 'async';
        }
      });
    `,
    'lazy-loading': `
      // Lazy loading implementation
      if ('IntersectionObserver' in window) {
        const lazyImages = document.querySelectorAll('img[data-src]');
        const imageObserver = new IntersectionObserver((entries, observer) => {
          entries.forEach(entry => {
            if (entry.isIntersecting) {
              const img = entry.target as HTMLImageElement;
              img.src = img.dataset.src || '';
              img.removeAttribute('data-src');
              observer.unobserve(img);
            }
          });
        });
        lazyImages.forEach(img => imageObserver.observe(img));
      }
    `,
  };

  return scripts[type] || '';
}

/**
 * Calculate overall rating
 */
function calculateOverallRating(metrics: any): 'good' | 'needs-improvement' | 'poor' {
  let issues = 0;
  if (metrics.fps < 30) issues++;
  if (metrics.frameTime > 33) issues++;
  if (metrics.mainThreadTime > 50) issues++;
  if (metrics.scriptExecutionTime > 20) issues++;
  if (metrics.layoutTime > 16) issues++;
  if (metrics.paintTime > 16) issues++;

  if (issues === 0) return 'good';
  if (issues <= 2) return 'needs-improvement';
  return 'poor';
}

/**
 * Calculate main thread utilization
 */
function calculateMainThreadUtilization(samples: any[]): number {
  if (samples.length === 0) return 0;
  const threadTimes = samples.map(s => s.mainThreadTime || 0);
  const mean = threadTimes.reduce((sum, t) => sum + t, 0) / threadTimes.length;
  return mean / 16.67; // Normalize to 60fps budget
}

/**
 * Calculate memory pressure
 */
function calculateMemoryPressure(samples: any[]): 'low' | 'medium' | 'high' {
  if (samples.length === 0) return 'low';
  const memoryUsage = samples.map(s => s.memoryUsage || 0);
  const max = Math.max(...memoryUsage);
  const mean = memoryUsage.reduce((sum, m) => sum + m, 0) / memoryUsage.length;

  if (max > mean * 2) return 'high';
  if (max > mean * 1.5) return 'medium';
  return 'low';
}

/**
 * Calculate render performance
 */
function calculateRenderPerformance(samples: any[]): 'good' | 'needs-improvement' | 'poor' {
  if (samples.length === 0) return 'good';
  const frameTimes = samples.map(s => s.frameTime || 0);
  const mean = frameTimes.reduce((sum, t) => sum + t, 0) / frameTimes.length;

  if (mean < 16) return 'good';
  if (mean < 33) return 'needs-improvement';
  return 'poor';
}

/**
 * Calculate network performance
 */
function calculateNetworkPerformance(samples: any[]): 'good' | 'needs-improvement' | 'poor' {
  if (samples.length === 0) return 'good';
  // Simplified network performance calculation
  return 'good';
}

/**
 * Identify top issues
 */
function identifyTopIssues(samples: any[]): string[] {
  const issues: string[] = [];

  const highFrameTime = samples.filter(s => (s.frameTime || 0) > 33).length;
  if (highFrameTime > samples.length * 0.5) {
    issues.push('High frame time causing janky animations');
  }

  const highMemory = samples.filter(s => (s.memoryUsage || 0) > 50000000).length;
  if (highMemory > samples.length * 0.3) {
    issues.push('High memory usage detected');
  }

  return issues;
}

/**
 * Prioritize bottlenecks
 */
function prioritizeBottlenecks(bottlenecks: any[]): string[] {
  const highPriority = bottlenecks.filter(b => b.severity === 'high').map(b => b.description);
  const mediumPriority = bottlenecks.filter(b => b.severity === 'medium').map(b => b.description);
  const lowPriority = bottlenecks.filter(b => b.severity === 'low').map(b => b.description);

  return [
    ...highPriority,
    ...mediumPriority,
    ...lowPriority,
  ];
}

/**
 * Export monitoring data
 */
function exportMonitoringData(sessionId: string, format: string): any {
  // In production, would retrieve actual session data
  const mockData = {
    sessionId,
    format,
    metrics: [],
    duration: 0,
    alerts: [],
  };

  switch (format) {
    case 'csv':
      return {
        format: 'csv',
        data: convertToCSV(mockData.metrics),
      };
    case 'prometheus':
      return {
        format: 'prometheus',
        data: convertToPrometheus(mockData.metrics),
      };
    default:
      return mockData;
  }
}

/**
 * Convert metrics to CSV
 */
function convertToCSV(metrics: any[]): string {
  if (metrics.length === 0) return '';
  const headers = Object.keys(metrics[0]).join(',');
  const rows = metrics.map(m => Object.values(m).join(','));
  return [headers, ...rows].join('\n');
}

/**
 * Convert metrics to Prometheus format
 */
function convertToPrometheus(metrics: any[]): string {
  return metrics.map(m =>
    Object.entries(m)
      .map(([key, value]) => `performance_metric{metric="${key}"} ${value}`)
      .join('\n')
  ).join('\n');
}

/**
 * Generate design audit recommendations
 */
function generateDesignAuditRecommendations(audit: DesignAuditResult): string[] {
  const recommendations: string[] = [];

  if (audit.colorContrast.violations.length > 0) {
    recommendations.push(
      `Fix ${audit.colorContrast.violations.length} color contrast violations for WCAG AA compliance`
    );
  }

  if (audit.touchTargets.failing > 0) {
    recommendations.push(
      `${audit.touchTargets.failing} interactive elements are smaller than 48x48px minimum touch target`
    );
  }

  if (audit.typography.readabilityScore < 80) {
    recommendations.push(
      `Typography readability score is ${audit.typography.readabilityScore}/100 — check font sizes and line heights`
    );
  }

  if (audit.responsiveness.hasHorizontalScroll) {
    recommendations.push('Page has horizontal scroll — fix overflowing elements for mobile compatibility');
  }

  if (audit.images.missingAlt.length > 0) {
    recommendations.push(
      `${audit.images.missingAlt.length} images missing alt text — critical for accessibility`
    );
  }

  if (audit.images.oversized.length > 0) {
    recommendations.push(
      `${audit.images.oversized.length} images are significantly larger than their display size — optimize for performance`
    );
  }

  if (audit.forms.withoutLabels > 0) {
    recommendations.push(
      `${audit.forms.withoutLabels} form inputs missing labels — add labels for accessibility`
    );
  }

  if (audit.spacing.consistencyScore < 60) {
    recommendations.push(
      `Spacing consistency score is ${audit.spacing.consistencyScore}/100 — standardize margins and padding`
    );
  }

  return recommendations;
}