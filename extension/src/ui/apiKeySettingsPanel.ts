import * as vscode from 'vscode';
import { ApiKeyManager, ProviderApiKeyConfig } from '../client/apiKeyManager';
import { RouterClient, RouterModelInfo } from '../client/routerClient';
import { ExtensionConfig, getExtensionConfig, getProviderConfig } from '../config/settings';
import { ModelCatalog } from '../provider/modelCatalog';
import { API_KEY_SETTINGS_VIEW_TYPE, CONFIGURATION_SECTION } from '../infra/identifiers';
import { getLogger } from '../infra/logger';

const logger = getLogger('api-key-panel');

type ModelCatalogSource = 'live' | 'fallback';

const MODE_OVERRIDE_DEFINITIONS = [
  {
    id: 'code',
    label: 'Code',
    description: 'Used for implementation-heavy work and code generation.',
  },
  {
    id: 'plan',
    label: 'Plan',
    description: 'Used for planning, sequencing, and execution strategy.',
  },
  {
    id: 'debug',
    label: 'Debug',
    description: 'Used for troubleshooting, error analysis, and fault isolation.',
  },
  {
    id: 'orchestrator',
    label: 'Orchestrator',
    description: 'Used for coordination flows that split work across multiple steps.',
  },
  {
    id: 'ask',
    label: 'Ask',
    description: 'Used for concise question-and-answer interactions.',
  },
] as const;

type ModeOverrideId = (typeof MODE_OVERRIDE_DEFINITIONS)[number]['id'];

interface PanelState {
  config: ExtensionConfig;
  providers: ProviderApiKeyConfig[];
  models: RouterModelInfo[];
  modelCatalogSource: ModelCatalogSource;
  detectedIde: string;
  currentMode: 'agent' | 'router';
}

interface PanelMessage {
  command?: string;
  provider?: string;
  apiKey?: string;
  ide?: string;
  defaultModel?: string;
  smallModel?: string;
  codeModel?: string;
  planModel?: string;
  debugModel?: string;
  orchestratorModel?: string;
  askModel?: string;
  baseUrl?: string;
  routerPath?: string;
  showOnlyHealthyModels?: boolean;
}

export class ApiKeySettingsPanel {
  public static currentPanel: ApiKeySettingsPanel | undefined;
  public static readonly viewType = API_KEY_SETTINGS_VIEW_TYPE;

