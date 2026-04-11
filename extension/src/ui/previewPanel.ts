import * as vscode from 'vscode';
import { getLogger } from '../infra/logger';

const logger = getLogger('preview-panel');

interface BrowserContext {
  url: string;
  title: string;
  selectedText?: string;
  metaDescription?: string;
}

interface BrowserStatus {
  connected: boolean;
}

/**
 * Webview panel for live browser preview.
 * Shows current browser page URL, title, screenshot, and connection status.
 */
export class PreviewPanel {
  private static currentPanel: PreviewPanel | undefined;
  private static readonly viewType = 'ifinPlatform.preview';

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel;
    this.extensionUri = extensionUri;

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (message) => this.handleMessage(message),
      null,
      this.disposables,
    );

    // Start auto-refresh every 10 seconds
    this.refreshInterval = setInterval(() => {
      this.refresh();
    }, 10000);

    // Initial render
    this.refresh();
  }

  /**
   * Show the preview panel.
   * @param context Extension context for URI resolution
   */
  public static show(context: vscode.ExtensionContext): void {
    if (PreviewPanel.currentPanel) {
      PreviewPanel.currentPanel.panel.reveal(vscode.ViewColumn.Two);
      PreviewPanel.currentPanel.refresh();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      PreviewPanel.viewType,
      'ifin Browser Preview',
      vscode.ViewColumn.Two,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
      },
    );

    PreviewPanel.currentPanel = new PreviewPanel(panel, context.extensionUri);
  }

  private async handleMessage(message: { command?: string }): Promise<void> {
    switch (message.command) {
      case 'captureScreenshot':
        await this.captureAndRefresh();
        break;
      case 'refresh':
        await this.refresh();
        break;
    }
  }

  private getBaseUrl(): string {
    return vscode.workspace.getConfiguration('ifinPlatform').get<string>('baseUrl', 'http://localhost:3000');
  }

  private async fetchContext(): Promise<BrowserContext> {
    const baseUrl = this.getBaseUrl();
    try {
      const res = await fetch(`${baseUrl}/api/browser/context`);
      if (res.ok) {
        return await res.json() as BrowserContext;
      }
    } catch (error) {
      logger.debug('Failed to fetch browser context:', error);
    }
    return { url: '', title: '', selectedText: '', metaDescription: '' };
  }

  private async fetchStatus(): Promise<BrowserStatus> {
    const baseUrl = this.getBaseUrl();
    try {
      const res = await fetch(`${baseUrl}/api/browser/status`);
      if (res.ok) {
        return await res.json() as BrowserStatus;
      }
    } catch (error) {
      logger.debug('Failed to fetch browser status:', error);
    }
    return { connected: false };
  }

  private async captureScreenshot(): Promise<string> {
    const baseUrl = this.getBaseUrl();
    try {
      const res = await fetch(`${baseUrl}/api/browser/screenshot`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json() as { screenshot?: string };
        return data.screenshot ?? '';
      }
    } catch (error) {
      logger.debug('Failed to capture screenshot:', error);
    }
    return '';
  }

  private async refresh(): Promise<void> {
    const [context, status] = await Promise.all([
      this.fetchContext(),
      this.fetchStatus(),
    ]);

    if (!this.panel) {
      return;
    }

    this.panel.webview.html = this.getHtml(context, status, '');
  }

  private async captureAndRefresh(): Promise<void> {
    const [context, status, screenshot] = await Promise.all([
      this.fetchContext(),
      this.fetchStatus(),
      this.captureScreenshot(),
    ]);

    if (!this.panel) {
      return;
    }

    this.panel.webview.html = this.getHtml(context, status, screenshot);
  }

  private getHtml(context: BrowserContext, status: BrowserStatus, screenshot: string): string {
    const webview = this.panel.webview;
    const variablesCssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'variables.css'),
    );

    const connected = status.connected;
    const statusColor = connected ? 'var(--success)' : 'var(--danger)';
    const statusText = connected ? 'Connected' : 'Not Connected';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'unsafe-inline'; img-src data:;">
  <title>Browser Preview</title>
  <link rel="stylesheet" href="${variablesCssUri}">
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      background-color: var(--shell-bg);
      color: var(--text-primary);
      font-family: var(--font-sans);
      min-height: 100vh;
      padding: var(--space-5);
    }

    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: var(--space-4);
    }

    .header h1 {
      font-size: 16px;
      font-weight: 600;
    }

    .status-badge {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: var(--text-secondary);
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }

    .actions {
      display: flex;
      gap: var(--space-2);
      margin-bottom: var(--space-4);
    }

    .btn {
      padding: 6px 12px;
      background: var(--accent);
      color: var(--text-on-accent);
      border: none;
      border-radius: var(--radius-md);
      cursor: pointer;
      font-size: 12px;
      transition: opacity var(--transition-fast);
    }

    .btn:hover {
      opacity: 0.9;
    }

    .btn-secondary {
      background: var(--shell-panel);
      border: 1px solid var(--shell-border-strong);
      color: var(--text-primary);
    }

    .info-card {
      background: var(--shell-panel);
      border: 1px solid var(--shell-border);
      border-radius: var(--radius-md);
      padding: var(--space-3);
      margin-bottom: var(--space-3);
    }

    .info-label {
      font-size: 11px;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 4px;
    }

    .info-value {
      font-size: 13px;
      word-break: break-all;
    }

    .screenshot-container {
      background: var(--shell-panel);
      border: 1px solid var(--shell-border);
      border-radius: var(--radius-md);
      padding: var(--space-2);
      text-align: center;
      min-height: 200px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .screenshot-container img {
      max-width: 100%;
      border-radius: 4px;
    }

    .placeholder {
      color: var(--text-secondary);
      font-size: 13px;
      padding: var(--space-4);
    }

    .timestamp {
      font-size: 11px;
      color: var(--text-muted);
      margin-top: var(--space-3);
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Browser Preview</h1>
    <div class="status-badge">
      <span class="status-dot" style="background:${statusColor}"></span>
      ${statusText}
    </div>
  </div>

  <div class="actions">
    <button class="btn" id="capture-btn" type="button">Capture Screenshot</button>
    <button class="btn btn-secondary" id="refresh-btn" type="button">Refresh</button>
  </div>

  ${context.url ? `
  <div class="info-card">
    <div class="info-label">URL</div>
    <div class="info-value">${escapeHtml(context.url)}</div>
  </div>
  <div class="info-card">
    <div class="info-label">Title</div>
    <div class="info-value">${escapeHtml(context.title || 'Untitled')}</div>
  </div>
  ${context.selectedText ? `
  <div class="info-card">
    <div class="info-label">Selected Text</div>
    <div class="info-value">${escapeHtml(context.selectedText)}</div>
  </div>
  ` : ''}
  ` : `
  <div class="info-card">
    <div class="placeholder">No browser context available. Make sure the browser extension is connected.</div>
  </div>
  `}

  <div class="screenshot-container">
    ${screenshot ? `<img src="data:image/png;base64,${screenshot}" alt="Browser Screenshot" />` : '<div class="placeholder">No screenshot captured. Click "Capture Screenshot" to take one.</div>'}
  </div>

  <div class="timestamp">Last updated: ${new Date().toLocaleTimeString()}</div>

  <script>
    const vscode = acquireVsCodeApi();

    document.getElementById('capture-btn').addEventListener('click', () => {
      vscode.postMessage({ command: 'captureScreenshot' });
    });

    document.getElementById('refresh-btn').addEventListener('click', () => {
      vscode.postMessage({ command: 'refresh' });
    });
  </script>
</body>
</html>`;
  }

  public dispose(): void {
    PreviewPanel.currentPanel = undefined;
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
    logger.info('PreviewPanel disposed');
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
