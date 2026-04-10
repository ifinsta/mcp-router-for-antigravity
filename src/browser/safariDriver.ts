/**
 * Safari Browser Driver
 *
 * Safari browser control using Safari WebDriver and AppleScript automation.
 * Limited cross-browser support as Safari has more restricted automation APIs.
 */

import { spawn, exec } from 'node:child_process';
import { existsSync } from 'node:fs';
import { getLogger } from '../infra/logger.js';

const logger = getLogger('safari-driver');

// ============================================================================
// Types
// ============================================================================

/**
 * Safari configuration
 */
export interface SafariConfig {
  headless: boolean;
  viewport?: {
    width: number;
    height: number;
  };
  userAgent?: string;
  enableRemoteAutomation?: boolean;
}

/**
 * Safari session
 */
export interface SafariSession {
  sessionId: string;
  process?: ReturnType<typeof spawn>;
  config: SafariConfig;
  isActive: boolean;
  useWebDriver: boolean;
  port?: number;
}

// ============================================================================
// Safari Driver Implementation
// ============================================================================

export class SafariDriver {
  private static instance: SafariDriver | null = null;
  private sessions: Map<string, SafariSession>;

  private constructor() {
    this.sessions = new Map();
  }

  static getInstance(): SafariDriver {
    if (!SafariDriver.instance) {
      SafariDriver.instance = new SafariDriver();
    }
    return SafariDriver.instance;
  }

  /**
   * Check if Safari WebDriver is available (macOS only)
   */
  private isSafariWebDriverAvailable(): boolean {
    return process.platform === 'darwin';
  }

  /**
   * Check if safaridriver is installed
   */
  private isSafariDriverInstalled(): Promise<boolean> {
    return new Promise((resolve) => {
      exec('which safaridriver', (error) => {
        resolve(!error);
      });
    });
  }

  /**
   * Launch Safari instance
   */
  async launch(config: SafariConfig): Promise<string> {
    const sessionId = this.generateSessionId();

    logger.info('Launching Safari', { sessionId, platform: process.platform });

    if (process.platform !== 'darwin') {
      throw new Error('Safari WebDriver is only available on macOS');
    }

    const driverAvailable = await this.isSafariDriverInstalled();
    if (!driverAvailable) {
      throw new Error('Safari WebDriver (safaridriver) is not installed. Run: safaridriver --enable');
    }

    const useWebDriver = config.enableRemoteAutomation ?? true;

    // Enable Safari WebDriver if needed
    if (useWebDriver) {
      await this.enableSafariWebDriver();
    }

    const session: SafariSession = {
      sessionId,
      config,
      isActive: true,
      useWebDriver,
    };

    this.sessions.set(sessionId, session);

    // Launch Safari app
    if (config.headless) {
      logger.warn('Safari does not support headless mode, launching in normal mode');
    }

    const safariPath = '/Applications/Safari.app/Contents/MacOS/Safari';

    if (existsSync(safariPath)) {
      const process = spawn('open', ['-a', 'Safari']);
      session.process = process;
    } else {
      throw new Error('Safari application not found');
    }

    // Wait for Safari to be ready
    await new Promise(resolve => setTimeout(resolve, 2000));

    logger.info('Safari launched successfully', { sessionId, useWebDriver });
    return sessionId;
  }

  /**
   * Enable Safari WebDriver (macOS only)
   */
  private async enableSafariWebDriver(): Promise<void> {
    return new Promise((resolve, reject) => {
      exec('safaridriver --enable', (error, stdout, stderr) => {
        if (error) {
          logger.warn('Failed to enable Safari WebDriver', { error: error.message });
          // Continue anyway - may already be enabled
        } else {
          logger.info('Safari WebDriver enabled');
        }
        resolve();
      });
    });
  }

  /**
   * Navigate to URL
   */
  async navigate(sessionId: string, url: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isActive) {
      throw new Error(`Session not found or inactive: ${sessionId}`);
    }

    if (session.useWebDriver) {
      // Use WebDriver if available
      await this.navigateWithWebDriver(url);
    } else {
      // Fallback to AppleScript
      await this.navigateWithAppleScript(url);
    }

    logger.info('Safari navigated', { sessionId, url });
  }

  /**
   * Navigate using WebDriver
   */
  private async navigateWithWebDriver(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      exec(`safaridriver --url ${JSON.stringify(url)}`, (error) => {
        if (error) {
          reject(new Error(`WebDriver navigation failed: ${error.message}`));
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Navigate using AppleScript (fallback)
   */
  private async navigateWithAppleScript(url: string): Promise<void> {
    const script = `
      tell application "Safari"
        if (count of windows) = 0 then
          make new document
        end if
        set URL of front document to "${url}"
      end tell
    `;

    return new Promise((resolve, reject) => {
      exec(`osascript -e ${JSON.stringify(script)}`, (error) => {
        if (error) {
          reject(new Error(`AppleScript navigation failed: ${error.message}`));
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Take screenshot (limited support)
   */
  async screenshot(sessionId: string): Promise<string> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isActive) {
      throw new Error(`Session not found or inactive: ${sessionId}`);
    }

    if (!session.useWebDriver) {
      throw new Error('Screenshots require Safari WebDriver to be enabled');
    }

    // Safari screenshot requires WebDriver - limited implementation
    logger.warn('Safari screenshot has limited support', { sessionId });

    // Return placeholder - actual screenshot requires WebDriver client
    return '';
  }

  /**
   * Execute script (limited support)
   */
  async executeScript(sessionId: string, script: string): Promise<any> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isActive) {
      throw new Error(`Session not found or inactive: ${sessionId}`);
    }

    if (!session.useWebDriver) {
      throw new Error('Script execution requires Safari WebDriver to be enabled');
    }

    // Safari script execution requires WebDriver - limited implementation
    logger.warn('Safari script execution has limited support', { sessionId });

    return null;
  }

  /**
   * Close session
   */
  async close(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    logger.info('Closing Safari session', { sessionId });

    // Close Safari via AppleScript
    const script = `
      tell application "Safari"
        close front window
      end tell
    `;

    await new Promise<void>((resolve) => {
      exec(`osascript -e ${JSON.stringify(script)}`, () => {
        resolve();
      });
    });

    session.isActive = false;
    this.sessions.delete(sessionId);

    logger.info('Safari session closed', { sessionId });
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private generateSessionId(): string {
    return `safari_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Get all active sessions
   */
  getActiveSessions(): SafariSession[] {
    return Array.from(this.sessions.values()).filter(session => session.isActive);
  }

  /**
   * Get session by ID
   */
  getSession(sessionId: string): SafariSession | undefined {
    return this.sessions.get(sessionId);
  }
}