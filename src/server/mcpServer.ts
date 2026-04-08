/**
 * MCP Server Bootstrap
 *
 * Initializes and runs the MCP server for Antigravity integration
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadAndValidateConfig } from '../infra/config.js';
import { getLogger } from '../infra/logger.js';
import {
  registerLlmChatTool,
  registerListModelsTool,
  registerRouterHealthTool,
  registerRouterCacheTool,
  registerLlmConsensusTool,
  registerLlmFromTemplateTool,
  registerLlmListTemplatesTool,
} from './toolHandlers.js';
import {
  registerPerfCriticalPathAnalysisTool,
  registerPerfBundleOptimizationTool,
  registerPerfRenderOptimizationTool,
  registerPerfNetworkOptimizationTool,
  registerPerfCoreWebVitalsTool,
  registerPerfMemoryOptimizationTool,
  registerPerfImageOptimizationTool,
  registerPerfVanillaJsOptimizationTool,
  registerPerfCssOptimizationTool,
  registerPerfProfilingStrategyTool,
  registerPerfAuditActionPlanTool,
  registerPerfServiceWorkerTool,
  registerPerfListTemplatesTool,
} from './performanceToolHandlers.js';
import { registerPerformanceDiagnosticsTools } from '../core/performanceDiagnostics.js';
import {
  registerPerfMeasureRealWorldTool,
  registerPerfProfileDeepTool,
  registerPerfMeasureNetworkTool,
  registerPerfApplyOptimizationTool,
  registerPerfStartMonitoringTool,
  registerPerfStopMonitoringTool,
  registerPerfAnalyzeBottlenecksRealTool,
  registerPerfDesignAuditTool,
} from './browserToolHandlers.js';
import {
  registerTestLaunchBrowserTool,
  registerTestNavigateTool,
  registerTestScreenshotTool,
  registerTestExecuteScriptTool,
  registerTestCloseSessionTool,
  registerTestListSessionsTool,
  registerTestRunAllTestsTool,
  registerTestRunAutomatedTool,
  registerTestOpenDashboardTool,
  registerTestClickTool,
  registerTestTypeTool,
  registerTestFillFormTool,
  registerTestHoverTool,
  registerTestWaitForTool,
} from './testingToolHandlers.js';
import { startExtensionAPIServer } from './extensionApiServer.js';

const logger = getLogger('mcp-server');

/**
 * Create and start the MCP server
 */
export async function createMCPServer(): Promise<McpServer> {
  logger.info('Initializing MCP server...');

  try {
    // Load configuration
    const config = loadAndValidateConfig();
    logger.info('Configuration loaded', {
      defaultProvider: config.router.defaultProvider,
      defaultModel: config.router.defaultModel,
      timeoutMs: config.router.timeoutMs,
    });

    // Create MCP server
    const server = new McpServer(
      {
        name: 'mcp-router-for-antigravity',
        version: '1.0.0',
      },
      {
        capabilities: {
          resources: {},
          tools: {},
        },
      }
    );

    logger.info('MCP server created');

    // Register tools
    registerLlmChatTool(server);
    registerListModelsTool(server);
    registerRouterHealthTool(server);
    registerRouterCacheTool(server);
    registerLlmConsensusTool(server);
    registerLlmFromTemplateTool(server);
    registerLlmListTemplatesTool(server);

    // Register performance optimization tools
    registerPerfCriticalPathAnalysisTool(server);
    registerPerfBundleOptimizationTool(server);
    registerPerfRenderOptimizationTool(server);
    registerPerfNetworkOptimizationTool(server);
    registerPerfCoreWebVitalsTool(server);
    registerPerfMemoryOptimizationTool(server);
    registerPerfImageOptimizationTool(server);
    registerPerfVanillaJsOptimizationTool(server);
    registerPerfCssOptimizationTool(server);
    registerPerfProfilingStrategyTool(server);
    registerPerfAuditActionPlanTool(server);
    registerPerfServiceWorkerTool(server);
    registerPerfListTemplatesTool(server);

    // Register performance diagnostics tools
    registerPerformanceDiagnosticsTools(server);

    // Register browser integration tools
    registerPerfMeasureRealWorldTool(server);
    registerPerfProfileDeepTool(server);
    registerPerfMeasureNetworkTool(server);
    registerPerfApplyOptimizationTool(server);
    registerPerfStartMonitoringTool(server);
    registerPerfStopMonitoringTool(server);
    registerPerfAnalyzeBottlenecksRealTool(server);
    registerPerfDesignAuditTool(server);

    // Register master testing system tools
    registerTestLaunchBrowserTool(server);
    registerTestNavigateTool(server);
    registerTestScreenshotTool(server);
    registerTestExecuteScriptTool(server);
    registerTestCloseSessionTool(server);
    registerTestListSessionsTool(server);
    registerTestRunAllTestsTool(server);
    registerTestRunAutomatedTool(server);
    registerTestOpenDashboardTool(server);

    // Register interaction tools
    registerTestClickTool(server);
    registerTestTypeTool(server);
    registerTestFillFormTool(server);
    registerTestHoverTool(server);
    registerTestWaitForTool(server);

    logger.info('All tools registered');

    return server;
  } catch (error) {
    logger.error('Failed to create MCP server', error);
    throw error;
  }
}

/**
 * Start the MCP server with stdio transport and extension API server
 */
export async function startMCPServer(): Promise<void> {
  try {
    const server = await createMCPServer();

    logger.info('Starting MCP server on stdio transport...');

    // Start the MCP server
    const transport = new StdioServerTransport();
    await server.connect(transport);

    logger.info('MCP server started successfully');

    // Start the extension API server (HTTP)
    const extensionAPIServer = startExtensionAPIServer();
    logger.info('Extension API server started');

    // Handle graceful shutdown
    process.on('SIGINT', () => {
      logger.info('Shutting down...');
      extensionAPIServer.close();
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      logger.info('Shutting down...');
      extensionAPIServer.close();
      process.exit(0);
    });
  } catch (error) {
    logger.error('Failed to start MCP server', error);
    process.exit(1);
  }
}
