/**
 * CDP Client - Direct Chrome DevTools Protocol Connection
 *
 * Provides reliable browser control operations via direct CDP connection,
 * bypassing the extension's service worker reliability issues.
 *
 * CDP handles: navigation, screenshots, viewport changes, script execution,
 * network monitoring, profiling
 *
 * Extension handles: design audit, web vitals collection, DOM inspection,
 * user scroll simulation, form interactions (needs content script)
 */

import { WebSocket } from 'ws';
import { createConnection } from 'node:net';
import { getLogger } from '../infra/logger.js';

const logger = getLogger('cdp-client');

// ============================================================================
// Types
// ============================================================================

/**
 * CDP Target information from /json endpoint
 */
export interface CDPTarget {
  id: string;
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl: string;
}

/**
 * CDP Client interface
 */
export interface CDPClient {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  on(event: string, handler: (params: unknown) => void): void;
  off(event: string, handler: (params: unknown) => void): void;
  close(): void;
  isConnected(): boolean;
  // High-level operations
  navigateTo(url: string, options?: { timeout?: number; waitUntil?: 'load' | 'DOMContentLoaded' | 'networkIdle' }): Promise<{ url: string; loadTime: number }>;
  captureScreenshot(options?: CDPScreenshotOptions): Promise<string>;
  setViewport(config: ViewportConfig): Promise<void>;
  executeScript(expression: string, options?: { returnByValue?: boolean; awaitPromise?: boolean; timeout?: number }): Promise<unknown>;
  enableNetwork(): Promise<void>;
  disableNetwork(): Promise<void>;
  getNetworkRequests(): NetworkRequest[];
  startCPUProfile(): Promise<void>;
  stopCPUProfile(): Promise<unknown>;
  getPerformanceMetrics(): Promise<PerformanceMetric[]>;
}

/**
 * Viewport configuration for emulation
 */
export interface ViewportConfig {
  width: number;
  height: number;
  deviceScaleFactor?: number;
  mobile?: boolean;
  scale?: number;
  screenWidth?: number;
  screenHeight?: number;
  positionX?: number;
  positionY?: number;
  dontSetVisibleSize?: boolean;
  screenOrientation?: { type: 'portraitPrimary' | 'portraitSecondary' | 'landscapePrimary' | 'landscapeSecondary'; angle: number };
  viewport?: { x: number; y: number; width: number; height: number };
}

/**
 * Screenshot options
 */
export interface CDPScreenshotOptions {
  format?: 'png' | 'jpeg';
  quality?: number;
  fullPage?: boolean;
  clip?: { x: number; y: number; width: number; height: number };
  fromSurface?: boolean;
  captureBeyondViewport?: boolean;
}

/**
 * Network request tracked during profiling
 */
export interface NetworkRequest {
  requestId: string;
  url: string;
  method: string;
  status: number;
  mimeType: string;
  encodedDataLength: number;
  timing?: {
    requestTime: number;
    proxyStart: number;
    proxyEnd: number;
    dnsStart: number;
    dnsEnd: number;
    connectStart: number;
    connectEnd: number;
    sslStart: number;
    sslEnd: number;
    workerStart: number;
    workerReady: number;
    sendStart: number;
    sendEnd: number;
    receiveHeadersEnd: number;
  };
}

/**
 * Performance metric from CDP
 */
export interface PerformanceMetric {
  name: string;
  value: number;
}

// ============================================================================
// Internal Types
// ============================================================================

interface PendingCDPCommand {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface CDPEventHandlers {
  [event: string]: Set<(params: unknown) => void>;
}

// ============================================================================
// CDP Client Implementation
// ============================================================================

/**
 * Direct CDP connection to a Chrome target.
 * Uses WebSocket for command/response protocol.
 */
class CDPClientImpl implements CDPClient {
  private ws: WebSocket | null = null;
  private targetId: string;
  private pendingCommands: Map<number, PendingCDPCommand> = new Map();
  private eventHandlers: CDPEventHandlers = {};
  private nextId: number = 1;
  private connected: boolean = false;
  private networkRequests: Map<string, NetworkRequest> = new Map();
  private trackingNetwork: boolean = false;

