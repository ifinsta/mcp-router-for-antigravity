/**
 * Chutes Provider Adapter
 *
 * Handles Chutes.ai API integration, request/response mapping, and error handling
 * Chutes uses an OpenAI-compatible API at https://llm.chutes.ai/v1
 */

import { getLogger } from '../infra/logger.js';
import {
  ProviderAdapter,
  ProviderCapabilities,
  ModelInfo,
  ProviderHealthStatus,
  NormalizedChatRequest,
  NormalizedChatResponse,
  NormalizedUsage,
} from '../core/types.js';
import {
  createAuthenticationError,
  createUpstreamError,
  createRateLimitedError,
  createTimeoutError,
  createNetworkError,
  isRouterError,
  sanitizeUpstreamError,
} from '../core/errors.js';
import { AppConfig } from '../infra/config.js';
import { validateNormalizedResponse } from './baseAdapter.js';

const logger = getLogger('chutes-adapter');

// Chutes API configuration
const CHUTES_API_BASE_URL = 'https://llm.chutes.ai/v1';
const CHUTES_TIMEOUT_MS = 60000;

/**
 * Chutes Adapter Implementation (OpenAI-compatible)
 */
export class ChutesAdapter implements ProviderAdapter {
  readonly name = 'chutes';
  readonly capabilities: ProviderCapabilities = {
    chat: true,
    structured: false,
    embeddings: false,
    streaming: true,
    vision: false,
  };

  private apiKey: string;
  private baseUrl: string;

  constructor(config: AppConfig) {
    if (!config.providers.chutes) {
      throw new Error('Chutes configuration is missing');
    }

    this.apiKey = config.providers.chutes.apiKey;
    this.baseUrl = config.providers.chutes.baseUrl || CHUTES_API_BASE_URL;

    logger.info('Chutes adapter initialized', {
      baseUrl: this.baseUrl,
      hasApiKey: !!this.apiKey,
    });
  }

