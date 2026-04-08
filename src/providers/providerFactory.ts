/**
 * Provider Factory
 *
 * Centralized factory for creating provider adapters.
 * Decouples adapter instantiation from configuration and registration.
 */

import { getLogger } from '../infra/logger.js';
import { AppConfig } from '../infra/config.js';
import { ProviderAdapter, ProviderCapabilities } from '../core/types.js';
import { BaseProviderAdapter, validateProviderConfig } from './baseAdapter.js';
import { OpenAICompatibleAdapter, OpenAICompatibleConfig } from './openaiCompatibleAdapter.js';

const logger = getLogger('provider-factory');

/**
 * Provider definition for factory registration
 */
export interface ProviderDefinition {
  name: string;
  displayName: string;
  defaultBaseUrl: string;
  capabilities: ProviderCapabilities;
  adapterType: 'openai-compatible' | 'custom';
  // For OpenAI-compatible providers
  modelMappings?: Record<string, string> | undefined;
  // For custom providers - path to adapter module
  adapterModule?: string | undefined;
  adapterClass?: string | undefined;
}

/**
 * Registry of supported providers
 */
const PROVIDER_REGISTRY: Record<string, ProviderDefinition> = {
  openai: {
    name: 'openai',
    displayName: 'OpenAI',
    defaultBaseUrl: 'https://api.openai.com/v1',
    capabilities: {
      chat: true,
      structured: false,
      embeddings: false,
      streaming: true,
      vision: false,
    },
    adapterType: 'openai-compatible',
    modelMappings: {
      'gpt-4o': 'GPT-4o',
      'gpt-4o-mini': 'GPT-4o Mini',
      'gpt-4-turbo': 'GPT-4 Turbo',
      'gpt-4': 'GPT-4',
      'gpt-3.5-turbo': 'GPT-3.5 Turbo',
    },
  },
  
  chutes: {
    name: 'chutes',
    displayName: 'Chutes.ai',
    defaultBaseUrl: 'https://llm.chutes.ai/v1',
    capabilities: {
      chat: true,
      structured: false,
      embeddings: false,
      streaming: true,
      vision: false,
    },
    adapterType: 'openai-compatible',
    modelMappings: {
      'Qwen/Qwen2.5-72B-Instruct': 'Qwen 2.5 72B Instruct',
      'Qwen/Qwen2.5-Coder-32B-Instruct': 'Qwen 2.5 Coder 32B',
      'meta-llama/Llama-3.3-70B-Instruct': 'Llama 3.3 70B',
    },
  },
  
  glm: {
    name: 'glm',
    displayName: 'GLM (Z.AI)',
    defaultBaseUrl: 'https://api.z.ai/api/paas/v4/chat/completions',
    capabilities: {
      chat: true,
      structured: false,
      embeddings: false,
      streaming: true,
      vision: false,
    },
    adapterType: 'custom',
    adapterModule: './glmAdapter.js',
    adapterClass: 'GLMAdapter',
  },

  anthropic: {
    name: 'anthropic',
    displayName: 'Anthropic',
    defaultBaseUrl: 'https://api.anthropic.com',
    capabilities: {
      chat: true,
      structured: false,
      embeddings: false,
      streaming: true,
      vision: true,
    },
    adapterType: 'custom',
    adapterModule: './anthropicAdapter.js',
    adapterClass: 'AnthropicAdapter',
  },

  'azure-openai': {
    name: 'azure-openai',
    displayName: 'Azure OpenAI',
    defaultBaseUrl: '',
    capabilities: {
      chat: true,
      structured: false,
      embeddings: false,
      streaming: true,
      vision: false,
    },
    adapterType: 'custom',
    adapterModule: './azureOpenaiAdapter.js',
    adapterClass: 'AzureOpenAIAdapter',
  },
};

/**
 * Factory for creating provider adapters
 */
export class ProviderFactory {
  private config: AppConfig;

  constructor(config: AppConfig) {
    this.config = config;
  }

  /**
   * Get list of available provider definitions
   */
  getAvailableProviders(): ProviderDefinition[] {
    return Object.values(PROVIDER_REGISTRY);
  }

