import * as vscode from 'vscode';
import { ConnectionInfo, RouterConnectionManager } from '../infra/connectionManager';
import { getLogger } from '../infra/logger';

const logger = getLogger('status-panel');

interface TabInfo {
  tabId: string;
  url: string;
  title: string;
  isActive: boolean;
}

interface StatusPanelState {
  mode: 'agent' | 'router';
  connectionInfo: ConnectionInfo;
  isVsCode: boolean;
  tabs: TabInfo[];
}

type StatusTone = 'accent' | 'success' | 'warning' | 'danger' | 'neutral';

interface StatusSummary {
  label: string;
  tone: StatusTone;
  detail: string;
}

interface NativeModelsSummary extends StatusSummary {
  availability: string;
}

interface ActionButtonConfig {
  command: string;
  label: string;
  style: 'primary' | 'secondary';
  disabled?: boolean;
}

export class StatusPanel {
  private static currentPanel: StatusPanel | undefined;
  private static readonly viewType = 'ifinPlatform.status';

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly connectionManager: RouterConnectionManager;
  private refreshInterval: NodeJS.Timeout | null = null;
  private disposables: vscode.Disposable[] = [];

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    connectionManager: RouterConnectionManager
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.connectionManager = connectionManager;

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (message) => this.handleMessage(message as { command?: string }),
      null,
      this.disposables
    );

    this.refreshInterval = setInterval(() => {
      void this.refresh();
    }, 15_000);

    void this.refresh();
  }

  public static show(
    context: vscode.ExtensionContext,
    connectionManager: RouterConnectionManager
  ): void {
    if (StatusPanel.currentPanel) {
      StatusPanel.currentPanel.panel.reveal(vscode.ViewColumn.Two);
      void StatusPanel.currentPanel.refresh();
      return;
    }

    const panel = vscode.window.createWebviewPanel(StatusPanel.viewType, 'ifin Platform Status', vscode.ViewColumn.Two, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
    });

    StatusPanel.currentPanel = new StatusPanel(panel, context.extensionUri, connectionManager);
  }

  private async handleMessage(message: { command?: string }): Promise<void> {
    switch (message.command) {
      case 'switchMode':
        await vscode.commands.executeCommand('ifinPlatform.switchMode');
        break;
      case 'openBrowserPairing':
        await vscode.commands.executeCommand('ifinPlatform.pairBrowser');
        break;
      case 'openSettings':
        await vscode.commands.executeCommand('ifinPlatform.configureApiKeys');
        break;
      case 'refresh':
        await this.connectionManager.refresh();
        await this.refresh();
        break;
      default:
        break;
    }
  }

  private async fetchTabs(): Promise<TabInfo[]> {
    try {
      const config = vscode.workspace.getConfiguration('ifinPlatform');
      const baseUrl = config.get<string>('baseUrl', 'http://localhost:3000');
      const response = await fetch(`${baseUrl}/api/browser/tabs`, {
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) {
        return [];
      }

      const data = (await response.json()) as { tabs?: TabInfo[] };
      return data.tabs ?? [];
    } catch {
      return [];
    }
  }

  private async refresh(): Promise<void> {
    const mode = vscode.workspace.getConfiguration('ifinPlatform').get<string>('mode', 'agent') as 'agent' | 'router';
    const connectionInfo = this.connectionManager.info;
    const isVsCode = this.detectVsCode();
    const tabs = await this.fetchTabs();

    const state: StatusPanelState = {
      mode,
      connectionInfo,
      isVsCode,
      tabs,
    };

    this.panel.webview.html = this.getHtml(state);
  }

  private detectVsCode(): boolean {
    const appName = vscode.env.appName.toLowerCase();
    return appName.includes('visual studio code') || appName.includes('vscode');
  }

  private getHtml(state: StatusPanelState): string {
    const webview = this.panel.webview;
    const variablesCssUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'variables.css'));
    const settingsCssUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'settings.css'));

    const { mode, connectionInfo, isVsCode, tabs } = state;
    const routerSummary = this.getRouterSummary(connectionInfo);
    const browserSummary = this.getBrowserSummary(connectionInfo);
    const nativeModelsSummary = this.getNativeModelsSummary(mode, isVsCode);
    const modeSummary = this.getModeSummary(mode);
    const providerCount = connectionInfo.providers.length;
    const lastCheck = this.formatLastCheck(connectionInfo.lastCheck);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'unsafe-inline';">
  <title>ifin Platform Status</title>
  <link rel="stylesheet" href="${variablesCssUri}">
  <link rel="stylesheet" href="${settingsCssUri}">
