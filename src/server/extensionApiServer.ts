/**
 * Extension API Server
 *
 * HTTP server that exposes API endpoints for the local IDE extension layer
 * This runs alongside the MCP stdio server
 */

import http from 'http';
import { loadAndValidateConfig, updateProviderApiKey, getModeConfig, updateMode } from '../infra/config.js';
import { getLogger } from '../infra/logger.js';
import { getProvider, getAllProviders, getProviderHealth } from '../core/registry.js';
import { getHealth } from '../core/health.js';
import { ExtensionStreamChunk } from '../core/types.js';
import { getExtensionBridge } from '../browser/extensionBridge.js';
import { getBrowserContextProvider } from '../core/browserContext.js';
import { getSecurityEngine } from '../resilience/securityPolicy.js';
import { getEvidenceCapsuleCollector } from '../core/evidenceCapsule.js';
import { getFailureClassifier } from '../core/failureClassifier.js';
import { getAssertionEvaluator } from '../core/assertionModel.js';
import { getFixVerifier } from '../core/fixVerification.js';
import { getRootCauseMapper } from '../core/rootCauseMapper.js';
import { getFlakeAnalyzer } from '../core/flakeAnalyzer.js';
import { BROWSER_CAPABILITY_MATRIX } from '../core/browserContract.js';
import { getWorkflowRecorder } from '../core/workflowRecorder.js';
import { getPRSummaryGenerator } from '../core/prSummaryGenerator.js';

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
  tools?: Array<{
    type?: 'function';
    function?: {
      name: string;
      description: string;
      parameters: object;
    };
    name?: string;
    description?: string;
    input_schema?: object;
  }>;
  tool_choice?: string | object;
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
      } else if (req.method === 'GET' && url.pathname === '/api/browser/status') {
        await handleBrowserStatus(req, res);
      } else if (req.method === 'GET' && url.pathname === '/api/browser/context') {
        await handleBrowserContext(req, res);
      } else if (req.method === 'POST' && url.pathname === '/api/browser/screenshot') {
        await handleBrowserScreenshot(req, res);
      } else if (req.method === 'POST' && url.pathname === '/api/browser/command') {
        await handleBrowserCommand(req, res);
      } else if (req.method === 'GET' && url.pathname === '/api/mode') {
        await handleGetMode(req, res);
      } else if (req.method === 'POST' && url.pathname === '/api/mode') {
        await handleUpdateMode(req, res);
      } else if (req.method === 'GET' && url.pathname === '/api/security/policy') {
        await handleGetSecurityPolicy(req, res);
      } else if (req.method === 'GET' && url.pathname === '/api/security/audit-log') {
        await handleGetSecurityAuditLog(req, res);
      } else if (req.method === 'GET' && url.pathname === '/api/browser/capabilities') {
        await handleBrowserCapabilities(req, res);
      } else if (req.method === 'GET' && url.pathname === '/api/browser/tabs') {
        await handleBrowserTabs(req, res);
      } else if (req.method === 'POST' && url.pathname === '/api/evidence/capture') {
        await handleEvidenceCapture(req, res);
      } else if (req.method === 'GET' && url.pathname === '/api/evidence') {
        await handleEvidenceList(req, res);
      } else if (req.method === 'POST' && url.pathname.match(/^\/api\/evidence\/[^/]+\/explain$/)) {
        await handleEvidenceExplain(req, res);
      } else if (req.method === 'GET' && url.pathname.startsWith('/api/evidence/')) {
        await handleEvidenceGet(req, res);
      } else if (req.method === 'POST' && url.pathname === '/api/assertions/evaluate') {
        await handleAssertionEvaluate(req, res);
      } else if (req.method === 'GET' && url.pathname === '/api/browser/auto-context') {
        await handleBrowserAutoContext(req, res);
      } else if (req.method === 'POST' && url.pathname.match(/^\/api\/evidence\/[^/]+\/root-cause$/)) {
        await handleEvidenceRootCause(req, res);
      } else if (req.method === 'POST' && url.pathname === '/api/verification/run') {
        await handleVerificationRun(req, res);
      } else if (req.method === 'POST' && url.pathname === '/api/evidence/flake-analysis') {
        await handleFlakeAnalysis(req, res);
      } else if (req.method === 'POST' && url.pathname === '/api/recorder/start') {
        await handleRecorderStart(req, res);
      } else if (req.method === 'POST' && url.pathname === '/api/recorder/stop') {
        await handleRecorderStop(req, res);
      } else if (req.method === 'GET' && url.pathname.startsWith('/api/recorder/workflow/')) {
        await handleRecorderGetWorkflow(req, res);
      } else if (req.method === 'GET' && url.pathname === '/api/recorder/workflows') {
        await handleRecorderListWorkflows(req, res);
      } else if (req.method === 'POST' && url.pathname === '/api/pr-summary/generate') {
        await handlePRSummaryGenerate(req, res);
      } else if (req.method === 'GET' && url.pathname.match(/^\/api\/pr-summary\/[^/]+$/)) {
        await handlePRSummaryGet(req, res);
      } else if (req.method === 'GET' && url.pathname.match(/^\/api\/pr-summary\/[^/]+\/markdown$/)) {
        await handlePRSummaryMarkdown(req, res);
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
      ...(body.tools ? { tools: body.tools } : {}),
      ...(body.tool_choice !== undefined ? { tool_choice: body.tool_choice } : {}),
    };

    // Execute the request
    const response = await provider.chat(normalizedRequest);

    if (body.stream) {
      // Real SSE streaming: chunk the response text into word-sized pieces
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-IfinPlatform-Router-Version': getRouterVersion(),
      });

      // Send text content as streaming chunks (word-by-word for smooth UX)
      const words = response.outputText.split(/(\s+)/); // split keeping whitespace
      for (const word of words) {
        if (res.destroyed || res.writableEnded) break;
        if (word) {
          const chunk: ExtensionStreamChunk = {
            type: 'text',
            content: word,
          };
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }
      }

      // Send usage info if available
      if (response.usage) {
        const usageChunk: ExtensionStreamChunk = {
          type: 'usage',
          usage: response.usage,
        };
        res.write(`data: ${JSON.stringify(usageChunk)}\n\n`);
      }

      // Send done marker
      const doneChunk: ExtensionStreamChunk = {
        type: 'done',
        finishReason: response.finishReason,
      };
      res.write(`data: ${JSON.stringify(doneChunk)}\n\n`);
      res.end();
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
    
    // If we've already started streaming, send error as SSE
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Chat request failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      }));
    } else {
      const errorChunk: ExtensionStreamChunk = {
        type: 'error',
        errorCode: 'CHAT_FAILED',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      };
      res.write(`data: ${JSON.stringify(errorChunk)}\n\n`);
      res.end();
    }
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
 * Health check endpoint with version and browser bridge info
 */
