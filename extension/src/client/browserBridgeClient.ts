import * as vscode from 'vscode';
import { ExtensionConfig, getExtensionConfig } from '../config/settings';
import { getLogger } from '../infra/logger';
import { sanitizeErrorMessage } from '../infra/errors';

const logger = getLogger('browser-bridge');

/**
 * Browser tab information
 */
export interface BrowserTabInfo {
  tabId: number;
  url: string;
  title: string;
  active: boolean;
}

/**
 * Browser connection status
 */
export interface BrowserStatus {
  connected: boolean;
  tabCount: number;
  activeTab: BrowserTabInfo | null;
}

/**
 * Browser context snapshot for chat injection
 */
export interface BrowserContext {
  url: string;
  title: string;
  selectedText: string;
  metaDescription: string;
}

/**
 * Browser command types
 */
export type BrowserCommandType = 'navigate' | 'click' | 'screenshot' | 'scroll' | 'type' | 'evaluate';

export interface BrowserCommand {
  type: BrowserCommandType;
  payload: Record<string, unknown>;
  tabId?: number;
}

export interface BrowserCommandResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

/**
 * Client for communicating with the browser bridge via the router.
 * 
 * The router mediates all communication between the IDE extension and
 * the Chrome extension. The IDE never speaks directly to the browser.
 */
export class BrowserBridgeClient implements vscode.Disposable {
  private config: ExtensionConfig;
  private disposables: vscode.Disposable[] = [];
  private _onDidChangeStatus = new vscode.EventEmitter<BrowserStatus>();

  /** Event fired when browser connection status changes */
  readonly onDidChangeStatus = this._onDidChangeStatus.event;

  constructor(config?: ExtensionConfig) {
    this.config = config ?? getExtensionConfig();
    this.disposables.push(this._onDidChangeStatus);
  }

  /**
   * Get current browser status
   */
  async getStatus(): Promise<BrowserStatus> {
    try {
      const url = `${this.config.baseUrl}/api/browser/status`;
      const response = await fetch(url);

      if (!response.ok) {
        return { connected: false, tabCount: 0, activeTab: null };
      }

      const data = await response.json() as BrowserStatus;
      return data;
    } catch (error) {
      logger.warn('Failed to get browser status', error);
      return { connected: false, tabCount: 0, activeTab: null };
    }
  }

  /**
   * Check if browser extension is connected
   */
  get isConnected(): boolean {
    // Synchronous check — will be updated by polling in ConnectionManager
    return false; // Will be overridden by actual status
  }

  /**
   * Capture current browser context for chat injection
   */
  async captureContext(): Promise<BrowserContext | null> {
    try {
      const url = `${this.config.baseUrl}/api/browser/context`;
      const response = await fetch(url);

      if (!response.ok) {
        logger.debug('Browser context not available');
        return null;
      }

      const data = await response.json() as BrowserContext;
      return data;
    } catch (error) {
      logger.debug('Failed to capture browser context', error);
      return null;
    }
  }

  /**
   * Take a screenshot of the current browser tab
   * Returns base64-encoded PNG
   */
  async takeScreenshot(): Promise<string | null> {
    try {
      const url = `${this.config.baseUrl}/api/browser/screenshot`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        logger.warn('Failed to take screenshot');
        return null;
      }

      const data = await response.json() as { image?: string };
      return data.image ?? null;
    } catch (error) {
      logger.warn('Failed to take screenshot', error);
      return null;
    }
  }

  /**
   * Execute a browser command via the router
   */
  async executeCommand(command: BrowserCommand): Promise<BrowserCommandResult> {
    try {
      const url = `${this.config.baseUrl}/api/browser/command`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        return {
          success: false,
          error: (error as { error?: string }).error ?? response.statusText,
        };
      }

      const data = await response.json() as BrowserCommandResult;
      return data;
    } catch (error) {
      logger.error('Failed to execute browser command', error);
      return {
        success: false,
        error: sanitizeErrorMessage(error),
      };
    }
  }

  /**
   * Format browser context as text for chat injection
   */
  static formatContextForChat(context: BrowserContext): string {
    const lines = [
      '[Browser Context]',
      `Active URL: ${context.url}`,
      `Page title: ${context.title}`,
    ];

    if (context.selectedText) {
      lines.push(`Selected text: "${context.selectedText}"`);
    }

    if (context.metaDescription) {
      lines.push(`Page description: ${context.metaDescription}`);
    }

    return lines.join('\n');
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
    logger.info('BrowserBridgeClient disposed');
  }
}