</head>
<body>
  <div class="shell">
    <aside class="sidebar">
      <div class="sidebar-header">
        <div class="sidebar-title">Status</div>
        <div class="sidebar-subtitle">ifin Platform</div>
      </div>
      <nav class="sidebar-nav">
        ${this.renderNavItem('overview', '1', 'Overview', true)}
        ${this.renderNavItem('router', '2', 'Router')}
        ${this.renderNavItem('browser', '3', 'Browser')}
        ${this.renderNavItem('models', '4', 'Models')}
        ${this.renderNavItem('tabs', '5', 'Tabs')}
      </nav>
      <div class="sidebar-footer">
        <div class="status-meta">Last check: ${this.escapeHtml(lastCheck)}</div>
        <button class="ghost-button" id="refresh-button" type="button">Refresh</button>
      </div>
    </aside>

    <main class="content">
      <div class="content-inner">
        <header class="content-header">
          <div class="header-copy">
            <h1>ifin Platform Status</h1>
            <p>Inspect router reachability, browser bridge state, and current execution mode in one compact status surface.</p>
          </div>
          <div class="header-actions">
            <span class="status-pill status-pill-${routerSummary.tone}">
              <span class="status-dot-small"></span>
              ${this.escapeHtml(routerSummary.label)}
            </span>
            <button class="secondary-button" id="header-settings-button" type="button">Open Settings</button>
          </div>
        </header>

        <section class="settings-section" data-section="overview">
          <div class="section-head">
            <div>
              <h2>Overview</h2>
              <p>Review the current mode, router state, browser bridge, and IDE model path at a glance.</p>
            </div>
          </div>

          <div class="section-stack">
            <div class="status-metrics">
              ${this.renderMetric('Mode', mode === 'router' ? 'Router' : 'Agent', modeSummary.detail)}
              ${this.renderMetric('Providers', String(providerCount), providerCount === 1 ? '1 provider reported by health.' : `${providerCount} providers reported by health.`)}
              ${this.renderMetric('Models', String(connectionInfo.modelCount), 'Approximate healthy model count from provider status.')}
              ${this.renderMetric('Tabs', String(connectionInfo.browserTabCount), tabs.length > 0 ? `${tabs.length} browser tabs listed.` : 'No browser tabs currently listed.')}
            </div>

            <div class="settings-group">
              <div class="group-header">
                <div>
                  <h3>Current State</h3>
                  <p>Each area below links to the next action without leaving the status view.</p>
                </div>
              </div>
              <div class="group-body settings-surface">
                ${this.renderStatusRow(
                  'Operating Mode',
                  'Choose whether the extension routes requests through ifin Platform or stays on the IDE-native model path.',
                  modeSummary.label,
                  modeSummary.tone,
                  modeSummary.detail,
                  { command: 'switchMode', label: 'Switch Mode', style: 'secondary' }
                )}
                ${this.renderStatusRow(
                  'Router',
                  'Reachability, provider availability, and router health warnings are reported from the local health endpoint.',
                  routerSummary.label,
                  routerSummary.tone,
                  routerSummary.detail,
                  { command: 'openSettings', label: 'Open Settings', style: 'secondary' }
                )}
                ${this.renderStatusRow(
                  'Browser Bridge',
                  'Tracks whether the paired browser is connected and whether the extension can enumerate tabs.',
                  browserSummary.label,
                  browserSummary.tone,
                  browserSummary.detail,
                  { command: 'openBrowserPairing', label: connectionInfo.browserConnected ? 'Manage Browser' : 'Pair Browser', style: 'secondary' }
                )}
                ${this.renderStatusRow(
                  'IDE Models',
                  'Shows whether the current host can provide native language models directly or whether routing is handling execution.',
                  nativeModelsSummary.label,
                  nativeModelsSummary.tone,
                  nativeModelsSummary.availability,
                  { command: 'openSettings', label: 'Model Settings', style: 'secondary', disabled: !isVsCode }
                )}
              </div>
            </div>
          </div>
        </section>

        <section class="settings-section" data-section="router" hidden>
          <div class="section-head">
            <div>
              <h2>Router</h2>
              <p>Detailed connection status for the local router, including provider health and warning propagation.</p>
            </div>
            <button class="secondary-button" type="button" data-command="openSettings">Open Settings</button>
          </div>

          <div class="section-stack">
            <div class="settings-group">
              <div class="group-header">
                <div>
                  <h3>Router Connection</h3>
                  <p>Use this section when the extension reports degraded or disconnected router state.</p>
                </div>
              </div>
              <div class="group-body settings-surface">
                ${this.renderStatusRow('Status', 'Current router reachability derived from the latest health poll.', routerSummary.label, routerSummary.tone, routerSummary.detail)}
                ${this.renderValueRow('Router Version', 'Version header or health payload version reported by the router.', connectionInfo.routerVersion ?? 'Unknown')}
                ${this.renderValueRow('Available Models', 'Approximate count of healthy or degraded provider-backed models.', String(connectionInfo.modelCount))}
                ${this.renderValueRow('Last Check', 'Relative time since the extension last completed a successful health request.', lastCheck)}
              </div>
            </div>

            <div class="settings-group">
              <div class="group-header">
                <div>
                  <h3>Provider Health</h3>
                  <p>Health rows come directly from the router payload and reflect the provider execution path the router sees.</p>
                </div>
              </div>
              <div class="group-body">
                ${this.renderProviderHealth(connectionInfo)}
              </div>
            </div>
          </div>
        </section>

        <section class="settings-section" data-section="browser" hidden>
          <div class="section-head">
            <div>
              <h2>Browser</h2>
              <p>Review browser bridge connectivity and jump straight to pairing or browser management when needed.</p>
            </div>
            <button class="secondary-button" type="button" data-command="openBrowserPairing">${connectionInfo.browserConnected ? 'Manage Browser' : 'Pair Browser'}</button>
          </div>

          <div class="section-stack">
            <div class="settings-group">
              <div class="group-header">
                <div>
                  <h3>Browser Bridge</h3>
                  <p>The router uses this bridge for browser automation and tab inspection.</p>
                </div>
              </div>
              <div class="group-body settings-surface">
                ${this.renderStatusRow('Connection', 'Whether the local browser bridge is connected to the router right now.', browserSummary.label, browserSummary.tone, browserSummary.detail)}
                ${this.renderValueRow('Tracked Tabs', 'Number of tabs the router reports through the browser bridge.', String(connectionInfo.browserTabCount))}
                ${this.renderValueRow('Last Check', 'Shared router health polling timestamp for browser connectivity data.', lastCheck)}
              </div>
            </div>
          </div>
        </section>

        <section class="settings-section" data-section="models" hidden>
          <div class="section-head">
            <div>
              <h2>Models</h2>
              <p>Clarify whether the extension is currently using IDE-native models or router-managed models.</p>
            </div>
            <button class="secondary-button" type="button" data-command="switchMode">Switch Mode</button>
          </div>

          <div class="section-stack">
            <div class="settings-group">
              <div class="group-header">
                <div>
                  <h3>IDE Model Path</h3>
                  <p>The effective path depends on both host IDE support and the current extension mode.</p>
                </div>
              </div>
              <div class="group-body settings-surface">
                ${this.renderStatusRow('Availability', 'Effective native-model posture for the current host and selected mode.', nativeModelsSummary.label, nativeModelsSummary.tone, nativeModelsSummary.availability)}
                ${this.renderValueRow('Host IDE', 'The current host application determines whether native language model APIs are available.', isVsCode ? 'VS Code-compatible host' : 'Non-VS Code host')}
                ${this.renderValueRow('Selected Mode', 'Current extension mode stored in workspace configuration.', mode === 'router' ? 'Router mode' : 'Agent mode')}
              </div>
            </div>
          </div>
        </section>

        <section class="settings-section" data-section="tabs" hidden>
          <div class="section-head">
            <div>
              <h2>Tabs</h2>
              <p>Active browser tabs surfaced by the router. This list stays compact and read-only in the status view.</p>
            </div>
            <button class="secondary-button" type="button" data-command="openBrowserPairing">${tabs.length > 0 ? 'Manage Browser' : 'Pair Browser'}</button>
          </div>

          <div class="section-stack">
            <div class="settings-group">
              <div class="group-header">
                <div>
                  <h3>Browser Tabs</h3>
                  <p>${tabs.length === 1 ? '1 tab is currently listed by the router.' : `${tabs.length} tabs are currently listed by the router.`}</p>
                </div>
              </div>
              <div class="group-body">
                ${this.renderTabs(tabs, connectionInfo.browserConnected)}
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const previousState = vscode.getState() || { section: 'overview' };
    let currentSection = previousState.section || 'overview';

    function setSection(section) {
      currentSection = section;
      vscode.setState({ section });
      for (const button of document.querySelectorAll('[data-nav-target]')) {
        button.classList.toggle('sidebar-item-active', button.getAttribute('data-nav-target') === section);
      }
      for (const view of document.querySelectorAll('[data-section]')) {
        view.hidden = view.getAttribute('data-section') !== section;
      }
    }

    for (const button of document.querySelectorAll('[data-nav-target]')) {
      button.addEventListener('click', () => setSection(button.getAttribute('data-nav-target')));
    }

    for (const button of document.querySelectorAll('[data-command]')) {
      button.addEventListener('click', () => vscode.postMessage({ command: button.getAttribute('data-command') }));
    }

    document.getElementById('refresh-button').addEventListener('click', () => {
      vscode.postMessage({ command: 'refresh' });
    });

    document.getElementById('header-settings-button').addEventListener('click', () => {
      vscode.postMessage({ command: 'openSettings' });
    });

    setSection(currentSection);
  </script>
