import * as vscode from 'vscode';
import { RouterClient } from '../client/routerClient';
import { getExtensionConfig, validateConfig } from '../config/settings';
import { getLogger } from '../infra/logger';
import { sanitizeErrorMessage } from '../infra/errors';
import { ApiKeyManager } from '../client/apiKeyManager';
import { ModelCatalog } from './modelCatalog';
import { mapToRouterRequest, parseModelId } from './requestMapper';
import { 
  streamRouterResponse, 
  hasToolCalls, 
  extractToolCalls,
  extractTextFromChunk 
} from './responseMapper';
import { ToolMapper } from './toolMapper';
import { ToolExecutor } from './toolExecutor';

const logger = getLogger('lm-provider');

/**
 * Main Language Model Chat Provider implementation
 * Bridges the editor chat UI with the MCP Router backend
 */
export class McpRouterLanguageModelProvider implements vscode.LanguageModelChatProvider, vscode.Disposable {
  private client: RouterClient;
  private catalog: ModelCatalog;
  private apiKeyManager: ApiKeyManager;
  private disposables: vscode.Disposable[] = [];

  /**
   * Event that fires when the available set of models changes.
   * VS Code listens to this to re-query provideLanguageModelChatInformation.
   */
  private readonly _onDidChangeLanguageModelChatInformation = new vscode.EventEmitter<void>();
  readonly onDidChangeLanguageModelChatInformation = this._onDidChangeLanguageModelChatInformation.event;

