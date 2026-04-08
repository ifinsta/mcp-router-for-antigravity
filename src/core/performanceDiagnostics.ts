/**
 * Performance Diagnostics Tool
 *
 * Provides automated performance analysis and recommendations
 * using the performance knowledge base. This tool can analyze
 * performance metrics, identify bottlenecks, and generate
 * prioritized action plans.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getLogger } from '../infra/logger.js';
import {
  analyzePerformanceMetrics,
  getOptimizationPriorities,
  getFrameworkPerformanceBestPractices,
  PERFORMANCE_BOTTLENECKS,
  OPTIMIZATION_STRATEGIES,
} from './performanceKnowledgeBase.js';

const logger = getLogger('performance-diagnostics');

// ============================================================================
// Input Schemas
// ============================================================================

const PerfAnalyzeMetricsSchema = z.object({
  lcp: z.number().describe('Largest Contentful Paint in milliseconds'),
  fid: z.number().describe('First Input Delay in milliseconds'),
  cls: z.number().describe('Cumulative Layout Shift score'),
  framework: z.string().optional().describe('Framework (react, vue, angular, vanilla)'),
  pageType: z.string().optional().describe('Page type (ecommerce, blog, portfolio, etc.)'),
  constraints: z.array(z.string()).optional().describe('Technical constraints'),
});

const PerfGetPrioritiesSchema = z.object({
  lcp: z.number().describe('Largest Contentful Paint in milliseconds'),
  fid: z.number().describe('First Input Delay in milliseconds'),
  cls: z.number().describe('Cumulative Layout Shift score'),
  bundleSize: z.number().optional().describe('Initial bundle size in bytes'),
  imageCount: z.number().optional().describe('Number of images on page'),
  jsFiles: z.number().optional().describe('Number of JavaScript files'),
  cssFiles: z.number().optional().describe('Number of CSS files'),
});

const PerfFrameworkBestPracticesSchema = z.object({
  framework: z.enum(['react', 'vue', 'angular', 'vanilla']).describe('Framework to get best practices for'),
});

const PerfIdentifyBottlenecksSchema = z.object({
  symptoms: z.array(z.string()).describe('Observed performance symptoms'),
  framework: z.string().optional().describe('Framework being used'),
  pageType: z.string().optional().describe('Type of page'),
});

const PerfGetOptimizationStrategiesSchema = z.object({
  category: z.enum(['quick-wins', 'medium-investments', 'high-impact-changes', 'all']).optional().default('all').describe('Optimization category'),
});

// ============================================================================
// Helper Functions
// ============================================================================

function generateRequestId(): string {
  return `perf_diag_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
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
// Performance Diagnostics Tool Registration
// ============================================================================

/**
 * Register performance diagnostics tools
 */
