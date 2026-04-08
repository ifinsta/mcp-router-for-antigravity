/**
 * Browser Extension Bridge
 *
 * Enables deep browser integration through extension APIs, allowing
 * MCP Router to execute optimizations in browser context, stream
 * real-time metrics, and interact with page content directly.
 *
 * Communicates with the Chrome extension via a WebSocket server on
 * a configurable port (default 9315). The extension connects and
 * sends/receives JSON messages following the protocol defined in
 * chrome-extension/service-worker.js.
 */

import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import { getLogger } from '../infra/logger.js';

const logger = getLogger('extension-bridge');

// ============================================================================
// Core Types
// ============================================================================

/**
 * Extension message types
 */
export type ExtensionMessageType =
  | 'init-monitoring'
  | 'collect-metrics'
  | 'apply-optimization'
  | 'execute-script'
  | 'get-page-info'
  | 'start-profiling'
  | 'stop-profiling'
  | 'capture-heap-snapshot';

/**
 * Extension message
 */
export interface ExtensionMessage {
  type: ExtensionMessageType;
  data: Record<string, unknown>;
  requestId?: string;
}

/**
 * Extension response
 */
export interface ExtensionResponse {
  success: boolean;
  data: unknown;
  error?: string;
  requestId?: string;
}

/**
 * Extension connection
 */
export interface ExtensionConnection {
  extensionId: string;
  isConnected: boolean;
  lastHeartbeat: number;
  messageListeners: Map<string, (message: ExtensionMessage) => void>;
}

/**
 * Optimization that can be applied in browser
 */
export interface BrowserOptimization {
  type: string;
  script: string;
  description: string;
  expectedImpact: string;
  validationCheck: string;
}

/**
 * Event listener callback type
 */
export type ExtensionEventListener = (event: string, data: unknown) => void;

// ============================================================================
// Internal types for WebSocket protocol messages
// ============================================================================

/** Incoming message from the extension (parsed from JSON) */
interface WsIncomingMessage {
  type: string;
  id?: string;
  extensionId?: string;
  command?: string;
  params?: Record<string, unknown>;
  event?: string;
  data?: unknown;
  result?: unknown;
  error?: string;
  ts?: number;
  reconnect?: boolean;
}

