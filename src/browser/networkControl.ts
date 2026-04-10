/**
 * Network Control Capabilities
 *
 * Provides network throttling, mocking, and interception capabilities
 * for browser automation. Enables testing under various network conditions.
 */

import type { CDPClient } from './cdpClient.js';
import { getLogger } from '../infra/logger.js';

const logger = getLogger('network-control');

// ============================================================================
// Types
// ============================================================================

/**
 * Network conditions preset
 */
export interface NetworkConditions {
  offline: boolean;
  downloadThroughput: number; // bytes per second
  uploadThroughput: number; // bytes per second
  latency: number; // milliseconds
}

/**
 * Network throttling presets
 */
export interface NetworkPreset {
  name: string;
  description: string;
  conditions: NetworkConditions;
}

/**
 * Network mock configuration
 */
export interface NetworkMock {
  urlPattern: string;
  method?: string;
  response: {
    statusCode: number;
    headers?: Record<string, string>;
    body?: string;
    delay?: number;
  };
  active: boolean;
}

/**
 * Request interception rule
 */
export interface RequestInterception {
  urlPattern: string;
  action: 'block' | 'mock' | 'continue' | 'modify';
  mockData?: NetworkMock['response'];
  modifyRequest?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  };
  active: boolean;
}

// ============================================================================
// Network Presets
// ============================================================================

/**
 * Pre-configured network conditions for testing
 */
export const NETWORK_PRESETS: Record<string, NetworkPreset> = {
  offline: {
    name: 'Offline',
    description: 'No network connection',
    conditions: {
      offline: true,
      downloadThroughput: 0,
      uploadThroughput: 0,
      latency: 0,
    },
  },
  gprs: {
    name: 'GPRS',
    description: 'Very slow mobile network (50 Kbps)',
    conditions: {
      offline: false,
      downloadThroughput: 50 * 1024 / 8, // 50 Kbps
      uploadThroughput: 20 * 1024 / 8, // 20 Kbps
      latency: 500,
    },
  },
  '2g': {
    name: '2G',
    description: 'Slow mobile network (250 Kbps)',
    conditions: {
      offline: false,
      downloadThroughput: 250 * 1024 / 8, // 250 Kbps
      uploadThroughput: 50 * 1024 / 8, // 50 Kbps
      latency: 300,
    },
  },
  '3g': {
    name: '3G',
    description: 'Regular mobile network (750 Kbps)',
    conditions: {
      offline: false,
      downloadThroughput: 750 * 1024 / 8, // 750 Kbps
      uploadThroughput: 250 * 1024 / 8, // 250 Kbps
      latency: 100,
    },
  },
  '3g_slow': {
    name: '3G Slow',
    description: 'Slow 3G connection (400 Kbps)',
    conditions: {
      offline: false,
      downloadThroughput: 400 * 1024 / 8, // 400 Kbps
      uploadThroughput: 200 * 1024 / 8, // 200 Kbps
      latency: 200,
    },
  },
  '4g': {
    name: '4G',
    description: 'Fast mobile network (4 Mbps)',
    conditions: {
      offline: false,
      downloadThroughput: 4 * 1024 * 1024 / 8, // 4 Mbps
      uploadThroughput: 3 * 1024 * 1024 / 8, // 3 Mbps
      latency: 20,
    },
  },
  lte: {
    name: 'LTE',
    description: 'Very fast mobile network (10 Mbps)',
    conditions: {
      offline: false,
      downloadThroughput: 10 * 1024 * 1024 / 8, // 10 Mbps
      uploadThroughput: 5 * 1024 * 1024 / 8, // 5 Mbps
      latency: 4,
    },
  },
  wifi: {
    name: 'WiFi',
    description: 'Fast WiFi connection (30 Mbps)',
    conditions: {
      offline: false,
      downloadThroughput: 30 * 1024 * 1024 / 8, // 30 Mbps
      uploadThroughput: 15 * 1024 * 1024 / 8, // 15 Mbps
      latency: 2,
    },
  },
  cable: {
    name: 'Cable',
    description: 'Very fast cable connection (100 Mbps)',
    conditions: {
      offline: false,
      downloadThroughput: 100 * 1024 * 1024 / 8, // 100 Mbps
      uploadThroughput: 50 * 1024 * 1024 / 8, // 50 Mbps
      latency: 1,
    },
  },
};

// ============================================================================
// Network Control Manager
// ============================================================================

/**
 * Network Control Manager
 *
 * Manages network conditions, mocking, and request interception
 * for browser automation.
 */
export class NetworkControlManager {
  private cdpClient: CDPClient | null = null;
  private currentConditions: NetworkConditions | null = null;
  private activeMocks: Map<string, NetworkMock> = new Map();
  private activeInterceptions: Map<string, RequestInterception> = new Map();
  private requestInterceptionEnabled: boolean = false;