  /**
   * Get provider definition by name
   */
  getProviderDefinition(name: string): ProviderDefinition | undefined {
    return PROVIDER_REGISTRY[name];
  }

  /**
   * Check if provider is supported
   */
  isProviderSupported(name: string): boolean {
    return name in PROVIDER_REGISTRY;
  }

  /**
   * Create adapter for a provider
   */
  async createAdapter(providerName: string): Promise<ProviderAdapter> {
    const definition = PROVIDER_REGISTRY[providerName];
    
    if (!definition) {
      throw new Error(`Unknown provider: ${providerName}`);
    }

    const providerConfig = this.config.providers[providerName as keyof typeof this.config.providers];
    
    if (!providerConfig) {
      throw new Error(`${providerName} configuration is missing`);
    }

    // Check for apiKey requirement (ollama doesn't need one)
    if ('apiKey' in providerConfig && !providerConfig.apiKey) {
      throw new Error(`${providerName} API key is required`);
    }

    logger.info(`Creating adapter for ${providerName}`, {
      type: definition.adapterType,
    });

    if (definition.adapterType === 'openai-compatible') {
      return this.createOpenAICompatibleAdapter(definition, providerConfig as { apiKey: string; baseUrl?: string });
    } else {
      return this.createCustomAdapter(definition, providerConfig as { apiKey: string; baseUrl?: string });
    }
  }

  /**
   * Create OpenAI-compatible adapter
   */
  private createOpenAICompatibleAdapter(
    definition: ProviderDefinition,
    providerConfig: { apiKey: string; baseUrl?: string }
  ): OpenAICompatibleAdapter {
    const validated = validateProviderConfig(definition.name, providerConfig);
    
    const config: OpenAICompatibleConfig = {
      baseUrl: validated.baseUrl || definition.defaultBaseUrl,
      apiKey: validated.apiKey,
      timeoutMs: 60000,
      modelMappings: definition.modelMappings,
    };

    // Create anonymous class extending OpenAICompatibleAdapter
    return new (class extends OpenAICompatibleAdapter {
      readonly name = definition.name;
      readonly capabilities = definition.capabilities;
    })(config);
  }

  /**
   * Create custom adapter (for non-OpenAI-compatible providers)
   */
  private async createCustomAdapter(
    definition: ProviderDefinition,
    providerConfig: { apiKey: string; baseUrl?: string }
  ): Promise<ProviderAdapter> {
    if (!definition.adapterModule) {
      throw new Error(`Custom adapter ${definition.name} missing adapterModule`);
    }

    // Dynamic import of custom adapter
    const module = await import(definition.adapterModule);
    const AdapterClass = module[definition.adapterClass || 'default'];
    
    if (!AdapterClass) {
      throw new Error(`Adapter class not found in ${definition.adapterModule}`);
    }

    return new AdapterClass(this.config);
  }

  /**
   * Create all configured adapters
   */
  async createAllAdapters(): Promise<ProviderAdapter[]> {
    const adapters: ProviderAdapter[] = [];
    
    for (const providerName of Object.keys(PROVIDER_REGISTRY)) {
      const providerConfig = this.config.providers[providerName as keyof typeof this.config.providers];
      
      if (providerConfig && ('apiKey' in providerConfig ? providerConfig.apiKey : true)) {
        try {
          const adapter = await this.createAdapter(providerName);
          adapters.push(adapter);
        } catch (error) {
          logger.warn(`Failed to create adapter for ${providerName}`, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    return adapters;
  }
}

/**
 * Create factory from config
 */
export function createProviderFactory(config: AppConfig): ProviderFactory {
  return new ProviderFactory(config);
}

/**
 * Get supported provider names
 */
export function getSupportedProviderNames(): string[] {
  return Object.keys(PROVIDER_REGISTRY);
}

/**
 * Get provider capabilities
 */
export function getProviderCapabilities(name: string): ProviderCapabilities | undefined {
  return PROVIDER_REGISTRY[name]?.capabilities;
}