/** Pending command waiting for a response */
interface PendingCommand {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Queued command waiting for extension reconnection */
interface QueuedCommand {
  extensionId: string;
  command: string;
  params: Record<string, unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timestamp: number;
  timeoutId: ReturnType<typeof setTimeout>;
}

/** Extension health state */
interface ExtensionHealth {
  lastMessageTime: number;
  lastPingTime: number;
  pendingPong: boolean;
  isStale: boolean;
}

// ============================================================================
// Pre-defined Browser Optimizations
// ============================================================================

const BROWSER_OPTIMIZATIONS: Record<string, BrowserOptimization> = {
  'critical-css-extraction': {
    type: 'critical-css-extraction',
    script: `
      (function() {
        const stylesheets = Array.from(document.querySelectorAll('link[rel="stylesheet"]'));
        const viewportHeight = window.innerHeight;
        const criticalStyles = [];
        stylesheets.forEach(sheet => {
          const sheetRules = Array.from(sheet.sheet?.cssRules || []);
          sheetRules.forEach(rule => {
            if (rule.style) {
              criticalStyles.push(rule.cssText);
            }
          });
        });
        return {
          criticalCSS: criticalStyles.join('\\n'),
          viewportHeight: viewportHeight,
          sheetCount: stylesheets.length
        };
      })();
    `,
    description: 'Extract critical CSS for above-fold content',
    expectedImpact: '0.5-1.5s LCP improvement',
    validationCheck: 'Check that critical elements are styled correctly',
  },
  'image-lazy-loading': {
    type: 'image-lazy-loading',
    script: `
      (function() {
        const images = Array.from(document.querySelectorAll('img:not([loading])'));
        images.forEach(img => {
          img.loading = 'lazy';
          img.decoding = 'async';
          img.style.opacity = '0';
          img.style.transition = 'opacity 0.3s ease-in';
          img.addEventListener('load', () => { img.style.opacity = '1'; });
        });
        return {
          lazyLoadedCount: images.length,
          totalImageCount: document.querySelectorAll('img').length
        };
      })();
    `,
    description: 'Implement lazy loading for all images',
    expectedImpact: '30-50% initial load reduction',
    validationCheck: 'Verify images load correctly when scrolled into view',
  },
  'font-display-optimization': {
    type: 'font-display-optimization',
    script: `
      (function() {
        const styleSheets = Array.from(document.styleSheets);
        const fontRules = [];
        styleSheets.forEach(sheet => {
          try {
            const rules = Array.from(sheet.cssRules || []);
            rules.forEach(rule => {
              if (rule instanceof CSSFontFaceRule) { fontRules.push(rule.cssText); }
            });
          } catch (e) {}
        });
        const styleElement = document.createElement('style');
        fontRules.forEach(rule => {
          if (rule.includes('@font-face')) {
            const modifiedRule = rule.includes('font-display')
              ? rule
              : rule.replace('{', '{ font-display: swap;');
            styleElement.textContent += modifiedRule + '\\n';
          }
        });
        document.head.appendChild(styleElement);
        return { optimizedFonts: fontRules.length, styleElementsInjected: 1 };
      })();
    `,
    description: 'Optimize font loading with font-display: swap',
    expectedImpact: '100-300ms FCP improvement',
    validationCheck: 'Ensure text remains visible during font loading',
  },
};

// ============================================================================
// Default configuration
// ============================================================================

const DEFAULT_WS_PORT = 9315;
const COMMAND_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2_000;
const RECONNECT_WAIT_MS = 30_000; // Max time to wait for extension reconnection (increased)
const HEALTH_CHECK_INTERVAL_MS = 10_000; // Check connection health every 10s
const STALE_COMMAND_MS = 60_000; // Clean up commands older than this

// ============================================================================
// Extension Bridge Implementation
// ============================================================================

/**
 * Browser Extension Bridge
 *
 * Provides communication with browser extensions for in-browser
 * optimization execution and real-time metrics streaming.
 * Runs a WebSocket server that the Chrome extension connects to.
 */
export class ExtensionBridge {
  private wss: WebSocketServer | null = null;
  private wsConnections: Map<string, WebSocket> = new Map();
  private connections: Map<string, ExtensionConnection> = new Map();
  private pendingCommands: Map<string, PendingCommand> = new Map();
  private eventListeners: Set<ExtensionEventListener> = new Set();
  private isServerRunning = false;
  private serverPort: number = DEFAULT_WS_PORT;

  // Command queue for disconnected extensions
  private commandQueue: QueuedCommand[] = [];

  // Health monitoring
  private extensionHealth: Map<string, ExtensionHealth> = new Map();
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Start the WebSocket server
   */
  async startServer(port?: number): Promise<void> {
    if (this.isServerRunning && this.wss) {
      logger.info('WebSocket server already running', { port: this.serverPort });
      return;
    }

    this.serverPort = port ?? DEFAULT_WS_PORT;

    return new Promise<void>((resolve, reject) => {
      try {
        this.wss = new WebSocketServer({ port: this.serverPort });

        this.wss.on('listening', () => {
          this.isServerRunning = true;
          logger.info('WebSocket server started', { port: this.serverPort });
          // Start health check interval
          this.startHealthCheck();
          resolve();
        });

        this.wss.on('error', (error: Error) => {
          // Handle EADDRINUSE gracefully - another instance is already running
          if ('code' in error && error.code === 'EADDRINUSE') {
            logger.info('WebSocket server already running on port (EADDRINUSE)', { port: this.serverPort });
            this.isServerRunning = true;
            resolve();
            return;
          }
          logger.error('WebSocket server error', error);
          if (!this.isServerRunning) {
            reject(error);
          }
        });

        this.wss.on('connection', (ws: WebSocket) => {
          logger.info('New WebSocket connection received');
          this.handleNewConnection(ws);
        });
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.error('Failed to create WebSocket server', err);
        reject(err);
      }
    });
  }

  /**
   * Stop the WebSocket server
   */
  async stopServer(): Promise<void> {
    if (!this.wss) {
      return;
    }

    logger.info('Stopping WebSocket server');

    // Reject all pending commands
    for (const [id, pending] of this.pendingCommands.entries()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('WebSocket server shutting down'));
      this.pendingCommands.delete(id);
    }

    // Close all connections
    for (const [extId, ws] of this.wsConnections.entries()) {
      try {
        ws.close(1000, 'Server shutting down');
      } catch {
        // ignore close errors during shutdown
      }
      this.wsConnections.delete(extId);
      this.connections.delete(extId);
    }

