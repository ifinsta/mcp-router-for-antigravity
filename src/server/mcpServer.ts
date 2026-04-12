/**
 * MCP Server Bootstrap
 *
 * Initializes and runs the MCP server for local client integration
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadAndValidateConfig } from '../infra/config.js';
import { getLogger } from '../infra/logger.js';
import { syncProvidersFromConfig } from '../core/registry.js';
import {
  registerLlmChatTool,
  registerListModelsTool,
  registerRouterHealthTool,
  registerRouterCacheTool,
  registerLlmConsensusTool,
  registerLlmFromTemplateTool,
  registerLlmListTemplatesTool,
} from './toolHandlers.js';
import { registerAssignmentTools } from './assignmentToolHandlers.js';
import { startExtensionAPIServer } from './extensionApiServer.js';
import { registerBrowserPublicTools } from './browserPublicToolHandlers.js';

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

    // Register provider adapters for all configured providers
    await syncProvidersFromConfig();
    logger.info('Provider adapters synchronized');

    // Create MCP server
    const server = new McpServer(
      {
        name: 'ifin-platform',
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

    registerBrowserPublicTools(server);

    // Register assignment mode tools
    registerAssignmentTools(server);

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