  constructor(context: vscode.ExtensionContext, apiKeyManager: ApiKeyManager) {
    this.client = new RouterClient();
    this.catalog = new ModelCatalog(this.client);
    this.apiKeyManager = apiKeyManager;

    this.disposables.push(this._onDidChangeLanguageModelChatInformation);

    // Sync API keys to router on initialization, then notify model change
    this.syncApiKeysToRouter().then(() => {
      // Signal that models are ready after initial setup
      logger.info('Firing onDidChangeLanguageModelChatInformation after API key sync');
      this._onDidChangeLanguageModelChatInformation.fire();
    }).catch(() => {
      // Even if sync fails, still notify — fallback models should appear
      logger.info('Firing onDidChangeLanguageModelChatInformation after API key sync failure');
      this._onDidChangeLanguageModelChatInformation.fire();
    });

    // Fire a second event after a short delay to ensure VS Code has fully initialized the provider
    setTimeout(() => {
      logger.info('Firing delayed onDidChangeLanguageModelChatInformation (2s delay)');
      this._onDidChangeLanguageModelChatInformation.fire();
    }, 2000);

    // Listen for configuration changes
    const configListener = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('mcpRouter')) {
        // Validate new configuration before applying changes
        const newConfig = getExtensionConfig();
        const errors = validateConfig(newConfig);
        if (errors.length > 0) {
          vscode.window.showErrorMessage(`ifin Platform config error: ${errors[0]}`);
          logger.error('Configuration validation failed', errors);
          return;
        }

        logger.info('Configuration changed, refreshing model catalog');
        this.catalog.invalidateCache();
        
        // Reinitialize client with new config
        this.client = new RouterClient();
        this.catalog = new ModelCatalog(this.client);
        
        // Re-sync API keys on any mcpRouter config change
        logger.info('Configuration changed, syncing API keys to router');
        this.syncApiKeysToRouter().then(() => {
          logger.info('Firing onDidChangeLanguageModelChatInformation after config change');
          this._onDidChangeLanguageModelChatInformation.fire();
        }).catch(() => {
          logger.info('Firing onDidChangeLanguageModelChatInformation after config change (sync failed)');
          this._onDidChangeLanguageModelChatInformation.fire();
        });
      }
    });

    this.disposables.push(configListener);
  }

  /**
   * Sync API keys from ApiKeyManager to router
   */
  private async syncApiKeysToRouter(): Promise<void> {
    try {
      const providers = this.apiKeyManager.getSupportedProviders();
      const apiKeys = new Map<string, string>();

      for (const provider of providers) {
        const key = await this.apiKeyManager.getApiKey(provider.provider);
        if (key && key.length > 0) {
          apiKeys.set(provider.provider, key);
        }
      }

      await this.client.syncApiKeys(apiKeys);
      logger.info('API keys synced to router successfully');
    } catch (error) {
      logger.error('Failed to sync API keys to router', error);
    }
  }

  /**
   * Provide the list of available language models
   * This determines what appears in Antigravity's model selector
   */
  async provideLanguageModelChatInformation(
    _options: vscode.PrepareLanguageModelChatModelOptions,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelChatInformation[]> {
    logger.info(`[MODEL-INFO] Providing language model information (silent=${_options.silent})...`);

    try {
      const models = await this.catalog.getModels();

      const vscodeModels = models.map((model) => ModelCatalog.toVSCodeModel(model));

      logger.info(`[MODEL-INFO] Returning ${vscodeModels.length} models for selector: ${vscodeModels.map(m => m.name).join(', ')}`);
      return vscodeModels;
    } catch (error) {
      logger.error('[MODEL-INFO] Failed to provide language model information', error);
      // Return default catalog rather than empty - ensures models always appear
      const fallback = ModelCatalog.getDefaultModels().map(m => ModelCatalog.toVSCodeModel(m));
      logger.info(`[MODEL-INFO] Returning ${fallback.length} fallback models for selector`);
      return fallback;
    }
  }

  /**
   * Handle a chat request for a specific model
   * This is called when the user sends a message with one of our models selected
   */
  async provideLanguageModelChatResponse(
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken
  ): Promise<void> {
    logger.info(`Processing chat request for model: ${model.id}`);

    try {
      const { provider } = parseModelId(model.id);
      
      // Check if tools are available
      const hasTools = options.tools && options.tools.length > 0;
      
      if (hasTools) {
        logger.info(`Tools available: ${options.tools!.length} tools, mode: ${options.toolMode}`);
        // Use tool calling loop
        await this.handleToolCallingLoop(
          model,
          messages,
          options,
          progress,
          token
        );
      } else {
        // Simple chat without tools
        await this.handleSimpleChat(
          model,
          messages,
          progress,
          token
        );
      }

      logger.info('Chat request completed successfully');
    } catch (error) {
      const errorMessage = sanitizeErrorMessage(error);
      logger.error(`Chat request failed for model ${model.id}: ${errorMessage}`, error);

      // Report error as text to the user
      const errorText = this.formatErrorMessage(error, model);
      progress.report(new vscode.LanguageModelTextPart(errorText));
    }
  }

  /**
   * Handle simple chat request without tools
   */
  private async handleSimpleChat(
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken
  ): Promise<void> {
    // Map VS Code messages to router request format
    const routerRequest = mapToRouterRequest(model, messages);

    // Stream the response from router to Antigravity
    const responseStream = this.client.chatStream(routerRequest);

    await streamRouterResponse(responseStream, progress, token);
  }

  /**
   * Handle chat request with tool calling loop
   */
  private async handleToolCallingLoop(
    model: vscode.LanguageModelChatInformation,
    initialMessages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken
  ): Promise<void> {
    const { provider } = parseModelId(model.id);
    const executor = new ToolExecutor();
    
    // Convert to mutable array
    let messages = [...initialMessages] as vscode.LanguageModelChatMessage[];
    
    // Maximum tool calling iterations to prevent infinite loops
    const MAX_TOOL_ITERATIONS = 10;
    let iteration = 0;

    while (iteration < MAX_TOOL_ITERATIONS) {
      iteration++;
      logger.info(`Tool calling iteration ${iteration}/${MAX_TOOL_ITERATIONS}`);

      // Map messages to router request format with tools
      const requestOptions: {
        tools?: readonly vscode.LanguageModelChatTool[];
        toolMode?: vscode.LanguageModelChatToolMode;
      } = {};
      
      if (options.tools) {
        requestOptions.tools = options.tools;
      }
      if (options.toolMode) {
        requestOptions.toolMode = options.toolMode;
      }
      
      const routerRequest = mapToRouterRequest(model, messages, requestOptions);

      // Send request to router
      const responseStream = this.client.chatStream(routerRequest);

      // Collect tool calls and text from response
      const toolCalls: vscode.LanguageModelToolCallPart[] = [];
      let hasTextContent = false;

      for await (const chunk of responseStream) {
        if (token.isCancellationRequested) {
          logger.info('Tool calling loop cancelled by token');
          return;
        }

        // Parse chunk
        try {
          const parsedChunk = typeof chunk === 'string' ? JSON.parse(chunk) : chunk;

          // Check for tool calls
          if (hasToolCalls(parsedChunk)) {
            const rawToolCalls = extractToolCalls(parsedChunk, provider);
            
            for (const rawToolCall of rawToolCalls) {
              const toolCallPart = ToolMapper.fromProviderToolCall(provider, rawToolCall);
              toolCalls.push(toolCallPart);
              
              logger.info(`Detected tool call: ${toolCallPart.name} (${toolCallPart.callId})`);
            }
          }

          // Check for text content
          const text = extractTextFromChunk(parsedChunk);
          if (text) {
            hasTextContent = true;
            progress.report(new vscode.LanguageModelTextPart(text));
          }
        } catch (error) {
          logger.warn('Failed to parse response chunk', error);
        }
      }

      // If no tool calls, we're done
      if (toolCalls.length === 0) {
        logger.info(`No tool calls detected after iteration ${iteration}, ending loop`);
        return;
      }

      logger.info(`Executing ${toolCalls.length} tool calls (iteration ${iteration})`);

      // Execute tool calls
      const executionResults = await executor.executeMultipleToolCalls(toolCalls, token);
      
      // Log execution summary
      const summary = ToolExecutor.getExecutionSummary(executionResults);
      logger.info(summary);

      // Convert results to messages and add to conversation
      const resultMessages = ToolExecutor.createToolResultMessages(executionResults);
      messages.push(...resultMessages);

      // Continue loop - send tool results back to provider
    }

    // If we reach here, we hit the iteration limit
    logger.warn(`Reached maximum tool calling iterations (${MAX_TOOL_ITERATIONS})`);
    progress.report(
      new vscode.LanguageModelTextPart(
        '\n\nMaximum tool calling iterations reached. The conversation may be incomplete.'
      )
    );
  }

  /**
   * Count tokens for a given text using the router
   */
  async provideTokenCount(
    model: vscode.LanguageModelChatInformation,
    text: string | vscode.LanguageModelChatRequestMessage,
    _token: vscode.CancellationToken
  ): Promise<number> {
    try {
      const textContent = typeof text === 'string' ? text : JSON.stringify(text);
      
      return await this.client.countTokens(model.id, textContent);
    } catch (error) {
      logger.warn('Token counting failed, using approximate count', error);
      
      // Fallback to approximate counting
      const textContent = typeof text === 'string' ? text : JSON.stringify(text);
      return Math.ceil(textContent.length / 4); // Rough approximation
    }
  }

  /**
   * Format error message for display to user
   */
  private formatErrorMessage(error: unknown, model: vscode.LanguageModelChatInformation): string {
    const sanitized = sanitizeErrorMessage(error);
    
    return [
      `Error processing request with ${model.name}`,
      '',
      `Details: ${sanitized}`,
      '',
      'Please check:',
      '- ifin Platform is running',
      '- Router URL is configured correctly in settings',
      '- Model is available and healthy',
    ].join('\n');
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    logger.info('Disposing ifin Platform Language Model Provider');
    
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    
    this.disposables = [];
  }
}
