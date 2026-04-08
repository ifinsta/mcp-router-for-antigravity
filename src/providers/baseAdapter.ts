/**
 * Base Provider Adapter
 *
 * Abstract base class that encapsulates common provider adapter functionality.
 * Eliminates duplication across provider implementations while maintaining
 * clean separation of concerns.
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
  ErrorCode,
} from '../core/errors.js';

const logger = getLogger('base-adapter');

/**
 * Configuration for HTTP requests
 */
export interface HttpConfig {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  authHeader?: string | undefined;
  authPrefix?: string | undefined;
}

/**
 * Provider-specific model information
 */
export interface ProviderModelInfo {
  id: string;
  name?: string | undefined;
  contextWindow?: number | undefined;
  maxTokens?: number | undefined;
  maxOutputTokens?: number | undefined;
  [key: string]: unknown;
}

/**
 * Provider-specific chat response
 */
export interface ProviderChatResponse {
  id: string;
  model: string;
  content: string;
  finishReason: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/**
 * Abstract base adapter implementing common functionality
 */
export abstract class BaseProviderAdapter implements ProviderAdapter {
  abstract readonly name: string;
  abstract readonly capabilities: ProviderCapabilities;
  
  protected httpConfig: HttpConfig;
  protected readonly defaultTimeoutMs: number = 60000;

  constructor(config: HttpConfig) {
    this.httpConfig = {
      authHeader: 'Authorization',
      authPrefix: 'Bearer',
      ...config,
    };
  }

  /**
   * List models - provider must implement model fetching
   */
  abstract listModels(): Promise<ModelInfo[]>;

  /**
   * Chat completion - provider must implement request/response mapping
   */
  abstract chat(request: NormalizedChatRequest): Promise<NormalizedChatResponse>;