async function handleHealth(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const health = await getHealth();

    // Query ExtensionBridge for real browser connection status
    const bridge = getExtensionBridge();
    const connectedExtensions = bridge.getConnectedExtensions();

    // Enrich health response with version and browser info
    const enrichedHealth = {
      ...health,
      version: getRouterVersion(),
      apiVersion: 2, // Bumped for SSE streaming + typed chunks
      browserBridge: {
        connected: connectedExtensions.length > 0,
        tabCount: connectedExtensions.length,
      },
    };

    res.writeHead(200, { 
      'Content-Type': 'application/json',
      'X-IfinPlatform-Router-Version': getRouterVersion(),
    });
    res.end(JSON.stringify(enrichedHealth));
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
 * Handle GET /api/browser/status
 * Returns browser extension connection status
 */
async function handleBrowserStatus(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const bridge = getExtensionBridge();
    const connectedExtensions = bridge.getConnectedExtensions();
    
    const connected = connectedExtensions.length > 0;
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      connected,
      tabCount: connectedExtensions.length,
      activeTab: connected ? {
        tabId: 0, // TODO: Get actual active tab from extension
        url: '',
        title: '',
        active: true,
      } : null,
    }));
  } catch (error) {
    logger.error('Browser status check failed', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Browser status check failed' }));
  }
}

/**
 * Handle GET /api/browser/context
 * Returns current browser tab context for chat injection
 */
