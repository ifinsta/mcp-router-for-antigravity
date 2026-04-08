import * as vscode from 'vscode';
import { ApiKeyManager, ProviderApiKeyConfig } from '../client/apiKeyManager';
import { RouterClient } from '../client/routerClient';
import { getExtensionConfig, getProviderConfig } from '../config/settings';
import { getLogger } from '../infra/logger';

const logger = getLogger('api-key-panel');

/**
 * Webview panel for managing provider API keys
 */
export class ApiKeySettingsPanel {
  public static currentPanel: ApiKeySettingsPanel | undefined;
  public static readonly viewType = 'mcpRouterApiKeySettings';

  private readonly panel: vscode.WebviewPanel;
  private readonly apiKeyManager: ApiKeyManager;
  private readonly routerClient: RouterClient;
  private disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel, apiKeyManager: ApiKeyManager) {
    this.panel = panel;
    this.apiKeyManager = apiKeyManager;
    const config = getExtensionConfig();
    this.routerClient = new RouterClient(config);

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (message) => this.handleMessage(message),
      null,
      this.disposables
    );
  }

  /**
   * Render or reuse the panel
   */
  public static render(context: vscode.ExtensionContext): void {
    if (ApiKeySettingsPanel.currentPanel) {
      ApiKeySettingsPanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      ApiKeySettingsPanel.viewType,
      'MCP Router - API Keys',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    const apiKeyManager = new ApiKeyManager(context);
    ApiKeySettingsPanel.currentPanel = new ApiKeySettingsPanel(panel, apiKeyManager);
    ApiKeySettingsPanel.currentPanel.update();
  }

  /**
   * Update the webview content
   */
  private async update(): Promise<void> {
    const providers = await this.apiKeyManager.getAllProvidersStatus();
    this.panel.webview.html = this.getHtmlForWebview(providers);
  }

  /**
   * Handle messages from webview
   */
  private async handleMessage(message: any): Promise<void> {
    try {
      switch (message.command) {
        case 'saveApiKey':
          await this.handleSaveApiKey(message.provider, message.apiKey);
          break;
        case 'removeApiKey':
          await this.handleRemoveApiKey(message.provider);
          break;
        case 'testConnection':
          await this.handleTestConnection(message.provider);
          break;
        case 'refresh':
          await this.update();
          break;
        case 'setupMCP':
          await this.handleMCPSetup(message.ide, message.config);
          break;
      }
    } catch (error: any) {
      this.panel.webview.postMessage({
        command: 'error',
        provider: message.provider,
        message: error.message || 'Unknown error occurred',
      });
    }
  }

  /**
   * Handle MCP setup for current IDE
   */
  private async handleMCPSetup(ide: string, config: any): Promise<void> {
    const os = process.platform;
    const home = process.env.HOME || process.env.USERPROFILE || '';
    const appData = process.env.APPDATA || (home ? `${home}/AppData/Roaming` : '');
    
    type OSConfig = Record<string, string>;
    const configPaths: Record<string, OSConfig> = {
      win32: {
        qoder: `${appData}/Qoder/User/mcp.json`,
        cursor: `${appData}/Cursor/User/mcp.json`,
        windsurf: `${home}/.codeium/windsurf/mcp_config.json`,
        'claude-desktop': `${appData}/Claude/claude_desktop_config.json`,
        antigravity: `${appData}/antigravity/mcp_servers.json`,
      },
      darwin: {
        qoder: `${home}/.config/Qoder/User/mcp.json`,
        cursor: `${home}/.cursor/mcp.json`,
        windsurf: `${home}/.codeium/windsurf/mcp_config.json`,
        'claude-desktop': `${home}/Library/Application Support/Claude/claude_desktop_config.json`,
        antigravity: `${home}/.config/antigravity/mcp_servers.json`,
      },
      linux: {
        qoder: `${home}/.config/Qoder/User/mcp.json`,
        cursor: `${home}/.cursor/mcp.json`,
        windsurf: `${home}/.codeium/windsurf/mcp_config.json`,
        'claude-desktop': `${home}/.config/Claude/claude_desktop_config.json`,
        antigravity: `${home}/.config/antigravity/mcp_servers.json`,
      },
    };
    
    const osConfig = configPaths[os as keyof typeof configPaths];
    if (!osConfig) {
      throw new Error(`Unsupported OS: ${os}`);
    }
    
    const configPath = osConfig[ide as keyof typeof osConfig];
    if (!configPath) {
      throw new Error(`Unsupported IDE: ${ide}`);
    }
    
    logger.info(`MCP config will be saved to: ${configPath}`);
    
    this.panel.webview.postMessage({
      command: 'mcpConfigReady',
      configPath,
      config,
      message: `Configuration ready for ${ide}. Path: ${configPath}`,
    });
  }

  /**
   * Save API key
   */
  private async handleSaveApiKey(provider: string, apiKey: string): Promise<void> {
    if (!apiKey || apiKey.trim().length === 0) {
      throw new Error('API key cannot be empty');
    }

    await this.apiKeyManager.setApiKey(provider, apiKey.trim());
    logger.info(`API key saved for ${provider}`);

    this.panel.webview.postMessage({
      command: 'keySaved',
      provider,
      message: `API key saved for ${provider}`,
    });

    // Refresh the view
    await this.update();
  }

  /**
   * Remove API key
   */
  private async handleRemoveApiKey(provider: string): Promise<void> {
    await this.apiKeyManager.removeApiKey(provider);
    logger.info(`API key removed for ${provider}`);

    this.panel.webview.postMessage({
      command: 'keyRemoved',
      provider,
      message: `API key removed for ${provider}`,
    });

    await this.update();
  }

  /**
   * Test connection to provider by calling the provider API directly
   */
  private async handleTestConnection(provider: string): Promise<void> {
    this.panel.webview.postMessage({
      command: 'testing',
      provider,
    });

    try {
      const apiKey = await this.apiKeyManager.getApiKey(provider);
      
      if (!apiKey) {
        throw new Error('No API key configured. Enter and save a key first.');
      }

      // Test by calling the provider API endpoint directly
      const providerConfig = getProviderConfig(provider);
      if (!providerConfig) {
        throw new Error(`Unknown provider: ${provider}`);
      }

      const result = await this.testProviderEndpoint(provider, providerConfig.baseUrl, apiKey);

      this.panel.webview.postMessage({
        command: 'testResult',
        provider,
        success: result.success,
        message: result.message,
      });
    } catch (error: any) {
      this.panel.webview.postMessage({
        command: 'testResult',
        provider,
        success: false,
        message: error.message || 'Connection test failed',
      });
    }
  }

  /**
   * Test a provider endpoint directly by calling its models/health API
   */
  private async testProviderEndpoint(
    provider: string,
    baseUrl: string,
    apiKey: string
  ): Promise<{ success: boolean; message: string }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      let url: string;
      let headers: Record<string, string>;

      if (provider === 'glm') {
        // Z.AI uses OpenAI-compatible /models endpoint
        url = `${baseUrl.replace(/\/$/, '')}/models`;
        headers = {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        };
      } else if (provider === 'openai') {
        url = `${baseUrl.replace(/\/$/, '')}/models`;
        headers = {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        };
      } else if (provider === 'anthropic') {
        // Anthropic doesn't have a /models endpoint; test with a minimal message
        url = `${baseUrl.replace(/\/$/, '')}/v1/messages`;
        headers = {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        };
      } else {
        return { success: false, message: `Unknown provider: ${provider}` };
      }

      logger.info(`Testing ${provider} endpoint: ${url}`);

      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });

      if (response.ok) {
        return { success: true, message: `Connected to ${provider} successfully (${response.status})` };
      } else if (response.status === 401 || response.status === 403) {
        return { success: false, message: `Authentication failed (${response.status}). Check your API key.` };
      } else {
        const body = await response.text().catch(() => '');
        return { success: false, message: `${provider} returned ${response.status}: ${body.slice(0, 200)}` };
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        return { success: false, message: `Connection timed out after 15s. Check the base URL.` };
      }
      return { success: false, message: `Connection failed: ${error.message}` };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Generate HTML for webview
   */
  private getHtmlForWebview(providers: ProviderApiKeyConfig[]): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this.panel.webview.cspSource} 'unsafe-inline'; script-src 'unsafe-inline';">
  <title>MCP Router API Keys</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: var(--vscode-font-family);
      padding: 20px;
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
    }
    
    .header {
      margin-bottom: 30px;
    }
    
    .header h1 {
      font-size: 24px;
      font-weight: 600;
      margin-bottom: 8px;
    }
    
    .header p {
      color: var(--vscode-descriptionForeground);
      font-size: 13px;
    }
    
    .provider-card {
      background: var(--vscode-editor-inactiveSelectionBackground);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      padding: 20px;
      margin-bottom: 16px;
      transition: all 0.2s;
    }
    
    .provider-card:hover {
      border-color: var(--vscode-focusBorder);
    }
    
    .provider-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }
    
    .provider-name {
      font-size: 16px;
      font-weight: 600;
    }
    
    .provider-desc {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 16px;
    }
    
    .status-badge {
      display: inline-block;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
    }
    
    .status-configured {
      background: var(--vscode-testing-iconPassed);
      color: white;
    }
    
    .status-not-configured {
      background: var(--vscode-testing-iconFailed);
      color: white;
    }
    
    .api-key-input {
      width: 100%;
      padding: 8px 12px;
      border: 1px solid var(--vscode-input-border);
      border-radius: 4px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      font-family: var(--vscode-editor-font-family);
      font-size: 13px;
      margin-bottom: 12px;
    }
    
    .api-key-input:focus {
      outline: none;
      border-color: var(--vscode-focusBorder);
    }
    
    .button-group {
      display: flex;
      gap: 8px;
    }
    
    button {
      padding: 8px 16px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
      transition: all 0.2s;
    }
    
    .btn-primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    
    .btn-primary:hover {
      background: var(--vscode-button-hoverBackground);
    }
    
    .btn-secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    
    .btn-secondary:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }
    
    .btn-danger {
      background: var(--vscode-inputValidation-errorBackground);
      color: var(--vscode-inputValidation-errorForeground);
    }
    
    .btn-danger:hover {
      opacity: 0.9;
    }
    
    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    
    .message {
      margin-top: 12px;
      padding: 8px 12px;
      border-radius: 4px;
      font-size: 12px;
    }
    
    .message-success {
      background: var(--vscode-inputValidation-infoBackground);
      border: 1px solid var(--vscode-inputValidation-infoBorder);
      color: var(--vscode-inputValidation-infoForeground);
    }
    
    .message-error {
      background: var(--vscode-inputValidation-errorBackground);
      border: 1px solid var(--vscode-inputValidation-errorBorder);
      color: var(--vscode-inputValidation-errorForeground);
    }
    
    .message-info {
      background: var(--vscode-textBlockQuote-background);
      border: 1px solid var(--vscode-textBlockQuote-border);
    }
    
    .spinner {
      display: inline-block;
      width: 14px;
      height: 14px;
      border: 2px solid var(--vscode-progressBar-background);
      border-top-color: transparent;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin-right: 6px;
    }
    
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    
    .refresh-btn {
      position: absolute;
      top: 20px;
      right: 20px;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>🔑 MCP Router Settings</h1>
    <p>Configure API keys and set up MCP server for your IDE</p>
  </div>
  
  <div style="margin-bottom: 20px;">
    <button class="btn-primary" onclick="showTab('api-keys')" id="tab-api-keys">🔑 API Keys</button>
    <button class="btn-secondary" onclick="showTab('mcp-setup')" id="tab-mcp-setup">⚙️ MCP IDE Setup</button>
    <button class="btn-secondary refresh-btn" onclick="refresh()">↻ Refresh</button>
  </div>
  
  <div id="api-keys-tab">
    <div id="providers">
      ${providers.map(p => this.renderProviderCard(p)).join('')}
    </div>
  </div>
  
  <div id="mcp-setup-tab" style="display: none;">
    <div class="provider-card">
      <div class="provider-header">
        <span class="provider-name">🚀 MCP Server Setup</span>
      </div>
      <div class="provider-desc">Configure MCP Router for your current IDE. Works with Qoder, Cursor, Windsurf, Claude Desktop, and Antigravity.</div>
      
      <div class="form-group">
        <label style="margin-bottom: 8px; display: block; font-weight: 500;">Detected IDE</label>
        <div style="padding: 10px; background: var(--vscode-input-background); border-radius: 4px; font-family: var(--vscode-editor-font-family); font-size: 13px;">
          <span id="current-ide">Detecting...</span>
        </div>
      </div>
      
      <div class="form-group">
        <label style="margin-bottom: 8px; display: block; font-weight: 500;">Config Path</label>
        <div style="padding: 10px; background: var(--vscode-input-background); border-radius: 4px; font-family: var(--vscode-editor-font-family); font-size: 12px; word-break: break-all;">
          <span id="config-path">Click "Generate Configuration" to detect</span>
        </div>
      </div>
      
      <div class="button-group" style="margin-top: 16px;">
        <button class="btn-primary" onclick="generateMCPConfig()">🔧 Generate Configuration</button>
        <button class="btn-secondary" onclick="copyMCPConfig()">📋 Copy to Clipboard</button>
      </div>
      
      <div id="mcp-output" style="margin-top: 16px; display: none;">
        <label style="margin-bottom: 8px; display: block; font-weight: 500;">Generated Configuration</label>
        <pre style="padding: 12px; background: var(--vscode-textCodeBlock-background); border-radius: 4px; font-family: var(--vscode-editor-font-family); font-size: 12px; overflow-x: auto; max-height: 300px; overflow-y: auto; white-space: pre-wrap; word-break: break-all;"></pre>
      </div>
      
      <div id="mcp-msg"></div>
    </div>
  </div>
  
  <script>
    const vscode = acquireVsCodeApi();
    let currentMCPConfig = null;
    
    // Detect IDE from VS Code environment
    function detectIDE() {
      const appName = vscode.env.appName || '';
      const userAgent = navigator.userAgent || '';
      
      // Check app name first (most reliable)
      if (appName.toLowerCase().includes('qoder')) return 'qoder';
      if (appName.toLowerCase().includes('cursor')) return 'cursor';
      if (appName.toLowerCase().includes('windsurf')) return 'windsurf';
      if (appName.toLowerCase().includes('claude')) return 'claude-desktop';
      if (appName.toLowerCase().includes('antigravity')) return 'antigravity';
      
      // Fallback to user agent
      const match = userAgent.match(/(Qoder|Cursor|Windsurf|Claude|Antigravity)/i);
      return match ? match[1].toLowerCase() : 'vscode';
    }
    
    function showTab(tabName) {
      document.getElementById('api-keys-tab').style.display = tabName === 'api-keys' ? 'block' : 'none';
      document.getElementById('mcp-setup-tab').style.display = tabName === 'mcp-setup' ? 'block' : 'none';
      
      document.getElementById('tab-api-keys').className = tabName === 'api-keys' ? 'btn-primary' : 'btn-secondary';
      document.getElementById('tab-mcp-setup').className = tabName === 'mcp-setup' ? 'btn-primary' : 'btn-secondary';
    }
    
    // Initialize IDE detection on load
    window.addEventListener('load', () => {
      const ide = detectIDE();
      document.getElementById('current-ide').textContent = ide.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    });
    
    function generateMCPConfig() {
      const ide = detectIDE();
      document.getElementById('current-ide').textContent = ide.charAt(0).toUpperCase() + ide.slice(1);
      
      const config = {
        mcpServers: {
          'mcp-router': {
            command: 'node',
            args: ['C:\\Users\\user\\CascadeProjects\\mcp-router-for-antigravity\\dist\\index.js'],
            env: {
              ROUTER_DEFAULT_PROVIDER: 'chutes',
              ROUTER_DEFAULT_MODEL: 'Qwen/Qwen2.5-72B-Instruct'
            }
          }
        }
      };
      
      currentMCPConfig = config;
      
      vscode.postMessage({ 
        command: 'setupMCP', 
        ide,
        config 
      });
      
      document.getElementById('mcp-output').style.display = 'block';
      document.getElementById('mcp-output').querySelector('pre').textContent = JSON.stringify(config, null, 2);
    }
    
    function copyMCPConfig() {
      if (!currentMCPConfig) {
        generateMCPConfig();
      }
      
      navigator.clipboard.writeText(JSON.stringify(currentMCPConfig, null, 2)).then(() => {
        showMessage('mcp', '✅ Configuration copied to clipboard!', 'success');
      }).catch(err => {
        showMessage('mcp', '❌ Failed to copy: ' + err.message, 'error');
      });
    }
    
    function saveApiKey(provider) {
      const input = document.getElementById('key-' + provider);
      const apiKey = input.value;
      vscode.postMessage({ command: 'saveApiKey', provider, apiKey });
    }
    
    function removeApiKey(provider) {
      if (confirm('Are you sure you want to remove the API key for ' + provider + '?')) {
        vscode.postMessage({ command: 'removeApiKey', provider });
      }
    }
    
    function testConnection(provider) {
      vscode.postMessage({ command: 'testConnection', provider });
    }
    
    function refresh() {
      vscode.postMessage({ command: 'refresh' });
    }
    
    function showMessage(provider, message, type) {
      let msgDiv = document.getElementById('msg-' + provider);
      if (!msgDiv) {
        msgDiv = document.createElement('div');
        msgDiv.id = 'msg-' + provider;
        document.getElementById('card-' + provider).appendChild(msgDiv);
      }
      msgDiv.className = 'message message-' + type;
      msgDiv.textContent = message;
      setTimeout(() => { msgDiv.textContent = ''; }, 5000);
    }
    
    function setTesting(provider, testing) {
      const btn = document.getElementById('test-' + provider);
      if (testing) {
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> Testing...';
      } else {
        btn.disabled = false;
        btn.textContent = 'Test Connection';
      }
    }
    
    window.addEventListener('message', event => {
      const message = event.data;
      switch (message.command) {
        case 'keySaved':
          showMessage(message.provider, message.message, 'success');
          break;
        case 'keyRemoved':
          showMessage(message.provider, message.message, 'info');
          break;
        case 'testing':
          setTesting(message.provider, true);
          break;
        case 'testResult':
          setTesting(message.provider, false);
          showMessage(message.provider, message.message, message.success ? 'success' : 'error');
          break;
        case 'error':
          showMessage(message.provider, message.message, 'error');
          break;
        case 'mcpConfigReady':
          document.getElementById('config-path').textContent = message.configPath;
          showMessage('mcp', '✅ ' + message.message, 'success');
          break;
      }
    });
  </script>
</body>
</html>`;
  }

  /**
   * Render provider card HTML
   */
  private renderProviderCard(provider: ProviderApiKeyConfig): string {
    const statusBadge = provider.isConfigured
      ? '<span class="status-badge status-configured">✓ Configured</span>'
      : '<span class="status-badge status-not-configured">✗ Not Configured</span>';

    return `
      <div class="provider-card" id="card-${provider.provider}">
        <div class="provider-header">
          <span class="provider-name">${provider.displayName}</span>
          ${statusBadge}
        </div>
        <div class="provider-desc">${provider.description}${provider.baseUrl ? ` • ${provider.baseUrl}` : ''}</div>
        <input 
          type="password" 
          id="key-${provider.provider}" 
          class="api-key-input" 
          placeholder="Enter ${provider.displayName} API Key"
          value="${provider.isConfigured ? '••••••••••••' : ''}"
        />
        <div class="button-group">
          <button class="btn-primary" onclick="saveApiKey('${provider.provider}')">Save Key</button>
          <button class="btn-secondary" id="test-${provider.provider}" onclick="testConnection('${provider.provider}')" ${!provider.isConfigured ? 'disabled' : ''}>Test Connection</button>
          <button class="btn-danger" onclick="removeApiKey('${provider.provider}')" ${!provider.isConfigured ? 'disabled' : ''}>Remove</button>
        </div>
        <div id="msg-${provider.provider}"></div>
      </div>
    `;
  }

  /**
   * Dispose of the panel
   */
  public dispose(): void {
    ApiKeySettingsPanel.currentPanel = undefined;
    this.panel.dispose();
    while (this.disposables.length) {
      const disposable = this.disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }
}
