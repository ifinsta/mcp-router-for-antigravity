/**
 * Performance Optimization Tool Handlers
 *
 * MCP tools specifically designed for frontend performance optimization.
 * These tools provide specialized access to performance engineering capabilities
 * and analysis patterns that LLMs can use to optimize web applications.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getLogger } from '../infra/logger.js';
import { getRouter } from '../core/router.js';
import { getTemplateRegistry } from '../core/templates.js';
import { getPerformanceTemplatesByCategory, getPerformanceTemplateNames } from '../core/performanceTemplates.js';
import { isRouterError } from '../core/errors.js';

const logger = getLogger('performance-tool-handlers');

/**
 * Generate a unique request ID
 */
function generateRequestId(): string {
  return `perf_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

// ============================================================================
// Input Schemas
// ============================================================================

const PerfCriticalPathAnalysisSchema = z.object({
  framework: z.string().describe('Framework (React, Vue, Angular, vanilla)'),
  html: z.string().describe('HTML content or snippet'),
  css: z.string().describe('CSS content or snippet'),
  js: z.string().describe('JavaScript content or snippet'),
  provider: z.string().optional().describe('LLM provider override'),
  model: z.string().optional().describe('LLM model override'),
});

const PerfBundleOptimizationSchema = z.object({
  framework: z.string().describe('Framework (React, Vue, Angular, vanilla)'),
  bundleAnalysis: z.string().describe('Bundle analysis output (webpack-bundle-analyzer, etc.)'),
  dependencies: z.string().describe('Package.json dependencies section'),
  provider: z.string().optional().describe('LLM provider override'),
  model: z.string().optional().describe('LLM model override'),
});

const PerfRenderOptimizationSchema = z.object({
  framework: z.string().describe('Framework (React, Vue, Angular, vanilla)'),
  component: z.string().describe('Component code to optimize'),
  context: z.string().describe('Usage context (list rendering, animation, etc.)'),
  provider: z.string().optional().describe('LLM provider override'),
  model: z.string().optional().describe('LLM model override'),
});

const PerfNetworkOptimizationSchema = z.object({
  type: z.string().describe('Application type (SPA, MPA, PWA)'),
  currentSetup: z.string().describe('Current network setup (headers, CDN, etc.)'),
  metrics: z.string().describe('Current performance metrics'),
  provider: z.string().optional().describe('LLM provider override'),
  model: z.string().optional().describe('LLM model override'),
});

const PerfCoreWebVitalsSchema = z.object({
  framework: z.string().describe('Framework (React, Vue, Angular, vanilla)'),
  lcp: z.number().describe('Current LCP in milliseconds'),
  fid: z.number().describe('Current FID in milliseconds'),
  cls: z.number().describe('Current CLS score'),
  pageContent: z.string().describe('Page content description or HTML snippet'),
  lcpStatus: z.string().optional().describe('LCP status (good, needs-improvement, poor)'),
  fidStatus: z.string().optional().describe('FID status (good, needs-improvement, poor)'),
  clsStatus: z.string().optional().describe('CLS status (good, needs-improvement, poor)'),
  provider: z.string().optional().describe('LLM provider override'),
  model: z.string().optional().describe('LLM model override'),
});

const PerfMemoryOptimizationSchema = z.object({
  framework: z.string().describe('Framework (React, Vue, Angular, vanilla)'),
  component: z.string().describe('Component code to optimize'),
  lifecycle: z.string().describe('Lifecycle events and hooks used'),
  provider: z.string().optional().describe('LLM provider override'),
  model: z.string().optional().describe('LLM model override'),
});

const PerfImageOptimizationSchema = z.object({
  type: z.string().describe('Website type (blog, ecommerce, portfolio, etc.)'),
  imageList: z.string().describe('List of images with sizes and formats'),
  context: z.string().describe('Usage context (hero, gallery, product images, etc.)'),
  provider: z.string().optional().describe('LLM provider override'),
  model: z.string().optional().describe('LLM model override'),
});

const PerfVanillaJsOptimizationSchema = z.object({
  code: z.string().describe('Vanilla JavaScript code to optimize'),
  context: z.string().describe('Performance context (animation, data processing, DOM manipulation)'),
  provider: z.string().optional().describe('LLM provider override'),
  model: z.string().optional().describe('LLM model override'),
});

const PerfCssOptimizationSchema = z.object({
  framework: z.string().describe('Framework (React, Vue, Angular, vanilla)'),
  css: z.string().describe('CSS code to optimize'),
  structure: z.string().describe('Component structure description'),
  provider: z.string().optional().describe('LLM provider override'),
  model: z.string().optional().describe('LLM model override'),
});

const PerfProfilingStrategySchema = z.object({
  type: z.string().describe('Application type (SPA, MPA, PWA)'),
  issues: z.string().describe('Current performance issues'),
  stack: z.string().describe('Technical stack and libraries used'),
  provider: z.string().optional().describe('LLM provider override'),
  model: z.string().optional().describe('LLM model override'),
});

const PerfAuditActionPlanSchema = z.object({
  framework: z.string().describe('Framework (React, Vue, Angular, vanilla)'),
  lcp: z.number().describe('Current LCP in milliseconds'),
  fid: z.number().describe('Current FID in milliseconds'),
  cls: z.number().describe('Current CLS score'),
  constraints: z.string().describe('Technical constraints and limitations'),
  provider: z.string().optional().describe('LLM provider override'),
  model: z.string().optional().describe('LLM model override'),
});

const PerfServiceWorkerSchema = z.object({
  type: z.string().describe('Application type (SPA, MPA, PWA)'),
  currentSetup: z.string().describe('Current Service Worker setup (if any)'),
  apis: z.string().describe('API endpoints and patterns'),
  assets: z.string().describe('Static assets and their update frequency'),
  provider: z.string().optional().describe('LLM provider override'),
  model: z.string().optional().describe('LLM model override'),
});

const PerfListTemplatesSchema = z.object({
  category: z.string().optional().describe('Filter by performance category'),
});

// ============================================================================
// Helper Functions
// ============================================================================

function routerErrorResponse(error: unknown) {
  if (isRouterError(error)) {
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              error: true,
              code: error.code,
              message: error.message,
              provider: error.provider,
            },
            null,
            2
          ),
        },
      ],
      isError: true,
    };
  }

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

async function executePerformanceTemplate(
  templateName: string,
  vars: Record<string, string>,
  provider?: string,
  model?: string,
): Promise<Record<string, unknown>> {
  const router = getRouter();
  const registry = getTemplateRegistry();

  const rendered = registry.render(templateName, vars);

  const request = {
    provider,
    model: model ?? rendered.recommendedModel,
    messages: rendered.messages,
  };

  const response = await router.executeChat(request);

  return {
    outputText: response.outputText,
    provider: response.provider,
    model: response.model,
    template: templateName,
    finishReason: response.finishReason,
    latencyMs: response.latencyMs,
    warnings: response.warnings,
  };
}

// ============================================================================
// Performance Tool Registration Functions
// ============================================================================

/**
 * Register performance-critical-path-analysis tool
 */
export function registerPerfCriticalPathAnalysisTool(server: McpServer): void {
  server.registerTool(
    'perf-critical-path-analysis',
    {
      title: 'Performance: Critical Path Analysis',
      description: 'Analyze and optimize the critical rendering path. Identifies blocking resources, render-blocking CSS/JS, and prioritizes above-the-fold content for maximum perceived performance.',
      inputSchema: PerfCriticalPathAnalysisSchema,
    },
    async (args) => {
      const requestId = generateRequestId();
      logger.info('perf-critical-path-analysis tool called', { requestId });

      try {
        const output = await executePerformanceTemplate(
          'perf-critical-path-analysis',
          {
            framework: args.framework,
            html: args.html,
            css: args.css,
            js: args.js,
          },
          args.provider,
          args.model
        );

        logger.info('perf-critical-path-analysis tool completed', { requestId, provider: output['provider'] });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(output, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error('perf-critical-path-analysis tool failed', error, { requestId });
        return routerErrorResponse(error);
      }
    }
  );

  logger.info('perf-critical-path-analysis tool registered');
}

/**
 * Register performance-bundle-optimization tool
 */
export function registerPerfBundleOptimizationTool(server: McpServer): void {
  server.registerTool(
    'perf-bundle-optimization',
    {
      title: 'Performance: Bundle Optimization',
      description: 'Analyze and optimize bundle sizes using tree-shaking, code splitting, and dependency elimination. Focuses on reducing initial JavaScript payload while maintaining functionality.',
      inputSchema: PerfBundleOptimizationSchema,
    },
    async (args) => {
      const requestId = generateRequestId();
      logger.info('perf-bundle-optimization tool called', { requestId });

      try {
        const output = await executePerformanceTemplate(
          'perf-bundle-optimization',
          {
            framework: args.framework,
            bundleAnalysis: args.bundleAnalysis,
            dependencies: args.dependencies,
          },
          args.provider,
          args.model
        );

        logger.info('perf-bundle-optimization tool completed', { requestId, provider: output['provider'] });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(output, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error('perf-bundle-optimization tool failed', error, { requestId });
        return routerErrorResponse(error);
      }
    }
  );

  logger.info('perf-bundle-optimization tool registered');
}

/**
 * Register performance-render-optimization tool
 */
export function registerPerfRenderOptimizationTool(server: McpServer): void {
  server.registerTool(
    'perf-render-optimization',
    {
      title: 'Performance: Render Optimization',
      description: 'Optimize rendering performance by eliminating layout thrashing, reducing reflows, and implementing efficient animation patterns. Focuses on achieving 60fps animations and smooth interactions.',
      inputSchema: PerfRenderOptimizationSchema,
    },
    async (args) => {
      const requestId = generateRequestId();
      logger.info('perf-render-optimization tool called', { requestId });

      try {
        const output = await executePerformanceTemplate(
          'perf-render-optimization',
          {
            framework: args.framework,
            component: args.component,
            context: args.context,
          },
          args.provider,
          args.model
        );

        logger.info('perf-render-optimization tool completed', { requestId, provider: output['provider'] });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(output, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error('perf-render-optimization tool failed', error, { requestId });
        return routerErrorResponse(error);
      }
    }
  );

  logger.info('perf-render-optimization tool registered');
}

/**
 * Register performance-network-optimization tool
 */
export function registerPerfNetworkOptimizationTool(server: McpServer): void {
  server.registerTool(
    'perf-network-optimization',
    {
      title: 'Performance: Network Optimization',
      description: 'Optimize network performance through HTTP/2, caching strategies, resource prioritization, and connection reuse. Focuses on reducing latency and maximizing bandwidth efficiency.',
      inputSchema: PerfNetworkOptimizationSchema,
    },
    async (args) => {
      const requestId = generateRequestId();
      logger.info('perf-network-optimization tool called', { requestId });

      try {
        const output = await executePerformanceTemplate(
          'perf-network-optimization',
          {
            type: args.type,
            currentSetup: args.currentSetup,
            metrics: args.metrics,
          },
          args.provider,
          args.model
        );

        logger.info('perf-network-optimization tool completed', { requestId, provider: output['provider'] });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(output, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error('perf-network-optimization tool failed', error, { requestId });
        return routerErrorResponse(error);
      }
    }
  );

  logger.info('perf-network-optimization tool registered');
}

/**
 * Register performance-core-web-vitals tool
 */
export function registerPerfCoreWebVitalsTool(server: McpServer): void {
  server.registerTool(
    'perf-core-web-vitals',
    {
      title: 'Performance: Core Web Vitals Optimization',
      description: 'Optimize for Core Web Vitals (LCP, FID, CLS) through targeted improvements. Focuses on achieving "Good" ratings across all metrics that Google uses for ranking.',
      inputSchema: PerfCoreWebVitalsSchema,
    },
    async (args) => {
      const requestId = generateRequestId();
      logger.info('perf-core-web-vitals tool called', { requestId });

      try {
        const output = await executePerformanceTemplate(
          'perf-core-web-vitals',
          {
            framework: args.framework,
            lcp: args.lcp.toString(),
            fid: args.fid.toString(),
            cls: args.cls.toString(),
            pageContent: args.pageContent,
            lcpStatus: args.lcpStatus || 'unknown',
            fidStatus: args.fidStatus || 'unknown',
            clsStatus: args.clsStatus || 'unknown',
          },
          args.provider,
          args.model
        );

        logger.info('perf-core-web-vitals tool completed', { requestId, provider: output['provider'] });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(output, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error('perf-core-web-vitals tool failed', error, { requestId });
        return routerErrorResponse(error);
      }
    }
  );

  logger.info('perf-core-web-vitals tool registered');
}

/**
 * Register performance-memory-optimization tool
 */
export function registerPerfMemoryOptimizationTool(server: McpServer): void {
  server.registerTool(
    'perf-memory-optimization',
    {
      title: 'Performance: Memory Optimization',
      description: 'Optimize memory usage and prevent memory leaks through proper cleanup, efficient data structures, and garbage collection awareness. Essential for smooth long-running applications.',
      inputSchema: PerfMemoryOptimizationSchema,
    },
    async (args) => {
      const requestId = generateRequestId();
      logger.info('perf-memory-optimization tool called', { requestId });

      try {
        const output = await executePerformanceTemplate(
          'perf-memory-optimization',
          {
            framework: args.framework,
            component: args.component,
            lifecycle: args.lifecycle,
          },
          args.provider,
          args.model
        );

        logger.info('perf-memory-optimization tool completed', { requestId, provider: output['provider'] });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(output, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error('perf-memory-optimization tool failed', error, { requestId });
        return routerErrorResponse(error);
      }
    }
  );

  logger.info('perf-memory-optimization tool registered');
}

/**
 * Register performance-image-optimization tool
 */
export function registerPerfImageOptimizationTool(server: McpServer): void {
  server.registerTool(
    'perf-image-optimization',
    {
      title: 'Performance: Image Optimization',
      description: 'Comprehensive image optimization strategy covering formats (WebP, AVIF), lazy loading, responsive images, and compression. Aims to reduce image payload by 70%+ while maintaining quality.',
      inputSchema: PerfImageOptimizationSchema,
    },
    async (args) => {
      const requestId = generateRequestId();
      logger.info('perf-image-optimization tool called', { requestId });

      try {
        const output = await executePerformanceTemplate(
          'perf-image-optimization',
          {
            type: args.type,
            imageList: args.imageList,
            context: args.context,
          },
          args.provider,
          args.model
        );

        logger.info('perf-image-optimization tool completed', { requestId, provider: output['provider'] });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(output, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error('perf-image-optimization tool failed', error, { requestId });
        return routerErrorResponse(error);
      }
    }
  );

  logger.info('perf-image-optimization tool registered');
}

/**
 * Register performance-vanilla-js-optimization tool
 */
export function registerPerfVanillaJsOptimizationTool(server: McpServer): void {
  server.registerTool(
    'perf-vanilla-js-optimization',
    {
      title: 'Performance: Vanilla JavaScript Optimization',
      description: 'Optimize vanilla JavaScript performance by understanding V8 internals, avoiding anti-patterns, and using efficient patterns. Emphasizes that vanilla JS can be beautiful and highly performant.',
      inputSchema: PerfVanillaJsOptimizationSchema,
    },
    async (args) => {
      const requestId = generateRequestId();
      logger.info('perf-vanilla-js-optimization tool called', { requestId });

      try {
        const output = await executePerformanceTemplate(
          'perf-vanilla-js-optimization',
          {
            code: args.code,
            context: args.context,
          },
          args.provider,
          args.model
        );

        logger.info('perf-vanilla-js-optimization tool completed', { requestId, provider: output['provider'] });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(output, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error('perf-vanilla-js-optimization tool failed', error, { requestId });
        return routerErrorResponse(error);
      }
    }
  );

  logger.info('perf-vanilla-js-optimization tool registered');
}

/**
 * Register performance-css-optimization tool
 */
export function registerPerfCssOptimizationTool(server: McpServer): void {
  server.registerTool(
    'perf-css-optimization',
    {
      title: 'Performance: CSS Optimization',
      description: 'Optimize CSS performance through selector efficiency, containment, reduction of layout thrashing, and GPU acceleration. Focuses on eliminating expensive CSS operations.',
      inputSchema: PerfCssOptimizationSchema,
    },
    async (args) => {
      const requestId = generateRequestId();
      logger.info('perf-css-optimization tool called', { requestId });

      try {
        const output = await executePerformanceTemplate(
          'perf-css-optimization',
          {
            framework: args.framework,
            css: args.css,
            structure: args.structure,
          },
          args.provider,
          args.model
        );

        logger.info('perf-css-optimization tool completed', { requestId, provider: output['provider'] });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(output, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error('perf-css-optimization tool failed', error, { requestId });
        return routerErrorResponse(error);
      }
    }
  );

  logger.info('perf-css-optimization tool registered');
}

/**
 * Register performance-profiling-strategy tool
 */
export function registerPerfProfilingStrategyTool(server: McpServer): void {
  server.registerTool(
    'perf-profiling-strategy',
    {
      title: 'Performance: Profiling Strategy',
      description: 'Create comprehensive profiling strategies using Chrome DevTools, Lighthouse, and custom monitoring. Provides systematic workflows to identify performance bottlenecks and root causes.',
      inputSchema: PerfProfilingStrategySchema,
    },
    async (args) => {
      const requestId = generateRequestId();
      logger.info('perf-profiling-strategy tool called', { requestId });

      try {
        const output = await executePerformanceTemplate(
          'profiling-strategy',
          {
            type: args.type,
            issues: args.issues,
            stack: args.stack,
          },
          args.provider,
          args.model
        );

        logger.info('perf-profiling-strategy tool completed', { requestId, provider: output['provider'] });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(output, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error('perf-profiling-strategy tool failed', error, { requestId });
        return routerErrorResponse(error);
      }
    }
  );

  logger.info('perf-profiling-strategy tool registered');
}

/**
 * Register performance-audit-action-plan tool
 */
export function registerPerfAuditActionPlanTool(server: McpServer): void {
  server.registerTool(
    'perf-audit-action-plan',
    {
      title: 'Performance: Audit and Action Plan',
      description: 'Create a comprehensive performance audit and action plan prioritized by impact and effort. Combines multiple optimization areas into a cohesive 6-month improvement roadmap.',
      inputSchema: PerfAuditActionPlanSchema,
    },
    async (args) => {
      const requestId = generateRequestId();
      logger.info('perf-audit-action-plan tool called', { requestId });

      try {
        const output = await executePerformanceTemplate(
          'perf-audit-action-plan',
          {
            framework: args.framework,
            lcp: args.lcp.toString(),
            fid: args.fid.toString(),
            cls: args.cls.toString(),
            constraints: args.constraints,
          },
          args.provider,
          args.model
        );

        logger.info('perf-audit-action-plan tool completed', { requestId, provider: output['provider'] });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(output, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error('perf-audit-action-plan tool failed', error, { requestId });
        return routerErrorResponse(error);
      }
    }
  );

  logger.info('perf-audit-action-plan tool registered');
}

/**
 * Register performance-service-worker tool
 */
export function registerPerfServiceWorkerTool(server: McpServer): void {
  server.registerTool(
    'perf-service-worker',
    {
      title: 'Performance: Service Worker Optimization',
      description: 'Implement Service Worker for offline-first performance with intelligent caching strategies and background sync. Balances performance, freshness, and offline capability.',
      inputSchema: PerfServiceWorkerSchema,
    },
    async (args) => {
      const requestId = generateRequestId();
      logger.info('perf-service-worker tool called', { requestId });

      try {
        const output = await executePerformanceTemplate(
          'service-worker-performance',
          {
            type: args.type,
            currentSetup: args.currentSetup,
            apis: args.apis,
            assets: args.assets,
          },
          args.provider,
          args.model
        );

        logger.info('perf-service-worker tool completed', { requestId, provider: output['provider'] });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(output, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error('perf-service-worker tool failed', error, { requestId });
        return routerErrorResponse(error);
      }
    }
  );

  logger.info('perf-service-worker tool registered');
}

/**
 * Register perf-list-templates tool
 */
export function registerPerfListTemplatesTool(server: McpServer): void {
  server.registerTool(
    'perf-list-templates',
    {
      title: 'Performance: List Optimization Templates',
      description: 'List all available performance optimization templates. These templates provide specialized prompts for different performance optimization areas.',
      inputSchema: PerfListTemplatesSchema,
    },
    async (args) => {
      const requestId = generateRequestId();
      logger.info('perf-list-templates tool called', { requestId, category: args.category });

      try {
        const registry = getTemplateRegistry();
        let templates = registry.list();

        // Filter to only performance templates
        const perfTemplateNames = getPerformanceTemplateNames();
        templates = templates.filter(t => perfTemplateNames.includes(t.name));

        if (args.category) {
          templates = templates.filter(t => t.category === args.category);
        }

        const summaries = templates.map((t) => ({
          name: t.name,
          description: t.description,
          category: t.category,
          variables: t.variables,
          outputFormat: t.outputFormat ?? 'text',
          recommendedModel: t.recommendedModel,
        }));

        logger.info('perf-list-templates tool completed', { requestId, templateCount: summaries.length });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(summaries, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error('perf-list-templates tool failed', error, { requestId });
        return routerErrorResponse(error);
      }
    }
  );

  logger.info('perf-list-templates tool registered');
}