  /**
   * List available Chutes models
   */
  async listModels(): Promise<ModelInfo[]> {
    logger.debug('Listing Chutes models');

    try {
      const response = await this.makeChutesRequest<ChutesModelsResponse>(
        `${this.baseUrl}/models`,
        'GET'
      );

      if (!response.ok) {
        const errorText = await response.text();
        logger.warn(`Chutes models request failed: ${response.status}`, {
          status: response.status,
          error: errorText,
        });

        throw createUpstreamError(this.name, `Failed to list models: ${response.status}`);
      }

      const data = (await response.json()) as ChutesModelsResponse;

      // Map Chutes models to normalized format
      const models: ModelInfo[] = data.data.map((model) => ({
        id: model.id,
        name: this.getModelName(model.id),
        provider: this.name,
        capabilities: {
          chat: true,
          structured: false,
          embeddings: false,
          streaming: true,
          vision: false,
        },
        maxContextTokens: model.context_window ?? undefined,
        maxOutputTokens: model.max_tokens ?? undefined,
      }));

      logger.info(`Listed ${models.length} Chutes models`);

      return models;
    } catch (error) {
      logger.error('Failed to list Chutes models', error);

      if (isRouterError(error)) {
        throw error;
      }

      throw createUpstreamError(
        this.name,
        'Unknown error listing models',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Execute chat completion
   */
  async chat(request: NormalizedChatRequest): Promise<NormalizedChatResponse> {
    const startTime = Date.now();
    logger.debug('Executing Chutes chat', {
      model: request.model,
      messageCount: request.messages.length,
    });

    try {
      // Map normalized request to OpenAI-compatible format
      const chutesRequest = this.mapToChutesRequest(request);

      const response = await this.makeChutesRequest<ChutesChatResponse>(
        `${this.baseUrl}/chat/completions`,
        'POST',
        chutesRequest
      );

      const latencyMs = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text();
        logger.warn(`Chutes chat request failed: ${response.status}`, {
          status: response.status,
          error: errorText,
        });

        // Handle specific error codes
        if (response.status === 401) {
          throw createAuthenticationError(this.name, 'Invalid API key');
        }
        if (response.status === 429) {
          throw createRateLimitedError(this.name);
        }

        throw createUpstreamError(this.name, `Request failed: ${response.status}`);
      }

      const data = (await response.json()) as ChutesChatResponse;

      if (!data.choices || data.choices.length === 0) {
        logger.error('Chutes returned no choices', { data });
        throw createUpstreamError(this.name, 'No completion choices returned');
      }

      const choice = data.choices[0];

      if (!choice) {
        throw createUpstreamError(this.name, 'No completion choices returned');
      }

      const message = choice.message;

      if (!message || message.role !== 'assistant') {
        logger.error('Chutes returned unexpected message structure', { choice });
        throw createUpstreamError(this.name, 'Unexpected response structure');
      }

      // Map response to normalized format
      const normalizedResponse: NormalizedChatResponse = {
        provider: this.name,
        model: data.model,
        outputText: message.content || '',
        finishReason: choice.finish_reason || 'unknown',
        usage: this.mapUsage(data.usage),
        latencyMs,
        costEstimate: this.estimateCost(data.usage),
        warnings: [],
        fallbackUsed: false,
      };

      logger.info('Chutes chat completed successfully', {
        model: normalizedResponse.model,
        finishReason: normalizedResponse.finishReason,
        latencyMs,
        usage: normalizedResponse.usage,
      });

      // Post-extraction validation
      validateNormalizedResponse(normalizedResponse, this.name);

      return normalizedResponse;
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      logger.error('Chutes chat failed', { latencyMs, error: sanitizeUpstreamError(error instanceof Error ? error.message : String(error)) });

      if (isRouterError(error)) {
        throw error;
      }

      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw createNetworkError(this.name, 'Network error', error);
      }

      throw createUpstreamError(
        this.name,
        'Unknown error during chat',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Check Chutes provider health
   */
  async healthCheck(): Promise<ProviderHealthStatus> {
    const startTime = Date.now();
    logger.debug('Checking Chutes provider health');

    try {
      const models = await this.listModels();
      const latencyMs = Date.now() - startTime;

      const healthStatus: ProviderHealthStatus = {
        provider: this.name,
        status: 'healthy',
        lastCheckAt: Date.now(),
        latencyMs,
      };

      logger.info('Chutes health check successful', {
        latencyMs,
        modelCount: models.length,
      });

      return healthStatus;
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      logger.error('Chutes health check failed', error, { latencyMs });

      const healthStatus: ProviderHealthStatus = {
        provider: this.name,
        status: 'unhealthy',
        lastCheckAt: Date.now(),
        latencyMs,
        error: error instanceof Error ? error.message : String(error),
      };

      return healthStatus;
    }
  }

  /**
   * Map normalized chat request to Chutes API format (OpenAI-compatible)
   */
  private mapToChutesRequest(request: NormalizedChatRequest): Record<string, unknown> {
    const chutesRequest: Record<string, unknown> = {
      model: request.model || 'Qwen/Qwen2.5-72B-Instruct',
      messages: request.messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
        name: msg.name,
      })),
    };

    if (request.temperature !== undefined) {
      chutesRequest['temperature'] = request.temperature;
    }

    if (request.maxTokens !== undefined) {
      chutesRequest['max_tokens'] = request.maxTokens;
    }

    return chutesRequest;
  }

  /**
   * Map usage to normalized format
   */
  private mapUsage(usage: ChutesUsage | undefined): NormalizedUsage {
    if (!usage) {
      return {
        accuracy: 'unavailable',
      };
    }

    return {
      inputTokens: usage.prompt_tokens,
      outputTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens,
      accuracy: 'exact',
    };
  }

  /**
   * Estimate cost based on usage
   */
  private estimateCost(usage: ChutesUsage | undefined): number | null {
    if (!usage) {
      return null;
    }

    // Chutes pricing varies by model; using approximate default
    const inputCostPer1k = 0.0005;
    const outputCostPer1k = 0.0015;

    const inputCost = (usage.prompt_tokens / 1000) * inputCostPer1k;
    const outputCost = (usage.completion_tokens / 1000) * outputCostPer1k;

    const totalCost = inputCost + outputCost;
    const costInCents = Math.round(totalCost * 100);

    logger.debug('Cost estimated', {
      inputTokens: usage.prompt_tokens,
      outputTokens: usage.completion_tokens,
      estimatedCostCents: costInCents,
    });

    return costInCents / 100;
  }

  /**
   * Get friendly model name from model ID
   */
  private getModelName(modelId: string): string {
    // Chutes uses HuggingFace-style model IDs like "Qwen/Qwen2.5-72B-Instruct"
    const parts = modelId.split('/');
    const modelName = (parts.length > 1 ? parts[1] : modelId) ?? modelId;
    
    // Convert kebab-case to title case
    return modelName
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  /**
   * Make HTTP request to Chutes API
   */
  private async makeChutesRequest<T>(
    url: string,
    method: string,
    body?: Record<string, unknown>
  ): Promise<Response> {
    const timeoutMs = body?.['max_tokens']
      ? Math.min((body['max_tokens'] as number) * 10, CHUTES_TIMEOUT_MS)
      : CHUTES_TIMEOUT_MS;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const fetchOptions: RequestInit = {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        signal: controller.signal,
      };

      if (body) {
        fetchOptions.body = JSON.stringify(body);
      }

      const response = await fetch(url, fetchOptions);

      clearTimeout(timeoutId);

      return response;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === 'AbortError') {
        throw createTimeoutError(this.name, 'chat', timeoutMs);
      }

      throw error;
    }
  }
}

// OpenAI-compatible response types (Chutes uses same format)
interface ChutesModelsResponse {
  object: string;
  data: ChutesModel[];
}

interface ChutesModel {
  id: string;
  object: string;
  created: number;
  owned_by: string;
  permission: string[];
  root: string;
  parent: string | null;
  context_window: number | null;
  max_tokens: number | null;
}

interface ChutesChatResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string | null;
    };
    finish_reason: string;
  }>;
  usage: ChutesUsage;
}

interface ChutesUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

/**
 * Create Chutes adapter from configuration
 */
export function createChutesAdapter(config: AppConfig): ChutesAdapter {
  return new ChutesAdapter(config);
}
