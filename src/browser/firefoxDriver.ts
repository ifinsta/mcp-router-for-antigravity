/**
 * Firefox Browser Driver
 *
 * Firefox browser control using Marionette (Firefox's remote debugging protocol)
 * Alternative to Chrome DevTools Protocol for cross-browser support.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve as pathResolve } from 'node:path';
import { getLogger } from '../infra/logger.js';

const logger = getLogger('firefox-driver');

// ============================================================================
// Types
// ============================================================================

/**
 * Firefox configuration
 */
export interface FirefoxConfig {
  headless: boolean;
  viewport?: {
    width: number;
    height: number;
  };
  userAgent?: string;
  marionettePort?: number;
  profile?: string;
}

/**
 * Firefox session
 */
export interface FirefoxSession {
  sessionId: string;
  process: ReturnType<typeof spawn>;
  marionettePort: number;
  config: FirefoxConfig;
  isActive: boolean;
  connected: boolean;
}

/**
 * Marionette command response
 */
interface MarionetteResponse {
  [0]: number; // message ID
  [1]: any; // result
  [2]: any; // error
}

/**
 * Marionette command
 */
interface MarionetteCommand {
  [0]: number; // message ID
  [1]: string; // command name
  [2]: any; // parameters
}

// ============================================================================
// Firefox Driver Implementation
// ============================================================================

export class FirefoxDriver {
  private static instance: FirefoxDriver | null = null;
  private sessions: Map<string, FirefoxSession>;
  private nextMessageId: number = 0;

  private constructor() {
    this.sessions = new Map();
  }

  static getInstance(): FirefoxDriver {
    if (!FirefoxDriver.instance) {
      FirefoxDriver.instance = new FirefoxDriver();
    }
    return FirefoxDriver.instance;
  }

  /**
   * Find Firefox executable
   */
  private findFirefoxExecutable(): string {
    const paths = [
      'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
      'C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe',
    ];

    for (const path of paths) {
      if (existsSync(path)) return path;
    }

    // Check common locations on Unix-like systems
    const unixPaths = [
      '/usr/bin/firefox',
      '/usr/local/bin/firefox',
      '/Applications/Firefox.app/Contents/MacOS/firefox',
    ];

    for (const path of unixPaths) {
      if (existsSync(path)) return path;
    }

    // Fallback to PATH
    return 'firefox';
  }

  /**
   * Launch Firefox instance
   */
  async launch(config: FirefoxConfig): Promise<string> {
    const sessionId = this.generateSessionId();
    const firefoxPath = this.findFirefoxExecutable();

    logger.info('Launching Firefox', { sessionId, firefoxPath });

    // Generate random port for Marionette
    const marionettePort = config.marionettePort ?? 2828 + Math.floor(Math.random() * 1000);

    const args = [
      '--marionette',
      `--marionette-port=${marionettePort}`,
    ];

    if (config.headless) {
      args.push('--headless');
    }

    if (config.profile) {
      args.push('--profile', config.profile);
    } else {
      // Create temporary profile for automation
      args.push('--new-instance');
    }

    const process = spawn(firefoxPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: false,
    });

    const session: FirefoxSession = {
      sessionId,
      process,
      marionettePort,
      config,
      isActive: true,
      connected: false,
    };

    this.sessions.set(sessionId, session);

    // Wait for Marionette to be ready
    await this.waitForMarionette(session);

