/**
 * OpenAI-Compatible Provider Adapter Base
 *
 * Base class for providers that use OpenAI-compatible API format.
 * Used by OpenAI, Chutes.ai, and potentially other providers.
 */

import { getLogger } from '../infra/logger.js';
import {
  ProviderCapabilities,
  ModelInfo,
  NormalizedChatRequest,
  NormalizedChatResponse,
} from '../core/types.js';
import { createUpstreamError } from '../core/errors.js';
import { BaseProviderAdapter, HttpConfig, ProviderModelInfo } from './baseAdapter.js';

const logger = getLogger('openai-compatible-adapter');

/**
 * OpenAI API response types
 */
interface OpenAIModelsResponse {
  object: string;
  data: OpenAIModel[];
}

interface OpenAIModel {
  id: string;
  object: string;
  created: number;
  owned_by: string;
  context_window?: number;
  max_tokens?: number;
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
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Configuration for OpenAI-compatible adapter
 */
export interface OpenAICompatibleConfig extends HttpConfig {
  /** Default model to use if not specified */
  defaultModel?: string | undefined;
  /** Custom model name mappings */
  modelMappings?: Record<string, string> | undefined;
}

/**
 * Base adapter for OpenAI-compatible APIs
 */
export abstract class OpenAICompatibleAdapter extends BaseProviderAdapter {
  protected openAIConfig: OpenAICompatibleConfig;

  constructor(config: OpenAICompatibleConfig) {
    super(config);
    this.openAIConfig = config;
  }

  /**
   * List models using OpenAI /models endpoint
   */
  async listModels(): Promise<ModelInfo[]> {
    logger.debug(`Listing models for ${this.name}`);

    try {
      const response = await this.makeRequest<OpenAIModelsResponse>(
        `${this.httpConfig.baseUrl}/models`,
        'GET'
      );

      const data = await this.handleResponse<OpenAIModelsResponse>(response);

      return data.data.map((model) =>
        this.mapToModelInfo({
          id: model.id,
          name: this.getModelDisplayName(model.id),
          contextWindow: model.context_window,
          maxTokens: model.max_tokens,
        })
      );
    } catch (error) {
      this.logError('listModels', error);
      throw error;
    }
  }

  /**
   * Chat completion using OpenAI /chat/completions endpoint
   */
  async chat(request: NormalizedChatRequest): Promise<NormalizedChatResponse> {
    logger.debug(`${this.name} chat request`, {
      model: request.model,
      messageCount: request.messages.length,
    });

    const openAIRequest = this.mapToOpenAIRequest(request);

    try {
      const response = await this.makeRequest<OpenAIChatResponse>(
        `${this.httpConfig.baseUrl}/chat/completions`,
        'POST',
        openAIRequest
      );

      const data = await this.handleResponse<OpenAIChatResponse>(response);

      const normalized = this.mapFromOpenAIResponse(data, request);
      this.validateNormalizedResponse(normalized);
      return normalized;
    } catch (error) {
      this.logError('chat', error);
      throw error;
    }
  }

  /**
   * Map normalized request to OpenAI format
   */
  protected mapToOpenAIRequest(request: NormalizedChatRequest): Record<string, unknown> {
    const result: Record<string, unknown> = {
      model: request.model,
      messages: request.messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
      })),
    };

    if (request['temperature'] !== undefined) {
      result['temperature'] = request['temperature'];
    }

    if (request['maxTokens'] !== undefined) {
      result['max_tokens'] = request['maxTokens'];
    }

    return result;
  }

  /**
   * Map OpenAI response to normalized format
   */
  protected mapFromOpenAIResponse(
    response: OpenAIChatResponse,
    originalRequest: NormalizedChatRequest
  ): NormalizedChatResponse {
    const choice = response.choices[0];

    if (!choice) {
      throw createUpstreamError(this.name, 'No choices in response');
    }

    return {
      provider: this.name,
      model: response.model || originalRequest.model || 'unknown',
      outputText: choice.message.content || '',
      finishReason: this.normalizeFinishReason(choice.finish_reason || 'stop'),
      usage: this.createUsage({
        promptTokens: response.usage?.prompt_tokens || 0,
        completionTokens: response.usage?.completion_tokens || 0,
        totalTokens: response.usage?.total_tokens || 0,
      }),
      latencyMs: 0, // Will be set by router
      costEstimate: null,
      fallbackUsed: false,
      warnings: [],
    };
  }

  /**
   * Normalize OpenAI finish reason to standard format
   */
  protected normalizeFinishReason(reason: string): string {
    const reasonMap: Record<string, string> = {
      stop: 'stop',
      length: 'length',
      content_filter: 'content_filter',
      tool_calls: 'tool_calls',
      function_call: 'tool_calls',
    };

    return reasonMap[reason] ?? reason;
  }

  /**
   * Get display name for model - can be overridden for provider-specific naming
   */
  protected override getModelDisplayName(modelId: string): string {
    // Check for custom mappings first
    if (this.openAIConfig.modelMappings) {
      const mapped = this.openAIConfig.modelMappings[modelId];
      if (mapped) {
        return mapped;
      }
    }

    // Default OpenAI-style naming
    const modelNames: Record<string, string> = {
      'gpt-4o': 'GPT-4o',
      'gpt-4o-mini': 'GPT-4o Mini',
      'gpt-4-turbo': 'GPT-4 Turbo',
      'gpt-4': 'GPT-4',
      'gpt-3.5-turbo': 'GPT-3.5 Turbo',
    };

    return modelNames[modelId] ?? super.getModelDisplayName(modelId);
  }
}

/**
 * Factory for creating OpenAI-compatible adapters
 */
export function createOpenAICompatibleAdapter(
  name: string,
  config: OpenAICompatibleConfig,
  capabilities: ProviderCapabilities = {
    chat: true,
    structured: false,
    embeddings: false,
    streaming: true,
    vision: false,
  }
): OpenAICompatibleAdapter {
  return new (class extends OpenAICompatibleAdapter {
    readonly name = name;
    readonly capabilities = capabilities;
  })(config);
}
