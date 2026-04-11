/**
 * Provider Registry
 *
 * Manages provider registration, lookup, and capability resolution
 */

import { getLogger } from '../infra/logger.js';
import { ProviderAdapter, ProviderCapabilities, ModelInfo, ProviderHealthStatus } from './types.js';
import { createProviderNotFoundError, createValidationError } from './errors.js';
import { getConfig, AppConfig } from '../infra/config.js';
import { createProviderFactory } from '../providers/providerFactory.js';

const logger = getLogger('provider-registry');

/**
 * Provider registry interface
 */
class ProviderRegistry {
  private providers: Map<string, ProviderAdapter>;
  private initialized: boolean;

  constructor() {
    this.providers = new Map();
    this.initialized = false;
  }

  /**
   * Register a provider adapter
   */
  register(adapter: ProviderAdapter): void {
    const { name } = adapter;

    if (this.providers.has(name)) {
      throw createValidationError(`Provider '${name}' is already registered`);
    }

    this.providers.set(name, adapter);
    logger.info(`Provider '${name}' registered`, {
      capabilities: adapter.capabilities,
    });
  }

  /**
   * Get a provider adapter by name
   */
  get(name: string): ProviderAdapter {
    const provider = this.providers.get(name);

    if (!provider) {
      throw createProviderNotFoundError(name);
    }

    return provider;
  }

  /**
   * Check if a provider exists
   */
  has(name: string): boolean {
    return this.providers.has(name);
  }

  /**
   * Unregister a provider adapter by name.
   * Returns true if the provider was found and removed.
   */
  unregister(name: string): boolean {
    if (!this.providers.has(name)) {
      return false;
    }
    this.providers.delete(name);
    logger.info(`Provider '${name}' unregistered`);
    return true;
  }

