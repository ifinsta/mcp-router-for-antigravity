/**
 * Anthropic Provider Adapter
 *
 * Handles Anthropic-specific API integration, request/response mapping, and error handling.
 * Anthropic's Messages API differs significantly from OpenAI's chat/completions API:
 *   - Endpoint: /v1/messages
 *   - Auth: x-api-key header (no Bearer prefix)
 *   - Different request/response shapes
 *
 * Extends BaseProviderAdapter with custom request/response mapping.
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
  isRouterError,
  sanitizeUpstreamError,
  createAuthenticationError,
  createRateLimitedError,
  createTimeoutError,
  createNetworkError,
} from '../core/errors.js';
import { AppConfig } from '../infra/config.js';
import { BaseProviderAdapter, validateNormalizedResponse } from './baseAdapter.js';

const logger = getLogger('anthropic-adapter');

// Anthropic API configuration
const ANTHROPIC_API_BASE_URL = 'https://api.anthropic.com';
const ANTHROPIC_TIMEOUT_MS = 120000;
const ANTHROPIC_API_VERSION = '2023-06-01';

// ============================================================================
// Anthropic API types
// ============================================================================

interface AnthropicContentBlock {
  type: string;
  text?: string | undefined;
}

interface AnthropicMessagesResponse {
  id: string;
  type: string;
  role: string;
  content: AnthropicContentBlock[];
  model: string;
  stop_reason: string | null;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

interface AnthropicErrorResponse {
  type: string;
  error: {
    type: string;
    message: string;
  };
}

// ============================================================================
// Model catalog
// ============================================================================

interface AnthropicModelDef {
  id: string;
  name: string;
  contextWindow: number;
  maxOutputTokens: number;
}

const ANTHROPIC_MODELS: AnthropicModelDef[] = [
  {
    id: 'claude-3-5-sonnet-20241022',
    name: 'Claude 3.5 Sonnet',
    contextWindow: 200000,
    maxOutputTokens: 8192,
  },
  {
    id: 'claude-3-5-haiku-20241022',
    name: 'Claude 3.5 Haiku',
    contextWindow: 200000,
    maxOutputTokens: 8192,
  },
  {
    id: 'claude-3-opus-20240229',
    name: 'Claude 3 Opus',
    contextWindow: 200000,
    maxOutputTokens: 4096,
  },
  {
    id: 'claude-3-haiku-20240307',
    name: 'Claude 3 Haiku',
    contextWindow: 200000,
    maxOutputTokens: 4096,
  },
];

// ============================================================================
// Adapter implementation
// ============================================================================

/**
 * Anthropic Adapter Implementation
 *
 * Uses Anthropic Messages API (not OpenAI-compatible).
 */
export class AnthropicAdapter extends BaseProviderAdapter {
  readonly name = 'anthropic';
  readonly capabilities: ProviderCapabilities = {
    chat: true,
    structured: false,
    embeddings: false,
    streaming: true,
    vision: true,
  };

  private apiKey: string;
  private baseUrl: string;

  constructor(config: AppConfig) {
    const providerCfg = config.providers.anthropic;
    if (!providerCfg) {
      throw new Error('Anthropic configuration is missing');
    }

    const baseUrl = providerCfg.baseUrl ?? ANTHROPIC_API_BASE_URL;

    super({
      baseUrl,
      apiKey: providerCfg.apiKey,
      timeoutMs: ANTHROPIC_TIMEOUT_MS,
      // Anthropic uses x-api-key without a prefix, so we override makeRequest below
      authHeader: 'x-api-key',
      authPrefix: undefined,
    });

    this.apiKey = providerCfg.apiKey;
    this.baseUrl = baseUrl;

    logger.info('Anthropic adapter initialized', {
      baseUrl: this.baseUrl,
      hasApiKey: !!this.apiKey,
    });
  }

  // --------------------------------------------------------------------------
  // listModels — Anthropic has no list-models endpoint; return static catalog
  // --------------------------------------------------------------------------

  async listModels(): Promise<ModelInfo[]> {
    logger.debug('Listing Anthropic models (static catalog)');
    return ANTHROPIC_MODELS.map((m) => ({
      id: m.id,
      name: m.name,
      provider: this.name,
      capabilities: { ...this.capabilities },
      maxContextTokens: m.contextWindow,
      maxOutputTokens: m.maxOutputTokens,
    }));
  }

  // --------------------------------------------------------------------------
  // chat — Anthropic Messages API
  // --------------------------------------------------------------------------