    logger.info('Firefox launched successfully', { sessionId, marionettePort });
    return sessionId;
  }

  /**
   * Navigate to URL
   */
  async navigate(sessionId: string, url: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isActive) {
      throw new Error(`Session not found or inactive: ${sessionId}`);
    }

    await this.sendMarionetteCommand(session, 'WebDriver:Navigate', {
      url,
    });

    logger.info('Firefox navigated', { sessionId, url });
  }

  /**
   * Take screenshot
   */
  async screenshot(sessionId: string): Promise<string> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isActive) {
      throw new Error(`Session not found or inactive: ${sessionId}`);
    }

    const result = await this.sendMarionetteCommand(session, 'WebDriver:TakeScreenshot');

    logger.info('Firefox screenshot captured', { sessionId });
    return result.value as string;
  }

  /**
   * Execute script
   */
  async executeScript(sessionId: string, script: string): Promise<any> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isActive) {
      throw new Error(`Session not found or inactive: ${sessionId}`);
    }

    const result = await this.sendMarionetteCommand(session, 'WebDriver:ExecuteScript', {
      script: `return (function() { ${script} })()`,
    });

    logger.info('Firefox script executed', { sessionId });
    return result.value;
  }

  /**
   * Click element
   */
  async click(sessionId: string, selector: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isActive) {
      throw new Error(`Session not found or inactive: ${sessionId}`);
    }

    await this.sendMarionetteCommand(session, 'WebDriver:FindElement', {
      using: 'css selector',
      value: selector,
    });

    await this.sendMarionetteCommand(session, 'WebDriver:ElementClick');

    logger.info('Firefox element clicked', { sessionId, selector });
  }

  /**
   * Type text
   */
  async type(sessionId: string, selector: string, text: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isActive) {
      throw new Error(`Session not found or inactive: ${sessionId}`);
    }

    await this.sendMarionetteCommand(session, 'WebDriver:FindElement', {
      using: 'css selector',
      value: selector,
    });

    await this.sendMarionetteCommand(session, 'WebDriver:ElementSendKeys', {
      text,
    });

    logger.info('Firefox text typed', { sessionId, selector, length: text.length });
  }

  /**
   * Close session
   */
  async close(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    logger.info('Closing Firefox session', { sessionId });

    try {
      await this.sendMarionetteCommand(session, 'WebDriver:Quit');
    } catch {
      // Session may already be closed
    }

    session.isActive = false;
    session.connected = false;
    this.sessions.delete(sessionId);

    logger.info('Firefox session closed', { sessionId });
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private generateSessionId(): string {
    return `firefox_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Wait for Marionette to be ready
   */
  private async waitForMarionette(session: FirefoxSession, timeoutMs: number = 10000): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      try {
        // Try to connect and send a simple command
        await this.sendMarionetteCommand(session, 'WebDriver:Status');
        session.connected = true;
        return;
      } catch {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    throw new Error('Marionette connection timeout');
  }

  /**
   * Send Marionette command
   */
  private async sendMarionetteCommand(
    session: FirefoxSession,
    command: string,
    params?: any
  ): Promise<any> {
    const messageId = this.nextMessageId++;

    const message: MarionetteCommand = [messageId, command, params ?? {}];

    return new Promise((resolve, reject) => {
      // Set up response listener
      const timeout = setTimeout(() => {
        reject(new Error(`Marionette command timeout: ${command}`));
      }, 30000);

      // Write command to stdin
      const messageStr = JSON.stringify([messageId, command, params ?? {}]) + '\n';
      session.process.stdin?.write(messageStr);

      // Listen for response
      const dataHandler = (data: Buffer) => {
        try {
          const lines = data.toString().split('\n').filter(line => line.trim());

          for (const line of lines) {
            const response: MarionetteResponse = JSON.parse(line);

            if (response[0] === messageId) {
              // This is our response
              clearTimeout(timeout);
              session.process.stdout?.off('data', dataHandler);

              if (response[2]) {
                reject(new Error(`Marionette error: ${JSON.stringify(response[2])}`));
              } else {
                resolve(response[1]);
              }
            }
          }
        } catch (error) {
          // Skip invalid JSON
        }
      };

      session.process.stdout?.on('data', dataHandler);
    });
  }

  /**
   * Get all active sessions
   */
  getActiveSessions(): FirefoxSession[] {
    return Array.from(this.sessions.values()).filter(session => session.isActive);
  }

  /**
   * Get session by ID
   */
  getSession(sessionId: string): FirefoxSession | undefined {
    return this.sessions.get(sessionId);
  }
}