/**
 * Provider Registry
 *
 * Manages provider registration, lookup, and capability resolution
 */

import { getLogger } from '../infra/logger.js';
import { ProviderAdapter, ProviderCapabilities, ModelInfo, ProviderHealthStatus } from './types.js';
import { createProviderNotFoundError, createValidationError } from './errors.js';

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
 * Initialize provider registry with adapters
 */
export async function initializeProviderRegistry(): Promise<void> {
  const registry = getProviderRegistry();

  if (registry.isRegistryInitialized()) {
    logger.warn('Provider registry already initialized');
    return;
  }

  logger.info('Initializing provider registry...');

  // TODO: Register provider adapters when implemented
  // For now, we'll register placeholder providers
  // const { register } = await import("../providers/index.js");

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

export async function getProviderHealth(name: string): Promise<ProviderHealthStatus> {
  return getProviderRegistry().getProviderHealth(name);
}

export async function listAllModels(): Promise<
  Array<{ provider: string; models: ModelInfo[]; errors: string[] }>
> {
  return getProviderRegistry().listAllModels();
}
