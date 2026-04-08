/**
 * Extension API Server
 * 
 * HTTP server that exposes API endpoints for the Antigravity extension
 * This runs alongside the MCP stdio server
 */

import http from 'http';
import { loadAndValidateConfig, updateProviderApiKey } from '../infra/config.js';
import { getLogger } from '../infra/logger.js';
import { getProvider, getAllProviders, getProviderHealth } from '../core/registry.js';
import { getHealth } from '../core/health.js';

const logger = getLogger('extension-api');

/**
 * Request body type for chat endpoint
 */
interface ExtensionChatRequest {
  model: string;
  provider: string;
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
  }>;
  stream?: boolean;
}

/**
 * Request body type for token counting
 */
interface ExtensionTokenRequest {
  model: string;
  text: string;
}

/**
 * Request body type for API key updates
 */
interface ExtensionApiKeyRequest {
  provider: string;
  apiKey: string;
}

/**
 * Create the extension API server
 */
export function createExtensionAPIServer(port: number = 3000): http.Server {
  const server = http.createServer(async (req, res) => {
    // Set CORS headers for local development
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      // Parse URL for route matching (handles query parameters)
      const url = new URL(req.url ?? '/', 'http://localhost');

      // Route requests using pathname (ignores query parameters)
      if (req.method === 'GET' && url.pathname === '/api/extension/models') {
        await handleGetModels(req, res);
      } else if (req.method === 'POST' && url.pathname === '/api/extension/chat') {
        await handleChat(req, res);
      } else if (req.method === 'POST' && url.pathname === '/api/extension/tokens') {
        await handleTokenCount(req, res);
      } else if (req.method === 'POST' && url.pathname === '/api/extension/keys') {
        await handleUpdateApiKey(req, res);
      } else if (req.method === 'GET' && url.pathname === '/health') {
        await handleHealth(req, res);
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
      }
    } catch (error) {
      logger.error('Extension API error', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      }));
    }
  });

  return server;
}

/**
 * Handle GET /api/extension/models
 * Returns the model catalog for the extension
 */
async function handleGetModels(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  logger.debug('Fetching model catalog for extension');

  try {
    const config = loadAndValidateConfig();
    
    // Parse query parameters
    const url = new URL(req.url ?? '/api/extension/models', 'http://localhost');
    const healthyOnly = url.searchParams.get('healthyOnly') === 'true';
    
    // Get all registered providers
    const providerNames = getAllProviders();
    const models: Array<{
      id: string;
      name: string;
      provider: string;
      family: string;
      healthy: boolean;
      maxTokens?: number | undefined;
    }> = [];

    for (const providerName of providerNames) {
      try {
        const provider = getProvider(providerName);
        const providerModels = await provider.listModels();
        
        // Check health
        let isHealthy = true;
        try {
          const healthStatus = await getProviderHealth(providerName);
          isHealthy = healthStatus.status === 'healthy' || healthStatus.status === 'degraded';
        } catch {
          isHealthy = false;
        }

        for (const model of providerModels) {
          models.push({
            id: `${providerName}:${model.id}`,
            name: `${model.name} (via MCP Router)`,
            provider: providerName,
            family: model.id,
            healthy: isHealthy,
            maxTokens: model.maxContextTokens,
          });
        }
      } catch (error) {
        logger.warn(`Failed to list models for provider ${providerName}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    // Filter by health status if requested
    const filteredModels = healthyOnly ? models.filter((m) => m.healthy) : models;

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ models: filteredModels }));
  } catch (error) {
    logger.error('Failed to fetch model catalog', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Failed to fetch model catalog',
      message: error instanceof Error ? error.message : 'Unknown error',
    }));
  }
}

/**
 * Handle POST /api/extension/chat
 * Execute a chat request (streaming or non-streaming)
 */
async function handleChat(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const body = await readRequestBody<ExtensionChatRequest>(req);
  
  if (!body || !body.model || !body.provider || !body.messages) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing required fields: model, provider, messages' }));
    return;
  }

  logger.debug(`Processing chat request for ${body.provider}/${body.model}`);

  try {
    // Get the provider
    const provider = getProvider(body.provider);
    
    if (!provider) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Provider '${body.provider}' not found` }));
      return;
    }

    // Normalize the request
    const normalizedRequest = {
      provider: body.provider,
      model: body.model,
      messages: body.messages,
      stream: body.stream ?? false,
    };

    // Execute the request
    const response = await provider.chat(normalizedRequest);

    if (body.stream) {
      // For now, send as non-streaming (streaming would require SSE implementation)
      // TODO: Implement proper SSE streaming
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: `chat-${Date.now()}`,
        model: body.model,
        provider: body.provider,
        choices: [{
          message: {
            role: 'assistant',
            content: response.outputText,
          },
          finish_reason: response.finishReason,
        }],
        usage: response.usage ? {
          prompt_tokens: response.usage.inputTokens ?? 0,
          completion_tokens: response.usage.outputTokens ?? 0,
          total_tokens: response.usage.totalTokens ?? 0,
        } : undefined,
      }));
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: `chat-${Date.now()}`,
        model: body.model,
        provider: body.provider,
        choices: [{
          message: {
            role: 'assistant',
            content: response.outputText,
          },
          finish_reason: response.finishReason,
        }],
        usage: response.usage ? {
          prompt_tokens: response.usage.inputTokens ?? 0,
          completion_tokens: response.usage.outputTokens ?? 0,
          total_tokens: response.usage.totalTokens ?? 0,
        } : undefined,
      }));
    }
  } catch (error) {
    logger.error('Chat request failed', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Chat request failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    }));
  }
}

