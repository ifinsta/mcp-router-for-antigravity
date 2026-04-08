/**
 * GLM Provider Adapter
 *
 * Handles GLM-specific API integration, request/response mapping, and error handling
 * Implements explicit compatibility handling instead of assuming OpenAI compatibility
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

const logger = getLogger('glm-adapter');

// GLM API configuration
const GLM_API_BASE_URL = 'https://api.z.ai/api/paas/v4/chat/completions'; // Z.AI/GLM API endpoint
const GLM_MODELS_URL = 'https://api.z.ai/api/paas/v4/models';
const GLM_TIMEOUT_MS = 60000;

/**
 * GLM Adapter Implementation
 */
export class GLMAdapter implements ProviderAdapter {
  readonly name = 'glm';
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
    if (!config.providers.glm) {
      throw new Error('GLM configuration is missing');
    }

    this.apiKey = config.providers.glm.apiKey;
    this.baseUrl = config.providers.glm.baseUrl || GLM_API_BASE_URL;

    logger.info('GLM adapter initialized', {
      baseUrl: this.baseUrl,
      hasApiKey: !!this.apiKey,
    });
  }

  /**
   * List available GLM models
   */
  async listModels(): Promise<ModelInfo[]> {
    logger.debug('Listing GLM models');

    try {
      const response = await this.makeGLMRequest<GLMModelsResponse>(GLM_MODELS_URL, 'GET');

      if (!response.ok) {
        const errorText = await response.text();
        logger.warn(`GLM models request failed: ${response.status}`, {
          status: response.status,
          error: errorText,
        });

        throw createUpstreamError(this.name, `Failed to list models: ${response.status}`);
      }

      const data = (await response.json()) as GLMModelsResponse;

      // GLM-specific model mapping
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
        maxContextTokens: model.max_tokens ?? undefined,
        maxOutputTokens: model.max_output_tokens ?? undefined,
      }));

      logger.info(`Listed ${models.length} GLM models`);

      return models;
    } catch (error) {
      logger.error('Failed to list GLM models', error);

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
    logger.debug('Executing GLM chat', {
      model: request.model,
      messageCount: request.messages.length,
    });

    try {
      // Map normalized request to GLM format
      const glmRequest = this.mapToGLMRequest(request);

      const response = await this.makeGLMRequest<GLMChatResponse>(this.baseUrl, 'POST', glmRequest);

      const latencyMs = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text();
        logger.warn(`GLM chat request failed: ${response.status}`, {
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

      const data = (await response.json()) as GLMChatResponse;

      // GLM-specific response structure handling
      if (!data.choices || data.choices.length === 0) {
        logger.error('GLM returned no choices', { data });
        throw createUpstreamError(this.name, 'No completion choices returned');
      }

      const choice = data.choices[0];

      if (!choice) {
        throw createUpstreamError(this.name, 'No completion choices returned');
      }

      const message = choice.message;

      if (!message) {
        logger.error('GLM returned unexpected response structure', { choice });
        throw createUpstreamError(this.name, 'Unexpected response structure');
      }

      // Map GLM response to normalized format
      const normalizedResponse: NormalizedChatResponse = {
        provider: this.name,
        model: request.model || data.model || 'glm-4',
        outputText: message.content || '',
        finishReason: choice.finish_reason || 'stop',
        usage: this.mapGLMUsage(data.usage),
        latencyMs,
        costEstimate: this.estimateGLMCost(data.usage),
        warnings: [],
        fallbackUsed: false,
      };

      logger.info('GLM chat completed successfully', {
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
      logger.error('GLM chat failed', { latencyMs, error: sanitizeUpstreamError(error instanceof Error ? error.message : String(error)) });

      if (isRouterError(error)) {
        // Re-throw router errors
        throw error;
      }

      // Convert unknown errors to router errors
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
   * Check GLM provider health
   */
  async healthCheck(): Promise<ProviderHealthStatus> {
    const startTime = Date.now();
    logger.debug('Checking GLM provider health');

    try {
      // Simple health check - list models is a good indicator
      const models = await this.listModels();
      const latencyMs = Date.now() - startTime;

      const healthStatus: ProviderHealthStatus = {
        provider: this.name,
        status: 'healthy',
        lastCheckAt: Date.now(),
        latencyMs,
      };

      logger.info('GLM health check successful', {
        latencyMs,
        modelCount: models.length,
      });

      return healthStatus;
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      logger.error('GLM health check failed', error, { latencyMs });

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
   * Map normalized chat request to GLM API format
   */
  private mapToGLMRequest(request: NormalizedChatRequest): Record<string, unknown> {
    // GLM uses similar structure to OpenAI but with specific differences
    const glmRequest: Record<string, unknown> = {
      model: request.model || 'glm-4',
      messages: request.messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
        name: msg.name,
      })),
    };

    // Add optional parameters
    if (request.temperature !== undefined) {
      glmRequest['temperature'] = request.temperature;
    }

    if (request.maxTokens !== undefined) {
      glmRequest['max_tokens'] = request.maxTokens;
    }

    // GLM-specific parameters
    // GLM-4 may have specific parameters like top_p, frequency_penalty

    return glmRequest;
  }

  /**
   * Map GLM usage to normalized format
   */
  private mapGLMUsage(usage: GLMUsage | undefined): NormalizedUsage {
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
   * Estimate cost for GLM usage
   */
  private estimateGLMCost(usage: GLMUsage | undefined): number | null {
    if (!usage) {
      return null;
    }

    // GLM cost estimation (placeholder - should be updated with actual pricing)
    // GLM-4 pricing is different from OpenAI
    const inputCostPer1k = 0.00005; // Example GLM pricing
    const outputCostPer1k = 0.0001; // Example GLM pricing

    const inputCost = (usage.prompt_tokens / 1000) * inputCostPer1k;
    const outputCost = (usage.completion_tokens / 1000) * outputCostPer1k;

    const totalCost = inputCost + outputCost;
    const costInCents = Math.round(totalCost * 100);

    logger.debug('GLM cost estimated', {
      inputTokens: usage.prompt_tokens,
      outputTokens: usage.completion_tokens,
      estimatedCostCents: costInCents,
    });

    return costInCents / 100; // Return in USD
  }

  /**
   * Get model name from model ID
   */
  private getModelName(modelId: string): string {
    const modelNames: Record<string, string> = {
      'glm-5': 'GLM-5',
      'glm-4.7': 'GLM-4.7',
      'glm-4': 'GLM-4',
      'glm-4-plus': 'GLM-4 Plus',
      'glm-4-air': 'GLM-4 Air',
      'glm-4-flash': 'GLM-4 Flash',
      'glm-4-0520': 'GLM-4 0520',
      'glm-3-turbo': 'GLM-3 Turbo',
    };

    return modelNames[modelId] ?? modelId;
  }

  /**
   * Make HTTP request to GLM API
   */
  private async makeGLMRequest<T>(
    url: string,
    method: string,
    body?: Record<string, unknown>
  ): Promise<Response> {
    const timeoutMs = body?.['max_tokens']
      ? Math.min((body['max_tokens'] as number) * 10, GLM_TIMEOUT_MS)
      : GLM_TIMEOUT_MS;

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

// GLM API response types
interface GLMModelsResponse {
  code: number;
  msg: string;
  data: GLMModel[];
}

interface GLMModel {
  id: string;
  object: string;
  created: number;
  owned_by: string;
  permission: string[];
  context_length: number | null;
  max_tokens: number | null;
  max_output_tokens: number | null;
}

interface GLMChatResponse {
  code: number;
  msg: string;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string | null;
    };
    finish_reason: string;
  }>;
  usage: GLMUsage;
}

interface GLMUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

/**
 * Create GLM adapter from configuration
 */
export function createGLMAdapter(config: AppConfig): GLMAdapter {
  return new GLMAdapter(config);
}
