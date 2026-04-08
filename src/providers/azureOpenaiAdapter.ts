/**
 * Azure OpenAI Provider Adapter
 *
 * Handles Azure OpenAI-specific API integration.
 * Azure OpenAI is OpenAI-compatible but uses a different URL pattern and auth mechanism:
 *   - URL: https://{resource}.openai.azure.com/openai/deployments/{deployment}/chat/completions?api-version={version}
 *   - Auth: api-key header (no Bearer prefix)
 *
 * Extends BaseProviderAdapter with custom HTTP handling for Azure's URL/auth scheme
 * while reusing OpenAI-compatible request/response mapping.
 */

import { getLogger } from '../infra/logger.js';
import {
  ProviderCapabilities,
  ModelInfo,
  NormalizedChatRequest,
  NormalizedChatResponse,
  NormalizedUsage,
} from '../core/types.js';
import {
  createUpstreamError,
  createAuthenticationError,
  createRateLimitedError,
  createTimeoutError,
  createNetworkError,
  isRouterError,
  sanitizeUpstreamError,
} from '../core/errors.js';
import { AppConfig } from '../infra/config.js';
import { BaseProviderAdapter, validateNormalizedResponse } from './baseAdapter.js';

const logger = getLogger('azure-openai-adapter');

// Azure OpenAI defaults
const AZURE_OPENAI_DEFAULT_API_VERSION = '2024-02-01';
const AZURE_OPENAI_TIMEOUT_MS = 120000;

// ============================================================================
// Azure OpenAI response types (OpenAI-compatible)
// ============================================================================

interface AzureOpenAIChatResponse {
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

// ============================================================================
// Model catalog
// ============================================================================

interface AzureModelDef {
  id: string;
  name: string;
  contextWindow: number;
  maxOutputTokens: number;
}

/**
 * Default Azure OpenAI models — actual availability depends on deployment configuration.
 */
const AZURE_OPENAI_MODELS: AzureModelDef[] = [
  {
    id: 'gpt-4o',
    name: 'GPT-4o (Azure)',
    contextWindow: 128000,
    maxOutputTokens: 4096,
  },
  {
    id: 'gpt-4',
    name: 'GPT-4 (Azure)',
    contextWindow: 128000,
    maxOutputTokens: 4096,
  },
  {
    id: 'gpt-35-turbo',
    name: 'GPT-3.5 Turbo (Azure)',
    contextWindow: 16384,
    maxOutputTokens: 4096,
  },
];

// ============================================================================
// Azure-specific configuration
// ============================================================================

export interface AzureOpenAIProviderConfig {
  apiKey: string;
  resource: string;
  deployment: string;
  apiVersion?: string | undefined;
  baseUrl?: string | undefined;
}

// ============================================================================
// Adapter implementation
// ============================================================================

/**
 * Azure OpenAI Adapter Implementation
 *
 * Uses OpenAI-compatible request/response format with Azure-specific URL and auth.
 */
export class AzureOpenAIAdapter extends BaseProviderAdapter {
  readonly name = 'azure-openai';
  readonly capabilities: ProviderCapabilities = {
    chat: true,
    structured: false,
    embeddings: false,
    streaming: true,
    vision: false,
  };

  private apiKey: string;
  private resource: string;
  private deployment: string;
  private apiVersion: string;

  constructor(config: AppConfig) {
    const providerCfg = config.providers['azure-openai'] as AzureOpenAIProviderConfig | undefined;
    if (!providerCfg) {
      throw new Error('Azure OpenAI configuration is missing');
    }

    if (!providerCfg.resource) {
      throw new Error('Azure OpenAI resource name is required');
    }
    if (!providerCfg.deployment) {
      throw new Error('Azure OpenAI deployment name is required');
    }

    const baseUrl =
      providerCfg.baseUrl ??
      `https://${providerCfg.resource}.openai.azure.com`;

    super({
      baseUrl,
      apiKey: providerCfg.apiKey,
      timeoutMs: AZURE_OPENAI_TIMEOUT_MS,
      authHeader: 'api-key',
      authPrefix: undefined,
    });

    this.apiKey = providerCfg.apiKey;
    this.resource = providerCfg.resource;
    this.deployment = providerCfg.deployment;
    this.apiVersion = providerCfg.apiVersion ?? AZURE_OPENAI_DEFAULT_API_VERSION;

    logger.info('Azure OpenAI adapter initialized', {
      resource: this.resource,
      deployment: this.deployment,
      apiVersion: this.apiVersion,
      hasApiKey: !!this.apiKey,
    });
  }

  // --------------------------------------------------------------------------
  // listModels — Azure has no public models endpoint; return static catalog
  // --------------------------------------------------------------------------

  async listModels(): Promise<ModelInfo[]> {
    logger.debug('Listing Azure OpenAI models (static catalog)');
    return AZURE_OPENAI_MODELS.map((m) => ({
      id: m.id,
      name: m.name,
      provider: this.name,
      capabilities: { ...this.capabilities },
      maxContextTokens: m.contextWindow,
      maxOutputTokens: m.maxOutputTokens,
    }));
  }

  // --------------------------------------------------------------------------
  // chat — OpenAI-compatible with Azure URL pattern
  // --------------------------------------------------------------------------

