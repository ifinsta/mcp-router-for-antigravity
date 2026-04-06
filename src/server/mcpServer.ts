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
} from './toolHandlers.js';

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

    logger.info('All tools registered');

    return server;
  } catch (error) {
    logger.error('Failed to create MCP server', error);
    throw error;
  }
}

/**
 * Start the MCP server with stdio transport
 */
export async function startMCPServer(): Promise<void> {
  try {
    const server = await createMCPServer();

    logger.info('Starting MCP server on stdio transport...');

    // Start the server
    const transport = new StdioServerTransport();
    await server.connect(transport);

    logger.info('MCP server started successfully');
  } catch (error) {
    logger.error('Failed to start MCP server', error);
    process.exit(1);
  }
}