  constructor(targetId: string) {
    this.targetId = targetId;
  }

  /**
   * Connect to a target via WebSocket.
   */
  async connect(wsUrl: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('CDP WebSocket connection timeout'));
      }, 10_000);

      this.ws = new WebSocket(wsUrl);

      this.ws.on('open', () => {
        clearTimeout(timeout);
        this.connected = true;
        logger.debug('CDP WebSocket connected', { targetId: this.targetId });
        resolve();
      });

      this.ws.on('message', (data: Buffer) => {
        this.handleMessage(data);
      });

      this.ws.on('error', (error: Error) => {
        clearTimeout(timeout);
        logger.error('CDP WebSocket error', error, { targetId: this.targetId });
        this.connected = false;
      });

      this.ws.on('close', () => {
        this.connected = false;
        logger.debug('CDP WebSocket closed', { targetId: this.targetId });
        // Reject all pending commands
        for (const [id, pending] of this.pendingCommands.entries()) {
          clearTimeout(pending.timer);
          pending.reject(new Error('CDP connection closed'));
          this.pendingCommands.delete(id);
        }
      });
    });
  }

  /**
   * Handle incoming CDP message.
   */
  private handleMessage(data: Buffer): void {
    try {
      const msg = JSON.parse(data.toString()) as { id?: number; method?: string; params?: unknown; result?: unknown; error?: { message: string } };

      // Handle response to a command
      if (msg.id !== undefined) {
        const pending = this.pendingCommands.get(msg.id);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingCommands.delete(msg.id);
          if (msg.error) {
            pending.reject(new Error(`CDP error: ${msg.error.message}`));
          } else {
            pending.resolve(msg.result);
          }
        }
        return;
      }

      // Handle event
      if (msg.method !== undefined && msg.params !== undefined) {
        // Track network events internally
        this.handleInternalEvent(msg.method, msg.params);

        // Dispatch to registered handlers
        const handlers = this.eventHandlers[msg.method];
        if (handlers) {
          for (const handler of handlers) {
            try {
              handler(msg.params);
            } catch (err) {
              logger.error('CDP event handler error', err instanceof Error ? err : new Error(String(err)));
            }
          }
        }
      }
    } catch (err) {
      logger.error('Failed to parse CDP message', err instanceof Error ? err : new Error(String(err)));
    }
  }

  /**
   * Handle internal event tracking (network requests, etc.)
   */
  private handleInternalEvent(method: string, params: unknown): void {
    if (!this.trackingNetwork) return;

    if (method === 'Network.requestWillBeSent') {
      const p = params as { requestId: string; request: { url: string; method: string } };
      this.networkRequests.set(p.requestId, {
        requestId: p.requestId,
        url: p.request.url,
        method: p.request.method,
        status: 0,
        mimeType: '',
        encodedDataLength: 0,
      });
    } else if (method === 'Network.responseReceived') {
      const p = params as { requestId: string; response: { url: string; status: number; mimeType: string } };
      const req = this.networkRequests.get(p.requestId);
      if (req) {
        req.status = p.response.status;
        req.mimeType = p.response.mimeType;
      }
    } else if (method === 'Network.loadingFinished') {
      const p = params as { requestId: string; encodedDataLength: number };
      const req = this.networkRequests.get(p.requestId);
      if (req && p.encodedDataLength !== undefined) {
        req.encodedDataLength = p.encodedDataLength;
      }
    }
  }

  /**
   * Send a CDP command and await the response.
   */
  async send(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (!this.ws || !this.connected) {
      throw new Error('CDP client not connected');
    }

    const id = this.nextId++;

    return new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingCommands.delete(id);
        reject(new Error(`CDP command '${method}' timed out`));
      }, 30_000);

      this.pendingCommands.set(id, { resolve, reject, timer: timeout });

      const payload = JSON.stringify({ id, method, params: params ?? {} });
      this.ws!.send(payload, (err) => {
        if (err) {
          clearTimeout(timeout);
          this.pendingCommands.delete(id);
          reject(new Error(`Failed to send CDP command '${method}': ${err.message}`));
        }
      });
    });
  }

  /**
   * Register an event handler.
   */
  on(event: string, handler: (params: unknown) => void): void {
    if (!this.eventHandlers[event]) {
      this.eventHandlers[event] = new Set();
    }
    this.eventHandlers[event].add(handler);
  }

  /**
   * Remove an event handler.
   */
  off(event: string, handler: (params: unknown) => void): void {
    const handlers = this.eventHandlers[event];
    if (handlers) {
      handlers.delete(handler);
    }
  }

  /**
   * Check if the connection is active.
   */
  isConnected(): boolean {
    return this.connected && this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Close the CDP connection.
   */
  close(): void {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this.connected = false;

    // Reject all pending commands
    for (const [id, pending] of this.pendingCommands.entries()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('CDP client closed'));
      this.pendingCommands.delete(id);
    }
  }

  // ========================================================================
  // High-Level CDP Operations
  // ========================================================================

  /**
   * Navigate to a URL and wait for load event.
   */
  async navigateTo(url: string, options?: { timeout?: number; waitUntil?: 'load' | 'DOMContentLoaded' | 'networkIdle' }): Promise<{ url: string; loadTime: number }> {
    const start = Date.now();
    const timeout = options?.timeout ?? 30_000;

    // Enable Page domain
    await this.send('Page.enable');

    // Start navigation
    const navResult = await this.send('Page.navigate', { url }) as { frameId: string; loaderId: string; errorText?: string };
    if (navResult.errorText) {
      throw new Error(`Navigation failed: ${navResult.errorText}`);
    }

    // Wait for load event
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Navigation timeout after ${timeout}ms`));
      }, timeout);

      const handler = (params: unknown) => {
        const p = params as { frameId?: string };
        if (p.frameId === navResult.frameId || p.frameId === undefined) {
          clearTimeout(timer);
          this.off('Page.loadEventFired', handler);
          resolve({ url, loadTime: Date.now() - start });
        }
      };

      this.on('Page.loadEventFired', handler);
    });
  }

  /**
   * Capture a screenshot.
   */
  async captureScreenshot(options: CDPScreenshotOptions = {}): Promise<string> {
    const params: Record<string, unknown> = {
      format: options.format ?? 'png',
      fromSurface: options.fromSurface ?? true,
      captureBeyondViewport: options.captureBeyondViewport ?? options.fullPage ?? false,
    };

    if (options.quality !== undefined && options.format === 'jpeg') {
      params['quality'] = options.quality;
    }

    if (options.clip !== undefined) {
      params['clip'] = options.clip;
    }

    const result = await this.send('Page.captureScreenshot', params) as { data: string };
    return result.data;
  }

  /**
   * Set viewport dimensions for emulation.
   */
  async setViewport(config: ViewportConfig): Promise<void> {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width: config.width,
      height: config.height,
      deviceScaleFactor: config.deviceScaleFactor ?? 1,
      mobile: config.mobile ?? false,
      scale: config.scale,
      screenWidth: config.screenWidth ?? config.width,
      screenHeight: config.screenHeight ?? config.height,
      positionX: config.positionX ?? 0,
      positionY: config.positionY ?? 0,
      dontSetVisibleSize: config.dontSetVisibleSize ?? false,
      screenOrientation: config.screenOrientation,
      viewport: config.viewport,
    });

    // Also set the visible size
    await this.send('Emulation.setVisibleSize', { width: config.width, height: config.height });
  }

  /**
   * Execute JavaScript in the page context.
   */
  async executeScript(expression: string, options?: { returnByValue?: boolean; awaitPromise?: boolean; timeout?: number }): Promise<unknown> {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: options?.returnByValue ?? true,
      awaitPromise: options?.awaitPromise ?? false,
      timeout: options?.timeout,
    }) as { result?: { value?: unknown; description?: string; type?: string }; exceptionDetails?: { text: string } };

    if (result.exceptionDetails) {
      throw new Error(`Script execution error: ${result.exceptionDetails.text}`);
    }

    return result.result?.value;
  }

  /**
   * Enable network tracking.
   */
  async enableNetwork(): Promise<void> {
    await this.send('Network.enable');
    this.trackingNetwork = true;
    this.networkRequests.clear();
  }

  /**
   * Disable network tracking.
   */
  async disableNetwork(): Promise<void> {
    await this.send('Network.disable');
    this.trackingNetwork = false;
  }

  /**
   * Get network requests captured during tracking.
   */
  getNetworkRequests(): NetworkRequest[] {
    return Array.from(this.networkRequests.values());
  }

  /**
   * Start CPU profiling.
   */
  async startCPUProfile(): Promise<void> {
    await this.send('Profiler.enable');
    await this.send('Profiler.start');
  }

  /**
   * Stop CPU profiling and get the profile.
   */
  async stopCPUProfile(): Promise<unknown> {
    const result = await this.send('Profiler.stop') as { profile: unknown };
    await this.send('Profiler.disable');
    return result.profile;
  }

  /**
   * Get performance metrics.
   */
  async getPerformanceMetrics(): Promise<PerformanceMetric[]> {
    await this.send('Performance.enable');
    const result = await this.send('Performance.getMetrics') as { metrics: Array<{ name: string; value: number }> };
    await this.send('Performance.disable');
    return result.metrics ?? [];
  }

  /**
   * Get the target ID.
   */
  getTargetId(): string {
    return this.targetId;
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Get all CDP targets from Chrome's debugging port.
 */
export async function getTargets(debugPort: number): Promise<CDPTarget[]> {
  const response = await fetch(`http://localhost:${debugPort}/json`);
  if (!response.ok) {
    throw new Error(`Failed to get CDP targets: ${response.statusText}`);
  }
  return response.json() as Promise<CDPTarget[]>;
}

