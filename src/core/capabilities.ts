/**
 * Capability Model
 *
 * Provides capability declarations and resolution logic for provider features
 */

import { getLogger } from '../infra/logger.js';
import { ProviderCapabilities, ProviderAdapter } from './types.js';

const logger = getLogger('capabilities');

/**
 * Capability registry
 */
class CapabilityRegistry {
  private providers: Map<string, ProviderCapabilities>;

  constructor() {
    this.providers = new Map();
  }

  /**
   * Register provider capabilities
   */
  register(name: string, capabilities: ProviderCapabilities): void {
    this.providers.set(name, capabilities);
    logger.debug(
      `Registered capabilities for provider '${name}'`,
      capabilities as unknown as Record<string, unknown>
    );
  }

  /**
   * Get provider capabilities
   */
  get(name: string): ProviderCapabilities | undefined {
    return this.providers.get(name);
  }

  /**
   * Check if provider supports a specific capability
   */
  supports(name: string, capability: keyof ProviderCapabilities): boolean {
    const capabilities = this.get(name);
    return capabilities ? capabilities[capability] : false;
  }

  /**
   * Find providers that support a capability
   */
  findByCapability(capability: keyof ProviderCapabilities): string[] {
    const providers: string[] = [];

    for (const [name, caps] of this.providers.entries()) {
      if (caps[capability]) {
        providers.push(name);
      }
    }

    return providers;
  }

  /**
   * Check if any provider supports a capability
   */
  anySupports(capability: keyof ProviderCapabilities): boolean {
    return this.findByCapability(capability).length > 0;
  }

  /**
   * Get all providers that support all requested capabilities
   */
  findByCapabilities(capabilities: Array<keyof ProviderCapabilities>): string[] {
    return this.getProviderNames().filter((name) =>
      capabilities.every((cap) => this.supports(name, cap))
    );
  }

  /**
   * Get all registered provider names
   */
  private getProviderNames(): string[] {
    return Array.from(this.providers.keys());
  }
}

// Singleton instance
let capabilityRegistry: CapabilityRegistry | null = null;

/**
 * Get the capability registry singleton
 */
export function getCapabilityRegistry(): CapabilityRegistry {
  if (!capabilityRegistry) {
    capabilityRegistry = new CapabilityRegistry();
  }

  return capabilityRegistry;
}

/**
 * Initialize capability registry with adapters
 */
export function initializeCapabilityRegistry(): void {
  const registry = getCapabilityRegistry();
  logger.info('Capability registry initialized');

  // Register OpenAI capabilities
  registry.register('openai', {
    chat: true,
    structured: false,
    embeddings: false,
    streaming: true,
    vision: false,
  });

  // Register GLM capabilities
  registry.register('glm', {
    chat: true,
    structured: false,
    embeddings: false,
    streaming: true,
    vision: false,
  });

  // TODO: Register Ollama capabilities when implemented
  // registry.register("ollama", {
  //   chat: true,
  //   structured: false,
  //   embeddings: false,
  //   streaming: true,
  //   vision: false,
  // });
}

/**
 * Check if provider supports a capability
 */
export function providerSupportsCapability(
  name: string,
  capability: keyof ProviderCapabilities
): boolean {
  return getCapabilityRegistry().supports(name, capability);
}

/**
 * Find providers that support a capability
 */
export function findProvidersByCapability(capability: keyof ProviderCapabilities): string[] {
  return getCapabilityRegistry().findByCapability(capability);
}

/**
 * Check if any provider supports a capability
 */
export function anyProviderSupportsCapability(capability: keyof ProviderCapabilities): boolean {
  return getCapabilityRegistry().anySupports(capability);
}

/**
 * Find providers that support all requested capabilities
 */
export function findProvidersByCapabilities(
  capabilities: Array<keyof ProviderCapabilities>
): string[] {
  return getCapabilityRegistry().findByCapabilities(capabilities);
}

/**
 * Check if operation is supported for provider
 */
export function isOperationSupported(
  provider: string,
  operation: 'chat' | 'structured' | 'embeddings' | 'streaming' | 'vision'
): boolean {
  const capabilityMapping: Record<string, keyof ProviderCapabilities> = {
    chat: 'chat',
    structured: 'structured',
    embeddings: 'embeddings',
    streaming: 'streaming',
    vision: 'vision',
  };

  const mapped = capabilityMapping[operation];
  if (!mapped) {
    return false;
  }
  return providerSupportsCapability(provider, mapped);
}

/**
 * Get providers that can perform chat
 */
export function getChatProviders(): string[] {
  return findProvidersByCapability('chat');
}

/**
 * Get providers that can perform streaming
 */
export function getStreamingProviders(): string[] {
  return findProvidersByCapability('streaming');
}

/**
 * Validate requested capabilities are available
 */
export function validateCapabilities(requestedCapabilities: Array<keyof ProviderCapabilities>): {
  valid: boolean;
  missingCapabilities: Array<keyof ProviderCapabilities>;
} {
  logger.debug('Validating requested capabilities', { requestedCapabilities });

  const missing: Array<keyof ProviderCapabilities> = [];

  for (const capability of requestedCapabilities) {
    if (!anyProviderSupportsCapability(capability)) {
      missing.push(capability);
    }
  }

  const valid = missing.length === 0;

  if (!valid) {
    const missingCapabilities = missing;
    logger.warn('Requested capabilities not available', { missingCapabilities });
  }

  return { valid, missingCapabilities: missing };
}
