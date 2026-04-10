/**
 * Edge Browser Driver
 *
 * Microsoft Edge browser control using Chrome DevTools Protocol.
 * Edge is Chromium-based, so it uses the same CDP protocol as Chrome.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { resolve as pathResolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { getLogger } from '../infra/logger.js';
import { createCDPClient, waitForCDP, type CDPClient } from './cdpClient.js';

// ES module compatibility
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const logger = getLogger('edge-driver');

// ============================================================================
// Types
// ============================================================================

/**
 * Edge configuration
 */
export interface EdgeConfig {
  headless: boolean;
  viewport?: {
    width: number;
    height: number;
    deviceScaleFactor?: number;
  };
  userAgent?: string;
  locale?: string;
  timezone?: string;
  remoteDebuggingPort?: number;
}

/**
 * Edge session
 */
export interface EdgeSession {
  sessionId: string;
  process: ReturnType<typeof spawn>;
  remoteDebuggingPort: number;
  cdpClient: CDPClient;
  config: EdgeConfig;
  isActive: boolean;
  userDataDir: string;
}

// ============================================================================
// Edge Driver Implementation
// ============================================================================

export class EdgeDriver {
  private static instance: EdgeDriver | null = null;
  private sessions: Map<string, EdgeSession>;

  private constructor() {
    this.sessions = new Map();
  }

  static getInstance(): EdgeDriver {
    if (!EdgeDriver.instance) {
      EdgeDriver.instance = new EdgeDriver();
    }
    return EdgeDriver.instance;
  }

  /**
   * Find Edge executable
   */
  private findEdgeExecutable(): string {
    const paths = [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    ];

    for (const path of paths) {
      if (existsSync(path)) return path;
    }

    // Check common macOS location
    const macPath = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
    if (existsSync(macPath)) return macPath;

    // Check common Linux location
    const linuxPaths = [
      '/usr/bin/microsoft-edge',
      '/usr/bin/microsoft-edge-stable',
      '/opt/microsoft/msedge/msedge',
    ];

    for (const path of linuxPaths) {
      if (existsSync(path)) return path;
    }

    // Fallback to PATH
    return 'msedge';
  }

  /**
   * Launch Edge instance
   */
  async launch(config: EdgeConfig): Promise<string> {
    const sessionId = this.generateSessionId();
    const edgePath = this.findEdgeExecutable();

    logger.info('Launching Edge', { sessionId, edgePath });

    // Create a unique user data directory for this Edge instance
    const userDataDir = await mkdtemp(pathResolve(tmpdir(), 'mcp-edge-'));

    // Generate a random port for remote debugging
    const remoteDebuggingPort = config.remoteDebuggingPort ?? 9222 + Math.floor(Math.random() * 1000);

    const args: string[] = [
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-default-apps',
      '--auto-open-devtools-for-tabs',
      '--enable-automation',
      '--disable-popup-blocking',
      `--remote-debugging-port=${remoteDebuggingPort}`,
    ];

    if (config.headless) {
      args.push('--headless=new');
    }

    if (config.viewport) {
      args.push(`--window-size=${config.viewport.width},${config.viewport.height}`);
    }

    if (config.userAgent) {
      args.push(`--user-agent=${config.userAgent}`);
    }

    const process = spawn(edgePath, args, {
      stdio: 'ignore',
      detached: false,
    });

    process.on('error', (err) => {
      logger.error('Edge process error', err);
    });

    process.on('exit', (code) => {
      logger.info('Edge process exited', { code, userDataDir });
    });

    // Wait for CDP port to be ready
    const cdpReady = await waitForCDP(remoteDebuggingPort, 15_000);
    if (!cdpReady) {
      throw new Error(`CDP port ${remoteDebuggingPort} not ready in time`);
    }
    logger.info('CDP port ready', { remoteDebuggingPort });

    // Create CDP client for reliable browser control
    const cdpClient = await createCDPClient(remoteDebuggingPort);
    logger.info('CDP client connected', { remoteDebuggingPort });

    const session: EdgeSession = {
      sessionId,
      process,
      remoteDebuggingPort,
      cdpClient,
      config,
      isActive: true,
      userDataDir,
    };

    this.sessions.set(sessionId, session);

    logger.info('Edge launched successfully', { sessionId, userDataDir, remoteDebuggingPort });
    return sessionId;
  }