/**
 * Find a page target (not DevTools, service worker, etc.)
 */
export async function findPageTarget(debugPort: number, tabIndex?: number): Promise<CDPTarget | undefined> {
  const targets = await getTargets(debugPort);
  const pages = targets.filter(t => t.type === 'page');
  const index = tabIndex ?? 0;
  return pages[index];
}

/**
 * Create a CDP client connected to a specific target.
 */
export async function connectToTarget(wsUrl: string, targetId: string): Promise<CDPClient> {
  const client = new CDPClientImpl(targetId);
  await client.connect(wsUrl);
  return client;
}

/**
 * Create a CDP client for the first page target.
 */
export async function createCDPClient(debugPort: number, tabIndex?: number): Promise<CDPClient> {
  // Wait for Chrome to be ready
  let retries = 0;
  let target: CDPTarget | undefined;

  while (retries < 10) {
    try {
      target = await findPageTarget(debugPort, tabIndex);
      if (target) break;
    } catch {
      // Chrome not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, 500));
    retries++;
  }

  if (!target) {
    throw new Error(`No page target found on port ${debugPort}`);
  }

  logger.info('Connecting to CDP target', { targetId: target.id, url: target.url });
  return connectToTarget(target.webSocketDebuggerUrl, target.id);
}

/**
 * Check if a port is in use (Chrome debugging port).
 */
export async function isCDPPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection(port, '127.0.0.1');
    socket.once('connect', () => {
      socket.end();
      resolve(false); // Port is in use
    });
    socket.once('error', () => {
      resolve(true); // Port is available
    });
  });
}

/**
 * Wait for Chrome debugging port to be ready.
 */
export async function waitForCDP(debugPort: number, timeoutMs: number = 10_000): Promise<boolean> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const targets = await getTargets(debugPort);
      if (targets.length > 0) {
        return true;
      }
    } catch {
      // Chrome not ready
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }

  return false;
}