async function handleBrowserContext(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const bridge = getExtensionBridge();
    const connectedExtensions = bridge.getConnectedExtensions();
    
    if (connectedExtensions.length === 0) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        url: '',
        title: '',
        selectedText: '',
        metaDescription: '',
      }));
      return;
    }

    // Query the extension for current page info
    const pageInfo = await bridge.getPageInfo();
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      url: (pageInfo['url'] as string) ?? '',
      title: (pageInfo['title'] as string) ?? '',
      selectedText: (pageInfo['selectedText'] as string) ?? '',
      metaDescription: (pageInfo['metaDescription'] as string) ?? '',
    }));
  } catch (error) {
    logger.error('Browser context capture failed', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Browser context capture failed' }));
  }
}

/**
 * Handle GET /api/browser/auto-context
 * Returns compact browser context for AI injection with hasActiveSession flag
 */
async function handleBrowserAutoContext(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const provider = getBrowserContextProvider();
    const hasActiveSession = provider.hasActiveSession();
    const context = await provider.getContext();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      hasActiveSession,
      ...(context ?? {
        url: '',
        title: '',
        activeTabId: 0,
      }),
    }));
  } catch (error) {
    logger.error('Browser auto-context fetch failed', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Browser auto-context fetch failed',
      hasActiveSession: false,
    }));
  }
}

/**
 * Handle POST /api/browser/screenshot
 * Returns base64 PNG screenshot of current tab
 */
async function handleBrowserScreenshot(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const bridge = getExtensionBridge();
    const connectedExtensions = bridge.getConnectedExtensions();
    
    if (connectedExtensions.length === 0) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No browser extension connected' }));
      return;
    }

    // Request screenshot from extension
    const extensionId = connectedExtensions[0]!;
    const result = await bridge.sendCommand(extensionId, 'screenshot', {
      fullPage: false,
      format: 'png',
    });

    const resultObj = result as Record<string, unknown> | null;
    const image = (resultObj?.['image'] as string) ?? null;
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ image }));
  } catch (error) {
    logger.error('Browser screenshot failed', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Browser screenshot failed' }));
  }
}

/**
 * Handle POST /api/browser/command
 * Execute a browser command via the WebSocket bridge
 */
async function handleBrowserCommand(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const body = await readRequestBody<{ type: string; payload: Record<string, unknown>; tabId?: number }>(req);
    
    if (!body || !body.type) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing required field: type' }));
      return;
    }

    const bridge = getExtensionBridge();
    const connectedExtensions = bridge.getConnectedExtensions();
    
    if (connectedExtensions.length === 0) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        success: false, 
        error: 'No browser extension connected',
      }));
      return;
    }

    // Forward command to Chrome extension via WebSocket bridge
    const extensionId = connectedExtensions[0]!;
    logger.debug(`Browser command received: ${body.type}, forwarding to extension`);
    
    const result = await bridge.sendCommand(extensionId, body.type, body.payload);
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      data: result,
    }));
  } catch (error) {
    logger.error('Browser command execution failed', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      success: false,
      error: error instanceof Error ? error.message : 'Browser command execution failed',
    }));
  }
}

/**
 * Handle GET /api/mode
 * Returns current mode configuration
 */
async function handleGetMode(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const modeConfig = getModeConfig();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(modeConfig));
  } catch (error) {
    logger.error('Failed to get mode configuration', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Failed to get mode configuration',
      message: error instanceof Error ? error.message : 'Unknown error',
    }));
  }
}

/**
 * Handle POST /api/mode
 * Updates the current mode (localhost only)
 */
async function handleUpdateMode(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  // Check localhost-only (same pattern as /api/extension/keys)
  const remoteAddr = req.socket.remoteAddress;
  if (remoteAddr !== '127.0.0.1' && remoteAddr !== '::1' && remoteAddr !== '::ffff:127.0.0.1') {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Forbidden: endpoint is localhost-only' }));
    return;
  }

  logger.info('Mode update request received');

  try {
    const body = await readRequestBody<{ mode: string }>(req);

    // Validate request body
    if (!body || !body.mode) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Bad request',
        message: 'Missing required field: mode',
      }));
      return;
    }

    const { mode } = body;

    // Validate mode value
    if (mode !== 'agent' && mode !== 'router') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Bad request',
        message: 'Invalid mode. Must be "agent" or "router".',
      }));
      return;
    }

    // Update the mode
    updateMode(mode, 'user_selection');
    const updatedConfig = getModeConfig();

    logger.info(`Mode updated to: ${mode}`);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(updatedConfig));
  } catch (error) {
    logger.error('Failed to update mode', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Failed to update mode',
      message: error instanceof Error ? error.message : 'Unknown error',
    }));
  }
}