  async chat(request: NormalizedChatRequest): Promise<NormalizedChatResponse> {
    const startTime = Date.now();
    logger.debug('Executing Anthropic chat', {
      model: request.model,
      messageCount: request.messages.length,
    });

    try {
      const anthropicRequest = this.mapToAnthropicRequest(request);

      const response = await this.makeAnthropicRequest(
        `${this.baseUrl}/v1/messages`,
        'POST',
        anthropicRequest,
      );

      const latencyMs = Date.now() - startTime;

      if (!response.ok) {
        await this.handleAnthropicError(response);
      }

      const data = (await response.json()) as AnthropicMessagesResponse;

      // Validate response structure
      if (!data.content || !Array.isArray(data.content)) {
        throw createUpstreamError(this.name, 'Invalid response: missing content array');
      }

      const normalizedResponse = this.mapFromAnthropicResponse(data, request, latencyMs);
      this.validateNormalizedResponse(normalizedResponse);

      logger.info('Anthropic chat completed successfully', {
        model: normalizedResponse.model,
        finishReason: normalizedResponse.finishReason,
        latencyMs,
        usage: normalizedResponse.usage,
      });

      return normalizedResponse;
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      logger.error('Anthropic chat failed', {
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
  // Request mapping
  // --------------------------------------------------------------------------

  private mapToAnthropicRequest(request: NormalizedChatRequest): Record<string, unknown> {
    // Anthropic separates system prompt from messages
    const systemMessages = request.messages.filter((m) => m.role === 'system');
    const nonSystemMessages = request.messages.filter((m) => m.role !== 'system');

    const result: Record<string, unknown> = {
      model: request.model ?? 'claude-3-5-sonnet-20241022',
      max_tokens: request.maxTokens ?? 4096,
      messages: nonSystemMessages.map((msg) => ({
        role: msg.role,
        content: msg.content,
      })),
    };

    if (systemMessages.length > 0) {
      result['system'] = systemMessages.map((m) => m.content).join('\n\n');
    }

    if (request.temperature !== undefined) {
      result['temperature'] = request.temperature;
    }

    return result;
  }

  // --------------------------------------------------------------------------
  // Response mapping
  // --------------------------------------------------------------------------

  private mapFromAnthropicResponse(
    response: AnthropicMessagesResponse,
    originalRequest: NormalizedChatRequest,
    latencyMs: number,
  ): NormalizedChatResponse {
    // Extract text from content blocks
    const textBlocks = response.content.filter(
      (block) => block.type === 'text' && block.text !== undefined,
    );
    const outputText = textBlocks.map((block) => block.text ?? '').join('');

    return {
      provider: this.name,
      model: response.model || originalRequest.model || 'unknown',
      outputText,
      finishReason: this.normalizeStopReason(response.stop_reason),
      usage: this.mapAnthropicUsage(response.usage),
      latencyMs,
      costEstimate: this.estimateCost(response.usage),
      warnings: [],
      fallbackUsed: false,
    };
  }

  // --------------------------------------------------------------------------
  // Usage mapping
  // --------------------------------------------------------------------------

  private mapAnthropicUsage(
    usage: { input_tokens: number; output_tokens: number } | undefined,
  ): NormalizedUsage {
    if (!usage) {
      return { accuracy: 'unavailable' };
    }

    return {
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      totalTokens: usage.input_tokens + usage.output_tokens,
      accuracy: 'exact',
    };
  }

  // --------------------------------------------------------------------------
  // Finish-reason normalisation
  // --------------------------------------------------------------------------

  private normalizeStopReason(stopReason: string | null): string {
    if (!stopReason) return 'stop';
    const map: Record<string, string> = {
      end_turn: 'stop',
      max_tokens: 'length',
      stop_sequence: 'stop',
      tool_use: 'tool_calls',
    };
    return map[stopReason] ?? stopReason;
  }

  // --------------------------------------------------------------------------
  // Cost estimation
  // --------------------------------------------------------------------------

  private estimateCost(
    usage: { input_tokens: number; output_tokens: number } | undefined,
  ): number | null {
    if (!usage) return null;

    // Claude 3.5 Sonnet pricing (default estimate)
    const inputCostPer1k = 0.003;
    const outputCostPer1k = 0.015;

    const inputCost = (usage.input_tokens / 1000) * inputCostPer1k;
    const outputCost = (usage.output_tokens / 1000) * outputCostPer1k;

    return Math.round((inputCost + outputCost) * 10000) / 10000;
  }

  // --------------------------------------------------------------------------
  // HTTP helpers (custom for Anthropic's auth model)
  // --------------------------------------------------------------------------

  private async makeAnthropicRequest(
    url: string,
    method: string,
    body?: Record<string, unknown>,
  ): Promise<Response> {
    const timeoutMs = body?.['max_tokens']
      ? Math.min((body['max_tokens'] as number) * 10, ANTHROPIC_TIMEOUT_MS)
      : ANTHROPIC_TIMEOUT_MS;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const fetchOptions: RequestInit = {
        method,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': ANTHROPIC_API_VERSION,
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

  private async handleAnthropicError(response: Response): Promise<never> {
    const errorText = await response.text().catch(() => 'Unknown error');

    // Try to parse structured Anthropic error
    let errorType = '';
    try {
      const parsed = JSON.parse(errorText) as AnthropicErrorResponse;
      if (parsed.error?.type) {
        errorType = parsed.error.type;
      }
    } catch {
      // ignore parse failure
    }

    switch (response.status) {
      case 401:
        throw createAuthenticationError(this.name, 'Invalid API key');
      case 403:
        throw createAuthenticationError(
          this.name,
          `Forbidden: ${sanitizeUpstreamError(errorText)}`,
        );
      case 429:
        throw createRateLimitedError(this.name);
      case 500:
      case 502:
      case 503:
      case 529:
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
 * Create Anthropic adapter from configuration
 */
export function createAnthropicAdapter(config: AppConfig): AnthropicAdapter {
  return new AnthropicAdapter(config);
}
