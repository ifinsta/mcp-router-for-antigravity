#!/usr/bin/env node

/**
 * MCP Router for Antigravity - Entry Point
 *
 * Production-grade MCP router that allows Antigravity to use external LLMs
 * through one stable, resilient MCP server.
 */

import { startMCPServer } from './server/mcpServer.js';
import { getLogger } from './infra/logger.js';

const logger = getLogger('main');

export async function main() {
  try {
    logger.info('Starting MCP Router for Antigravity...');

    // Start the MCP server
    await startMCPServer();

    logger.info('MCP Router started successfully');
  } catch (error) {
    logger.error('Failed to start MCP Router', error);
    process.exit(1);
  }
}

// Start the application
void main();