/**
 * Handle GET /api/security/policy
 * Returns current security policy configuration
 */
async function handleGetSecurityPolicy(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const securityEngine = getSecurityEngine();
    const state = securityEngine.getState();
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(state.config));
  } catch (error) {
    logger.error('Failed to get security policy', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Failed to get security policy',
      message: error instanceof Error ? error.message : 'Unknown error',
    }));
  }
}

/**
 * Handle GET /api/browser/capabilities
 * Returns browser capability matrix
 */
async function handleBrowserCapabilities(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      matrix: BROWSER_CAPABILITY_MATRIX,
    }));
  } catch (error) {
    logger.error('Failed to get browser capabilities', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Failed to get browser capabilities',
      message: error instanceof Error ? error.message : 'Unknown error',
    }));
  }
}

/**
 * Handle GET /api/browser/tabs
 * Returns list of managed tabs from the multiTabManager
 */
async function handleBrowserTabs(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const bridge = getExtensionBridge();
    const connectedExtensions = bridge.getConnectedExtensions();

    // Return empty array if no browser bridge connected
    if (connectedExtensions.length === 0) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ tabs: [] }));
      return;
    }

    // Get tabs from the extension bridge
    const extensionId = connectedExtensions[0]!;
    const result = await bridge.sendCommand(extensionId, 'getTabs', {});

    // Normalize the response to expected format
    const tabs = Array.isArray(result) ? result.map((tab: unknown) => {
      const t = tab as Record<string, unknown>;
      return {
        tabId: String(t['tabId'] ?? t['id'] ?? ''),
        url: String(t['url'] ?? ''),
        title: String(t['title'] ?? ''),
        isActive: Boolean(t['isActive'] ?? t['active'] ?? false),
      };
    }) : [];

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ tabs }));
  } catch (error) {
    logger.error('Failed to get browser tabs', error);
    // Return empty array on error rather than failing
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ tabs: [] }));
  }
}

/**
 * Handle GET /api/security/audit-log
 * Returns audit log entries (optional query: ?limit=100)
 */
async function handleGetSecurityAuditLog(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const url = new URL(req.url ?? '/api/security/audit-log', 'http://localhost');
    const limitParam = url.searchParams.get('limit');
    const limit = limitParam ? parseInt(limitParam, 10) : 100;
    
    // Validate limit
    const validLimit = Number.isFinite(limit) && limit > 0 ? limit : 100;
    
    const securityEngine = getSecurityEngine();
    const auditLog = securityEngine.getAuditLog();
    
    // Return the most recent entries up to the limit
    const limitedLog = auditLog.slice(-validLimit);
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      entries: limitedLog,
      total: auditLog.length,
      returned: limitedLog.length,
    }));
  } catch (error) {
    logger.error('Failed to get security audit log', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Failed to get security audit log',
      message: error instanceof Error ? error.message : 'Unknown error',
    }));
  }
}

/**
 * Handle POST /api/evidence/capture
 * Captures a new evidence capsule
 */
async function handleEvidenceCapture(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const body = await readRequestBody<{ failure: { type: string; message: string; stack?: string } }>(req);

    if (!body || !body.failure || !body.failure.type || !body.failure.message) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Bad request',
        message: 'Missing required fields: failure.type and failure.message',
      }));
      return;
    }

    const collector = getEvidenceCapsuleCollector();
    const capsule = await collector.capture({
      type: body.failure.type,
      message: body.failure.message,
      ...(body.failure.stack !== undefined ? { stack: body.failure.stack } : {}),
    });

    logger.info('Evidence capsule captured via API', { capsuleId: capsule.capsuleId });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(capsule));
  } catch (error) {
    logger.error('Failed to capture evidence capsule', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Failed to capture evidence capsule',
      message: error instanceof Error ? error.message : 'Unknown error',
    }));
  }
}