  /**
   * Get all registered provider names
   */
  getProviderNames(): string[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Get provider capabilities
   */
  getCapabilities(name: string): ProviderCapabilities {
    return this.get(name).capabilities;
  }

  /**
   * Check if provider supports a capability
   */
  supportsCapability(name: string, capability: keyof ProviderCapabilities): boolean {
    const provider = this.get(name);
    return provider.capabilities[capability];
  }

  /**
   * Get all providers that support a capability
   */
  getProvidersByCapability(capability: keyof ProviderCapabilities): string[] {
    return this.getProviderNames().filter((name) => this.supportsCapability(name, capability));
  }

  /**
   * Get provider health status
   */
  async getProviderHealth(name: string): Promise<ProviderHealthStatus> {
    return this.get(name).healthCheck();
  }

  /**
   * List models from a specific provider
   */
  async listModels(name: string): Promise<ModelInfo[]> {
    return this.get(name).listModels();
  }

  /**
   * List models from all providers
   */
  async listAllModels(): Promise<
    Array<{ provider: string; models: ModelInfo[]; errors: string[] }>
  > {
    const results: Array<{ provider: string; models: ModelInfo[]; errors: string[] }> = [];

    for (const name of this.getProviderNames()) {
      try {
        const models = await this.listModels(name);
        results.push({
          provider: name,
          models,
          errors: [],
        });
      } catch (error) {
        logger.warn(`Failed to list models for provider '${name}'`, {
          error: error instanceof Error ? error.message : String(error),
        });
        results.push({
          provider: name,
          models: [],
          errors: [error instanceof Error ? error.message : String(error)],
        });
      }
    }

    return results;
  }

  /**
   * Mark registry as initialized
   */
  markInitialized(): void {
    this.initialized = true;
    logger.info(`Provider registry initialized with ${this.providers.size} providers`, {
      providers: this.getProviderNames(),
    });
  }

  /**
   * Check if registry is initialized
   */
  isRegistryInitialized(): boolean {
    return this.initialized;
  }
}

// Singleton instance
let registryInstance: ProviderRegistry | null = null;

/**
 * Get the provider registry singleton
 */
export function getProviderRegistry(): ProviderRegistry {
  if (!registryInstance) {
    registryInstance = new ProviderRegistry();
  }

  return registryInstance;
}

/**
 * Register a single provider from the current loaded config.
 *
 * If the provider is already registered, the existing adapter is replaced
 * so that runtime key updates are reflected immediately.
 */
export async function registerProviderFromConfig(providerName: string): Promise<void> {
  const registry = getProviderRegistry();
  const config = getConfig();
  const factory = createProviderFactory(config);

  if (!factory.isProviderSupported(providerName)) {
    logger.warn(`Skipping unsupported provider: ${providerName}`);
    return;
  }

  const providerConfig = config.providers[providerName as keyof AppConfig['providers']];
  if (!providerConfig) {
    logger.warn(`Skipping provider with no config: ${providerName}`);
    return;
  }

  // Providers like ollama don't require an apiKey
  if ('apiKey' in providerConfig && !providerConfig.apiKey) {
    logger.warn(`Skipping provider with no API key: ${providerName}`);
    return;
  }

  try {
    const adapter = await factory.createAdapter(providerName);

    // If already registered, replace silently (allows key rotation)
    if (registry.has(providerName)) {
      registry.unregister(providerName);
    }

    registry.register(adapter);
    logger.info(`Registered provider adapter: ${providerName}`);
  } catch (error) {
    logger.warn(`Failed to register provider adapter: ${providerName}`, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Synchronize the provider registry with the current loaded config.
 *
 * For every provider in the config that has valid credentials, this function
 * ensures a live adapter is registered in the registry.
 */
export async function syncProvidersFromConfig(): Promise<void> {
  const config = getConfig();
  const providerKeys = Object.keys(config.providers) as Array<keyof AppConfig['providers']>;

  const registered: string[] = [];
  const skipped: string[] = [];

  for (const providerName of providerKeys) {
    const providerConfig = config.providers[providerName];
    if (!providerConfig) {
      skipped.push(providerName);
      continue;
    }

    // Providers like ollama don't require an apiKey
    if ('apiKey' in providerConfig && !providerConfig.apiKey) {
      skipped.push(providerName);
      continue;
    }

    await registerProviderFromConfig(providerName);
    registered.push(providerName);
  }

  logger.info('Provider registry sync complete', {
    registered,
    skipped,
    totalProviders: registryGetProviderNames().length,
  });
}

/**
 * Initialize provider registry with adapters
 */
export async function initializeProviderRegistry(): Promise<void> {
  const registry = getProviderRegistry();

  if (registry.isRegistryInitialized()) {
    logger.warn('Provider registry already initialized');
    return;
  }

  logger.info('Initializing provider registry...');

  // Sync providers from loaded config
  await syncProvidersFromConfig();

  registry.markInitialized();
}

/**
 * Get provider adapter by name
 */
export function getProvider(name: string): ProviderAdapter {
  return getProviderRegistry().get(name);
}

/**
 * Check if provider exists
 */
export function hasProvider(name: string): boolean {
  return getProviderRegistry().has(name);
}

/**
 * Get all provider names
 */
export function getAllProviders(): string[] {
  return getProviderRegistry().getProviderNames();
}

/**
 * Get provider capabilities
 */
export function getProviderCapabilities(name: string): ProviderCapabilities {
  return getProviderRegistry().getCapabilities(name);
}

/**
 * Check if provider supports capability
 */
export function providerSupportsCapability(
  name: string,
  capability: keyof ProviderCapabilities
): boolean {
  return getProviderRegistry().supportsCapability(name, capability);
}

/**
 * Get providers by capability
 */
export function getProvidersByCapability(capability: keyof ProviderCapabilities): string[] {
  return getProviderRegistry().getProvidersByCapability(capability);
}

/**
 * Unregister a provider adapter by name.
 * Used internally for key rotation / replacement.
 */
export function unregisterProvider(name: string): boolean {
  return getProviderRegistry().unregister(name);
}

/**
 * Expose getProviderNames for logging in syncProvidersFromConfig.
 */
function registryGetProviderNames(): string[] {
  return getProviderRegistry().getProviderNames();
}

export async function getProviderHealth(name: string): Promise<ProviderHealthStatus> {
  return getProviderRegistry().getProviderHealth(name);
}

export async function listAllModels(): Promise<
  Array<{ provider: string; models: ModelInfo[]; errors: string[] }>
> {
  return getProviderRegistry().listAllModels();
}