    // Stop health check
    this.stopHealthCheck();

    // Reject all queued commands
    for (const cmd of this.commandQueue) {
      clearTimeout(cmd.timeoutId);
      cmd.reject(new Error('WebSocket server shutting down'));
    }
    this.commandQueue = [];

    return new Promise<void>((resolve) => {
      if (!this.wss) {
        resolve();
        return;
      }
      this.wss.close(() => {
        this.wss = null;
        this.isServerRunning = false;
        logger.info('WebSocket server stopped');
        resolve();
      });
    });
  }

  /**
   * Check if the WebSocket server is running
   */
  isRunning(): boolean {
    return this.isServerRunning;
  }

  /**
   * Mark the bridge as using an externally running server.
   * This prevents the bridge from trying to start its own server.
   */
  markExternalServerRunning(port: number = DEFAULT_WS_PORT): void {
    this.isServerRunning = true;
    this.serverPort = port;
    logger.info('Marked as using external WebSocket server', { port });
  }

  /**
   * Get list of connected extension IDs
   */
  getConnectedExtensions(): string[] {
    return Array.from(this.wsConnections.keys());
  }

  /**
   * Check if a specific extension is connected
   */
  isExtensionConnected(extensionId: string): boolean {
    const ws = this.wsConnections.get(extensionId);
    return ws !== undefined && ws.readyState === WebSocket.OPEN;
  }

  /**
   * Wait for an extension to reconnect (with timeout).
   * Returns true if extension connected, false if timeout.
   */
  async waitForReconnect(extensionId: string, timeoutMs: number = 5_000): Promise<boolean> {
    const start = Date.now();
    const pollInterval = 250;

    while (Date.now() - start < timeoutMs) {
      const ws = this.wsConnections.get(extensionId);
      if (ws !== undefined && ws.readyState === WebSocket.OPEN) {
        return true;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, pollInterval));
    }

