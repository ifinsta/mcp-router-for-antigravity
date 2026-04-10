/**
 * Multi-Tab Management
 *
 * Provides comprehensive tab management capabilities including tab creation,
 * switching, closing, and cross-tab operations for browser automation.
 */

import type { CDPClient } from './cdpClient.js';
import { getLogger } from '../infra/logger.js';

const logger = getLogger('multi-tab-manager');

// ============================================================================
// Types
// ============================================================================

/**
 * Tab information
 */
export interface TabInfo {
  tabId: string;
  targetId: string;
  url: string;
  title: string;
  isActive: boolean;
  isLoading: boolean;
  createdAt: number;
  lastActivity: number;
  metadata?: {
    referrer?: string;
    openerTabId?: string;
    type?: 'page' | 'background' | 'popup';
  };
}

/**
 * Tab creation options
 */
export interface TabCreationOptions {
  url?: string;
  background?: boolean;
  referrer?: string;
  openerTabId?: string;
  newWindow?: boolean;
}

/**
 * Tab navigation options
 */
export interface TabNavigationOptions {
  waitUntil?: 'load' | 'DOMContentLoaded' | 'networkidle';
  timeout?: number;
}

/**
 * Tab filter criteria
 */
export interface TabFilter {
  urlPattern?: string;
  titlePattern?: string;
  isActive?: boolean;
  isLoading?: boolean;
  minAge?: number;
  maxAge?: number;
}

/**
 * Tab operation result
 */
export interface TabOperationResult {
  success: boolean;
  tabId?: string;
  error?: string;
  tab?: TabInfo;
}

// ============================================================================
// Multi-Tab Manager
// ============================================================================

/**
 * Multi-Tab Manager
 *
 * Manages multiple browser tabs with comprehensive lifecycle
 * and cross-tab communication capabilities.
 */
export class MultiTabManager {
  private cdpClient: CDPClient | null = null;
  private tabs: Map<string, TabInfo> = new Map();
  private currentTabId: string | null = null;
  private targetId: string = '';
  private nextTabId: number = 1;

  constructor(cdpClient: CDPClient | null = null, targetId: string = '') {
    this.cdpClient = cdpClient;
    this.targetId = targetId;
  }

  /**
   * Set CDP client
   */
  setCDPClient(client: CDPClient): void {
    this.cdpClient = client;
  }

  /**
   * Set target ID
   */
  setTargetId(targetId: string): void {
    this.targetId = targetId;
  }

  /**
   * Initialize tab manager
   */
  async initialize(): Promise<void> {
    if (!this.cdpClient) {
      throw new Error('CDP client not set for tab management');
    }

    logger.info('Initializing multi-tab manager');

    try {
      // Enable necessary domains
      await this.cdpClient.send('Target.enable');
      await this.cdpClient.send('Page.enable');
      await this.cdpClient.send('Runtime.enable');

      // Set up event handlers for tab lifecycle
      this.setupTabEventHandlers();

      // Get existing tabs
      await this.discoverExistingTabs();

      logger.info('Multi-tab manager initialized', {
        tabCount: this.tabs.size,
        currentTabId: this.currentTabId,
      });
    } catch (error) {
      logger.error('Failed to initialize tab manager', error);
      throw error;
    }
  }

