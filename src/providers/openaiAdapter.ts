/**
 * OpenAI Provider Adapter
 *
 * Handles OpenAI-specific API integration, request/response mapping, and error handling
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
  ErrorCode,
} from '../core/errors.js';
import { AppConfig } from '../infra/config.js';

const logger = getLogger('openai-adapter');

// OpenAI API configuration
const OPENAI_API_BASE_URL = 'https://api.openai.com/v1';
const OPENAI_TIMEOUT_MS = 60000;

/**
 * OpenAI Adapter Implementation
 */
export class OpenAIAdapter implements ProviderAdapter {
  readonly name = 'openai';
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
    if (!config.providers.openai) {
      throw new Error('OpenAI configuration is missing');
    }

    this.apiKey = config.providers.openai.apiKey;
    this.baseUrl = config.providers.openai.baseUrl || OPENAI_API_BASE_URL;

    logger.info('OpenAI adapter initialized', {
      baseUrl: this.baseUrl,
      hasApiKey: !!this.apiKey,
    });
  }

  /**
   * List available OpenAI models
   */
  async listModels(): Promise<ModelInfo[]> {
    logger.debug('Listing OpenAI models');

    try {
      const response = await this.makeOpenAIRequest<OpenAIModelsResponse>(
        `${this.baseUrl}/models`,
        'GET'
      );

      if (!response.ok) {
        const errorText = await response.text();
        logger.warn(`OpenAI models request failed: ${response.status}`, {
          status: response.status,
          error: errorText,
        });

        throw createUpstreamError(this.name, `Failed to list models: ${response.status}`);
      }

      const data = (await response.json()) as OpenAIModelsResponse;

      // Map OpenAI models to normalized format
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
        maxContextTokens: model.context_window || undefined,
        maxOutputTokens: model.max_tokens || undefined,
      }));

      logger.info(`Listed ${models.length} OpenAI models`);

      return models;
    } catch (error) {
      logger.error('Failed to list OpenAI models', error);

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
    logger.debug('Executing OpenAI chat', {
      model: request.model,
      messageCount: request.messages.length,
    });

    try {
      // Map normalized request to OpenAI format
      const openaiRequest = this.mapToOpenAIRequest(request);

      const response = await this.makeOpenAIRequest<OpenAIChatResponse>(
        `${this.baseUrl}/chat/completions`,
        'POST',
        openaiRequest
      );

      const latencyMs = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text();
        logger.warn(`OpenAI chat request failed: ${response.status}`, {
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

      const data = (await response.json()) as OpenAIChatResponse;

      if (!data.choices || data.choices.length === 0) {
        logger.error('OpenAI returned no choices', { data });
        throw createUpstreamError(this.name, 'No completion choices returned');
      }

      const choice = data.choices[0];
      const message = choice.message;

      if (!message || message.role !== 'assistant') {
        logger.error('OpenAI returned unexpected message structure', { choice });
        throw createUpstreamError(this.name, 'Unexpected response structure');
      }

      // Map OpenAI response to normalized format
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

      logger.info('OpenAI chat completed successfully', {
        model: normalizedResponse.model,
        finishReason: normalizedResponse.finishReason,
        latencyMs,
        usage: normalizedResponse.usage,
      });

      return normalizedResponse;
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      logger.error('OpenAI chat failed', error, { latencyMs });

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
   * Check OpenAI provider health
   */
  async healthCheck(): Promise<ProviderHealthStatus> {
    const startTime = Date.now();
    logger.debug('Checking OpenAI provider health');

    try {
      // Simple health check - list models is a good indicator
      const models = await this.listModels();
      const latencyMs = Date.now() - startTime;

      const healthStatus: ProviderHealthStatus = {
        provider: this.name,
        status: 'healthy',
        lastCheckAt: Date.now(),
        latencyMs,
        error: undefined,
      };

      logger.info('OpenAI health check successful', {
        latencyMs,
        modelCount: models.length,
      });

      return healthStatus;
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      logger.error('OpenAI health check failed', error, { latencyMs });

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
   * Map normalized chat request to OpenAI API format
   */
  private mapToOpenAIRequest(request: NormalizedChatRequest): Record<string, unknown> {
    const openaiRequest: Record<string, unknown> = {
      model: request.model || 'gpt-3.5-turbo',
      messages: request.messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
        name: msg.name,
      })),
    };

    // Add optional parameters
    if (request.temperature !== undefined) {
      openaiRequest['temperature'] = request.temperature;
    }

    if (request.maxTokens !== undefined) {
      openaiRequest['max_tokens'] = request.maxTokens;
    }

    if (request.schema) {
      // OpenAI structured output (function calling) would go here
      // For v1, we're not implementing this yet
    }

    return openaiRequest;
  }

  /**
   * Map OpenAI usage to normalized format
   */
  private mapUsage(usage: OpenAIUsage | undefined): NormalizedUsage {
    if (!usage) {
      return {
        inputTokens: undefined,
        outputTokens: undefined,
        totalTokens: undefined,
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
  private estimateCost(usage: OpenAIUsage | undefined): number | null {
    if (!usage) {
      return null;
    }

    // Simple cost estimation for GPT-3.5-turbo
    // Note: This should be updated with current pricing
    const inputCostPer1k = 0.0005; // $0.0005 per 1k input tokens
    const outputCostPer1k = 0.0015; // $0.0015 per 1k output tokens

    const inputCost = (usage.prompt_tokens / 1000) * inputCostPer1k;
    const outputCost = (usage.completion_tokens / 1000) * outputCostPer1k;

    const totalCost = inputCost + outputCost;
    const costInCents = Math.round(totalCost * 100);

    logger.debug('Cost estimated', {
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
      'gpt-3.5-turbo': 'GPT-3.5 Turbo',
      'gpt-4': 'GPT-4',
      'gpt-4-turbo': 'GPT-4 Turbo',
      'gpt-4-1-mini': 'GPT-4.1 Mini',
    };

    return modelNames[modelId] || modelId;
  }

  /**
   * Make HTTP request to OpenAI API
   */
  private async makeOpenAIRequest<T>(
    url: string,
    method: string,
    body?: Record<string, unknown>
  ): Promise<Response> {
    const timeoutMs = body?.['max_tokens']
      ? Math.min((body['max_tokens'] as number) * 10, OPENAI_TIMEOUT_MS)
      : OPENAI_TIMEOUT_MS;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

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

// OpenAI API response types
interface OpenAIModelsResponse {
  object: string;
  data: OpenAIModel[];
}

interface OpenAIModel {
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

interface OpenAIChatResponse {
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
  usage: OpenAIUsage;
}

interface OpenAIUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

/**
 * Create OpenAI adapter from configuration
 */
export function createOpenAIAdapter(config: AppConfig): OpenAIAdapter {
  return new OpenAIAdapter(config);
}