  constructor(cdpClient: CDPClient | null = null) {
    this.cdpClient = cdpClient;
  }

  /**
   * Set CDP client
   */
  setCDPClient(client: CDPClient): void {
    this.cdpClient = client;
  }

  /**
   * Apply network conditions
   */
  async applyNetworkConditions(conditions: NetworkConditions): Promise<void> {
    if (!this.cdpClient) {
      throw new Error('CDP client not set for network control');
    }

    logger.info('Applying network conditions', { conditions });

    try {
      await this.cdpClient.send('Network.emulateNetworkConditions', {
        offline: conditions.offline,
        downloadThroughput: conditions.downloadThroughput,
        uploadThroughput: conditions.uploadThroughput,
        latency: conditions.latency,
      });

      this.currentConditions = conditions;
      logger.info('Network conditions applied successfully');
    } catch (error) {
      logger.error('Failed to apply network conditions', error);
      throw error;
    }
  }

  /**
   * Apply network preset
   */
  async applyNetworkPreset(presetName: string): Promise<void> {
    const preset = NETWORK_PRESETS[presetName];
    if (!preset) {
      throw new Error(`Unknown network preset: ${presetName}`);
    }

    logger.info('Applying network preset', { presetName, preset });
    await this.applyNetworkConditions(preset.conditions);
  }

  /**
   * Reset network conditions
   */
  async resetNetworkConditions(): Promise<void> {
    if (!this.cdpClient) {
      throw new Error('CDP client not set for network control');
    }

    logger.info('Resetting network conditions');

    try {
      await this.cdpClient.send('Network.emulateNetworkConditions', {
        offline: false,
        downloadThroughput: -1,
        uploadThroughput: -1,
        latency: 0,
      });

      this.currentConditions = null;
      logger.info('Network conditions reset successfully');
    } catch (error) {
      logger.error('Failed to reset network conditions', error);
      throw error;
    }
  }

  /**
   * Enable request interception
   */
  async enableRequestInterception(): Promise<void> {
    if (!this.cdpClient) {
      throw new Error('CDP client not set for network control');
    }

    logger.info('Enabling request interception');

    try {
      await this.cdpClient.send('Network.enable');
      await this.cdpClient.send('Network.setRequestInterception', {
        patterns: [{ urlPattern: '*' }],
      });

      this.requestInterceptionEnabled = true;

      // Set up interception handler
      this.cdpClient.on('Network.requestIntercepted', async (params: unknown) => {
        await this.handleRequestInterception(params);
      });

      logger.info('Request interception enabled successfully');
    } catch (error) {
      logger.error('Failed to enable request interception', error);
      throw error;
    }
  }

  /**
   * Disable request interception
   */
  async disableRequestInterception(): Promise<void> {
    if (!this.cdpClient) {
      throw new Error('CDP client not set for network control');
    }

    logger.info('Disabling request interception');

    try {
      await this.cdpClient.send('Network.disable');
      this.requestInterceptionEnabled = false;
      logger.info('Request interception disabled successfully');
    } catch (error) {
      logger.error('Failed to disable request interception', error);
      throw error;
    }
  }

  /**
   * Add network mock
   */
  addNetworkMock(mock: NetworkMock): void {
    const mockId = `mock_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    this.activeMocks.set(mockId, { ...mock, active: true });
    logger.info('Network mock added', { mockId, urlPattern: mock.urlPattern });
  }

  /**
   * Remove network mock
   */
  removeNetworkMock(mockId: string): boolean {
    const result = this.activeMocks.delete(mockId);
    if (result) {
      logger.info('Network mock removed', { mockId });
    }
    return result;
  }

  /**
   * Add request interception rule
   */
  addRequestInterception(interception: RequestInterception): string {
    const ruleId = `rule_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    this.activeInterceptions.set(ruleId, { ...interception, active: true });
    logger.info('Request interception added', { ruleId, urlPattern: interception.urlPattern });
    return ruleId;
  }

  /**
   * Remove request interception rule
   */
  removeRequestInterception(ruleId: string): boolean {
    const result = this.activeInterceptions.delete(ruleId);
    if (result) {
      logger.info('Request interception removed', { ruleId });
    }
    return result;
  }

  /**
   * Get current network conditions
   */
  getCurrentConditions(): NetworkConditions | null {
    return this.currentConditions;
  }

  /**
   * Get all active mocks
   */
  getActiveMocks(): NetworkMock[] {
    return Array.from(this.activeMocks.values()).filter(mock => mock.active);
  }

