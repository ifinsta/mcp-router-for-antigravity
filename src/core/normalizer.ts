/**
 * Normalization Layer
 *
 * Converts between MCP tool inputs, internal domain contracts, and provider responses
 */

import { getLogger } from '../infra/logger.js';
import {
  NormalizedChatRequest,
  NormalizedChatResponse,
  ListModelsRequest,
  ListModelsResponse,
  ModelInfo,
  NormalizedUsage,
  HealthResponse,
  RouterStatus,
  CircuitBreakerState,
} from './types.js';
import { createValidationError, isRouterError } from './errors.js';
import type { RouterError } from './errors.js';
import { ChatRequestSchema } from './validation.js';

const logger = getLogger('normalizer');

/**
 * Map MCP tool input to normalized domain request
 */
export function normalizeChatRequest(mcpInput: unknown): NormalizedChatRequest | RouterError {
  logger.debug('Normalizing chat request from MCP input');

  try {
    // Use validation schema to parse and normalize
    const validated = ChatRequestSchema.parse(mcpInput);

    const normalizedRequest: NormalizedChatRequest = {
      provider: validated.provider,
      model: validated.model,
      messages: validated.messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
        name: msg.name,
      })),
      temperature: validated.temperature,
      maxTokens: validated.maxTokens,
      timeoutMs: validated.timeoutMs,
      fallbackProvider: validated.fallbackProvider,
      schema: validated.schema,
    };

    logger.debug('Chat request normalized successfully', {
      provider: normalizedRequest.provider,
      model: normalizedRequest.model,
      messageCount: normalizedRequest.messages.length,
    });

    return normalizedRequest;
  } catch (error) {
    logger.warn('Failed to normalize chat request', { error });
    throw createValidationError('Invalid chat request format', 'chatRequest');
  }
}

/**
 * Map MCP tool input to normalized list models request
 */
export function normalizeListModelsRequest(mcpInput: unknown): ListModelsRequest {
  logger.debug('Normalizing list models request from MCP input');

  const listRequest: ListModelsRequest = {
    provider:
      typeof mcpInput === 'object' && mcpInput !== null && 'provider' in mcpInput
        ? (mcpInput.provider as string)
        : undefined,
  };

  logger.debug('List models request normalized successfully', {
    provider: listRequest.provider,
  });

  return listRequest;
}

/**
 * Normalize provider response to domain response
 */
export function normalizeChatResponse(
  providerResponse: unknown,
  provider: string,
  model: string,
  latencyMs: number
): NormalizedChatResponse {
  logger.debug('Normalizing provider response', { provider, model });

  // TODO: Implement provider response normalization
  // For now, return a basic response structure
  const normalizedResponse: NormalizedChatResponse = {
    provider,
    model,
    outputText: 'Response normalization not yet implemented',
    finishReason: 'stop',
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      accuracy: 'estimated',
    },
    latencyMs,
    costEstimate: null,
    warnings: ['Response normalization not yet implemented - using basic structure'],
    fallbackUsed: false,
  };

  logger.debug('Provider response normalized successfully', {
    provider,
    model,
    latencyMs,
  });

  return normalizedResponse;
}

/**
 * Normalize provider model info to domain model info
 */
export function normalizeModelInfo(providerModelInfo: unknown, provider: string): ModelInfo {
  logger.debug('Normalizing provider model info', { provider });

  // TODO: Implement model info normalization
  // For now, return a basic model info structure
  const modelInfo: ModelInfo = {
    id: 'unknown-model',
    name: 'Unknown Model',
    provider,
    capabilities: {
      chat: true,
      structured: false,
      embeddings: false,
      streaming: false,
      vision: false,
    },
    maxContextTokens: undefined,
    maxOutputTokens: undefined,
  };

  logger.debug('Model info normalized successfully', {
    provider,
    modelId: modelInfo.id,
  });

  return modelInfo;
}

/**
 * Aggregate multiple provider model listings
 */
export function aggregateModelListings(
  providerListings: Array<{ provider: string; models: unknown[]; errors: string[] }>
): ListModelsResponse {
  logger.debug('Aggregating model listings from multiple providers');

  const providers = providerListings.map((listing) => ({
    provider: listing.provider,
    models: listing.models.map((model) => normalizeModelInfo(model, listing.provider)),
    warnings: listing.errors,
  }));

  const aggregateWarnings = ['Model aggregation not yet fully implemented'];

  logger.debug('Model listings aggregated successfully', {
    providerCount: providers.length,
  });

  return {
    providers,
    warnings: aggregateWarnings,
  };
}

/**
 * Normalize usage information
 */
export function normalizeUsage(providerUsage: unknown): NormalizedUsage {
  // TODO: Implement usage normalization
  return {
    inputTokens: undefined,
    outputTokens: undefined,
    totalTokens: undefined,
    accuracy: 'estimated',
  };
}

/**
 * Normalize health status
 */
export function normalizeHealthStatus(
  configHealth: 'valid' | 'invalid' | 'warnings',
  discoveryHealth: 'healthy' | 'degraded' | 'failed',
  executionHealth: 'healthy' | 'degraded' | 'failed'
): RouterStatus {
  // Determine overall status based on component health
  if (configHealth === 'invalid' || discoveryHealth === 'failed' || executionHealth === 'failed') {
    return RouterStatus.UNHEALTHY;
  } else if (
    configHealth === 'warnings' ||
    discoveryHealth === 'degraded' ||
    executionHealth === 'degraded'
  ) {
    return RouterStatus.DEGRADED;
  } else {
    return RouterStatus.HEALTHY;
  }
}

/**
 * Create standardized health response
 */
export function createHealthResponse(
  configHealth: {
    status: 'valid' | 'invalid' | 'warnings';
    warnings: string[];
    errors: string[];
  },
  discoveryHealth: {
    status: 'healthy' | 'degraded' | 'failed';
    providers: Array<{
      provider: string;
      status: 'success' | 'failed';
      modelCount?: number | undefined;
      error?: string | undefined;
    }>;
    warnings: string[];
  },
  executionHealth: {
    status: 'healthy' | 'degraded' | 'failed';
    activeRequests: number;
    concurrencyUtilization: number;
    recentErrorRate?: number | undefined;
    warnings: string[];
  },
  providerHealth: Array<{
    provider: string;
    status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
    breakerState: CircuitBreakerState;
    lastCheckAt: number;
    latencyMs?: number | undefined;
    recentErrorRate?: number | undefined;
  }>
): HealthResponse {
  const status = normalizeHealthStatus(
    configHealth.status,
    discoveryHealth.status,
    executionHealth.status
  );

  const warnings = [
    ...configHealth.warnings,
    ...discoveryHealth.warnings,
    ...executionHealth.warnings,
  ];

  const response: HealthResponse = {
    status,
    version: '1.0.0',
    config: configHealth,
    discovery: discoveryHealth,
    execution: executionHealth,
    providers: providerHealth,
    warnings,
    timestamp: Date.now(),
  };

  logger.debug('Health response created', { status, warningCount: warnings.length });

  return response;
}