  /**
   * Navigate to URL
   */
  async navigate(sessionId: string, url: string): Promise<{ url: string; loadTime: number }> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isActive) {
      throw new Error(`Session not found or inactive: ${sessionId}`);
    }

    const result = await session.cdpClient.navigateTo(url);
    logger.info('Edge navigated', { sessionId, url, loadTime: result.loadTime });
    return result;
  }

  /**
   * Take screenshot
   */
  async screenshot(sessionId: string, options: {
    format?: 'png' | 'jpeg';
    quality?: number;
    fullPage?: boolean;
  } = {}): Promise<string> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isActive) {
      throw new Error(`Session not found or inactive: ${sessionId}`);
    }

    const screenshot = await session.cdpClient.captureScreenshot(options);
    logger.info('Edge screenshot captured', { sessionId });
    return screenshot;
  }

  /**
   * Execute script
   */
  async executeScript(sessionId: string, script: string, options?: {
    returnByValue?: boolean;
    awaitPromise?: boolean;
  }): Promise<any> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isActive) {
      throw new Error(`Session not found or inactive: ${sessionId}`);
    }

    const result = await session.cdpClient.executeScript(script, options);
    logger.info('Edge script executed', { sessionId });
    return result;
  }

  /**
   * Set viewport
   */
  async setViewport(sessionId: string, config: {
    width: number;
    height: number;
    deviceScaleFactor?: number;
    mobile?: boolean;
  }): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isActive) {
      throw new Error(`Session not found or inactive: ${sessionId}`);
    }

    await session.cdpClient.setViewport(config);
    logger.info('Edge viewport set', { sessionId, config });
  }

  /**
   * Click element
   */
  async click(sessionId: string, selector: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isActive) {
      throw new Error(`Session not found or inactive: ${sessionId}`);
    }

    const script = `
      (function() {
        const element = document.querySelector('${selector}');
        if (!element) throw new Error('Element not found: ${selector}');
        element.click();
        return true;
      })()
    `;

    await session.cdpClient.executeScript(script, { returnByValue: true });
    logger.info('Edge element clicked', { sessionId, selector });
  }

  /**
   * Type text
   */
  async type(sessionId: string, selector: string, text: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isActive) {
      throw new Error(`Session not found or inactive: ${sessionId}`);
    }

    const script = `
      (function() {
        const element = document.querySelector('${selector}');
        if (!element) throw new Error('Element not found: ${selector}');
        element.value = '';
        element.value = '${text}';
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()
    `;

    await session.cdpClient.executeScript(script, { returnByValue: true });
    logger.info('Edge text typed', { sessionId, selector, length: text.length });
  }

  /**
   * Get performance metrics
   */
  async getMetrics(sessionId: string): Promise<Array<{ name: string; value: number }>> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isActive) {
      throw new Error(`Session not found or inactive: ${sessionId}`);
    }

    return await session.cdpClient.getPerformanceMetrics();
  }

  /**
   * Close session
   */
  async close(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    logger.info('Closing Edge session', { sessionId });

    try {
      session.cdpClient.close();
    } catch {
      // ignore
    }

    try {
      if (!session.process.killed) {
        session.process.kill();
      }
    } catch {
      // ignore
    }

    session.isActive = false;
    this.sessions.delete(sessionId);

    logger.info('Edge session closed', { sessionId });
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private generateSessionId(): string {
    return `edge_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Get all active sessions
   */
  getActiveSessions(): EdgeSession[] {
    return Array.from(this.sessions.values()).filter(session => session.isActive);
  }

  /**
   * Get session by ID
   */
  getSession(sessionId: string): EdgeSession | undefined {
    return this.sessions.get(sessionId);
  }
}