  /**
   * Get all active interceptions
   */
  getActiveInterceptions(): RequestInterception[] {
    return Array.from(this.activeInterceptions.values()).filter(interception => interception.active);
  }

  /**
   * Clear all mocks and interceptions
   */
  async clearAll(): Promise<void> {
    logger.info('Clearing all network mocks and interceptions');

    this.activeMocks.clear();
    this.activeInterceptions.clear();

    if (this.requestInterceptionEnabled) {
      await this.disableRequestInterception();
    }

    if (this.currentConditions) {
      await this.resetNetworkConditions();
    }

    logger.info('All network controls cleared');
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Handle intercepted request
   */
  private async handleRequestInterception(params: unknown): Promise<void> {
    if (!this.cdpClient || !this.requestInterceptionEnabled) {
      return;
    }

    try {
      // Extract request info
      const requestParams = params as { interceptionId: string; request?: { url: string; method: string } };
      const { interceptionId, request } = requestParams;

      if (!request) {
        await this.continueRequest(interceptionId);
        return;
      }

      // Check for matching interceptions
      for (const [ruleId, interception] of this.activeInterceptions.entries()) {
        if (!interception.active) continue;

        if (this.urlMatchesPattern(request.url, interception.urlPattern)) {
          logger.info('Request matched interception rule', { ruleId, url: request.url });

          switch (interception.action) {
            case 'block':
              await this.blockRequest(interceptionId);
              return;
            case 'mock':
              if (interception.mockData) {
                await this.mockRequest(interceptionId, interception.mockData);
              }
              return;
            case 'modify':
              if (interception.modifyRequest) {
                await this.modifyRequest(interceptionId, interception.modifyRequest);
                return;
              }
              await this.continueRequest(interceptionId);
              return;
            case 'continue':
              await this.continueRequest(interceptionId);
              return;
          }
        }
      }

      // Check for matching mocks
      for (const [mockId, mock] of this.activeMocks.entries()) {
        if (!mock.active) continue;

        if (this.urlMatchesPattern(request.url, mock.urlPattern)) {
          if (mock.method && mock.method !== request.method) continue;

          logger.info('Request matched mock', { mockId, url: request.url });
          await this.mockRequest(interceptionId, mock.response);
          return;
        }
      }

      // No match, continue request
      await this.continueRequest(interceptionId);
    } catch (error) {
      logger.error('Error handling intercepted request', error);
    }
  }

  /**
   * Continue request normally
   */
  private async continueRequest(interceptionId: string): Promise<void> {
    if (!this.cdpClient) return;

    await this.cdpClient.send('Network.continueInterceptedRequest', {
      interceptionId,
    });
  }

  /**
   * Block request
   */
  private async blockRequest(interceptionId: string): Promise<void> {
    if (!this.cdpClient) return;

    await this.cdpClient.send('Network.continueInterceptedRequest', {
      interceptionId,
      errorReason: 'BlockedByClient',
    });
  }

  /**
   * Mock request response
   */
  private async mockRequest(interceptionId: string, mockData: NetworkMock['response']): Promise<void> {
    if (!this.cdpClient) return;

    const { statusCode, headers, body } = mockData;

    await this.cdpClient.send('Network.continueInterceptedRequest', {
      interceptionId,
      rawResponse: body ? Buffer.from(body).toString('base64') : undefined,
      responseHeaders: headers ? Object.entries(headers).map(([name, value]) => ({ name, value })) : undefined,
      responseStatusCode: statusCode,
    });
  }

  /**
   * Modify request
   */
  private async modifyRequest(interceptionId: string, modifyConfig: RequestInterception['modifyRequest']): Promise<void> {
    if (!this.cdpClient) return;

    await this.cdpClient.send('Network.continueInterceptedRequest', {
      interceptionId,
      ...modifyConfig,
    });
  }

  /**
   * Check if URL matches pattern
   */
  private urlMatchesPattern(url: string, pattern: string): boolean {
    // Simple glob pattern matching
    const regexPattern = pattern
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');

    const regex = new RegExp(regexPattern);
    return regex.test(url);
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get network presets
 */
export function getNetworkPresets(): Record<string, NetworkPreset> {
  return NETWORK_PRESETS;
}

/**
 * Get popular network presets
 */
export function getPopularNetworkPresets(): NetworkPreset[] {
  return [
    NETWORK_PRESETS['wifi']!,
    NETWORK_PRESETS['4g']!,
    NETWORK_PRESETS['3g']!,
    NETWORK_PRESETS['offline']!,
  ];
}

/**
 * Create network control manager
 */
export function createNetworkControlManager(cdpClient: CDPClient | null = null): NetworkControlManager {
  return new NetworkControlManager(cdpClient);
}