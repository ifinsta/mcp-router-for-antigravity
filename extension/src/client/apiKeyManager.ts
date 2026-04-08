import * as vscode from 'vscode';
import { getExtensionConfig, getProviderConfig, hasApiKeyInSettings } from '../config/settings';
import { getLogger } from '../infra/logger';
import { sanitizeErrorMessage } from '../infra/errors';

const logger = getLogger('api-key-manager');

/**
 * Provider API key configuration
 */
export interface ProviderApiKeyConfig {
  provider: string;
  displayName: string;
  description: string;
  baseUrl?: string;
  isConfigured: boolean;
}

/**
 * Manages API keys for providers using VS Code secret storage
 */
export class ApiKeyManager {
  private static readonly SECRET_PREFIX = 'mcp-router-api-key-';
  private secretStorage: vscode.SecretStorage;

  constructor(context: vscode.ExtensionContext) {
    this.secretStorage = context.secrets;
  }

  /**
   * Get all supported providers with their configuration status
   */
  getSupportedProviders(): ProviderApiKeyConfig[] {
    const config = getExtensionConfig();
    return [
      {
        provider: 'openai',
        displayName: 'OpenAI',
        description: 'GPT-4, GPT-4o, GPT-3.5 Turbo, and more',
        baseUrl: config.providers.openai.baseUrl,
        isConfigured: false, // Will be checked asynchronously
      },
      {
        provider: 'glm',
        displayName: 'GLM (Z.AI)',
        description: 'GLM-5.1, GLM-5, GLM-4.7, GLM-4.6, GLM-4.5 via Z.AI',
        baseUrl: config.providers.glm.baseUrl,
        isConfigured: false,
      },
      {
        provider: 'anthropic',
        displayName: 'Anthropic',
        description: 'Claude 3 Opus, Sonnet, Haiku',
        baseUrl: config.providers.anthropic.baseUrl,
        isConfigured: false,
      },
      {
        provider: 'chutes',
        displayName: 'Chutes',
        description: 'OpenAI-compatible models via Chutes.ai',
        baseUrl: config.providers.chutes.baseUrl,
        isConfigured: false,
      },
    ];
  }

  /**
   * Get API key for a provider.
   * First checks VS Code settings, then falls back to secret storage.
   */
  async getApiKey(provider: string): Promise<string | undefined> {
    try {
      // Check VS Code settings first
      if (hasApiKeyInSettings(provider)) {
        const providerConfig = getProviderConfig(provider);
        if (providerConfig) {
          return providerConfig.apiKey;
        }
      }
      // Fall back to secret storage
      const key = await this.secretStorage.get(`${ApiKeyManager.SECRET_PREFIX}${provider}`);
      return key;
    } catch (error) {
      logger.error(`Failed to retrieve API key for ${provider}: ${sanitizeErrorMessage(error)}`);
      return undefined;
    }
  }

  /**
   * Set API key for a provider
   */
  async setApiKey(provider: string, key: string): Promise<void> {
    try {
      await this.secretStorage.store(`${ApiKeyManager.SECRET_PREFIX}${provider}`, key);
      logger.info(`API key stored for ${provider}`);

      // Also push to router for runtime updates
      try {
        await this.pushApiKeyToRouter(provider, key);
        logger.info(`API key pushed to router for ${provider}`);
      } catch (error) {
        logger.warn(`Failed to push API key to router for ${provider}, but local storage succeeded: ${sanitizeErrorMessage(error)}`);
        // Don't throw - local storage succeeded
      }
    } catch (error) {
      logger.error(`Failed to store API key for ${provider}: ${sanitizeErrorMessage(error)}`);
      throw error;
    }
  }

  /**
   * Remove API key for a provider
   */
  async removeApiKey(provider: string): Promise<void> {
    try {
      await this.secretStorage.delete(`${ApiKeyManager.SECRET_PREFIX}${provider}`);
      logger.info(`API key removed for ${provider}`);
    } catch (error) {
      logger.error(`Failed to remove API key for ${provider}: ${sanitizeErrorMessage(error)}`);
      throw error;
    }
  }

  /**
   * Check if provider has API key configured (settings or secret storage)
   */
  async isConfigured(provider: string): Promise<boolean> {
    // Check settings first
    if (hasApiKeyInSettings(provider)) {
      return true;
    }
    // Then check secret storage
    const key = await this.getApiKey(provider);
    return key !== undefined && key.length > 0;
  }

  /**
   * Get configuration status for all providers
   */
  async getAllProvidersStatus(): Promise<ProviderApiKeyConfig[]> {
    const providers = this.getSupportedProviders();
    
    const updated = await Promise.all(
      providers.map(async (provider) => ({
        ...provider,
        isConfigured: await this.isConfigured(provider.provider),
      }))
    );

    return updated;
  }

  /**
   * Push API key to router for runtime updates
   */
  private async pushApiKeyToRouter(provider: string, apiKey: string): Promise<void> {
    const config = getExtensionConfig();
    const baseUrl = config.baseUrl.replace(/\/$/, ''); // Remove trailing slash

    const response = await fetch(`${baseUrl}/api/extension/keys`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        provider,
        apiKey,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Unknown error' }));
      const errorMessage = (error as { message?: string }).message || response.statusText;
      throw new Error(`Router rejected API key: ${errorMessage}`);
    }

    logger.info(`API key successfully synced to router for ${provider}`);
  }
}