/**
 * Handle GET /api/evidence
 * Lists all evidence capsule summaries
 */
async function handleEvidenceList(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const collector = getEvidenceCapsuleCollector();
    const capsules = collector.list();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      capsules,
      total: capsules.length,
    }));
  } catch (error) {
    logger.error('Failed to list evidence capsules', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Failed to list evidence capsules',
      message: error instanceof Error ? error.message : 'Unknown error',
    }));
  }
}

/**
 * Handle GET /api/evidence/:capsuleId
 * Returns a specific evidence capsule by ID
 */
async function handleEvidenceGet(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const pathname = url.pathname;

    // Extract capsuleId from pathname: /api/evidence/:capsuleId
    const capsuleId = pathname.substring('/api/evidence/'.length);

    if (!capsuleId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing capsuleId in path' }));
      return;
    }

    const collector = getEvidenceCapsuleCollector();
    const capsule = collector.get(capsuleId);

    if (!capsule) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Capsule not found', capsuleId }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(capsule));
  } catch (error) {
    logger.error('Failed to get evidence capsule', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Failed to get evidence capsule',
      message: error instanceof Error ? error.message : 'Unknown error',
    }));
  }
}

/**
 * Handle POST /api/evidence/:capsuleId/explain
 * Returns a failure explanation for an evidence capsule
 */
async function handleEvidenceExplain(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const pathname = url.pathname;

    // Extract capsuleId from pathname: /api/evidence/:capsuleId/explain
    const match = pathname.match(/^\/api\/evidence\/([^/]+)\/explain$/);
    if (!match || !match[1]) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid URL format' }));
      return;
    }

    const capsuleId = match[1];

    const collector = getEvidenceCapsuleCollector();
    const capsule = collector.get(capsuleId);

    if (!capsule) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Capsule not found', capsuleId }));
      return;
    }

    const classifier = getFailureClassifier();
    const explanation = classifier.classify(capsule);

    logger.info('Failure explanation generated', { capsuleId, failureClass: explanation.failureClass });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(explanation));
  } catch (error) {
    logger.error('Failed to explain evidence capsule', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Failed to explain evidence capsule',
      message: error instanceof Error ? error.message : 'Unknown error',
    }));
  }
}

// ============================================================================
// PR Summary Endpoints
// ============================================================================

/**
 * Handle POST /api/pr-summary/generate
 * Generates a PR summary from an evidence capsule
 */
async function handlePRSummaryGenerate(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const body = await readRequestBody<{ capsuleId: string }>(req);

    if (!body || !body.capsuleId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Bad request',
        message: 'Missing required field: capsuleId',
      }));
      return;
    }

    // Verify capsule exists
    const collector = getEvidenceCapsuleCollector();
    const capsule = collector.get(body.capsuleId);

    if (!capsule) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Capsule not found',
        capsuleId: body.capsuleId,
      }));
      return;
    }

    const generator = getPRSummaryGenerator();
    const summary = await generator.generate(body.capsuleId);

    logger.info('PR summary generated via API', {
      summaryId: summary.id,
      capsuleId: summary.capsuleId,
      failureClass: summary.probableRootCause.failureExplanation.failureClass,
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(summary));
  } catch (error) {
    logger.error('Failed to generate PR summary', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Failed to generate PR summary',
      message: error instanceof Error ? error.message : 'Unknown error',
    }));
  }
}

/**
 * Handle GET /api/pr-summary/:id
 * Returns a specific PR summary by ID
 */
async function handlePRSummaryGet(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const pathname = url.pathname;

    // Extract summaryId from pathname: /api/pr-summary/:id
    const summaryId = pathname.substring('/api/pr-summary/'.length);

    if (!summaryId || summaryId.includes('/')) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid summary ID format' }));
      return;
    }

    const generator = getPRSummaryGenerator();
    const summary = generator.getSummary(summaryId);

    if (!summary) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Summary not found', summaryId }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(summary));
  } catch (error) {
    logger.error('Failed to get PR summary', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Failed to get PR summary',
      message: error instanceof Error ? error.message : 'Unknown error',
    }));
  }
}

/**
 * Handle GET /api/pr-summary/:id/markdown
 * Returns PR summary markdown as text/plain
 */
