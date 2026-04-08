import * as vscode from 'vscode';
import { McpRouterLanguageModelProvider } from './provider/lmProvider';
import { McpRouterServerProvider } from './provider/mcpServerProvider';
import { ApiKeySettingsPanel } from './ui/apiKeySettingsPanel';
import { ApiKeyManager } from './client/apiKeyManager';
import { getLogger } from './infra/logger';

const logger = getLogger('extension');

export function activate(context: vscode.ExtensionContext) {
  logger.info('Activating Antigravity Custom Models extension...');

  try {
    // Create API key manager for secret storage
    const apiKeyManager = new ApiKeyManager(context);

    // Create and register the language model provider
    const provider = new McpRouterLanguageModelProvider(context, apiKeyManager);

    const registration = vscode.lm.registerLanguageModelChatProvider('mcp-router', provider);
    
    // Create and register the MCP server provider (proxy approach)
    const mcpServerProvider = new McpRouterServerProvider(context, apiKeyManager);
    const mcpRegistration = vscode.lm.registerMcpServerDefinitionProvider('mcp-router-server', mcpServerProvider);
    
    // Register command to open API key settings
    const settingsCommand = vscode.commands.registerCommand(
      'mcpRouter.configureApiKeys',
      () => {
        ApiKeySettingsPanel.render(context);
      }
    );
    
    // Register command for MCP IDE setup
    const mcpSetupCommand = vscode.commands.registerCommand(
      'mcpRouter.setupMCP',
      () => {
        ApiKeySettingsPanel.render(context);
      }
    );
    
    context.subscriptions.push(registration);
    context.subscriptions.push(mcpRegistration);
    context.subscriptions.push(provider);
    context.subscriptions.push(mcpServerProvider);
    context.subscriptions.push(settingsCommand);
    context.subscriptions.push(mcpSetupCommand);

    logger.info('MCP Router language model provider and MCP server provider registered successfully');

    // Fire-and-forget migration check for removed settings
    checkForRemovedSettings();
  } catch (error) {
    logger.error('Failed to register MCP Router language model provider', error);
    throw error;
  }
}

/**
 * Check for removed settings that may still be in user's settings.json.
 * Shows a migration warning if any are found with non-default values.
 * This is fire-and-forget and should not block activation.
 */
function checkForRemovedSettings(): void {
  const removedKeys = [
    'openaiApiKey',
    'glmApiKey',
    'anthropicApiKey',
    'allowedProviders',
    'autoDiscoverModels',
    'refreshModelsOnKeyChange'
  ];

  const config = vscode.workspace.getConfiguration('mcpRouter');
  let hasLegacySettings = false;

  for (const key of removedKeys) {
    const value = config.get(key);
    // Check for non-empty string values (removed settings defaulted to empty strings or 'openai')
    if (typeof value === 'string' && value.trim() !== '') {
      hasLegacySettings = true;
      break;
    }
  }

  if (hasLegacySettings) {
    vscode.window.showInformationMessage(
      'MCP Router: API key settings have moved to secure storage. Use the "Configure API Keys" command to set up your provider keys.',
      'Configure Now'
    ).then(selection => {
      if (selection === 'Configure Now') {
        vscode.commands.executeCommand('mcpRouter.configureApiKeys');
      }
    });
  }
}

export function deactivate() {
  logger.info('Deactivating Antigravity Custom Models extension');
}