</body>
</html>`;
  }

  private getModeSummary(mode: 'agent' | 'router'): StatusSummary {
    if (mode === 'router') {
      return {
        label: 'Router Mode',
        tone: 'accent',
        detail: 'The extension routes model execution through ifin Platform.',
      };
    }

    return {
      label: 'Agent Mode',
      tone: 'success',
      detail: 'The extension keeps model execution on the IDE-native path.',
    };
  }

  private getRouterSummary(info: ConnectionInfo): StatusSummary {
    if (info.status === 'connected') {
      return {
        label: 'Connected',
        tone: 'success',
        detail: `Router healthy with ${info.providers.length} provider${info.providers.length === 1 ? '' : 's'} reported.`,
      };
    }

    if (this.isMissingProviderState(info)) {
      return {
        label: 'No Providers',
        tone: 'warning',
        detail: info.statusDetail ?? 'Router is reachable, but provider configuration is still missing.',
      };
    }

    if (info.status === 'degraded') {
      return {
        label: 'Degraded',
        tone: 'warning',
        detail: info.statusDetail ?? 'Router is reachable, but one or more checks reported degraded state.',
      };
    }

    return {
      label: 'Disconnected',
      tone: 'danger',
      detail: info.error ?? 'The extension could not reach the local router.',
    };
  }

  private getBrowserSummary(info: ConnectionInfo): StatusSummary {
    if (info.browserConnected) {
      return {
        label: 'Connected',
        tone: 'success',
        detail: `${info.browserTabCount} tab${info.browserTabCount === 1 ? '' : 's'} currently available through the bridge.`,
      };
    }

    if (info.status === 'connected' || info.status === 'degraded') {
      return {
        label: 'Not Connected',
        tone: 'warning',
        detail: 'Router is reachable, but no browser bridge is currently attached.',
      };
    }

    return {
      label: 'Unavailable',
      tone: 'danger',
      detail: 'Browser state is unavailable while the router itself is disconnected.',
    };
  }

  private getNativeModelsSummary(mode: 'agent' | 'router', isVsCode: boolean): NativeModelsSummary {
    if (!isVsCode) {
      return {
        label: 'Unsupported',
        tone: 'neutral',
        detail: 'This host does not expose the VS Code language model APIs used by the extension.',
        availability: 'IDE-native models are not available in this host.',
      };
    }

    if (mode === 'agent') {
      return {
        label: 'IDE Active',
        tone: 'success',
        detail: 'Agent mode keeps execution on the IDE-native provider path.',
        availability: 'IDE-native models are the active path right now.',
      };
    }

    return {
      label: 'Router Managed',
      tone: 'accent',
      detail: 'Router mode bypasses the IDE-native provider path for model execution.',
      availability: 'Router-managed models are the active path right now.',
    };
  }

  private renderNavItem(section: string, badge: string, label: string, active = false): string {
    return `
      <button class="sidebar-item ${active ? 'sidebar-item-active' : ''}" type="button" data-nav-target="${section}">
        <span class="sidebar-badge">${badge}</span>
        <span class="sidebar-label">${label}</span>
      </button>
    `;
  }

  private renderMetric(label: string, value: string, help: string): string {
    return `
      <div class="status-metric">
        <div class="status-metric-label">${this.escapeHtml(label)}</div>
        <div class="status-metric-value">${this.escapeHtml(value)}</div>
        <div class="status-metric-help">${this.escapeHtml(help)}</div>
      </div>
    `;
  }

  private renderStatusRow(
    label: string,
    help: string,
    value: string,
    tone: StatusTone,
    meta: string,
    action?: ActionButtonConfig
  ): string {
    const actionMarkup = action
      ? `<button class="${action.style === 'primary' ? 'primary-button' : 'secondary-button'}" type="button" data-command="${action.command}" ${action.disabled ? 'disabled' : ''}>${this.escapeHtml(action.label)}</button>`
      : '';

    return `
      <div class="setting-row">
        <div class="setting-copy">
          <div class="setting-label">${this.escapeHtml(label)}</div>
          <div class="setting-help">${this.escapeHtml(help)}</div>
        </div>
        <div class="setting-control">
          <div class="setting-value-stack">
            <div class="status-line">
              <span class="status-pill status-pill-${tone}">
                <span class="status-dot-small"></span>
                ${this.escapeHtml(value)}
              </span>
            </div>
            <div class="status-meta">${this.escapeHtml(meta)}</div>
            ${actionMarkup}
          </div>
        </div>
      </div>
    `;
  }

  private renderValueRow(label: string, help: string, value: string, meta?: string): string {
    return `
      <div class="setting-row">
        <div class="setting-copy">
          <div class="setting-label">${this.escapeHtml(label)}</div>
          <div class="setting-help">${this.escapeHtml(help)}</div>
        </div>
        <div class="setting-control">
          <div class="setting-value-stack">
            <div class="setting-value">${this.escapeHtml(value)}</div>
            ${meta ? `<div class="status-meta">${this.escapeHtml(meta)}</div>` : ''}
          </div>
        </div>
      </div>
    `;
  }

  private renderProviderHealth(info: ConnectionInfo): string {
    if (info.providers.length === 0) {
      return `<div class="empty-state">${this.escapeHtml(info.statusDetail ?? 'No providers are currently reported by the router.')}</div>`;
    }

    return `
      <div class="status-list">
        ${info.providers
          .map(
            (provider) => `
              <div class="status-list-item">
                <div class="status-list-copy">
                  <div class="status-list-title">${this.escapeHtml(provider.name)}</div>
                  <div class="status-list-meta">Reported by the latest router health snapshot.</div>
                </div>
                <div class="status-line">
                  <span class="status-pill status-pill-${this.getProviderTone(provider.status)}">
                    <span class="status-dot-small"></span>
                    ${this.escapeHtml(this.formatProviderStatus(provider.status))}
                  </span>
                </div>
              </div>
            `
          )
          .join('')}
      </div>
    `;
  }

  private renderTabs(tabs: TabInfo[], browserConnected: boolean): string {
    if (tabs.length === 0) {
      const message = browserConnected
        ? 'The browser bridge is connected, but no tabs are currently reported.'
        : 'Pair a browser to populate this list.';
      return `<div class="empty-state">${this.escapeHtml(message)}</div>`;
    }

    return `
      <div class="tab-list">
        ${tabs
          .map(
            (tab) => `
              <div class="tab-row ${tab.isActive ? 'tab-row-active' : ''}">
                <div class="tab-copy">
                  <div class="tab-title">${this.escapeHtml(tab.title || 'Untitled')}</div>
                  <div class="provider-url">${this.escapeHtml(tab.url || 'No URL reported')}</div>
                </div>
                <div class="tab-meta">
                  <span class="status-pill status-pill-${tab.isActive ? 'accent' : 'neutral'}">
                    <span class="status-dot-small"></span>
                    ${tab.isActive ? 'Active' : 'Tracked'}
                  </span>
                </div>
              </div>
            `
          )
          .join('')}
      </div>
    `;
  }

  private getProviderTone(status: string): StatusTone {
    switch (status) {
      case 'healthy':
        return 'success';
      case 'degraded':
        return 'warning';
      case 'unhealthy':
      case 'failed':
        return 'danger';
      default:
        return 'neutral';
    }
  }

  private formatProviderStatus(status: string): string {
    if (status.length === 0) {
      return 'Unknown';
    }
    return status.charAt(0).toUpperCase() + status.slice(1);
  }

  private isMissingProviderState(info: ConnectionInfo): boolean {
    return (
      info.providers.length === 0 &&
      typeof info.statusDetail === 'string' &&
      info.statusDetail.toLowerCase().includes('no providers are configured')
    );
  }

  private formatLastCheck(timestamp: number | null): string {
    if (!timestamp) {
      return 'Never';
    }

    const ago = Math.round((Date.now() - timestamp) / 1000);
    if (ago < 5) {
      return 'Just now';
    }
    if (ago < 60) {
      return `${ago}s ago`;
    }
    if (ago < 3_600) {
      return `${Math.round(ago / 60)}m ago`;
    }
    return `${Math.round(ago / 3_600)}h ago`;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  public dispose(): void {
    StatusPanel.currentPanel = undefined;

    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }

    this.panel.dispose();

    while (this.disposables.length > 0) {
      const disposable = this.disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }

    logger.info('StatusPanel disposed');
  }
}
