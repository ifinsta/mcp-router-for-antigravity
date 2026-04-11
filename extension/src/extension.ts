import * as vscode from 'vscode';
import { McpRouterLanguageModelProvider } from './provider/lmProvider';
import { McpRouterServerProvider } from './provider/mcpServerProvider';
import { ApiKeySettingsPanel } from './ui/apiKeySettingsPanel';
import { ModeSelectionPanel } from './ui/modeSelectionPanel';
import { StatusPanel } from './ui/statusPanel';
import { PreviewPanel } from './ui/previewPanel';
import { BrowserPairingPanel } from './ui/browserPairingPanel';
import { ApiKeyManager } from './client/apiKeyManager';
import { RouterClient } from './client/routerClient';
import { RouterConnectionManager } from './infra/connectionManager';
import { getLogger } from './infra/logger';
import { getExtensionConfig } from './config/settings';
import {
  COMMAND_CONFIGURE_API_KEYS,
  COMMAND_SETUP_MCP,
  CONFIGURATION_SECTION,
  LANGUAGE_MODEL_VENDOR,
  LEGACY_CONFIGURATION_SECTION,
  MCP_SERVER_PROVIDER_ID,
} from './infra/identifiers';

const COMMAND_REFRESH_CONNECTION = 'ifinPlatform.refreshConnection';

const logger = getLogger('extension');

// Track LM provider registration for runtime mode switching
let lmRegistration: vscode.Disposable | undefined;

// Global connection manager for status panel access
let connectionManager: RouterConnectionManager | undefined;

function registerLmProvider(context: vscode.ExtensionContext, provider: McpRouterLanguageModelProvider): vscode.Disposable {
  return vscode.lm.registerLanguageModelChatProvider(LANGUAGE_MODEL_VENDOR, provider);
}