    return false;
  }

  /**
   * Send a command to the extension and await the response.
   * Returns whatever the extension puts in the `result` field.
   * Includes retry logic with reconnection wait and command queuing.
   */
  async sendCommand(
    extensionId: string,
    command: string,
    params: Record<string, unknown> = {}
  ): Promise<unknown> {
    // Check if extension is connected
    const ws = this.wsConnections.get(extensionId);
    if (ws === undefined || ws.readyState !== WebSocket.OPEN) {
      // Extension is disconnected - queue the command and wait for reconnection
      logger.info('Extension disconnected, queuing command', { extensionId, command });
      return this.queueCommand(extensionId, command, params);
    }

    // Extension is connected - try to send with retry
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const wsNow = this.wsConnections.get(extensionId);
        if (wsNow === undefined || wsNow.readyState !== WebSocket.OPEN) {
          throw new Error(`Extension '${extensionId}' is not connected`);
        }

        return await this.sendCommandInternal(wsNow, extensionId, command, params);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const isConnectionError = lastError.message.includes('not connected') ||
          lastError.message.includes('disconnected');

        if (isConnectionError && attempt < MAX_RETRIES - 1) {
          logger.warn(`Command '${command}' failed, will retry`, {
            extensionId,
            attempt: attempt + 1,
            error: lastError.message
          });
          await new Promise<void>((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
          continue;
        }

        throw lastError;
      }
    }

    throw lastError ?? new Error(`Command '${command}' failed after ${MAX_RETRIES} retries`);
  }

  /**
   * Queue a command for later execution when extension reconnects.
   */
  private queueCommand(
    extensionId: string,
    command: string,
    params: Record<string, unknown>
  ): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      // Set up timeout for the queued command
      const timeoutId = setTimeout(() => {
        // Remove from queue
        const idx = this.commandQueue.findIndex(c => c.timeoutId === timeoutId);
        if (idx !== -1) {
          this.commandQueue.splice(idx, 1);
        }
        reject(new Error(`Extension '${extensionId}' did not reconnect within ${RECONNECT_WAIT_MS / 1000}s`));
      }, RECONNECT_WAIT_MS);

      // Add to queue
      const queuedCmd: QueuedCommand = {
        extensionId,
        command,
        params,
        resolve: resolve as (value: unknown) => void,
        reject,
        timestamp: Date.now(),
        timeoutId,
      };

      this.commandQueue.push(queuedCmd);
      logger.info('Command queued', { extensionId, command, queueLength: this.commandQueue.length });

      // Clean up stale commands (older than 30s)
      this.cleanupStaleCommands();
    });
  }

  /**
   * Flush queued commands for a reconnected extension.
   */
  private async flushCommandQueue(extensionId: string): Promise<void> {
    const pending = this.commandQueue.filter(c => c.extensionId === extensionId);
    if (pending.length === 0) {
      return;
    }

    // Remove from main queue
    this.commandQueue = this.commandQueue.filter(c => c.extensionId !== extensionId);

    logger.info('Flushing queued commands for reconnected extension', {
      extensionId,
      commandCount: pending.length
    });

    // Execute each command
    for (const cmd of pending) {
      clearTimeout(cmd.timeoutId);
      try {
        const ws = this.wsConnections.get(extensionId);
        if (ws === undefined || ws.readyState !== WebSocket.OPEN) {
          cmd.reject(new Error(`Extension '${extensionId}' disconnected during flush`));
          continue;
        }
        const result = await this.sendCommandInternal(ws, extensionId, cmd.command, cmd.params);
        cmd.resolve(result);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        cmd.reject(new Error(errMsg));
      }
    }
  }

  /**
   * Clean up stale queued commands (older than STALE_COMMAND_MS).
   */
  private cleanupStaleCommands(): void {
    const now = Date.now();
    const staleThreshold = now - STALE_COMMAND_MS;

    const staleCommands = this.commandQueue.filter(c => c.timestamp < staleThreshold);
    for (const cmd of staleCommands) {
      clearTimeout(cmd.timeoutId);
      cmd.reject(new Error('Command expired (stale)'));
    }

    this.commandQueue = this.commandQueue.filter(c => c.timestamp >= staleThreshold);

    if (staleCommands.length > 0) {
      logger.info('Cleaned up stale commands', { count: staleCommands.length });
    }
  }

  /**
   * Start health check interval.
   */
  private startHealthCheck(): void {
    if (this.healthCheckInterval !== null) {
      return;
    }

    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
    }, HEALTH_CHECK_INTERVAL_MS);

    logger.info('Health check started', { intervalMs: HEALTH_CHECK_INTERVAL_MS });
  }

  /**
   * Stop health check interval.
   */
  private stopHealthCheck(): void {
    if (this.healthCheckInterval !== null) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  /**
   * Perform health check on all connected extensions.
   */
  private performHealthCheck(): void {
    const now = Date.now();

    for (const [extensionId, ws] of this.wsConnections.entries()) {
      if (ws.readyState !== WebSocket.OPEN) {
        continue;
      }

      let health = this.extensionHealth.get(extensionId);
      if (health === undefined) {
        health = {
          lastMessageTime: now,
          lastPingTime: 0,
          pendingPong: false,
          isStale: false,
        };
        this.extensionHealth.set(extensionId, health);
      }

      const timeSinceLastMessage = now - health.lastMessageTime;

      // If no message for 10 seconds, send a ping
      if (timeSinceLastMessage > HEALTH_CHECK_INTERVAL_MS && !health.pendingPong) {
        logger.info('Sending health ping to extension', { extensionId });
        health.lastPingTime = now;
        health.pendingPong = true;

        try {
          ws.send(JSON.stringify({ type: 'ping', ts: now }));
        } catch {
          logger.warn('Failed to send health ping', { extensionId });
        }
      }

      // If ping was sent more than 5 seconds ago and no pong, mark as unstable
      if (health.pendingPong && now - health.lastPingTime > 5_000) {
        logger.warn('Extension health check failed - no pong received', { extensionId });
        health.isStale = true;
        // Don't disconnect yet - the command queue will handle reconnection
      }
    }

    // Clean up stale commands periodically
    this.cleanupStaleCommands();
  }

  /**
   * Internal implementation of sendCommand without retry logic.
   */
  private async sendCommandInternal(
    ws: WebSocket,
    extensionId: string,
    command: string,
    params: Record<string, unknown>
  ): Promise<unknown> {
    const id = randomUUID();

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingCommands.delete(id);
        reject(new Error(`Command '${command}' timed out after ${COMMAND_TIMEOUT_MS}ms`));
      }, COMMAND_TIMEOUT_MS);

      this.pendingCommands.set(id, { resolve, reject, timer });

      const payload = JSON.stringify({ id, type: 'command', command, params });

      try {
        ws.send(payload, (err) => {
          if (err) {
            clearTimeout(timer);
            this.pendingCommands.delete(id);
            reject(new Error(`Failed to send command '${command}': ${err.message}`));
          }
        });
      } catch (error) {
        clearTimeout(timer);
        this.pendingCommands.delete(id);
        const msg = error instanceof Error ? error.message : String(error);
        reject(new Error(`Failed to send command '${command}': ${msg}`));
      }
    });
  }

  /**
   * Connect to browser extension (legacy API — kept for compatibility).
   * In the WebSocket model the extension connects to us, so this simply
   * returns the existing connection or waits briefly for one to appear.
   */
  async connect(extensionId: string): Promise<ExtensionConnection> {
    logger.info('Connecting to extension', { extensionId });

    const existing = this.connections.get(extensionId);
    if (existing) {
      return existing;
    }

    const connection: ExtensionConnection = {
      extensionId,
      isConnected: false,
      lastHeartbeat: Date.now(),
      messageListeners: new Map(),
    };

    this.connections.set(extensionId, connection);
    logger.info('Extension connection registered (awaiting WebSocket)', { extensionId });
    return connection;
  }

  /**
   * Disconnect from browser extension
   */
  async disconnect(extensionId: string): Promise<void> {
    logger.info('Disconnecting from extension', { extensionId });

    const ws = this.wsConnections.get(extensionId);
    if (ws) {
      try {
        ws.close(1000, 'Disconnect requested');
      } catch {
        // ignore
      }
      this.wsConnections.delete(extensionId);
    }
    this.connections.delete(extensionId);

    logger.info('Disconnected from extension', { extensionId });
  }

  /**
   * Send message to extension (legacy API — wraps sendCommand)
   */
  async sendMessage(
    extensionId: string,
    message: ExtensionMessage
  ): Promise<ExtensionResponse> {
    logger.debug('Sending message to extension', { extensionId, messageType: message.type });

    try {
      const result = await this.sendCommand(extensionId, message.type, message.data);
      return {
        success: true,
        data: result,
        ...(message.requestId !== undefined ? { requestId: message.requestId } : {}),
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        data: null,
        error: msg,
        ...(message.requestId !== undefined ? { requestId: message.requestId } : {}),
      };
    }
  }

  /**
   * Add an event listener for extension-pushed events
   */
  addEventListener(listener: ExtensionEventListener): void {
    this.eventListeners.add(listener);
  }

  /**
   * Remove an event listener
   */
  removeEventListener(listener: ExtensionEventListener): void {
    this.eventListeners.delete(listener);
  }

  /**
   * Add message listener (legacy API)
   */
  addMessageListener(
    callback: (message: ExtensionMessage) => void
  ): string {
    const listenerId = randomUUID();
    const connection = Array.from(this.connections.values())[0];
    if (connection) {
      connection.messageListeners.set(listenerId, callback);
    }
    return listenerId;
  }

  /**
   * Remove message listener (legacy API)
   */
  removeMessageListener(listenerId: string): void {
    for (const connection of this.connections.values()) {
      connection.messageListeners.delete(listenerId);
    }
  }

  /**
   * Start real-time metrics streaming
   */
  async startMetricsStreaming(
    callback: (metrics: Record<string, number>) => void
  ): Promise<void> {
    logger.info('Starting metrics streaming');

    const extensionIds = this.getConnectedExtensions();
    const extensionId = extensionIds[0];
    if (extensionId === undefined) {
      throw new Error('No extension connection established');
    }

    // Register an event listener that forwards webvitals-update events
    const listener: ExtensionEventListener = (event, data) => {
      if (event === 'webvitals-update' && data !== null && typeof data === 'object') {
        callback(data as Record<string, number>);
      }
    };
    this.addEventListener(listener);

    // Tell the extension to start monitoring
    await this.sendCommand(extensionId, 'init-monitoring', { streaming: true });
  }

  /**
   * Stop metrics streaming
   */
  async stopMetricsStreaming(): Promise<void> {
    logger.info('Stopping metrics streaming');
    // Clear all event listeners (simple approach)
    this.eventListeners.clear();
  }

  /**
   * Execute optimization script in browser
   */
  async executeOptimization(
    optimizationType: string
  ): Promise<{
    success: boolean;
    beforeMetrics: Record<string, number>;
    afterMetrics: Record<string, number>;
    improvements: Record<string, number>;
  }> {
    logger.info('Executing optimization', { optimizationType });

    const optimization = BROWSER_OPTIMIZATIONS[optimizationType];
    if (!optimization) {
      throw new Error(`Unknown optimization type: ${optimizationType}`);
    }

    const extensionIds = this.getConnectedExtensions();
    const extensionId = extensionIds[0];
    if (extensionId === undefined) {
      throw new Error('No extension connection established');
    }

    const emptyMetrics: Record<string, number> = {};

    try {
      const result = await this.sendCommand(extensionId, 'executeScript', {
        code: optimization.script,
      });

      return {
        success: true,
        beforeMetrics: emptyMetrics,
        afterMetrics: emptyMetrics,
        improvements: {},
      };
    } catch (error) {
      logger.error('Optimization execution failed', error instanceof Error ? error : new Error(String(error)));
      return {
        success: false,
        beforeMetrics: emptyMetrics,
        afterMetrics: emptyMetrics,
        improvements: {},
      };
    }
  }

  /**
   * Get page information
   */
  async getPageInfo(): Promise<Record<string, unknown>> {
    logger.info('Getting page information');

    const extensionIds = this.getConnectedExtensions();
    const extensionId = extensionIds[0];
    if (extensionId === undefined) {
      throw new Error('No extension connection established');
    }

    const result = await this.sendCommand(extensionId, 'getDomTree', {});
    return result as Record<string, unknown>;
  }

  /**
   * Start profiling
   */
  async startProfiling(config: {
    duration: number;
    sampleRate: number;
  }): Promise<string> {
    logger.info('Starting profiling', { config });

    const extensionIds = this.getConnectedExtensions();
    const extensionId = extensionIds[0];
    if (extensionId === undefined) {
      throw new Error('No extension connection established');
    }

    const result = await this.sendCommand(extensionId, 'startProfiling', {
      ...config,
    });
    const resultObj = result as Record<string, unknown> | null;
    return (resultObj?.['profilingId'] as string) ?? randomUUID();
  }

  /**
   * Stop profiling
   */
  async stopProfiling(profileId: string): Promise<unknown> {
    logger.info('Stopping profiling', { profileId });

    const extensionIds = this.getConnectedExtensions();
    const extensionId = extensionIds[0];
    if (extensionId === undefined) {
      throw new Error('No extension connection established');
    }

    return await this.sendCommand(extensionId, 'stopProfiling', {
      profilingId: profileId,
    });
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  /**
   * Handle a new WebSocket connection
   */
  private handleNewConnection(ws: WebSocket): void {
    // The extension hasn't identified itself yet. We hold the socket
    // and wait for the 'extension-connect' message.
    let assignedExtensionId: string | null = null;

    ws.on('message', (raw: Buffer | string) => {
      let msg: WsIncomingMessage;
      try {
        const text = typeof raw === 'string' ? raw : raw.toString('utf-8');
        msg = JSON.parse(text) as WsIncomingMessage;
      } catch {
        logger.warn('Failed to parse incoming WebSocket message');
        return;
      }

      this.handleMessage(ws, msg, assignedExtensionId, (extId) => {
        assignedExtensionId = extId;
      });
    });

    ws.on('close', () => {
      if (assignedExtensionId !== null) {
        logger.info('Extension disconnected', { extensionId: assignedExtensionId });
        this.handleDisconnect(assignedExtensionId);
      }
    });

    ws.on('error', (error: Error) => {
      logger.error('WebSocket connection error', error, {
        ...(assignedExtensionId !== null ? { extensionId: assignedExtensionId } : {}),
      });
      if (assignedExtensionId !== null) {
        this.handleDisconnect(assignedExtensionId);
      }
    });
  }

  /**
   * Handle an incoming parsed message
   */
  private handleMessage(
    ws: WebSocket,
    msg: WsIncomingMessage,
    currentExtensionId: string | null,
    setExtensionId: (id: string) => void
  ): void {
    switch (msg.type) {
      case 'extension-connect': {
        const extId = msg.extensionId;
        if (typeof extId !== 'string' || extId.length === 0) {
          logger.warn('Received extension-connect without valid extensionId');
          return;
        }

        const isReconnect = msg.reconnect === true;

        // If there's already a connection with this ID, close the old one
        const existingWs = this.wsConnections.get(extId);
        if (existingWs !== undefined && existingWs !== ws) {
          logger.info('Extension reconnecting - replacing existing connection', {
            extensionId: extId,
            isReconnect
          });
          try {
            existingWs.close(1000, 'Replaced by new connection');
          } catch {
            // ignore
          }
        }

        this.wsConnections.set(extId, ws);
        setExtensionId(extId);

        // Update or create the ExtensionConnection record
        const conn: ExtensionConnection = {
          extensionId: extId,
          isConnected: true,
          lastHeartbeat: Date.now(),
          messageListeners: this.connections.get(extId)?.messageListeners ?? new Map(),
        };
        this.connections.set(extId, conn);

        // Initialize/update health tracking
        this.extensionHealth.set(extId, {
          lastMessageTime: Date.now(),
          lastPingTime: 0,
          pendingPong: false,
          isStale: false,
        });

        logger.info('Extension connected', { extensionId: extId, isReconnect });

        // Always flush queued commands on any new connection
        // This handles the case where SW restarts and hasConnectedBefore resets
        this.flushCommandQueue(extId).catch(err => {
          logger.error('Failed to flush command queue', err instanceof Error ? err : new Error(String(err)), { extensionId: extId });
        });
        break;
      }

      case 'response': {
        const id = msg.id;
        if (typeof id !== 'string') return;
        const pending = this.pendingCommands.get(id);
        if (pending !== undefined) {
          clearTimeout(pending.timer);
          this.pendingCommands.delete(id);
          pending.resolve(msg.result);
        }
        break;
      }

      case 'error': {
        const id = msg.id;
        if (typeof id !== 'string') return;
        const pending = this.pendingCommands.get(id);
        if (pending !== undefined) {
          clearTimeout(pending.timer);
          this.pendingCommands.delete(id);
          pending.reject(new Error(msg.error ?? 'Unknown extension error'));
        }
        break;
      }

      case 'event': {
        const eventName = msg.event;
        if (typeof eventName === 'string') {
          for (const listener of this.eventListeners) {
            try {
              listener(eventName, msg.data);
            } catch (err) {
              logger.error('Event listener error', err instanceof Error ? err : new Error(String(err)));
            }
          }
        }
        break;
      }

      case 'heartbeat': {
        // Update last heartbeat timestamp
        if (currentExtensionId !== null) {
          const conn = this.connections.get(currentExtensionId);
          if (conn) {
            conn.lastHeartbeat = Date.now();
          }
          // Update health tracking
          const health = this.extensionHealth.get(currentExtensionId);
          if (health) {
            health.lastMessageTime = Date.now();
          }
        }
        break;
      }

      case 'pong': {
        // Handle pong response from health ping
        if (currentExtensionId !== null) {
          const health = this.extensionHealth.get(currentExtensionId);
          if (health) {
            health.pendingPong = false;
            health.isStale = false;
            health.lastMessageTime = Date.now();
            logger.debug('Received pong from extension', { extensionId: currentExtensionId });
          }
        }
        break;
      }

      default:
        logger.debug('Received unknown message type', { type: msg.type });
        break;
    }
  }

  /**
   * Handle extension disconnect — clean up connection and reject pending commands
   */
  private handleDisconnect(extensionId: string): void {
    this.wsConnections.delete(extensionId);

    const conn = this.connections.get(extensionId);
    if (conn) {
      conn.isConnected = false;
    }
    this.connections.delete(extensionId);

    // Reject all pending commands (we can't tell which belong to this extension,
    // but in practice there's typically one extension)
    for (const [id, pending] of this.pendingCommands.entries()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(`Extension '${extensionId}' disconnected`));
      this.pendingCommands.delete(id);
    }
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let extensionBridgeInstance: ExtensionBridge | null = null;

/**
 * Get singleton extension bridge instance
 */
export function getExtensionBridge(): ExtensionBridge {
  if (!extensionBridgeInstance) {
    extensionBridgeInstance = new ExtensionBridge();
  }
  return extensionBridgeInstance;
}

/**
 * Get available optimizations
 */
export function getAvailableOptimizations(): Record<string, BrowserOptimization> {
  return BROWSER_OPTIMIZATIONS;
}
