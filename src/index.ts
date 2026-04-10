#!/usr/bin/env node

/**
 * MCP Router - Entry Point
 *
 * Production-grade MCP router that exposes one stable, resilient MCP server
 * for supported local clients, editors, and automation surfaces.
 */

import { startMCPServer } from './server/mcpServer.js';
import { getLogger } from './infra/logger.js';

const logger = getLogger('main');

export async function main() {
  try {
    logger.info('Starting MCP Router...');

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
