#!/usr/bin/env node

/**
 * WebSocket Bridge Startup Script
 *
 * Starts the extension bridge WebSocket server on port 9315
 * for Chrome extension communication.
 */

import { getExtensionBridge } from '../dist/browser/extensionBridge.js';
import { getLogger } from '../dist/infra/logger.js';

const logger = getLogger('ws-bridge-startup');
const PORT = 9315;

async function main() {
  try {
    logger.info('Starting WebSocket bridge...');

    const bridge = getExtensionBridge();
    await bridge.startServer(PORT);

    console.log(`WebSocket bridge listening on port ${PORT}`);
    logger.info('WebSocket bridge started successfully', { port: PORT });

    // Handle graceful shutdown
    process.on('SIGINT', () => {
      console.log('\nShutting down WebSocket bridge...');
      logger.info('Shutting down WebSocket bridge...');
      bridge.stopServer().then(() => {
        process.exit(0);
      });
    });

    process.on('SIGTERM', () => {
      console.log('\nShutting down WebSocket bridge...');
      logger.info('Shutting down WebSocket bridge...');
      bridge.stopServer().then(() => {
        process.exit(0);
      });
    });

    // Keep the process running
    setInterval(() => {
      // Heartbeat to keep process alive
    }, 10000);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('Failed to start WebSocket bridge:', msg);
    logger.error('Failed to start WebSocket bridge', error instanceof Error ? error : new Error(msg));
    process.exit(1);
  }
}

void main();