  private readonly panel: vscode.WebviewPanel;
  private readonly apiKeyManager: ApiKeyManager;
  private readonly extensionUri: vscode.Uri;
  private routerClient: RouterClient;
  private disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel, apiKeyManager: ApiKeyManager, extensionUri: vscode.Uri) {
    this.panel = panel;
    this.apiKeyManager = apiKeyManager;
    this.extensionUri = extensionUri;
    this.routerClient = new RouterClient(getExtensionConfig());

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (message) => this.handleMessage(message as PanelMessage),
      null,
      this.disposables,
    );
  }

  public static render(context: vscode.ExtensionContext): void {
    if (ApiKeySettingsPanel.currentPanel) {
      ApiKeySettingsPanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      ApiKeySettingsPanel.viewType,
      'ifin Platform Settings',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
      },
    );

    const apiKeyManager = new ApiKeyManager(context);
    ApiKeySettingsPanel.currentPanel = new ApiKeySettingsPanel(panel, apiKeyManager, context.extensionUri);
    void ApiKeySettingsPanel.currentPanel.update();
  }

  private async update(): Promise<void> {
    const state = await this.buildPanelState();
    this.panel.webview.html = this.getHtmlForWebview(state);
  }

  private async buildPanelState(): Promise<PanelState> {
    const config = getExtensionConfig();
    const providers = await this.apiKeyManager.getAllProvidersStatus();
    const { models, source } = await this.loadModelCatalog();

    return {
      config,
      providers,
      models,
      modelCatalogSource: source,
      detectedIde: this.detectCurrentIde(),
      currentMode: vscode.workspace.getConfiguration(CONFIGURATION_SECTION).get<'agent' | 'router'>('mode', 'agent'),
    };
  }

  private async loadModelCatalog(): Promise<{ models: RouterModelInfo[]; source: ModelCatalogSource }> {
    try {
      const models = await this.routerClient.getModelCatalog(false);
      return { models, source: 'live' };
    } catch (error) {
      logger.warn('Falling back to bundled model catalog for settings UI', error);
      return { models: ModelCatalog.getDefaultModels(), source: 'fallback' };
    }
  }

  private async handleMessage(message: PanelMessage): Promise<void> {
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
          await this.reloadRouterClient();
          await this.update();
          break;
        case 'setupMCP':
          await this.handleMCPSetup(message.ide);
          break;
        case 'saveModelSettings':
          await this.handleSaveModelSettings(message);
          break;
        case 'saveConnectionSettings':
          await this.handleSaveConnectionSettings(message);
          break;
        case 'verifySetup':
          await this.handleVerifySetup();
          break;
        case 'switchMode':
          await vscode.commands.executeCommand('ifinPlatform.switchMode');
          await this.update();
          break;
        case 'showStatus':
          await vscode.commands.executeCommand('ifinPlatform.showStatus');
          break;
      }
    } catch (error: unknown) {
      this.panel.webview.postMessage({
        command: 'error',
        provider: message.provider ?? 'global',
        message: error instanceof Error ? error.message : 'Unknown error occurred',
      });
    }
  }

  private async handleSaveModelSettings(message: PanelMessage): Promise<void> {
    const config = vscode.workspace.getConfiguration(CONFIGURATION_SECTION);
    await config.update('models.defaultModel', normalizeConfigValue(message.defaultModel), true);
    await config.update('models.smallModel', normalizeConfigValue(message.smallModel), true);
    await config.update('models.byMode.code', normalizeConfigValue(message.codeModel), true);
    await config.update('models.byMode.plan', normalizeConfigValue(message.planModel), true);
    await config.update('models.byMode.debug', normalizeConfigValue(message.debugModel), true);
    await config.update('models.byMode.orchestrator', normalizeConfigValue(message.orchestratorModel), true);
    await config.update('models.byMode.ask', normalizeConfigValue(message.askModel), true);
    this.panel.webview.postMessage({ command: 'notice', kind: 'success', message: 'Model preferences saved.' });
  }

  private async handleSaveConnectionSettings(message: PanelMessage): Promise<void> {
    const baseUrl = (message.baseUrl ?? '').trim();
    if (baseUrl.length === 0) {
      throw new Error('Router base URL is required.');
    }

    const config = vscode.workspace.getConfiguration(CONFIGURATION_SECTION);
    await config.update('baseUrl', baseUrl, true);
    await config.update('routerPath', normalizeConfigValue(message.routerPath), true);
    await config.update('showOnlyHealthyModels', !!message.showOnlyHealthyModels, true);
    await this.reloadRouterClient();
    await this.update();
  }
  private async handleMCPSetup(ide: string | undefined): Promise<void> {
    const currentIde = ide ?? this.detectCurrentIde();
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

    const configPath = osConfig[currentIde as keyof typeof osConfig];
    if (!configPath) {
      throw new Error(`Unsupported IDE: ${currentIde}`);
    }

    this.panel.webview.postMessage({
      command: 'mcpConfigReady',
      configPath,
      setupCommand: `npm run setup -- ${currentIde} --mode auto`,
      message: `ifin Platform can configure ${labelForIde(currentIde)} at ${configPath}.`,
    });
  }

  private async handleSaveApiKey(provider: string | undefined, apiKey: string | undefined): Promise<void> {
    if (!provider) {
      throw new Error('Provider is required.');
    }
    if (!apiKey || apiKey.trim().length === 0) {
      throw new Error('API key cannot be empty');
    }

    await this.apiKeyManager.setApiKey(provider, apiKey.trim());
    try {
      await vscode.commands.executeCommand('ifinPlatform.refreshConnection');
    } catch {
      // Extension may not be fully activated yet.
    }
    await this.update();
  }

  private async handleRemoveApiKey(provider: string | undefined): Promise<void> {
    if (!provider) {
      throw new Error('Provider is required.');
    }
    await this.apiKeyManager.removeApiKey(provider);
    await this.update();
  }

  private async handleTestConnection(provider: string | undefined): Promise<void> {
    if (!provider) {
      throw new Error('Provider is required.');
    }

    this.panel.webview.postMessage({ command: 'testing', provider });

    try {
      const apiKey = await this.apiKeyManager.getApiKey(provider);
      if (!apiKey) {
        throw new Error('No API key configured. Enter and save a key first.');
      }

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
    } catch (error: unknown) {
      this.panel.webview.postMessage({
        command: 'testResult',
        provider,
        success: false,
        message: error instanceof Error ? error.message : 'Connection test failed',
      });
    }
  }

  private async handleVerifySetup(): Promise<void> {
    const providers = await this.apiKeyManager.getAllProvidersStatus();
    const configuredProviders = providers.filter((provider) => provider.isConfigured);

    let routerHealthy = false;
    let routerError: string | null = null;
    let providerCount = 0;

    try {
      routerHealthy = await this.routerClient.healthCheck();
      if (routerHealthy) {
        const response = await fetch(`${this.routerClient.baseUrl.replace(/\/$/, '')}/health`, { method: 'GET' });
        if (response.ok) {
          providerCount = extractProviderCount(await response.json().catch(() => null));
        }
      } else {
        routerError = 'Router health check failed.';
      }
    } catch (error: unknown) {
      routerError = error instanceof Error ? error.message : 'Router health check failed.';
    }

    const summaryParts = [`Configured providers: ${configuredProviders.length} of ${providers.length}.`];
    if (routerHealthy) {
      summaryParts.push(providerCount > 0 ? `Router reachable. Health endpoint reports ${providerCount} providers.` : 'Router reachable.');
    } else {
      summaryParts.push(`Router unavailable${routerError ? `: ${routerError}` : '.'}`);
    }
    summaryParts.push(
      configuredProviders.length === 0
        ? 'Save at least one provider key before validating credentials.'
        : 'Use Test on a provider row to validate a specific credential.',
    );

    this.panel.webview.postMessage({
      command: 'verifyResult',
      success: routerHealthy && configuredProviders.length > 0,
      summary: summaryParts.join(' '),
    });
  }

  private async testProviderEndpoint(provider: string, baseUrl: string, apiKey: string): Promise<{ success: boolean; message: string }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15_000);

    try {
      let url: string;
      let method: 'GET' | 'POST' = 'GET';
      let headers: Record<string, string>;
      let body: string | undefined;

      if (provider === 'glm' || provider === 'openai' || provider === 'chutes') {
        url = `${baseUrl.replace(/\/$/, '')}/models`;
        headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
      } else if (provider === 'anthropic') {
        url = `${baseUrl.replace(/\/$/, '')}/v1/messages`;
        method = 'POST';
        headers = {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        };
        body = JSON.stringify({
          model: 'claude-3-5-haiku-20241022',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'ping' }],
        });
      } else {
        return { success: false, message: `Unknown provider: ${provider}` };
      }
      const response = await fetch(url, { method, headers, ...(body ? { body } : {}), signal: controller.signal });
      if (response.ok) {
        return { success: true, message: `Connected to ${provider} successfully.` };
      }
      if (response.status === 401 || response.status === 403) {
        return { success: false, message: `Authentication failed (${response.status}). Check the API key.` };
      }

      const responseBody = await response.text().catch(() => '');
      return { success: false, message: `${provider} returned ${response.status}: ${responseBody.slice(0, 160)}` };
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') {
        return { success: false, message: 'Connection timed out after 15 seconds.' };
      }
      return { success: false, message: `Connection failed: ${error instanceof Error ? error.message : 'Unknown error'}` };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async reloadRouterClient(): Promise<void> {
    this.routerClient = new RouterClient(getExtensionConfig());
  }

  private detectCurrentIde(): string {
    const appName = vscode.env.appName.toLowerCase();
    if (appName.includes('qoder')) return 'qoder';
    if (appName.includes('cursor')) return 'cursor';
    if (appName.includes('windsurf')) return 'windsurf';
    if (appName.includes('claude')) return 'claude-desktop';
    if (appName.includes('antigravity')) return 'antigravity';
    return 'vscode';
  }

  private getHtmlForWebview(state: PanelState): string {
    const webview = this.panel.webview;
    const variablesCssUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'variables.css'));
    const settingsCssUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'settings.css'));
    const configuredProviderIds = state.providers.filter((provider) => provider.isConfigured).map((provider) => provider.provider);
    const visibleOverrideIds = MODE_OVERRIDE_DEFINITIONS
      .filter((definition) => {
        const currentValue = state.config.models.byMode[definition.id];
        return typeof currentValue === 'string' && currentValue.length > 0;
      })
      .map((definition) => definition.id);
    const providerTemplateMap = Object.fromEntries(
      state.providers.map((provider) => [provider.provider, this.renderProviderRow(provider)])
    );
    const providerOptionMap = Object.fromEntries(
      state.providers.map((provider) => [provider.provider, provider.displayName])
    );
    const overrideTemplateMap = Object.fromEntries(
      MODE_OVERRIDE_DEFINITIONS.map((definition) => [
        definition.id,
        this.renderModelRow(
          definition.label,
          definition.description,
          `mode-${definition.id}`,
          state.config.models.byMode[definition.id],
          state.models,
          'Not set (use server default)',
          definition.id
        ),
      ])
    );
    const overrideOptionMap = Object.fromEntries(
      MODE_OVERRIDE_DEFINITIONS.map((definition) => [definition.id, definition.label])
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource}; script-src 'unsafe-inline';">
  <title>ifin Platform Settings</title>
  <link rel="stylesheet" href="${variablesCssUri}">
  <link rel="stylesheet" href="${settingsCssUri}">
