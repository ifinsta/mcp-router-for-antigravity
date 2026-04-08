import * as vscode from 'vscode';
import { RouterModelInfo, RouterClient } from '../client/routerClient';
import { getExtensionConfig } from '../config/settings';
import { getLogger } from '../infra/logger';
import { ModelCatalogError } from '../infra/errors';

const logger = getLogger('model-catalog');

/**
 * Default model catalog to use when router is unavailable
 */
const DEFAULT_MODEL_CATALOG: RouterModelInfo[] = [
  {
    id: 'glm:glm-4.7',
    name: 'GLM 4.7 (via Z.AI)',
    provider: 'glm',
    family: 'glm-4.7',
    healthy: true,
    maxTokens: 128000,
  },
  {
    id: 'glm:glm-4.5',
    name: 'GLM 4.5 (via Z.AI)',
    provider: 'glm',
    family: 'glm-4.5',
    healthy: true,
    maxTokens: 128000,
  },
  {
    id: 'openai:gpt-4o',
    name: 'GPT-4o (via MCP Router)',
    provider: 'openai',
    family: 'gpt-4o',
    healthy: true,
    maxTokens: 128000,
  },
  {
    id: 'openai:gpt-4.1-mini',
    name: 'GPT-4.1 Mini (via MCP Router)',
    provider: 'openai',
    family: 'gpt-4.1-mini',
    healthy: true,
    maxTokens: 8192,
  },
  {
    id: 'anthropic:claude-3-5-sonnet-20241022',
    name: 'Claude 3.5 Sonnet (via MCP Router)',
    provider: 'anthropic',
    family: 'claude-3-5-sonnet',
    healthy: true,
    maxTokens: 200000,
  },
  {
    id: 'anthropic:claude-3-5-haiku-20241022',
    name: 'Claude 3.5 Haiku (via MCP Router)',
    provider: 'anthropic',
    family: 'claude-3-5-haiku',
    healthy: true,
    maxTokens: 200000,
  },
  {
    id: 'anthropic:claude-3-opus-20240229',
    name: 'Claude 3 Opus (via MCP Router)',
    provider: 'anthropic',
    family: 'claude-3-opus',
    healthy: true,
    maxTokens: 200000,
  },
  {
    id: 'anthropic:claude-3-haiku-20240307',
    name: 'Claude 3 Haiku (via MCP Router)',
    provider: 'anthropic',
    family: 'claude-3-haiku',
    healthy: true,
    maxTokens: 200000,
  },
  {
    id: 'azure-openai:gpt-4o',
    name: 'GPT-4o (via Azure OpenAI)',
    provider: 'azure-openai',
    family: 'gpt-4o',
    healthy: true,
    maxTokens: 128000,
  },
  {
    id: 'azure-openai:gpt-4',
    name: 'GPT-4 (via Azure OpenAI)',
    provider: 'azure-openai',
    family: 'gpt-4',
    healthy: true,
    maxTokens: 128000,
  },
  {
    id: 'azure-openai:gpt-35-turbo',
    name: 'GPT-3.5 Turbo (via Azure OpenAI)',
    provider: 'azure-openai',
    family: 'gpt-35-turbo',
    healthy: true,
    maxTokens: 16384,
  },
];

/**
 * Model catalog manager that fetches and caches models from the router
 */
export class ModelCatalog {
  private client: RouterClient;
  private cache: RouterModelInfo[] | null = null;
  private lastFetch: number = 0;
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  constructor(client: RouterClient) {
    this.client = client;
  }

  /**
   * Get the model catalog, using cache if fresh enough
   */
  async getModels(forceRefresh = false): Promise<RouterModelInfo[]> {
    const now = Date.now();
    const config = getExtensionConfig();

    // Return cached models if still fresh
    if (
      !forceRefresh &&
      this.cache &&
      now - this.lastFetch < this.CACHE_TTL
    ) {
      logger.debug('Returning cached model catalog');
      return this.cache;
    }

    try {
      // Try to fetch from router
      logger.info('Fetching model catalog from router...');
      const models = await this.client.getModelCatalog(config.showOnlyHealthyModels);
      
      this.cache = models;
      this.lastFetch = now;

      logger.info(`Loaded ${models.length} models from router`);
      return models;
    } catch (error) {
      logger.warn('Failed to fetch model catalog from router, using defaults', error);
      
      // Fall back to default catalog
      if (!this.cache) {
        this.cache = DEFAULT_MODEL_CATALOG;
        this.lastFetch = now;
      }

      return this.cache;
    }
  }

  /**
   * Get the default fallback model catalog (static, no router needed)
   */
  static getDefaultModels(): RouterModelInfo[] {
    return [...DEFAULT_MODEL_CATALOG];
  }

  /**
   * Convert router model info to VS Code LanguageModelChatInformation
   */
  static toVSCodeModel(model: RouterModelInfo): vscode.LanguageModelChatInformation {
    return {
      id: model.id,
      name: model.name,
      family: model.family,
      version: '1.0.0',
      tooltip: `Provider: ${model.provider}\nMax tokens: ${model.maxTokens ?? 'Unknown'}`,
      detail: model.provider.toUpperCase(),
      maxInputTokens: model.maxTokens ?? 0,
      maxOutputTokens: model.maxTokens ?? 0,
      capabilities: {
        imageInput: false,
        toolCalling: true,
      },
    };
  }

  /**
   * Invalidate the cache
   */
  invalidateCache(): void {
    this.cache = null;
    this.lastFetch = 0;
    logger.debug('Model catalog cache invalidated');
  }
}