export function registerPerformanceDiagnosticsTools(server: McpServer): void {
  /**
   * Register perf_analyze_metrics tool
   */
  server.registerTool(
    'perf_analyze_metrics',
    {
      title: 'Performance: Analyze Metrics',
      description: 'Analyze Core Web Vitals metrics (LCP, FID, CLS) and provide comprehensive diagnostics with prioritized recommendations.',
      inputSchema: PerfAnalyzeMetricsSchema,
    },
    async (args) => {
      const requestId = generateRequestId();
      logger.info('perf_analyze_metrics tool called', { requestId, args });

      try {
        const diagnostics = analyzePerformanceMetrics(
          args.lcp,
          args.fid,
          args.cls,
          {
            ...(args.framework !== undefined ? { framework: args.framework } : {}),
            ...(args.pageType !== undefined ? { pageType: args.pageType } : {}),
            ...(args.constraints !== undefined ? { constraints: args.constraints } : {}),
          }
        );

        logger.info('perf_analyze_metrics tool completed', { requestId, overall: diagnostics.overall });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(diagnostics, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error('perf_analyze_metrics tool failed', error, { requestId });
        return routerErrorResponse(error);
      }
    }
  );

  /**
   * Register perf_get_priorities tool
   */
  server.registerTool(
    'perf_get_priorities',
    {
      title: 'Performance: Get Optimization Priorities',
      description: 'Get prioritized optimization actions based on current performance metrics and resource usage. Helps focus on high-impact improvements first.',
      inputSchema: PerfGetPrioritiesSchema,
    },
    async (args) => {
      const requestId = generateRequestId();
      logger.info('perf_get_priorities tool called', { requestId, args });

      try {
        const priorities = getOptimizationPriorities(
          { lcp: args.lcp, fid: args.fid, cls: args.cls },
          {
            ...(args.bundleSize !== undefined ? { bundleSize: args.bundleSize } : {}),
            ...(args.imageCount !== undefined ? { imageCount: args.imageCount } : {}),
            ...(args.jsFiles !== undefined ? { jsFiles: args.jsFiles } : {}),
            ...(args.cssFiles !== undefined ? { cssFiles: args.cssFiles } : {}),
          }
        );

        logger.info('perf_get_priorities tool completed', { requestId, priorityCount: priorities.length });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  priorities,
                  summary: {
                    high: priorities.filter(p => p.priority === 'high').length,
                    medium: priorities.filter(p => p.priority === 'medium').length,
                    low: priorities.filter(p => p.priority === 'low').length,
                  },
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        logger.error('perf_get_priorities tool failed', error, { requestId });
        return routerErrorResponse(error);
      }
    }
  );

  /**
   * Register perf_framework_best_practices tool
   */
  server.registerTool(
    'perf_framework_best_practices',
    {
      title: 'Performance: Framework Best Practices',
      description: 'Get framework-specific performance best practices and optimization patterns.',
      inputSchema: PerfFrameworkBestPracticesSchema,
    },
    async (args) => {
      const requestId = generateRequestId();
      logger.info('perf_framework_best_practices tool called', { requestId, framework: args.framework });

      try {
        const bestPractices = getFrameworkPerformanceBestPractices(args.framework);

        logger.info('perf_framework_best_practices tool completed', { requestId, practiceCount: bestPractices.length });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  framework: args.framework,
                  bestPractices,
                  summary: `${bestPractices.length} performance best practices for ${args.framework}`,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        logger.error('perf_framework_best_practices tool failed', error, { requestId });
        return routerErrorResponse(error);
      }
    }
  );

  /**
   * Register perf_identify_bottlenecks tool
   */
  server.registerTool(
    'perf_identify_bottlenecks',
    {
      title: 'Performance: Identify Bottlenecks',
      description: 'Identify potential performance bottlenecks based on observed symptoms and context.',
      inputSchema: PerfIdentifyBottlenecksSchema,
    },
    async (args) => {
      const requestId = generateRequestId();
      logger.info('perf_identify_bottlenecks tool called', { requestId, args });

      try {
        // Match symptoms to known bottlenecks
        const matchedBottlenecks = PERFORMANCE_BOTTLENECKS.filter(bottleneck =>
          args.symptoms.some(symptom =>
            bottleneck.symptoms.some(bottleneckSymptom =>
              bottleneckSymptom.toLowerCase().includes(symptom.toLowerCase()) ||
              symptom.toLowerCase().includes(bottleneckSymptom.toLowerCase())
            )
          )
        );

        // Add framework-specific considerations
        const frameworkConsiderations = args.framework
          ? getFrameworkPerformanceBestPractices(args.framework as 'react' | 'vue' | 'angular' | 'vanilla').slice(0, 3)
          : [];

        logger.info('perf_identify_bottlenecks tool completed', { requestId, matchCount: matchedBottlenecks.length });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  matchedBottlenecks,
                  frameworkConsiderations,
                  analysis: {
                    symptomCount: args.symptoms.length,
                    matchCount: matchedBottlenecks.length,
                    framework: args.framework,
                    pageType: args.pageType,
                  },
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        logger.error('perf_identify_bottlenecks tool failed', error, { requestId });
        return routerErrorResponse(error);
      }
    }
  );

  /**
   * Register perf_get_optimization_strategies tool
   */
  server.registerTool(
    'perf_get_optimization_strategies',
    {
      title: 'Performance: Get Optimization Strategies',
      description: 'Get detailed optimization strategies organized by effort and impact. Includes quick wins, medium investments, and high-impact changes.',
      inputSchema: PerfGetOptimizationStrategiesSchema,
    },
    async (args) => {
      const requestId = generateRequestId();
      logger.info('perf_get_optimization_strategies tool called', { requestId, category: args.category });

      try {
        let strategies: Record<string, typeof OPTIMIZATION_STRATEGIES[keyof typeof OPTIMIZATION_STRATEGIES]>;

        switch (args.category) {
          case 'quick-wins':
            strategies = { QUICK_WINS: OPTIMIZATION_STRATEGIES.QUICK_WINS };
            break;
          case 'medium-investments':
            strategies = { MEDIUM_INVESTMENTS: OPTIMIZATION_STRATEGIES.MEDIUM_INVESTMENTS };
            break;
          case 'high-impact-changes':
            strategies = { HIGH_IMPACT_CHANGES: OPTIMIZATION_STRATEGIES.HIGH_IMPACT_CHANGES };
            break;
          default:
            strategies = OPTIMIZATION_STRATEGIES;
        }

        logger.info('perf_get_optimization_strategies tool completed', { requestId, category: args.category });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  strategies,
                  summary: {
                    quickWinsCount: OPTIMIZATION_STRATEGIES.QUICK_WINS.length,
                    mediumInvestmentsCount: OPTIMIZATION_STRATEGIES.MEDIUM_INVESTMENTS.length,
                    highImpactChangesCount: OPTIMIZATION_STRATEGIES.HIGH_IMPACT_CHANGES.length,
                  },
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        logger.error('perf_get_optimization_strategies tool failed', error, { requestId });
        return routerErrorResponse(error);
      }
    }
  );

  logger.info('Performance diagnostics tools registered');
}