  async chat(request: NormalizedChatRequest): Promise<NormalizedChatResponse> {
    const startTime = Date.now();
    logger.debug('Executing Azure OpenAI chat', {
      model: request.model,
      deployment: this.deployment,
      messageCount: request.messages.length,
    });

    try {
      const openaiRequest = this.mapToOpenAIRequest(request);

      const chatUrl =
        `${this.httpConfig.baseUrl}/openai/deployments/${this.deployment}` +
        `/chat/completions?api-version=${this.apiVersion}`;

      const response = await this.makeAzureRequest(chatUrl, 'POST', openaiRequest);
      const latencyMs = Date.now() - startTime;

      if (!response.ok) {
        await this.handleAzureError(response);
      }

      const data = (await response.json()) as AzureOpenAIChatResponse;

      if (!data.choices || data.choices.length === 0) {
        throw createUpstreamError(this.name, 'No completion choices returned');
      }

      const choice = data.choices[0];
      if (!choice) {
        throw createUpstreamError(this.name, 'No completion choices returned');
      }

      const message = choice.message;
      if (!message || message.role !== 'assistant') {
        throw createUpstreamError(this.name, 'Unexpected response structure');
      }

      const normalizedResponse: NormalizedChatResponse = {
        provider: this.name,
        model: data.model || request.model || this.deployment,
        outputText: message.content || '',
        finishReason: this.normalizeFinishReason(choice.finish_reason || 'stop'),
        usage: this.mapOpenAIUsage(data.usage),
        latencyMs,
        costEstimate: this.estimateCost(data.usage),
        warnings: [],
        fallbackUsed: false,
      };

      this.validateNormalizedResponse(normalizedResponse);

      logger.info('Azure OpenAI chat completed successfully', {
        model: normalizedResponse.model,
        finishReason: normalizedResponse.finishReason,
        latencyMs,
        usage: normalizedResponse.usage,
      });

      return normalizedResponse;
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      logger.error('Azure OpenAI chat failed', {
        latencyMs,
        error: sanitizeUpstreamError(error instanceof Error ? error.message : String(error)),
      });

      if (isRouterError(error)) {
        throw error;
      }

      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw createNetworkError(this.name, 'Network error', error);
      }

      throw createUpstreamError(
        this.name,
        'Unknown error during chat',
        error instanceof Error ? error : undefined,
      );
    }
  }

  // --------------------------------------------------------------------------
  // Request mapping (OpenAI-compatible)
  // --------------------------------------------------------------------------

  private mapToOpenAIRequest(request: NormalizedChatRequest): Record<string, unknown> {
    const result: Record<string, unknown> = {
      messages: request.messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
      })),
    };

    // Azure uses deployment for model selection; don't send model in body
    if (request.temperature !== undefined) {
      result['temperature'] = request.temperature;
    }

    if (request.maxTokens !== undefined) {
      result['max_tokens'] = request.maxTokens;
    }

    return result;
  }

  // --------------------------------------------------------------------------
  // Response helpers
  // --------------------------------------------------------------------------

  private normalizeFinishReason(reason: string): string {
    const map: Record<string, string> = {
      stop: 'stop',
      length: 'length',
      content_filter: 'content_filter',
      tool_calls: 'tool_calls',
      function_call: 'tool_calls',
    };
    return map[reason] ?? reason;
  }

  private mapOpenAIUsage(
    usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | undefined,
  ): NormalizedUsage {
    if (!usage) {
      return { accuracy: 'unavailable' };
    }
    return {
      inputTokens: usage.prompt_tokens,
      outputTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens,
      accuracy: 'exact',
    };
  }

  private estimateCost(
    usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | undefined,
  ): number | null {
    if (!usage) return null;

    // Azure OpenAI pricing varies by model and agreement — use GPT-4o estimate
    const inputCostPer1k = 0.005;
    const outputCostPer1k = 0.015;

    const inputCost = (usage.prompt_tokens / 1000) * inputCostPer1k;
    const outputCost = (usage.completion_tokens / 1000) * outputCostPer1k;

    return Math.round((inputCost + outputCost) * 10000) / 10000;
  }

  // --------------------------------------------------------------------------
  // HTTP helpers (custom for Azure auth)
  // --------------------------------------------------------------------------

  private async makeAzureRequest(
    url: string,
    method: string,
    body?: Record<string, unknown>,
  ): Promise<Response> {
    const timeoutMs = body?.['max_tokens']
      ? Math.min((body['max_tokens'] as number) * 10, AZURE_OPENAI_TIMEOUT_MS)
      : AZURE_OPENAI_TIMEOUT_MS;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const fetchOptions: RequestInit = {
        method,
        headers: {
          'Content-Type': 'application/json',
          'api-key': this.apiKey,
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

  // --------------------------------------------------------------------------
  // Error handling
  // --------------------------------------------------------------------------

  private async handleAzureError(response: Response): Promise<never> {
    const errorText = await response.text().catch(() => 'Unknown error');

    switch (response.status) {
      case 401:
      case 403:
        throw createAuthenticationError(
          this.name,
          `Authentication failed: ${sanitizeUpstreamError(errorText)}`,
        );
      case 404:
        throw createUpstreamError(
          this.name,
          `Deployment not found — check resource/deployment config: ${sanitizeUpstreamError(errorText)}`,
        );
      case 429:
        throw createRateLimitedError(this.name);
      case 500:
      case 502:
      case 503:
      case 504:
        throw createUpstreamError(
          this.name,
          `Upstream error ${response.status}: ${sanitizeUpstreamError(errorText)}`,
        );
      default:
        throw createUpstreamError(
          this.name,
          `Request failed: ${response.status} - ${sanitizeUpstreamError(errorText)}`,
        );
    }
  }
}

/**
 * Create Azure OpenAI adapter from configuration
 */
export function createAzureOpenAIAdapter(config: AppConfig): AzureOpenAIAdapter {
  return new AzureOpenAIAdapter(config);
}
