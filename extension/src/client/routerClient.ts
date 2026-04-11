import * as vscode from 'vscode';
import { ExtensionConfig, getExtensionConfig } from '../config/settings';
import { getLogger } from '../infra/logger';
import { RouterConnectionError, RouterResponseError, sanitizeErrorMessage } from '../infra/errors';

const logger = getLogger('router-client');

/**
 * Browser auto-context response from the router
 */
export interface BrowserAutoContext {
  hasActiveSession: boolean;
  url: string;
  title: string;
  activeTabId: string | number;
  selectedText?: string;
  lastScreenshotTimestamp?: number;
}

/**
 * Normalized SSE chunk from the router
 * Matches ExtensionStreamChunk on the server side
 */
export interface RouterStreamChunk {
  type: 'text' | 'tool_call' | 'done' | 'error' | 'usage';
  content?: string;
  toolCallId?: string;
  toolCallName?: string;
  toolCallArgs?: string;
  finishReason?: string;
  errorCode?: string;
  errorMessage?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
}

/**
 * Model information as returned by the router
 */
export interface RouterModelInfo {
  id: string;
  name: string;
  provider: string;
  family: string;
  healthy: boolean;
  maxTokens?: number;
}

/**
 * Chat request to send to the router
 */
export interface RouterChatRequest {
  model: string;
  provider: string;
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
  }>;
  stream?: boolean;
  // Tool support
  tools?: Array<{
    type?: 'function';
    function?: {
      name: string;
      description: string;
      parameters: object;
    };
    name?: string;  // For Claude format
    description?: string;  // For Claude format
    input_schema?: object;  // For Claude format
  }>;
  tool_choice?: string | object | undefined;
}

/**
 * Parsed result from streaming response
 */
export interface StreamResult {
  /** Accumulated text content */
  text: string;
  /** Tool calls detected in the stream */
  toolCalls: Array<{
    id: string;
    name: string;
    arguments: string;
  }>;
  /** Finish reason */
  finishReason: string | null;
  /** Usage info if available */
  usage: RouterStreamChunk['usage'] | null;
}

/**
 * Chat response from the router (non-streaming)
 */