  /**
   * Create new tab
   */
  async createTab(options: TabCreationOptions = {}): Promise<TabOperationResult> {
    if (!this.cdpClient) {
      throw new Error('CDP client not set for tab management');
    }

    logger.info('Creating new tab', options as Record<string, unknown>);

    try {
      const tabId = this.generateTabId();
      const background = options.background ?? false;

      // Create new target
      const result = await this.cdpClient.send('Target.createTarget', {
        url: options.url || 'about:blank',
        newWindow: options.newWindow ?? false,
        background: background,
      }) as { targetId: string };

      // Get target info
      const targetInfo = await this.cdpClient.send('Target.getTargetInfo', {
        targetId: result.targetId,
      }) as { targetInfo: { targetId: string; type: string; title: string; url: string } };

      const tabInfo: TabInfo = {
        tabId,
        targetId: result.targetId,
        url: options.url || 'about:blank',
        title: targetInfo.targetInfo.title || 'New Tab',
        isActive: !background,
        isLoading: false,
        createdAt: Date.now(),
        lastActivity: Date.now(),
        metadata: {
          ...(options.referrer !== undefined ? { referrer: options.referrer } : {}),
          ...(options.openerTabId !== undefined ? { openerTabId: options.openerTabId } : {}),
          type: 'page',
        },
      };

      this.tabs.set(tabId, tabInfo);

      // Activate tab if not background
      if (!background) {
        await this.activateTab(tabId);
      }

      logger.info('Tab created successfully', { tabId, url: tabInfo.url });

      return {
        success: true,
        tabId,
        tab: tabInfo,
      };
    } catch (error) {
      logger.error('Failed to create tab', error instanceof Error ? error.message : String(error));
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Activate tab
   */
  async activateTab(tabId: string): Promise<TabOperationResult> {
    if (!this.cdpClient) {
      throw new Error('CDP client not set for tab management');
    }

    const tab = this.tabs.get(tabId);
    if (!tab) {
      return {
        success: false,
        error: `Tab not found: ${tabId}`,
      };
    }

    logger.info('Activating tab', { tabId, url: tab.url });

    try {
      // Set current tab inactive
      if (this.currentTabId && this.currentTabId !== tabId) {
        const currentTab = this.tabs.get(this.currentTabId);
        if (currentTab) {
          currentTab.isActive = false;
        }
      }

      // Activate target
      await this.cdpClient.send('Target.activateTarget', {
        targetId: tab.targetId,
      });

      // Activate page
      await this.cdpClient.send('Page.bringToFront');

      // Update tab state
      tab.isActive = true;
      tab.lastActivity = Date.now();
      this.currentTabId = tabId;

      logger.info('Tab activated successfully', { tabId });

      return {
        success: true,
        tabId,
        tab,
      };
    } catch (error) {
      logger.error('Failed to activate tab', error);
      return {
        success: false,
        tabId,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Close tab
   */
  async closeTab(tabId: string): Promise<TabOperationResult> {
    if (!this.cdpClient) {
      throw new Error('CDP client not set for tab management');
    }

    const tab = this.tabs.get(tabId);
    if (!tab) {
      return {
        success: false,
        error: `Tab not found: ${tabId}`,
      };
    }

    logger.info('Closing tab', { tabId, url: tab.url });

    try {
      // Close target
      await this.cdpClient.send('Target.closeTarget', {
        targetId: tab.targetId,
      });

      // Remove from tracking
      this.tabs.delete(tabId);

      // Update current tab if needed
      if (this.currentTabId === tabId) {
        this.currentTabId = this.getMostRecentActiveTab();
      }

      logger.info('Tab closed successfully', { tabId });

      return {
        success: true,
        tabId,
      };
    } catch (error) {
      logger.error('Failed to close tab', error);
      return {
        success: false,
        tabId,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Navigate tab
   */
  async navigateTab(tabId: string, url: string, options?: TabNavigationOptions): Promise<TabOperationResult> {
    if (!this.cdpClient) {
      throw new Error('CDP client not set for tab management');
    }

    const tab = this.tabs.get(tabId);
    if (!tab) {
      return {
        success: false,
        error: `Tab not found: ${tabId}`,
      };
    }

    logger.info('Navigating tab', { tabId, url });

    try {
      // Switch to tab first
      if (this.currentTabId !== tabId) {
        await this.activateTab(tabId);
      }

      // Navigate
      await this.cdpClient.send('Page.navigate', {
        url,
      });

      // Update tab info
      tab.url = url;
      tab.isLoading = true;
      tab.lastActivity = Date.now();

      // Wait for navigation if specified
      if (options?.waitUntil) {
        await this.waitForNavigation(options.waitUntil, options.timeout);
      }

      logger.info('Tab navigated successfully', { tabId, url });

      return {
        success: true,
        tabId,
        tab,
      };
    } catch (error) {
      logger.error('Failed to navigate tab', error instanceof Error ? error.message : String(error));
      return {
        success: false,
        tabId,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get all tabs
   */
  getAllTabs(): TabInfo[] {
    return Array.from(this.tabs.values());
  }

  /**
   * Get active tabs only
   */
  getActiveTabs(): TabInfo[] {
    return this.getAllTabs().filter(tab => tab.isActive);
  }

  /**
   * Get current tab
   */
  getCurrentTab(): TabInfo | undefined {
    if (this.currentTabId) {
      return this.tabs.get(this.currentTabId);
    }
    return undefined;
  }

  /**
   * Get tab by ID
   */
  getTab(tabId: string): TabInfo | undefined {
    return this.tabs.get(tabId);
  }

  /**
   * Find tabs matching criteria
   */
  findTabs(filter: TabFilter): TabInfo[] {
    const allTabs = this.getAllTabs();

    return allTabs.filter(tab => {
      // URL pattern match
      if (filter.urlPattern) {
        const regex = new RegExp(filter.urlPattern);
        if (!regex.test(tab.url)) return false;
      }

      // Title pattern match
      if (filter.titlePattern) {
        const regex = new RegExp(filter.titlePattern);
        if (!regex.test(tab.title)) return false;
      }

      // Active state match
      if (filter.isActive !== undefined && tab.isActive !== filter.isActive) {
        return false;
      }

      // Loading state match
      if (filter.isLoading !== undefined && tab.isLoading !== filter.isLoading) {
        return false;
      }

      // Age filter
      const age = Date.now() - tab.createdAt;
      if (filter.minAge !== undefined && age < filter.minAge) {
        return false;
      }
      if (filter.maxAge !== undefined && age > filter.maxAge) {
        return false;
      }

      return true;
    });
  }

  /**
   * Close all tabs except specified
   */
  async closeAllTabsExcept(exceptTabId: string): Promise<void> {
    logger.info('Closing all tabs except', { exceptTabId });

    const tabsToClose = this.getAllTabs()
      .filter(tab => tab.tabId !== exceptTabId)
      .map(tab => tab.tabId);

    for (const tabId of tabsToClose) {
      await this.closeTab(tabId);
    }

    logger.info('All tabs closed except specified', {
      exceptTabId,
      closedCount: tabsToClose.length,
    });
  }

  /**
   * Close all inactive tabs
   */
  async closeInactiveTabs(maxAge: number = 3600000): Promise<number> {
    logger.info('Closing inactive tabs', { maxAge });

    const now = Date.now();
    const tabsToClose = this.getAllTabs()
      .filter(tab => {
        const age = now - tab.lastActivity;
        return age > maxAge && !tab.isActive;
      })
      .map(tab => tab.tabId);

    for (const tabId of tabsToClose) {
      await this.closeTab(tabId);
    }

    logger.info('Inactive tabs closed', {
      closedCount: tabsToClose.length,
      maxAge,
    });

    return tabsToClose.length;
  }

  /**
   * Duplicate tab
   */
  async duplicateTab(tabId: string): Promise<TabOperationResult> {
    const tab = this.tabs.get(tabId);
    if (!tab) {
      return {
        success: false,
        error: `Tab not found: ${tabId}`,
      };
    }

    logger.info('Duplicating tab', { tabId, url: tab.url });

    // Create new tab with same URL
    return await this.createTab({
      url: tab.url,
      background: false,
      openerTabId: tabId,
    });
  }

  /**
   * Reload tab
   */
  async reloadTab(tabId: string, options?: {
    ignoreCache?: boolean;
    scriptToEvaluateOnLoad?: string;
  }): Promise<TabOperationResult> {
    if (!this.cdpClient) {
      throw new Error('CDP client not set for tab management');
    }

    const tab = this.tabs.get(tabId);
    if (!tab) {
      return {
        success: false,
        error: `Tab not found: ${tabId}`,
      };
    }

    logger.info('Reloading tab', { tabId, url: tab.url });

    try {
      // Switch to tab first
      if (this.currentTabId !== tabId) {
        await this.activateTab(tabId);
      }

      // Reload
      await this.cdpClient.send('Page.reload', {
        ignoreCache: options?.ignoreCache ?? false,
      });

      // Update tab state
      tab.isLoading = true;
      tab.lastActivity = Date.now();

      logger.info('Tab reloaded successfully', { tabId });

      return {
        success: true,
        tabId,
        tab,
      };
    } catch (error) {
      logger.error('Failed to reload tab', error instanceof Error ? error.message : String(error));
      return {
        success: false,
        tabId,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get tab count
   */
  getTabCount(): number {
    return this.tabs.size;
  }

  /**
   * Get tab statistics
   */
  getTabStats(): {
    totalTabs: number;
    activeTabs: number;
    inactiveTabs: number;
    loadingTabs: number;
    averageAge: number;
  } {
    const allTabs = this.getAllTabs();
    const now = Date.now();

    const activeTabs = allTabs.filter(tab => tab.isActive).length;
    const loadingTabs = allTabs.filter(tab => tab.isLoading).length;
    const averageAge = allTabs.length > 0
      ? allTabs.reduce((sum, tab) => sum + (now - tab.createdAt), 0) / allTabs.length
      : 0;

    return {
      totalTabs: allTabs.length,
      activeTabs,
      inactiveTabs: allTabs.length - activeTabs,
      loadingTabs,
      averageAge,
    };
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Generate unique tab ID
   */
  private generateTabId(): string {
    return `tab_${this.nextTabId++}_${Date.now()}`;
  }

  /**
   * Get most recent active tab
   */
  private getMostRecentActiveTab(): string | null {
    const activeTabs = this.getActiveTabs()
      .sort((a, b) => b.lastActivity - a.lastActivity);

    return activeTabs.length > 0 ? activeTabs[0]!.tabId : null;
  }

  /**
   * Discover existing tabs
   */
  private async discoverExistingTabs(): Promise<void> {
    try {
      const targets = await this.cdpClient!.send('Target.getTargets') as {
        targetInfos: Array<{ targetId: string; type: string; title: string; url: string }>;
      };

      for (const targetInfo of targets.targetInfos) {
        if (targetInfo.type === 'page') {
          const tabId = this.generateTabId();
          const tabInfo: TabInfo = {
            tabId,
            targetId: targetInfo.targetId,
            url: targetInfo.url || 'about:blank',
            title: targetInfo.title || '',
            isActive: false,
            isLoading: false,
            createdAt: Date.now(),
            lastActivity: Date.now(),
            metadata: {
              type: 'page',
            },
          };

          this.tabs.set(tabId, tabInfo);
        }
      }

      // Set first page as current tab
      const pageTabs = Array.from(this.tabs.values()).filter(tab => tab.metadata?.type === 'page');
      if (pageTabs.length > 0) {
        const firstTab = pageTabs[0]!;
        this.currentTabId = firstTab.tabId;
        firstTab.isActive = true;
      }

      logger.info('Discovered existing tabs', {
        tabCount: this.tabs.size,
        currentTabId: this.currentTabId,
      });
    } catch (error) {
      logger.warn('Failed to discover existing tabs', { error: error instanceof Error ? error.message : String(error) });
    }
  }

  /**
   * Setup tab event handlers
   */
  private setupTabEventHandlers(): void {
    if (!this.cdpClient) return;

    // Handle target created
    this.cdpClient.on('Target.targetCreated', (params: unknown) => {
      const p = params as { targetInfo: { targetId: string; type: string; title: string; url: string } };

      if (p.targetInfo.type === 'page') {
        const tabId = this.generateTabId();
        const tabInfo: TabInfo = {
          tabId,
          targetId: p.targetInfo.targetId,
          url: p.targetInfo.url || 'about:blank',
          title: p.targetInfo.title || '',
          isActive: false,
          isLoading: true,
          createdAt: Date.now(),
          lastActivity: Date.now(),
          metadata: {
            type: 'page',
          },
        };

        this.tabs.set(tabId, tabInfo);
        logger.info('Target created - new tab', { tabId, url: tabInfo.url });
      }
    });

    // Handle target destroyed
    this.cdpClient.on('Target.targetDestroyed', (params: unknown) => {
      const p = params as { targetId: string };

      // Find tab by target ID and remove it
      for (const [tabId, tab] of this.tabs.entries()) {
        if (tab.targetId === p.targetId) {
          this.tabs.delete(tabId);

          // Update current tab if needed
          if (this.currentTabId === tabId) {
            this.currentTabId = this.getMostRecentActiveTab();
          }

          logger.info('Target destroyed - tab removed', { tabId });
          break;
        }
      }
    });

    // Handle target info changed
    this.cdpClient.on('Target.targetInfoChanged', (params: unknown) => {
      const p = params as { targetInfo: { targetId: string; title: string; url: string } };

      for (const [tabId, tab] of this.tabs.entries()) {
        if (tab.targetId === p.targetInfo.targetId) {
          tab.url = p.targetInfo.url || tab.url;
          tab.title = p.targetInfo.title || tab.title;
          tab.lastActivity = Date.now();

          logger.info('Target info changed - tab updated', { tabId, url: tab.url });
          break;
        }
      }
    });

    // Handle page lifecycle events
    this.cdpClient.on('Page.loadEventFired', () => {
      if (this.currentTabId) {
        const currentTab = this.tabs.get(this.currentTabId);
        if (currentTab) {
          currentTab.isLoading = false;
          currentTab.lastActivity = Date.now();
        }
      }
    });

    this.cdpClient.on('Page.domContentLoaded', () => {
      if (this.currentTabId) {
        const currentTab = this.tabs.get(this.currentTabId);
        if (currentTab) {
          currentTab.isLoading = false;
          currentTab.lastActivity = Date.now();
        }
      }
    });
  }

  /**
   * Wait for navigation
   */
  private async waitForNavigation(waitUntil: 'load' | 'DOMContentLoaded' | 'networkidle' = 'load', timeout: number = 30000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Navigation timeout after ${timeout}ms`));
      }, timeout);

      const eventHandler = () => {
        clearTimeout(timeoutId);
        resolve();
      };

      if (waitUntil === 'load') {
        this.cdpClient!.on('Page.loadEventFired', eventHandler);
      } else if (waitUntil === 'DOMContentLoaded') {
        this.cdpClient!.on('Page.domContentLoaded', eventHandler);
      } else if (waitUntil === 'networkidle') {
        // Network idle requires more complex logic - simplified here
        this.cdpClient!.on('Page.loadEventFired', eventHandler);
      }
    });
  }

  /**
   * Cleanup
   */
  async cleanup(): Promise<void> {
    logger.info('Cleaning up multi-tab manager');

    this.tabs.clear();
    this.currentTabId = null;

    logger.info('Multi-tab manager cleaned up');
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create multi-tab manager
 */
export function createMultiTabManager(cdpClient: CDPClient | null = null, targetId: string = ''): MultiTabManager {
  return new MultiTabManager(cdpClient, targetId);
}