export function activate(context: vscode.ExtensionContext) {
  logger.info('Activating ifin Platform Integrations extension...');

  try {
    // Read mode from settings
    const mode = vscode.workspace.getConfiguration('ifinPlatform').get<string>('mode', 'agent');
    console.log(`[ifin-platform] Activating in ${mode} mode`);

    // Create API key manager for secret storage
    const apiKeyManager = new ApiKeyManager(context);
    void apiKeyManager.migrateLegacySecrets();

    // Create router client and connection manager
    const routerClient = new RouterClient(getExtensionConfig());
    connectionManager = new RouterConnectionManager(routerClient);
    context.subscriptions.push(connectionManager);

    // Create the language model provider (needed regardless of mode for potential runtime switching)
    const provider = new McpRouterLanguageModelProvider(context, apiKeyManager, connectionManager);

    // Conditionally register the language model provider based on mode
    if (mode === 'router') {
      lmRegistration = registerLmProvider(context, provider);
      context.subscriptions.push(lmRegistration);
    }

    // Create and register the MCP server provider (always registered - needed in both modes)
    const mcpServerProvider = new McpRouterServerProvider(context, apiKeyManager);
    const mcpRegistration = vscode.lm.registerMcpServerDefinitionProvider(MCP_SERVER_PROVIDER_ID, mcpServerProvider);

    // Register command to open API key settings
    const settingsCommand = vscode.commands.registerCommand(
      COMMAND_CONFIGURE_API_KEYS,
      () => {
        ApiKeySettingsPanel.render(context);
      }
    );

    // Register command for MCP IDE setup
    const mcpSetupCommand = vscode.commands.registerCommand(
      COMMAND_SETUP_MCP,
      () => {
        ApiKeySettingsPanel.render(context);
      }
    );

    // Register command to show status dashboard
    const showStatusCommand = vscode.commands.registerCommand(
      'ifinPlatform.showStatus',
      () => {
        if (connectionManager) {
          StatusPanel.show(context, connectionManager);
        } else {
          vscode.window.showErrorMessage('Connection manager not initialized');
        }
      }
    );

    // Register command to switch mode
    const switchModeCmd = vscode.commands.registerCommand('ifinPlatform.switchMode', async () => {
      const currentMode = vscode.workspace.getConfiguration('ifinPlatform').get<string>('mode', 'agent');
      const pick = await vscode.window.showQuickPick(
        [
          { label: 'Agent Mode', description: 'Use your IDE\'s native AI', value: 'agent' },
          { label: 'Router Mode', description: 'Use ifin-managed models', value: 'router' },
        ].map(item => ({
          ...item,
          picked: item.value === currentMode,
        })),
        {
          placeHolder: `Current mode: ${currentMode === 'router' ? 'Router' : 'Agent'}. Select new mode:`,
        }
      );
      
      if (pick && 'value' in pick) {
        const newMode = (pick as any).value as string;
        await vscode.workspace.getConfiguration('ifinPlatform').update('mode', newMode, vscode.ConfigurationTarget.Global);
        
        // Sync to router
        try {
          const baseUrl = vscode.workspace.getConfiguration('ifinPlatform').get<string>('baseUrl', 'http://localhost:3000');
          await fetch(`${baseUrl}/api/mode`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: newMode }),
          });
        } catch { /* router may not be running */ }
        
        vscode.window.showInformationMessage(`ifin Platform mode switched to ${newMode === 'router' ? 'Router' : 'Agent'} Mode`);
      }
    });

    // Add configuration change listener for mode switching
    const configListener = vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('ifinPlatform.mode')) {
        const newMode = vscode.workspace.getConfiguration('ifinPlatform').get<string>('mode', 'agent');
        if (newMode === 'router' && !lmRegistration) {
          lmRegistration = registerLmProvider(context, provider);
          context.subscriptions.push(lmRegistration);
          console.log('[ifin-platform] Router mode enabled: language model provider registered');
        } else if (newMode === 'agent' && lmRegistration) {
          lmRegistration.dispose();
          lmRegistration = undefined;
          console.log('[ifin-platform] Agent mode enabled: language model provider unregistered');
        }
      }
    });
    context.subscriptions.push(configListener);

    // Only add LM provider to subscriptions if it was registered
    if (lmRegistration) {
      context.subscriptions.push(provider);
    }
    context.subscriptions.push(mcpRegistration);
    context.subscriptions.push(mcpServerProvider);
    context.subscriptions.push(settingsCommand);
    context.subscriptions.push(mcpSetupCommand);
    context.subscriptions.push(showStatusCommand);
    context.subscriptions.push(switchModeCmd);

    // Register command to force a connection status refresh
    const refreshCmd = vscode.commands.registerCommand(
      COMMAND_REFRESH_CONNECTION,
      async () => {
        if (connectionManager) {
          await connectionManager.refresh();
        }
      }
    );
    context.subscriptions.push(refreshCmd);

    // Register command to show browser preview
    const showPreviewCmd = vscode.commands.registerCommand(
      'ifinPlatform.showPreview',
      () => {
        PreviewPanel.show(context);
      }
    );
    context.subscriptions.push(showPreviewCmd);

    // Register command to show browser pairing/setup guide
    const pairBrowserCmd = vscode.commands.registerCommand(
      'ifinPlatform.pairBrowser',
      () => {
        BrowserPairingPanel.show(context);
      }
    );
    context.subscriptions.push(pairBrowserCmd);

    // Structured logging for mode-gated registration
    console.log('[ifin-platform] MCP server provider registered (available in all modes)');
    if (mode === 'router') {
      console.log('[ifin-platform] Language model provider registered (Router mode)');
    } else {
      console.log('[ifin-platform] Language model provider skipped (Agent mode)');
    }

    logger.info('ifin Platform language model provider and MCP server provider registered successfully');
    
    // First-run mode selection
    const modeSelected = context.globalState.get<boolean>('ifinPlatform.modeSelected', false);
    if (!modeSelected) {
      ModeSelectionPanel.show(context, () => {
        // After mode selection, show API key settings for continued setup
        ApiKeySettingsPanel.render(context);
      });
    }
    
    // Fire-and-forget migration check for removed settings
    checkForRemovedSettings();
  } catch (error) {
    logger.error('Failed to register ifin Platform language model provider', error);
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

  const config = vscode.workspace.getConfiguration(LEGACY_CONFIGURATION_SECTION);
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
      'ifin Platform: API key settings have moved to secure storage. Use the "Configure API Keys" command to set up your provider keys.',
      'Configure Now'
    ).then(selection => {
      if (selection === 'Configure Now') {
        vscode.commands.executeCommand(COMMAND_CONFIGURE_API_KEYS);
      }
    });
  }
}

export function deactivate() {
  logger.info('Deactivating ifin Platform Integrations extension');
}