async function handlePRSummaryMarkdown(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const pathname = url.pathname;

    // Extract summaryId from pathname: /api/pr-summary/:id/markdown
    const match = pathname.match(/^\/api\/pr-summary\/([^/]+)\/markdown$/);
    if (!match || !match[1]) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid URL format' }));
      return;
    }

    const summaryId = match[1];

    const generator = getPRSummaryGenerator();
    const summary = generator.getSummary(summaryId);

    if (!summary) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Summary not found', summaryId }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(summary.markdown);
  } catch (error) {
    logger.error('Failed to get PR summary markdown', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Failed to get PR summary markdown',
      message: error instanceof Error ? error.message : 'Unknown error',
    }));
  }
}

// ============================================================================
// Assertion Evaluation Endpoints
// ============================================================================

/**
 * Handle POST /api/assertions/evaluate
 * Evaluates assertions for a given evidence capsule
 */
async function handleAssertionEvaluate(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const body = await readRequestBody<{ capsuleId: string }>(req);

    if (!body || !body.capsuleId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Bad request',
        message: 'Missing required field: capsuleId',
      }));
      return;
    }

    const collector = getEvidenceCapsuleCollector();
    const capsule = collector.get(body.capsuleId);

    if (!capsule) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Capsule not found',
        capsuleId: body.capsuleId,
      }));
      return;
    }

    const evaluator = getAssertionEvaluator();
    const result = evaluator.evaluate(capsule);

    logger.info('Assertion evaluation completed via API', {
      capsuleId: result.capsuleId,
      totalChecks: result.totalChecks,
      passed: result.passed,
      failed: result.failed,
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (error) {
    logger.error('Failed to evaluate assertions', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Failed to evaluate assertions',
      message: error instanceof Error ? error.message : 'Unknown error',
    }));
  }
}

// ============================================================================
// Fix Verification Endpoints
// ============================================================================

/**
 * Handle POST /api/verification/run
 * Runs fix verification against an original evidence capsule
 */
async function handleVerificationRun(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const body = await readRequestBody<{ patchId: string; originalCapsuleId: string; rerunCount?: number }>(req);

    if (!body || !body.patchId || !body.originalCapsuleId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Bad request',
        message: 'Missing required fields: patchId and originalCapsuleId',
      }));
      return;
    }

    // Validate rerunCount if provided
    const rerunCount = body.rerunCount ?? 3;
    if (!Number.isInteger(rerunCount) || rerunCount < 1 || rerunCount > 10) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Bad request',
        message: 'rerunCount must be an integer between 1 and 10',
      }));
      return;
    }

    // Check if original capsule exists
    const collector = getEvidenceCapsuleCollector();
    const capsule = collector.get(body.originalCapsuleId);

    if (!capsule) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Capsule not found',
        capsuleId: body.originalCapsuleId,
      }));
      return;
    }

    const verifier = getFixVerifier();
    const result = await verifier.verify(body.patchId, body.originalCapsuleId, rerunCount);

    logger.info('Verification completed via API', {
      patchId: result.patchId,
      verdict: result.overallVerdict,
      rerunCount: result.reruns.length,
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (error) {
    logger.error('Failed to run verification', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Failed to run verification',
      message: error instanceof Error ? error.message : 'Unknown error',
    }));
  }
}

// ============================================================================
// Flake Analysis Endpoints
// ============================================================================

/**
 * Handle POST /api/evidence/flake-analysis
 * Analyzes multiple evidence capsules for flaky test/failure patterns
 */
async function handleFlakeAnalysis(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const body = await readRequestBody<{ capsuleIds: string[] }>(req);

    if (!body || !body.capsuleIds || !Array.isArray(body.capsuleIds)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Bad request',
        message: 'Missing required field: capsuleIds (array)',
      }));
      return;
    }

    if (body.capsuleIds.length === 0) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Bad request',
        message: 'capsuleIds array cannot be empty',
      }));
      return;
    }

    const analyzer = getFlakeAnalyzer();
    const result = await analyzer.analyze(body.capsuleIds);

    logger.info('Flake analysis completed via API', {
      capsuleCount: body.capsuleIds.length,
      isFlaky: result.isFlaky,
      failureClass: result.failureClass,
      recommendedAction: result.recommendedAction,
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (error) {
    logger.error('Failed to run flake analysis', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Failed to run flake analysis',
      message: error instanceof Error ? error.message : 'Unknown error',
    }));
  }
}

