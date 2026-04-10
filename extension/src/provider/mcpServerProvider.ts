import * as vscode from 'vscode';
import { getExtensionConfig, getProviderConfig } from '../config/settings';
import { ApiKeyManager } from '../client/apiKeyManager';
import { getLogger } from '../infra/logger';

const logger = getLogger('mcp-server-provider');

/**
 * MCP Server Definition Provider
 *
 * Dynamically exposes the MCP Router as an MCP server to supported MCP-capable editors.
 * This keeps editor-side setup thin while the local router remains the primary MCP contract.
 * without manual MCP configuration.
 */
export class McpRouterServerProvider implements vscode.McpServerDefinitionProvider, vscode.Disposable {
  private apiKeyManager: ApiKeyManager;
  private disposables: vscode.Disposable[] = [];

  constructor(context: vscode.ExtensionContext, apiKeyManager: ApiKeyManager) {
    this.apiKeyManager = apiKeyManager;
    logger.info('ifin Platform Server Provider initialized');
  }

  /**
   * Provide available MCP server definitions
   * Returns the router as an stdio MCP server
   */
  provideMcpServerDefinitions(_token: vscode.CancellationToken): vscode.ProviderResult<vscode.McpServerDefinition[]> {
    logger.info('Providing MCP server definitions');

    const config = getExtensionConfig();
    const extensionPath = this.getExtensionPath();
    
    if (!extensionPath) {
      logger.error('Could not determine extension path');
      return [];
    }

    // Build environment with API keys from settings
    const env: Record<string, string | number | null> = {};
    
    // Add configured provider API keys
    for (const provider of ['glm', 'openai', 'anthropic']) {
      const providerConfig = getProviderConfig(provider);
      if (providerConfig?.apiKey) {
        const envKey = provider === 'openai' ? 'OPENAI_API_KEY' : 
                       provider === 'glm' ? 'GLM_API_KEY' : 'ANTHROPIC_API_KEY';
        env[envKey] = providerConfig.apiKey;
      }
    }

    // Add default provider settings
    env['ROUTER_DEFAULT_PROVIDER'] = 'glm';
    env['ROUTER_DEFAULT_MODEL'] = 'glm-4.7';

    // Create stdio server definition pointing to the router
    const serverDefinition = new vscode.McpStdioServerDefinition(
      'ifin Platform',
      process.execPath, // Use VS Code's Node.js
      [extensionPath],
      env,
      '1.0.0'
    );

    logger.info(`Providing MCP server at: ${extensionPath}`);
    return [serverDefinition];
  }

  /**
   * Resolve server definition when editor needs to start it
   * Can be used to prompt for authentication or update env vars
   */
  async resolveMcpServerDefinition(
    server: vscode.McpServerDefinition,
    _token: vscode.CancellationToken
  ): Promise<vscode.McpServerDefinition | undefined> {
    logger.info('Resolving MCP server definition');

    // Refresh API keys in case they changed
    const env: Record<string, string | number | null> = {};
    
    for (const provider of ['glm', 'openai', 'anthropic']) {
      const providerConfig = getProviderConfig(provider);
      if (providerConfig?.apiKey) {
        const envKey = provider === 'openai' ? 'OPENAI_API_KEY' : 
                       provider === 'glm' ? 'GLM_API_KEY' : 'ANTHROPIC_API_KEY';
        env[envKey] = providerConfig.apiKey;
      }
    }

    env['ROUTER_DEFAULT_PROVIDER'] = 'glm';
    env['ROUTER_DEFAULT_MODEL'] = 'glm-4.7';

    // Return updated server definition with fresh env
    return new vscode.McpStdioServerDefinition(
      server.label,
      process.execPath,
      server instanceof vscode.McpStdioServerDefinition ? server.args : [],
      env,
      '1.0.0'
    );
  }

  /**
   * Get the path to the router's dist/src/index.js entrypoint.
   */
  private getExtensionPath(): string | undefined {
    // The router is at the project root, not in extension/
    // We need to go up one level from extension/ to find dist/src/index.js
    const path = require('path');

    // When running from extension/, go up to project root
    const projectRoot = path.join(__dirname, '..', '..');
    const routerPath = path.join(projectRoot, 'dist', 'src', 'index.js');

    logger.debug(`Router path resolved to: ${routerPath}`);
    return routerPath;
  }

  dispose(): void {
    logger.info('Disposing ifin Platform Server Provider');
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables = [];
  }
}
