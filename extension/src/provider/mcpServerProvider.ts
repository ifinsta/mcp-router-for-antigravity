import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getExtensionConfig, getProviderConfig } from '../config/settings';
import { ApiKeyManager } from '../client/apiKeyManager';
import { getLogger } from '../infra/logger';

const logger = getLogger('mcp-server-provider');

interface RouterEntrypointResolutionContext {
  configuredRouterPath: string | null;
  workspaceFolders: readonly vscode.WorkspaceFolder[];
  extensionDir: string;
  cwd: string;
}

export function buildRouterEntrypointCandidates(
  context: RouterEntrypointResolutionContext,
): string[] {
  const candidates: string[] = [];
  const pushCandidate = (candidate: string) => {
    const resolved = path.resolve(candidate);
    if (!candidates.includes(resolved)) {
      candidates.push(resolved);
    }
  };

  const configuredPath = context.configuredRouterPath;
  if (configuredPath !== null) {
    pushCandidate(configuredPath);
    pushCandidate(path.join(configuredPath, 'dist', 'src', 'index.js'));
  }

  for (const workspaceFolder of context.workspaceFolders) {
    pushCandidate(path.join(workspaceFolder.uri.fsPath, 'dist', 'src', 'index.js'));
  }

  pushCandidate(path.join(context.cwd, 'dist', 'src', 'index.js'));

  // When running from extension/dist/provider inside the repo checkout.
  pushCandidate(path.join(context.extensionDir, '..', '..', '..', 'dist', 'src', 'index.js'));

  // Fallback for layouts that bundle the router JS under the extension directory itself.
  pushCandidate(path.join(context.extensionDir, '..', '..', 'dist', 'src', 'index.js'));
  pushCandidate(path.join(context.extensionDir, '..', '..', 'dist', 'index.js'));

  return candidates;
}

export function resolveRouterEntrypoint(
  context: RouterEntrypointResolutionContext,
  fileExists: (candidate: string) => boolean = fs.existsSync,
): string | undefined {
  for (const candidate of buildRouterEntrypointCandidates(context)) {
    if (fileExists(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

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
   * Tries multiple candidate paths and validates existence.
   */
  private getExtensionPath(): string | undefined {
    const config = getExtensionConfig();
    const candidates = buildRouterEntrypointCandidates({
      configuredRouterPath: config.routerPath,
      workspaceFolders: vscode.workspace.workspaceFolders ?? [],
      extensionDir: __dirname,
      cwd: process.cwd(),
    });
    const resolved = resolveRouterEntrypoint(
      {
        configuredRouterPath: config.routerPath,
        workspaceFolders: vscode.workspace.workspaceFolders ?? [],
        extensionDir: __dirname,
        cwd: process.cwd(),
      },
      fs.existsSync,
    );

    if (resolved) {
      logger.info(`Router resolved at: ${resolved}`);
      return resolved;
    }

    for (const candidate of candidates) {
      logger.debug(`Candidate path does not exist: ${candidate}`);
    }

    // Show user-friendly error if no candidate exists
    const errorMessage = [
      'ifin Platform: Could not find router entrypoint.',
      '',
      'Searched paths:',
      ...candidates.map((c) => `  - ${path.resolve(c)}`),
      '',
      'Open the router repo in the workspace, or set ifinPlatform.routerPath to the repo root or built entrypoint.',
    ].join('\n');

    logger.error(errorMessage);
    
    vscode.window.showErrorMessage(
      'ifin Platform: Could not find the router entrypoint. Build the repo or set ifinPlatform.routerPath.',
      'Show Docs'
    ).then(selection => {
      if (selection === 'Show Docs') {
        vscode.env.openExternal(vscode.Uri.parse('https://github.com/ifinsta/ifin-platform/blob/main/docs/QUICKSTART.md'));
      }
    });

    return undefined;
  }

  dispose(): void {
    logger.info('Disposing ifin Platform Server Provider');
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables = [];
  }
}