// ============================================================================
// Root Cause Mapping Endpoints
// ============================================================================

/**
 * Handle POST /api/evidence/:capsuleId/root-cause
 * Maps an evidence capsule to actionable root cause insights
 */
async function handleEvidenceRootCause(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const pathname = url.pathname;

    // Extract capsuleId from pathname: /api/evidence/:capsuleId/root-cause
    const match = pathname.match(/^\/api\/evidence\/([^/]+)\/root-cause$/);
    if (!match || !match[1]) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid URL format' }));
      return;
    }

    const capsuleId = match[1];

    const mapper = getRootCauseMapper();
    const mapping = await mapper.map(capsuleId);

    logger.info('Root cause mapping generated via API', {
      capsuleId,
      failureClass: mapping.failureExplanation.failureClass,
      component: mapping.likelyComponent,
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(mapping));
  } catch (error) {
    // Check if it's a "not found" error
    if (error instanceof Error && error.message.includes('not found')) {
      const match = error.message.match(/not found: (.+)$/);
      const capsuleId = match ? match[1] : 'unknown';
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Capsule not found',
        capsuleId,
      }));
      return;
    }

    logger.error('Failed to map root cause', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Failed to map root cause',
      message: error instanceof Error ? error.message : 'Unknown error',
    }));
  }
}

// ============================================================================
// Workflow Recorder Endpoints
// ============================================================================

/**
 * Handle POST /api/recorder/start
 * Start a new workflow recording session
 */
async function handleRecorderStart(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const body = await readRequestBody<{ name: string }>(req);

    if (!body || !body.name) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Bad request',
        message: 'Missing required field: name',
      }));
      return;
    }

    const recorder = getWorkflowRecorder();
    const workflowId = recorder.startRecording(body.name);

    logger.info('Workflow recording started via API', { workflowId, name: body.name });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ workflowId }));
  } catch (error) {
    logger.error('Failed to start recording', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Failed to start recording',
      message: error instanceof Error ? error.message : 'Unknown error',
    }));
  }
}

/**
 * Handle POST /api/recorder/stop
 * Stop a workflow recording session
 */
async function handleRecorderStop(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const body = await readRequestBody<{ workflowId: string }>(req);

    if (!body || !body.workflowId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Bad request',
        message: 'Missing required field: workflowId',
      }));
      return;
    }

    const recorder = getWorkflowRecorder();
    const workflow = recorder.stopRecording(body.workflowId);

    logger.info('Workflow recording stopped via API', {
      workflowId: body.workflowId,
      actionCount: workflow.actions.length,
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(workflow));
  } catch (error) {
    logger.error('Failed to stop recording', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Failed to stop recording',
      message: error instanceof Error ? error.message : 'Unknown error',
    }));
  }
}

/**
 * Handle GET /api/recorder/workflow/:id
 * Get a specific workflow by ID
 */
async function handleRecorderGetWorkflow(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const pathname = url.pathname;

    // Extract workflowId from pathname: /api/recorder/workflow/:id
    const workflowId = pathname.substring('/api/recorder/workflow/'.length);

    if (!workflowId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing workflowId in path' }));
      return;
    }

    const recorder = getWorkflowRecorder();
    const workflow = recorder.getWorkflow(workflowId);

    if (!workflow) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Workflow not found', workflowId }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(workflow));
  } catch (error) {
    logger.error('Failed to get workflow', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Failed to get workflow',
      message: error instanceof Error ? error.message : 'Unknown error',
    }));
  }
}

/**
 * Handle GET /api/recorder/workflows
 * List all recorded workflows
 */
async function handleRecorderListWorkflows(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const recorder = getWorkflowRecorder();
    const workflows = recorder.listWorkflows();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      workflows,
      total: workflows.length,
    }));
  } catch (error) {
    logger.error('Failed to list workflows', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Failed to list workflows',
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
 * Get the router version string for API versioning headers.
 * Returns the version from package.json or 'unknown' if unavailable.
 */
function getRouterVersion(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkg = require('../../package.json') as { version?: string };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
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