</head>
<body>
  <div class="shell">
    <aside class="sidebar">
      <div class="sidebar-header">
        <div class="sidebar-title">Settings</div>
        <div class="sidebar-subtitle">ifin Platform</div>
      </div>
      <nav class="sidebar-nav" role="tablist" aria-label="Settings sections">
        ${this.renderNavItem('overview', '1', 'Overview', true)}
        ${this.renderNavItem('models', '2', 'Models')}
        ${this.renderNavItem('providers', '3', 'Providers')}
        ${this.renderNavItem('integrations', '4', 'Integrations')}
      </nav>
      <div class="sidebar-footer">
        <button class="ghost-button" id="refresh-button" type="button">Refresh</button>
      </div>
    </aside>

    <main class="content">
      <div class="content-inner">
        <header class="content-header">
          <div class="header-copy">
            <h1>ifin Platform Settings</h1>
            <p>Manage model preferences, provider credentials, and router integration from one settings surface.</p>
          </div>
          <div class="header-meta">
            <div class="status-indicator ${state.modelCatalogSource === 'live' ? 'status-indicator-live' : 'status-indicator-fallback'}">
              <span class="status-indicator-label">Catalog</span>
              <span class="status-indicator-value">${state.modelCatalogSource === 'live' ? 'Live' : 'Fallback'}</span>
            </div>
          </div>
        </header>

        <div id="notice" class="notice" hidden></div>

        <section class="settings-section" id="section-overview" data-section="overview" role="tabpanel" aria-labelledby="tab-overview">
          <div class="section-head">
            <div>
              <h2>Overview</h2>
              <p>Check the active mode, review setup posture, and jump to the most common actions from one entry tab.</p>
            </div>
          </div>

          <div class="section-stack">
            <div class="status-metrics">
              ${this.renderMetric('Mode', state.currentMode === 'router' ? 'Router' : 'Agent', state.currentMode === 'router' ? 'ifin-managed models are active.' : 'Your IDE-native path is active.')}
              ${this.renderMetric('Providers', String(state.providers.filter((provider) => provider.isConfigured).length), `${state.providers.filter((provider) => provider.isConfigured).length} of ${state.providers.length} providers have stored credentials.`)}
              ${this.renderMetric('Catalog', state.modelCatalogSource === 'live' ? 'Live' : 'Fallback', state.modelCatalogSource === 'live' ? 'Router catalog loaded successfully.' : 'Bundled fallback catalog is in use.')}
              ${this.renderMetric('Client', labelForIde(state.detectedIde), 'Detected target used for MCP setup guidance.')}
            </div>

            <div class="settings-group">
              <div class="group-header">
                <div>
                  <h3>Quick Actions</h3>
                  <p>Open the runtime view, change mode, or prepare MCP setup without leaving settings.</p>
                </div>
              </div>
              <div class="group-body settings-surface">
                ${this.renderActionRow('Operating Mode', 'Switch between Agent mode and Router mode.', state.currentMode === 'router' ? 'Router mode is currently active.' : 'Agent mode is currently active.', 'switch-mode-button', 'Switch Mode')}
                ${this.renderActionRow('Status Dashboard', 'Open the health view for router, browser, and model path diagnostics.', 'Use this for runtime status rather than configuration.', 'show-status-button', 'Open Status')}
                ${this.renderActionRow('Client Setup', 'Detect the active client target and populate the MCP config path and command below.', `Current target: ${labelForIde(state.detectedIde)}.`, 'detect-setup-overview-button', 'Detect Setup')}
              </div>
            </div>

            <div class="settings-group">
              <div class="group-header">
                <div>
                  <h3>Current Summary</h3>
                  <p>This overview stays read-only so saves remain scoped to the detailed tabs.</p>
                </div>
              </div>
              <div class="group-body settings-surface">
                ${this.renderValueRow('Router Base URL', 'Active base URL used for health, catalog, and extension API requests.', state.config.baseUrl)}
                ${this.renderValueRow('Healthy Models Only', 'Whether unhealthy models are filtered out of model selectors.', state.config.showOnlyHealthyModels ? 'Enabled' : 'Disabled')}
                ${this.renderValueRow('Detected IDE', 'Client target used when generating MCP setup guidance.', labelForIde(state.detectedIde))}
              </div>
            </div>
          </div>
        </section>

        <section class="settings-section" id="section-models" data-section="models" role="tabpanel" aria-labelledby="tab-models" hidden>
          <div class="section-head">
            <div>
              <h2>Models</h2>
              <p>Keep the defaults visible, then add only the per-mode overrides you actually want to manage.</p>
            </div>
            <button class="primary-button" id="save-models-button" type="button">Save Model Settings</button>
          </div>

          <div class="section-stack">
            <div class="settings-group">
              <div class="group-header">
                <div>
                  <h3>Default Models</h3>
                  <p>Baseline selections used unless a workflow requests a mode-specific override.</p>
                </div>
              </div>
              <div class="group-body settings-surface">
                ${this.renderModelRow('Default Model', 'Primary model for conversations and general requests.', 'model-default', state.config.models.defaultModel, state.models, 'Not set (use router default)')}
                ${this.renderModelRow('Small Model', 'Lighter model for quick extension-side tasks and lower-cost prompts.', 'model-small', state.config.models.smallModel, state.models, 'Not set (use router default)')}
              </div>
            </div>

            <div class="settings-group">
              <div class="group-header">
                <div>
                  <h3>Per-mode Overrides</h3>
                  <p>Add only the workflow overrides you want to customize. Unset modes inherit the default selection.</p>
                </div>
              </div>
              <div class="group-body settings-surface">
                <div class="inline-toolbar">
                  <div class="inline-toolbar-copy">
                    <div class="setting-label">Add Override</div>
                    <div class="setting-help">Select a mode to reveal its override row.</div>
                  </div>
                  <div class="inline-toolbar-controls">
                    <select id="add-override-select" class="setting-select inline-select"></select>
                    <button class="secondary-button" id="add-override-button" type="button">Add Override</button>
                  </div>
                </div>
                <div id="model-overrides-empty" class="empty-state" hidden>No override rows are visible yet. Add a mode override to customize it here.</div>
                <div id="model-overrides-list"></div>
              </div>
            </div>
          </div>
        </section>

        <section class="settings-section" id="section-providers" data-section="providers" role="tabpanel" aria-labelledby="tab-providers" hidden>
          <div class="section-head">
            <div>
              <h2>Providers</h2>
              <p>Show only the provider rows you are actively configuring, then add others from the picker as needed.</p>
            </div>
            <button class="secondary-button" id="verify-setup-button" type="button">Verify Setup</button>
          </div>

          <div id="verify-result" class="verify-card" hidden></div>
          <div class="settings-group">
            <div class="group-header">
              <div>
                <h3>Provider Access</h3>
                <p>Add a provider row when you need to save, test, or remove its key.</p>
              </div>
            </div>
            <div class="group-body settings-surface">
              <div class="inline-toolbar">
                <div class="inline-toolbar-copy">
                  <div class="setting-label">Add Provider</div>
                  <div class="setting-help">Unconfigured providers stay hidden until you explicitly add them.</div>
                </div>
                <div class="inline-toolbar-controls">
                  <select id="add-provider-select" class="setting-select inline-select"></select>
                  <button class="secondary-button" id="add-provider-button" type="button">Add Provider</button>
                </div>
              </div>
            </div>
          </div>
          <div id="providers-empty" class="empty-state" hidden>No provider rows are visible yet. Add a provider to configure credentials.</div>
          <div id="providers-list" class="providers-list"></div>
        </section>

        <section class="settings-section" id="section-integrations" data-section="integrations" role="tabpanel" aria-labelledby="tab-integrations" hidden>
          <div class="section-head">
            <div>
              <h2>Integrations</h2>
              <p>Point the extension at the correct router instance and prepare the local client setup for MCP.</p>
            </div>
            <button class="primary-button" id="save-integrations-button" type="button">Save Integration Settings</button>
          </div>

          <div class="section-stack">
            <div class="settings-group">
              <div class="group-header">
                <div>
                  <h3>Router Connection</h3>
                  <p>These settings control how the extension discovers the local router and model catalog.</p>
                </div>
              </div>
              <div class="group-body settings-surface">
                ${this.renderTextFieldRow('Router Base URL', 'Used for health, catalog, and extension API requests.', 'router-base-url', state.config.baseUrl, 'http://localhost:3000')}
                ${this.renderTextFieldRow('Router Path', 'Optional repo root or built dist/src/index.js path for local MCP startup.', 'router-path', state.config.routerPath ?? '', 'C:\\Users\\you\\path\\to\\ifin-platform')}
                <label class="setting-row setting-row-toggle" for="healthy-only-toggle">
                  <div class="setting-copy">
                    <div class="setting-label">Healthy Models Only</div>
                    <div class="setting-help">Hide unhealthy models from the settings catalog and selector refreshes.</div>
                  </div>
                  <div class="setting-control">
                    <input id="healthy-only-toggle" class="toggle-input" type="checkbox" ${state.config.showOnlyHealthyModels ? 'checked' : ''}>
                  </div>
                </label>
              </div>
            </div>
            <div class="settings-group">
              <div class="group-header">
                <div>
                  <h3>Client Setup</h3>
                  <p>Inspect the detected IDE target and generate the recommended setup command.</p>
                </div>
              </div>
              <div class="group-body setup-card">
                <div class="setup-row">
                  <div class="setting-copy">
                    <div class="setting-label">Detected IDE</div>
                    <div class="setting-help">The extension will target this client when generating MCP setup guidance.</div>
                  </div>
                  <div class="setting-value-stack">
                    <div class="setting-value">${escapeHtml(labelForIde(state.detectedIde))}</div>
                    <button class="secondary-button" id="detect-setup-button" type="button">Detect Setup</button>
                  </div>
                </div>
                <div class="setup-details">
                  <div class="setup-detail-row">
                    <div class="setup-label">Config Path</div>
                    <div class="setup-mono" id="config-path">Run detection to inspect the current client config path.</div>
                  </div>
                  <div class="setup-detail-row">
                    <div class="setup-label">Recommended Command</div>
                    <div class="setup-mono" id="setup-command">Run detection to generate a setup command.</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const previousState = vscode.getState() || {
      section: 'overview',
      visibleProviders: ${toInlineJson(configuredProviderIds)},
      visibleOverrides: ${toInlineJson(visibleOverrideIds)},
    };
    let currentSection = previousState.section || 'overview';
    let visibleProviders = new Set(previousState.visibleProviders || ${toInlineJson(configuredProviderIds)});
    let visibleOverrides = new Set(previousState.visibleOverrides || ${toInlineJson(visibleOverrideIds)});
    const providerTemplates = ${toInlineJson(providerTemplateMap)};
    const providerOptions = ${toInlineJson(providerOptionMap)};
    const overrideTemplates = ${toInlineJson(overrideTemplateMap)};
    const overrideOptions = ${toInlineJson(overrideOptionMap)};

    function persistUiState() {
      vscode.setState({
        section: currentSection,
        visibleProviders: Array.from(visibleProviders),
        visibleOverrides: Array.from(visibleOverrides),
      });
    }

    function setSection(section) {
      currentSection = section;
      persistUiState();
      for (const button of document.querySelectorAll('[data-nav-target]')) {
        const active = button.getAttribute('data-nav-target') === section;
        button.classList.toggle('sidebar-item-active', active);
        button.setAttribute('aria-selected', active ? 'true' : 'false');
        button.tabIndex = active ? 0 : -1;
      }
      for (const view of document.querySelectorAll('[data-section]')) {
        const active = view.getAttribute('data-section') === section;
        view.hidden = !active;
        view.setAttribute('aria-hidden', active ? 'false' : 'true');
      }
    }

    function getInputValue(id) {
      const element = document.getElementById(id);
      return element ? element.value : '';
    }

    function renderSelectOptions(select, options, visibleSet, placeholder) {
      const remaining = Object.entries(options).filter(([id]) => !visibleSet.has(id));
      select.innerHTML = '<option value="">' + placeholder + '</option>' +
        remaining.map(([id, label]) => '<option value="' + id + '">' + label + '</option>').join('');
      select.disabled = remaining.length === 0;
    }

    function renderProviderList() {
      const list = document.getElementById('providers-list');
      const empty = document.getElementById('providers-empty');
      list.innerHTML = Array.from(visibleProviders).map((provider) => providerTemplates[provider] || '').join('');
      empty.hidden = visibleProviders.size !== 0;
      renderSelectOptions(document.getElementById('add-provider-select'), providerOptions, visibleProviders, 'Select provider');
      persistUiState();
    }

    function renderOverrideList() {
      const list = document.getElementById('model-overrides-list');
      const empty = document.getElementById('model-overrides-empty');
      list.innerHTML = Array.from(visibleOverrides).map((mode) => overrideTemplates[mode] || '').join('');
      empty.hidden = visibleOverrides.size !== 0;
      renderSelectOptions(document.getElementById('add-override-select'), overrideOptions, visibleOverrides, 'Select override');
      persistUiState();
    }

    function showNotice(message, kind = 'success') {
      const notice = document.getElementById('notice');
      notice.hidden = false;
      notice.textContent = message;
      notice.className = 'notice notice-' + kind;
      window.clearTimeout(showNotice.timerId);
      showNotice.timerId = window.setTimeout(() => { notice.hidden = true; }, 3200);
    }

    function saveModelSettings() {
      vscode.postMessage({
        command: 'saveModelSettings',
        defaultModel: getInputValue('model-default'),
        smallModel: getInputValue('model-small'),
        codeModel: getInputValue('mode-code'),
        planModel: getInputValue('mode-plan'),
        debugModel: getInputValue('mode-debug'),
        orchestratorModel: getInputValue('mode-orchestrator'),
        askModel: getInputValue('mode-ask'),
      });
    }

    function saveConnectionSettings() {
      vscode.postMessage({
        command: 'saveConnectionSettings',
        baseUrl: document.getElementById('router-base-url').value,
        routerPath: document.getElementById('router-path').value,
        showOnlyHealthyModels: document.getElementById('healthy-only-toggle').checked,
      });
    }

    function saveApiKey(provider) {
      const input = document.getElementById('key-' + provider);
      vscode.postMessage({ command: 'saveApiKey', provider, apiKey: input.value });
    }

    function removeApiKey(provider) {
      if (confirm('Remove the stored API key for ' + provider + '?')) {
        vscode.postMessage({ command: 'removeApiKey', provider });
      }
    }

    function testConnection(provider) { vscode.postMessage({ command: 'testConnection', provider }); }
    function verifySetup() { vscode.postMessage({ command: 'verifySetup' }); }
    function refreshPanel() { vscode.postMessage({ command: 'refresh' }); }
    function detectSetup() { vscode.postMessage({ command: 'setupMCP', ide: '${escapeJsString(state.detectedIde)}' }); }
    function switchMode() { vscode.postMessage({ command: 'switchMode' }); }
    function showStatus() { vscode.postMessage({ command: 'showStatus' }); }
    function addProvider() {
      const select = document.getElementById('add-provider-select');
      if (!select.value) return;
      visibleProviders.add(select.value);
      renderProviderList();
    }
    function addOverride() {
      const select = document.getElementById('add-override-select');
      if (!select.value) return;
      visibleOverrides.add(select.value);
      renderOverrideList();
    }
    function removeOverride(mode) {
      const select = document.getElementById('mode-' + mode);
      if (select) {
        select.value = '';
      }
      visibleOverrides.delete(mode);
      renderOverrideList();
    }

    function showVerifyResult(success, summary) {
      const container = document.getElementById('verify-result');
      if (!container) return;
      container.hidden = false;
      container.className = 'verify-card ' + (success ? 'verify-success' : 'verify-error');
      container.innerHTML = '<strong>' + (success ? 'Setup Verified' : 'Setup Issues Found') + '</strong>' + '<div class="verify-summary">' + summary + '</div>';
      window.clearTimeout(showVerifyResult.timerId);
      showVerifyResult.timerId = window.setTimeout(() => { container.hidden = true; }, 6000);
    }

    function setTesting(provider, isTesting) {
      const button = document.getElementById('test-' + provider);
      if (!button) return;
      button.disabled = isTesting;
      button.textContent = isTesting ? 'Testing...' : 'Test';
    }

    window.addEventListener('message', (event) => {
      const message = event.data;
      switch (message.command) {
        case 'testing':
          setTesting(message.provider, true);
          break;
        case 'testResult':
          setTesting(message.provider, false);
          showNotice(message.message, message.success ? 'success' : 'error');
          break;
        case 'error':
          showNotice(message.message, 'error');
          break;
        case 'notice':
          showNotice(message.message, message.kind || 'success');
          break;
        case 'verifyResult':
          showVerifyResult(message.success, message.summary);
          break;
        case 'mcpConfigReady':
          document.getElementById('config-path').textContent = message.configPath;
          document.getElementById('setup-command').textContent = message.setupCommand;
          showNotice(message.message, 'success');
          break;
      }
    });

    for (const button of document.querySelectorAll('[data-nav-target]')) {
      button.addEventListener('click', () => setSection(button.getAttribute('data-nav-target')));
    }
    document.addEventListener('click', (event) => {
      const trigger = event.target.closest('[data-remove-override]');
      if (!trigger) return;
      removeOverride(trigger.getAttribute('data-remove-override'));
    });
    document.getElementById('refresh-button').addEventListener('click', refreshPanel);
    document.getElementById('switch-mode-button').addEventListener('click', switchMode);
    document.getElementById('show-status-button').addEventListener('click', showStatus);
    document.getElementById('detect-setup-overview-button').addEventListener('click', detectSetup);
    document.getElementById('add-provider-button').addEventListener('click', addProvider);
    document.getElementById('add-override-button').addEventListener('click', addOverride);
    document.getElementById('save-models-button').addEventListener('click', saveModelSettings);
    document.getElementById('save-integrations-button').addEventListener('click', saveConnectionSettings);
    document.getElementById('detect-setup-button').addEventListener('click', detectSetup);
    const verifyButton = document.getElementById('verify-setup-button');
    if (verifyButton) verifyButton.addEventListener('click', verifySetup);
    renderProviderList();
    renderOverrideList();
    setSection(currentSection);
  </script>