export interface RouterChatResponse {
  id: string;
  model: string;
  provider: string;
  choices: Array<{
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * HTTP client for communicating with the MCP Router backend
 */
export class RouterClient {
  private config: ExtensionConfig;
  /** Router version discovered on first health check */
  private routerVersion: string | null = null;

  constructor(config?: ExtensionConfig) {
    this.config = config ?? getExtensionConfig();
  }

  /**
   * Get the discovered router version (set after first health check)
   */
  get discoveredVersion(): string | null {
    return this.routerVersion;
  }

  get baseUrl(): string {
    return this.config.baseUrl;
  }

  get timeoutMs(): number {
    return this.config.timeout;
  }

  /**
   * Get the model catalog from the router
   */
  async getModelCatalog(healthyOnly?: boolean): Promise<RouterModelInfo[]> {
    const url = new URL(`${this.config.baseUrl}/api/extension/models`);
    if (healthyOnly) {
      url.searchParams.set('healthyOnly', 'true');
    }
    logger.debug(`Fetching model catalog from ${url.toString()}`);

    try {
      const response = await this.makeRequest(url.toString(), {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();
      
      if (!response.ok) {
        throw new RouterResponseError(
          `Failed to fetch model catalog: ${response.statusText}`,
          response.status,
          JSON.stringify(data)
        );
      }

      if (!data || typeof data !== 'object' || !('models' in data)) {
        throw new RouterResponseError('Invalid response format from router');
      }

      return (data as { models: RouterModelInfo[] }).models;
    } catch (error) {
      if (error instanceof RouterConnectionError || error instanceof RouterResponseError) {
        throw error;
      }
      
      const message = sanitizeErrorMessage(error);
      logger.error(`Failed to fetch model catalog: ${message}`, error);
      throw new RouterConnectionError(`Failed to connect to router at ${this.config.baseUrl}`, error);
    }
  }

  /**
   * Sync API keys to the router
   * @param apiKeys Map of provider name to API key
   */
  async syncApiKeys(apiKeys: Map<string, string>): Promise<void> {
    for (const [provider, apiKey] of apiKeys.entries()) {
      if (apiKey && apiKey.length > 0) {
        await this.updateApiKey(provider, apiKey);
      }
    }
  }

  /**
   * Update API key for a specific provider
   */
  private async updateApiKey(provider: string, apiKey: string): Promise<void> {
    const url = `${this.config.baseUrl}/api/extension/keys`;
    logger.info(`Syncing API key for provider: ${provider}`);

    try {
      const response = await this.makeRequest(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ provider, apiKey }),
      });

      const data = await response.json() as any;

      if (!response.ok) {
        logger.error(`Failed to update API key for ${provider}: ${data.message || response.statusText}`);
      } else {
        logger.info(`API key synced for provider: ${provider}`);
      }
    } catch (error) {
      logger.error(`Failed to sync API key for ${provider}`, error);
    }
  }

  /**
   * Send a chat request to the router (non-streaming)
   */
  async chat(request: RouterChatRequest): Promise<RouterChatResponse> {
    const url = `${this.config.baseUrl}/api/extension/chat`;
    logger.debug(`Sending chat request to ${url} for model ${request.model}`);

    try {
      const response = await this.makeRequest(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...request,
          stream: false,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new RouterResponseError(
          `Router returned error: ${response.statusText}`,
          response.status,
          JSON.stringify(data)
        );
      }

      return data as RouterChatResponse;
    } catch (error) {
      if (error instanceof RouterConnectionError || error instanceof RouterResponseError) {
        throw error;
      }

      const message = sanitizeErrorMessage(error);
      logger.error(`Chat request failed: ${message}`, error);
      throw new RouterConnectionError('Failed to send chat request to router', error);
    }
  }

  /**
   * Send a streaming chat request to the router
   * Returns an AsyncIterable of raw SSE chunk strings (for backward compat)
   * 
   * @deprecated Use chatStreamTyped instead for typed chunks
   */
  async *chatStream(request: RouterChatRequest): AsyncIterable<string> {
    for await (const chunk of this.chatStreamTyped(request)) {
      // Emit text content for backward compatibility
      if (chunk.type === 'text' && chunk.content) {
        yield JSON.stringify({
          choices: [{ delta: { content: chunk.content } }],
        });
      } else if (chunk.type === 'tool_call') {
        yield JSON.stringify({
          choices: [{ delta: { tool_calls: [{
            id: chunk.toolCallId,
            function: {
              name: chunk.toolCallName,
              arguments: chunk.toolCallArgs,
            },
          }] } }],
        });
      } else if (chunk.type === 'done') {
        yield JSON.stringify({
          choices: [{ delta: {}, finish_reason: chunk.finishReason }],
        });
      }
    }
  }

  /**
   * Send a streaming chat request to the router
   * Returns an AsyncIterable of typed SSE chunks
   */
  async *chatStreamTyped(
    request: RouterChatRequest,
    cancelToken?: vscode.CancellationToken
  ): AsyncIterable<RouterStreamChunk> {
    const url = `${this.config.baseUrl}/api/extension/chat`;
    logger.debug(`Sending streaming chat request to ${url} for model ${request.model}`);

    try {
      const response = await this.makeRequest(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...request,
          stream: true,
        }),
      }, cancelToken);

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new RouterResponseError(
          `Router returned error: ${response.statusText}`,
          response.status,
          data ? JSON.stringify(data) : undefined
        );
      }

      // Capture version header
      const versionHeader = response.headers.get('x-ifinplatform-router-version');
      if (versionHeader && versionHeader !== 'unknown') {
        this.routerVersion = versionHeader;
        logger.debug(`Router version: ${versionHeader}`);
      }

      if (!response.body) {
        throw new RouterResponseError('Response body is null');
      }

      // Parse SSE stream with typed chunks
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (true) {
          if (cancelToken?.isCancellationRequested) {
            logger.info('Streaming cancelled by token');
            reader.releaseLock();
            return;
          }

          const { done, value } = await reader.read();

          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          
          // Process SSE lines
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              
              if (data === '[DONE]') {
                return;
              }

              try {
                const chunk = JSON.parse(data) as RouterStreamChunk;
                
                // Validate chunk has required 'type' field
                if (!chunk.type) {
                  logger.warn('SSE chunk missing type field, skipping');
                  continue;
                }

                yield chunk;
              } catch (parseError) {
                logger.warn('Failed to parse SSE chunk', parseError);
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    } catch (error) {
      if (error instanceof RouterConnectionError || error instanceof RouterResponseError) {
        throw error;
      }

      const message = sanitizeErrorMessage(error);
      logger.error(`Streaming chat request failed: ${message}`, error);
      throw new RouterConnectionError('Failed to stream chat from router', error);
    }
  }

  /**
   * Count tokens for a text using the router
   */
  async countTokens(model: string, text: string): Promise<number> {
    const url = `${this.config.baseUrl}/api/extension/tokens`;
    logger.debug(`Counting tokens for model ${model}`);

    try {
      const response = await this.makeRequest(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model, text }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new RouterResponseError(
          `Failed to count tokens: ${response.statusText}`,
          response.status,
          JSON.stringify(data)
        );
      }

      if (!data || typeof data !== 'object' || !('token_count' in data)) {
        throw new RouterResponseError('Invalid token count response format');
      }

      return (data as { token_count: number }).token_count;
    } catch (error) {
      if (error instanceof RouterConnectionError || error instanceof RouterResponseError) {
        throw error;
      }

      const message = sanitizeErrorMessage(error);
      logger.error(`Token counting failed: ${message}`, error);
      // Return approximate count as fallback
      return text.length;
    }
  }

  /**
   * Get browser auto-context for AI injection
   */
  async getBrowserAutoContext(): Promise<BrowserAutoContext | null> {
    const url = `${this.config.baseUrl}/api/browser/auto-context`;
    logger.debug('Fetching browser auto-context');

    try {
      const response = await this.makeRequest(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        logger.warn(`Failed to fetch browser auto-context: ${response.statusText}`);
        return null;
      }

      const data = await response.json() as BrowserAutoContext;
      return data;
    } catch (error) {
      logger.debug('Browser auto-context fetch failed (browser may not be connected)', error);
      return null;
    }
  }

  /**
   * Health check for the router
   */
  async healthCheck(): Promise<boolean> {
    const url = `${this.config.baseUrl}/health`;
    
    try {
      const response = await this.makeRequest(url, {
        method: 'GET',
      });

      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Make an HTTP request with timeout and error handling
   */
  private async makeRequest(
    url: string,
    init: RequestInit,
    cancelToken?: vscode.CancellationToken
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    // Wire VS Code cancellation token to AbortController
    const cancelDisposable = cancelToken?.onCancellationRequested(() => {
      controller.abort();
    });

    try {
      return await fetch(url, {
        ...init,
        signal: controller.signal,
      });
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw new RouterConnectionError(
          `Request to router timed out after ${this.config.timeout}ms`
        );
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
      cancelDisposable?.dispose();
    }
  }
}