  /**
   * Health check - default implementation, can be overridden
   */
  async healthCheck(): Promise<ProviderHealthStatus> {
    const startTime = Date.now();
    
    try {
      await this.listModels();
      return {
        provider: this.name,
        status: 'healthy',
        lastCheckAt: Date.now(),
        latencyMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        provider: this.name,
        status: 'unhealthy',
        lastCheckAt: Date.now(),
        latencyMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Make HTTP request with standardized error handling
   */
  protected async makeRequest<T>(
    url: string,
    method: string,
    body?: Record<string, unknown>
  ): Promise<Response> {
    const timeoutMs = this.calculateTimeout(body);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      // Add authentication header
      if (this.httpConfig.authHeader && this.httpConfig.authPrefix) {
        headers[this.httpConfig.authHeader] = `${this.httpConfig.authPrefix} ${this.httpConfig.apiKey}`;
      }

      const fetchOptions: RequestInit = {
        method,
        headers,
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
        throw createTimeoutError(this.name, method === 'GET' ? 'listModels' : 'chat', timeoutMs);
      }

      throw createNetworkError(this.name, error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Handle HTTP response with standardized error mapping
   */
  protected async handleResponse<T>(response: Response): Promise<T> {
    if (response.ok) {
      return response.json() as Promise<T>;
    }

    const errorText = await response.text().catch(() => 'Unknown error');
    
    // Map HTTP status to error type
    switch (response.status) {
      case 401:
      case 403:
        throw createAuthenticationError(
          this.name,
          `Authentication failed: ${errorText}`
        );
      
      case 429:
        throw createRateLimitedError(this.name);
      
      case 500:
      case 502:
      case 503:
      case 504:
        throw createUpstreamError(
          this.name,
          `Upstream error ${response.status}: ${errorText}`
        );
      
      default:
        throw createUpstreamError(
          this.name,
          `Request failed: ${response.status} - ${errorText}`
        );
    }
  }

  /**
   * Calculate request timeout based on expected tokens
   */
  protected calculateTimeout(body?: Record<string, unknown>): number {
    const maxTokens = body?.['max_tokens'] as number | undefined;
    if (maxTokens) {
      return Math.min(maxTokens * 10, this.httpConfig.timeoutMs);
    }
    return this.httpConfig.timeoutMs;
  }

  /**
   * Map provider model to normalized ModelInfo
   */
  protected mapToModelInfo(model: ProviderModelInfo): ModelInfo {
    return {
      id: model.id,
      name: model.name || this.getModelDisplayName(model.id),
      provider: this.name,
      capabilities: { ...this.capabilities },
      maxContextTokens: model.contextWindow,
      maxOutputTokens: model.maxOutputTokens || model.maxTokens,
    };
  }

  /**
   * Get display name for a model ID - can be overridden
   */
  protected getModelDisplayName(modelId: string): string {
    // Default: capitalize and clean up model ID
    return modelId
      .split('/')
      .pop()
      ?.replace(/-/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase()) || modelId;
  }

  /**
   * Create normalized usage from provider usage
   */
  protected createUsage(usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  }): NormalizedUsage {
    return {
      inputTokens: usage.promptTokens,
      outputTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
      accuracy: 'exact',
    };
  }

  /**
   * Log request/response for debugging
   */
  protected logRequest(method: string, url: string, body?: Record<string, unknown>): void {
    logger.debug(`${this.name} ${method} request`, {
      url: url.replace(this.httpConfig.apiKey, '[REDACTED]'),
      hasBody: !!body,
    });
  }

  /**
   * Validate a normalized chat response after extraction.
   *
   * Rejects:
   * - Empty or whitespace-only outputText
   * - Missing / falsy finishReason
   * - Structurally invalid usage (negative or NaN token counts)
   *
   * Call this after building the NormalizedChatResponse in every adapter.
   */
  protected validateNormalizedResponse(response: NormalizedChatResponse): void {
    validateNormalizedResponse(response, this.name);
  }

  /**
   * Log error with provider context
   */
  protected logError(operation: string, error: unknown): void {
    const sanitize = (msg: string): string => sanitizeUpstreamError(msg);

    if (isRouterError(error)) {
      logger.error(`${this.name} ${operation} failed`, {
        code: error.code,
        message: sanitize(error.message),
        provider: this.name,
      });
    } else {
      logger.error(`${this.name} ${operation} failed`, {
        error: sanitize(error instanceof Error ? error.message : String(error)),
      });
    }
  }
}

/**
 * Factory function type for creating adapters
 */
export type AdapterFactory<T extends BaseProviderAdapter> = (
  apiKey: string,
  baseUrl?: string,
  timeoutMs?: number
) => T;

/**
 * Validate a NormalizedChatResponse after extraction.
 *
 * Exported so adapters that do not extend BaseProviderAdapter (e.g. GLMAdapter)
 * can also call it.
 */
export function validateNormalizedResponse(
  response: NormalizedChatResponse,
  providerName: string,
): void {
  // 1. Reject empty / whitespace-only outputText
  if (!response.outputText || response.outputText.trim().length === 0) {
    throw createUpstreamError(
      providerName,
      'Provider returned empty response content',
    );
  }

  // 2. Reject missing finishReason
  if (!response.finishReason) {
    throw createUpstreamError(
      providerName,
      'Provider returned response without finishReason',
    );
  }

  // 3. Reject structurally invalid usage data
  if (response.usage !== null && response.usage !== undefined) {
    const usageFields: Array<{ key: string; value: number | undefined }> = [
      { key: 'inputTokens', value: response.usage.inputTokens },
      { key: 'outputTokens', value: response.usage.outputTokens },
      { key: 'totalTokens', value: response.usage.totalTokens },
    ];

    for (const { key, value } of usageFields) {
      if (value === undefined) continue; // absent is allowed
      if (typeof value !== 'number' || Number.isNaN(value)) {
        throw createUpstreamError(
          providerName,
          `Provider returned invalid usage: ${key} is NaN`,
        );
      }
      if (value < 0) {
        throw createUpstreamError(
          providerName,
          `Provider returned invalid usage: ${key} is negative (${value})`,
        );
      }
    }
  }
}

/**
 * Validate provider configuration
 */
export function validateProviderConfig(
  providerName: string,
  config: { apiKey?: string; baseUrl?: string } | undefined
): { apiKey: string; baseUrl: string } {
  if (!config) {
    throw new Error(`${providerName} configuration is missing`);
  }
  
  if (!config.apiKey) {
    throw new Error(`${providerName} API key is required`);
  }

  return {
    apiKey: config.apiKey,
    baseUrl: config.baseUrl || '',
  };
}
