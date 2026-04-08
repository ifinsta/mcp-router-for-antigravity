import { ExtensionConfig, getExtensionConfig } from '../config/settings';
import { getLogger } from '../infra/logger';
import { RouterConnectionError, RouterResponseError, sanitizeErrorMessage } from '../infra/errors';

const logger = getLogger('router-client');

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

  constructor(config?: ExtensionConfig) {
    this.config = config ?? getExtensionConfig();
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
   * Returns an AsyncIterable of text chunks
   */
  async *chatStream(request: RouterChatRequest): AsyncIterable<string> {
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
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new RouterResponseError(
          `Router returned error: ${response.statusText}`,
          response.status,
          data ? JSON.stringify(data) : undefined
        );
      }

      if (!response.body) {
        throw new RouterResponseError('Response body is null');
      }

      // Parse SSE stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (true) {
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
                const parsed = JSON.parse(data);
                const content = parsed.choices?.[0]?.delta?.content;
                
                if (content) {
                  yield content;
                }
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
  private async makeRequest(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

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
    }
  }
}