/**
 * Handle POST /api/extension/tokens
 * Count tokens for a given text
 */
async function handleTokenCount(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const body = await readRequestBody<ExtensionTokenRequest>(req);
  
  if (!body || !body.model || !body.text) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing required fields: model, text' }));
    return;
  }

  logger.debug(`Counting tokens for model ${body.model}`);

  try {
    // Approximate token counting (1 token ≈ 4 characters for English text)
    // For accurate counting, we'd need to call the provider's tokenizer
    const tokenCount = Math.ceil(body.text.length / 4);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ token_count: tokenCount }));
  } catch (error) {
    logger.error('Token counting failed', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Token counting failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    }));
  }
}

/**
 * Handle GET /health
 * Health check endpoint
 */
async function handleHealth(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const health = await getHealth();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(health));
  } catch (error) {
    logger.error('Health check failed', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Health check failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    }));
  }
}

/**
 * Handle POST /api/extension/keys
 * Updates a provider's API key at runtime
 */
async function handleUpdateApiKey(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const remoteAddr = req.socket.remoteAddress;
  if (remoteAddr !== '127.0.0.1' && remoteAddr !== '::1' && remoteAddr !== '::ffff:127.0.0.1') {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Forbidden: endpoint is localhost-only' }));
    return;
  }

  logger.info('API key update request received');

  try {
    const body = await readRequestBody<ExtensionApiKeyRequest>(req);

    // Validate request body
    if (!body.provider || !body.apiKey) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Bad request',
        message: 'Missing required fields: provider and apiKey',
      }));
      return;
    }

    const { provider, apiKey } = body;

    // Update the API key
    updateProviderApiKey(provider, apiKey);

    logger.info(`API key updated for provider: ${provider}`);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      message: `API key updated for ${provider}`,
      provider,
    }));
  } catch (error) {
    logger.error('Failed to update API key', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Failed to update API key',
      message: error instanceof Error ? error.message : 'Unknown error',
    }));
  }
}

/**
 * Read and parse request body
 */
function readRequestBody<T>(req: http.IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let body = '';
    
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) as T : {} as T);
      } catch (error) {
        reject(new Error('Invalid JSON body'));
      }
    });
    
    req.on('error', reject);
  });
}

/**
 * Start the extension API server
 */
export function startExtensionAPIServer(): http.Server {
  const config = loadAndValidateConfig();
  const port = config.server?.extensionApiPort ?? 3000;
  
  const server = createExtensionAPIServer(port);
  
  server.listen(port, () => {
    logger.info(`Extension API server started on port ${port}`);
  });

  server.on('error', (error) => {
    logger.error('Extension API server error', error);
  });

  return server;
}