</body>
</html>`;
  }

  private renderNavItem(section: string, badge: string, label: string, active = false): string {
    return `
      <button
        class="sidebar-item ${active ? 'sidebar-item-active' : ''}"
        id="tab-${section}"
        type="button"
        role="tab"
        aria-controls="section-${section}"
        aria-selected="${active ? 'true' : 'false'}"
        tabindex="${active ? '0' : '-1'}"
        data-nav-target="${section}"
      >
        <span class="sidebar-badge">${badge}</span>
        <span class="sidebar-label">${label}</span>
      </button>
    `;
  }

  private renderMetric(label: string, value: string, help: string): string {
    return `
      <div class="status-metric">
        <div class="status-metric-label">${escapeHtml(label)}</div>
        <div class="status-metric-value">${escapeHtml(value)}</div>
        <div class="status-metric-help">${escapeHtml(help)}</div>
      </div>
    `;
  }

  private renderActionRow(label: string, help: string, meta: string, buttonId: string, buttonLabel: string): string {
    return `
      <div class="setting-row">
        <div class="setting-copy">
          <div class="setting-label">${escapeHtml(label)}</div>
          <div class="setting-help">${escapeHtml(help)}</div>
        </div>
        <div class="setting-control">
          <div class="setting-value-stack">
            <div class="status-meta">${escapeHtml(meta)}</div>
            <button class="secondary-button" id="${buttonId}" type="button">${escapeHtml(buttonLabel)}</button>
          </div>
        </div>
      </div>
    `;
  }

  private renderValueRow(label: string, help: string, value: string): string {
    return `
      <div class="setting-row">
        <div class="setting-copy">
          <div class="setting-label">${escapeHtml(label)}</div>
          <div class="setting-help">${escapeHtml(help)}</div>
        </div>
        <div class="setting-control">
          <div class="setting-value-stack">
            <div class="setting-value">${escapeHtml(value)}</div>
          </div>
        </div>
      </div>
    `;
  }

  private renderModelRow(
    label: string,
    description: string,
    id: string,
    selectedModel: string | null,
    models: RouterModelInfo[],
    unsetLabel: string,
    overrideId?: ModeOverrideId
  ): string {
    return `
      <div class="setting-row">
        <div class="setting-copy">
          <div class="setting-label">${escapeHtml(label)}</div>
          <div class="setting-help">${escapeHtml(description)}</div>
        </div>
        <div class="setting-control">
          <div class="inline-select-stack">
            <select id="${id}" class="setting-select">
              <option value="">${escapeHtml(unsetLabel)}</option>
              ${this.renderModelOptions(models, selectedModel)}
            </select>
            ${overrideId ? `<button class="ghost-button inline-remove-button" type="button" data-remove-override="${overrideId}">Remove Override</button>` : ''}
          </div>
        </div>
      </div>
    `;
  }

  private renderModelOptions(models: RouterModelInfo[], selectedModel: string | null): string {
    const grouped = new Map<string, RouterModelInfo[]>();
    for (const model of models) {
      const bucket = grouped.get(model.provider) ?? [];
      bucket.push(model);
      grouped.set(model.provider, bucket);
    }
    return Array.from(grouped.entries()).map(([provider, providerModels]) => `
      <optgroup label="${escapeHtml(provider.toUpperCase())}">
        ${providerModels.map((model) => `
          <option value="${escapeHtml(model.id)}" ${selectedModel === model.id ? 'selected' : ''}>${escapeHtml(model.name)}</option>
        `).join('')}
      </optgroup>
    `).join('');
  }
  private renderProviderRow(provider: ProviderApiKeyConfig): string {
    return `
      <div class="provider-item" id="card-${escapeHtml(provider.provider)}">
        <div class="provider-summary">
          <div class="provider-heading">
            <div class="provider-title">${escapeHtml(provider.displayName)}</div>
            <div class="provider-meta">${escapeHtml(provider.description)}</div>
          </div>
          <div class="provider-status-line">
            <span class="provider-status-dot ${provider.isConfigured ? 'configured' : ''}"></span>
            <span>${provider.isConfigured ? 'Configured in secure storage' : 'No key saved'}</span>
          </div>
        </div>
        <div class="provider-detail-grid">
          <div class="provider-detail-item">
            <span class="provider-detail-label">Base URL</span>
            <div class="provider-url">${escapeHtml(provider.baseUrl ?? 'No base URL configured')}</div>
          </div>
          <div class="provider-detail-item">
            <span class="provider-detail-label">State</span>
            <div class="provider-detail-value">${provider.isConfigured ? 'Configured and ready for validation.' : 'Save a key to enable validation.'}</div>
          </div>
        </div>
        <div class="setting-row provider-key-row">
          <div class="setting-copy">
            <div class="setting-label">API Key</div>
            <div class="setting-help">Stored securely in VS Code secret storage and pushed to the router when saved.</div>
          </div>
          <div class="setting-control">
            <div class="provider-control-stack">
              <input
                type="password"
                class="field-input"
                id="key-${escapeHtml(provider.provider)}"
                placeholder="Enter ${escapeHtml(provider.displayName)} API key"
                value="${provider.isConfigured ? '************' : ''}"
              />
              <div class="provider-actions">
                <button class="primary-button" type="button" onclick="saveApiKey('${escapeJsString(provider.provider)}')">Save</button>
                <button class="secondary-button" id="test-${escapeHtml(provider.provider)}" type="button" onclick="testConnection('${escapeJsString(provider.provider)}')" ${!provider.isConfigured ? 'disabled' : ''}>Test</button>
                <button class="danger-button" type="button" onclick="removeApiKey('${escapeJsString(provider.provider)}')" ${!provider.isConfigured ? 'disabled' : ''}>Remove</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private renderTextFieldRow(label: string, help: string, id: string, value: string, placeholder: string): string {
    return `
      <label class="setting-row" for="${id}">
        <span class="setting-copy">
          <span class="setting-label">${escapeHtml(label)}</span>
          <span class="setting-help">${escapeHtml(help)}</span>
        </span>
        <span class="setting-control">
          <input id="${id}" class="field-input" type="text" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}">
        </span>
      </label>
    `;
  }

  public dispose(): void {
    ApiKeySettingsPanel.currentPanel = undefined;
    this.panel.dispose();
    while (this.disposables.length > 0) {
      const disposable = this.disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }
}

function normalizeConfigValue(value: string | undefined): string {
  return (value ?? '').trim();
}

function labelForIde(ide: string): string {
  return ide.split('-').map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1)).join(' ');
}

function extractProviderCount(payload: unknown): number {
  if (!payload || typeof payload !== 'object') {
    return 0;
  }

  const directProviders = (payload as { providers?: unknown }).providers;
  if (Array.isArray(directProviders)) {
    return directProviders.length;
  }
  if (directProviders && typeof directProviders === 'object') {
    return Object.keys(directProviders).length;
  }

  const nestedProviderCount = (payload as { providerCount?: unknown }).providerCount;
  if (typeof nestedProviderCount === 'number') {
    return nestedProviderCount;
  }

  const health = (payload as { health?: unknown }).health;
  if (health && typeof health === 'object') {
    return extractProviderCount(health);
  }

  return 0;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeJsString(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll("'", "\\'");
}

function toInlineJson(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026');
}
