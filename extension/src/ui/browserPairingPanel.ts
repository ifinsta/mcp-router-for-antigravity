import * as vscode from 'vscode';
import { getLogger } from '../infra/logger';

const logger = getLogger('browser-pairing-panel');

interface BrowserStatus {
  connected: boolean;
  tabCount: number;
  bridgeRunning: boolean;
  port: number;
}

interface PairingState {
  platform: string;
  extensionPath: string;
  verificationStatus: 'idle' | 'checking' | 'connected' | 'failed';
  statusDetails: BrowserStatus | null;
  errorMessage: string | null;
}

/**
 * Webview panel for guided browser extension pairing.
 * Provides step-by-step instructions for installing and connecting the Chrome extension.
 */
export class BrowserPairingPanel {
  private static currentPanel: BrowserPairingPanel | undefined;
  private static readonly viewType = 'ifinPlatform.browserPairing';

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private disposables: vscode.Disposable[] = [];
  private state: PairingState;

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.state = this.getInitialState();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (message) => this.handleMessage(message),
      null,
      this.disposables,
    );

    // Initial render
    this.refresh();
  }

  private getInitialState(): PairingState {
    const platform = this.detectPlatform();
    const workspaceFolders = vscode.workspace.workspaceFolders;
    let extensionPath = '';
    
    const workspaceFolder = workspaceFolders?.[0];
    if (workspaceFolder) {
      extensionPath = vscode.Uri.joinPath(workspaceFolder.uri, 'chrome-extension').fsPath;
    }

    return {
      platform,
      extensionPath,
      verificationStatus: 'idle',
      statusDetails: null,
      errorMessage: null,
    };
  }

  private detectPlatform(): string {
    const platform = process.platform;
    switch (platform) {
      case 'win32':
        return 'Windows';
      case 'darwin':
        return 'Mac';
      case 'linux':
        return 'Linux';
      default:
        return 'Unknown';
    }
  }

  /**
   * Show the browser pairing panel.
   * @param context Extension context for URI resolution
   */
  public static show(
    context: vscode.ExtensionContext,
  ): void {
    if (BrowserPairingPanel.currentPanel) {
      BrowserPairingPanel.currentPanel.panel.reveal(vscode.ViewColumn.Two);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      BrowserPairingPanel.viewType,
      'Browser Extension Setup',
      vscode.ViewColumn.Two,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
      },
    );

    BrowserPairingPanel.currentPanel = new BrowserPairingPanel(panel, context.extensionUri);
  }

  private async handleMessage(message: { command?: string }): Promise<void> {
    switch (message.command) {
      case 'copyPath':
        await this.copyExtensionPath();
        break;
      case 'verifyConnection':
        await this.verifyConnection();
        break;
      case 'openExtensionFolder':
        await this.openExtensionFolder();
        break;
      case 'refresh':
        this.refresh();
        break;
    }
  }

  private async copyExtensionPath(): Promise<void> {
    if (this.state.extensionPath) {
      await vscode.env.clipboard.writeText(this.state.extensionPath);
      vscode.window.showInformationMessage('Extension path copied to clipboard');
    } else {
      vscode.window.showWarningMessage('Extension path not available. Make sure you have a workspace open.');
    }
  }

  private async openExtensionFolder(): Promise<void> {
    if (this.state.extensionPath) {
      const uri = vscode.Uri.file(this.state.extensionPath);
      await vscode.commands.executeCommand('revealFileInOS', uri);
    } else {
      vscode.window.showWarningMessage('Extension folder not available. Make sure you have a workspace open.');
    }
  }

  private async verifyConnection(): Promise<void> {
    this.state.verificationStatus = 'checking';
    this.state.errorMessage = null;
    this.refresh();

    try {
      const baseUrl = vscode.workspace
        .getConfiguration('ifinPlatform')
        .get<string>('baseUrl', 'http://localhost:3000');

      const response = await fetch(`${baseUrl}/api/browser/status`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }

      const data = await response.json() as BrowserStatus;
      this.state.statusDetails = data;
      this.state.verificationStatus = data.connected ? 'connected' : 'failed';
      
      if (!data.connected) {
        this.state.errorMessage = 'Browser extension is not connected. Please follow the setup steps below.';
      }
    } catch (error) {
      this.state.verificationStatus = 'failed';
      this.state.statusDetails = null;
      this.state.errorMessage = error instanceof Error 
        ? `Connection failed: ${error.message}`
        : 'Unable to connect to the browser bridge. Make sure the MCP server is running.';
    }

    this.refresh();
  }

  private refresh(): void {
    this.panel.webview.html = this.getHtml();
  }

  private getPlatformInstructions(): string {
    switch (this.state.platform) {
      case 'Windows':
        return `
          <div class="platform-note">
            <strong>Windows Users:</strong> The extension folder is located at:
            <code>${this.escapeHtml(this.state.extensionPath || 'Not available - open a workspace first')}</code>
          </div>
        `;
      case 'Mac':
        return `
          <div class="platform-note">
            <strong>Mac Users:</strong> The extension folder is located at:
            <code>${this.escapeHtml(this.state.extensionPath || 'Not available - open a workspace first')}</code>
          </div>
        `;
      case 'Linux':
        return `
          <div class="platform-note">
            <strong>Linux Users:</strong> The extension folder is located at:
            <code>${this.escapeHtml(this.state.extensionPath || 'Not available - open a workspace first')}</code>
          </div>
        `;
      default:
        return '';
    }
  }

  private getVerificationButton(): string {
    const { verificationStatus } = this.state;
    
    let buttonClass = 'btn-primary';
    let buttonText = 'Verify Connection';
    let disabled = '';

    if (verificationStatus === 'checking') {
      buttonClass = 'btn-secondary';
      buttonText = 'Checking...';
      disabled = 'disabled';
    } else if (verificationStatus === 'connected') {
      buttonClass = 'btn-success';
      buttonText = 'Connected ✓';
    }

    return `<button class="action-button ${buttonClass}" id="verify-btn" type="button" ${disabled}>${buttonText}</button>`;
  }

  private getStatusIndicator(): string {
    const { verificationStatus } = this.state;
    
    if (verificationStatus === 'idle') {
      return '';
    }

    if (verificationStatus === 'checking') {
      return `
        <div class="status-message checking">
          <span class="status-spinner"></span>
          Checking connection to browser extension...
        </div>
      `;
    }

    if (verificationStatus === 'connected') {
      const tabCount = this.state.statusDetails?.tabCount || 0;
      return `
        <div class="status-message success">
          <span class="status-icon">✓</span>
          <div>
            <strong>Connected!</strong> Browser extension is active with ${tabCount} tab${tabCount !== 1 ? 's' : ''}.
          </div>
        </div>
      `;
    }

    // Failed state
    return `
      <div class="status-message error">
        <span class="status-icon">✗</span>
        <div>
          <strong>Connection Failed</strong>
          ${this.state.errorMessage ? `<p>${this.escapeHtml(this.state.errorMessage)}</p>` : ''}
        </div>
      </div>
    `;
  }

  private getTroubleshootingSection(): string {
    if (this.state.verificationStatus !== 'failed') {
      return '';
    }

    return `
      <div class="step troubleshooting">
        <div class="step-header">
          <div class="step-number">!</div>
          <div class="step-title">Troubleshooting</div>
        </div>
        <div class="step-content">
          <p>If the connection fails, try these steps:</p>
          <ul class="troubleshoot-list">
            <li><strong>Restart Chrome</strong> - Close all Chrome windows and reopen</li>
            <li><strong>Reinstall Extension</strong> - Remove and reload the unpacked extension</li>
            <li><strong>Check Port 9315</strong> - Ensure port 9315 is not blocked by firewall</li>
            <li><strong>Check WebSocket Bridge</strong> - Verify the bridge is running in the extension</li>
            <li><strong>Check MCP Server</strong> - Make sure the MCP server is running on port 3000</li>
          </ul>
          <div class="troubleshoot-actions">
            <button class="action-button btn-secondary" id="open-folder-btn" type="button">Open Extension Folder</button>
            <button class="action-button btn-secondary" id="refresh-btn" type="button">Refresh Status</button>
          </div>
        </div>
      </div>
    `;
  }

  private getHtml(): string {
    const webview = this.panel.webview;
    const variablesCssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'variables.css'),
    );

    const platformInstructions = this.getPlatformInstructions();
    const verificationButton = this.getVerificationButton();
    const statusIndicator = this.getStatusIndicator();
    const troubleshootingSection = this.getTroubleshootingSection();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'unsafe-inline';">
  <title>Browser Extension Setup</title>
  <link rel="stylesheet" href="${variablesCssUri}">
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      background-color: var(--vscode-editor-background);
      color: var(--vscode-foreground);
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
      min-height: 100vh;
      padding: var(--space-6, 24px);
      line-height: 1.6;
    }

    .header {
      margin-bottom: var(--space-6, 24px);
      padding-bottom: var(--space-4, 16px);
      border-bottom: 1px solid var(--vscode-panel-border);
    }

    .header h1 {
      font-size: 22px;
      font-weight: 600;
      margin-bottom: var(--space-2, 8px);
    }

    .header p {
      font-size: 14px;
      color: var(--vscode-descriptionForeground);
    }

    .steps-container {
      display: flex;
      flex-direction: column;
      gap: var(--space-5, 20px);
      max-width: 700px;
    }

    .step {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: var(--radius-md, 8px);
      overflow: hidden;
    }

    .step-header {
      display: flex;
      align-items: center;
      gap: var(--space-3, 12px);
      padding: var(--space-4, 16px);
      background: var(--vscode-sideBar-background);
      border-bottom: 1px solid var(--vscode-panel-border);
    }

    .step-number {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: var(--accent);
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 600;
      font-size: 14px;
      flex-shrink: 0;
    }

    .step-title {
      font-size: 15px;
      font-weight: 600;
    }

    .step-content {
      padding: var(--space-4, 16px);
    }

    .step-content p {
      margin-bottom: var(--space-3, 12px);
      font-size: 14px;
      line-height: 1.6;
    }

    .step-content p:last-child {
      margin-bottom: 0;
    }

    .platform-note {
      background: var(--vscode-textBlockQuote-background);
      border-left: 3px solid var(--accent);
      padding: var(--space-3, 12px);
      margin: var(--space-3, 12px) 0;
      border-radius: 0 var(--radius-sm, 4px) var(--radius-sm, 4px) 0;
    }

    .platform-note code {
      display: block;
      margin-top: var(--space-2, 8px);
      padding: var(--space-2, 8px);
      background: var(--vscode-textCodeBlock-background);
      border-radius: var(--radius-sm, 4px);
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 12px;
      word-break: break-all;
    }

    .instruction-list {
      list-style: none;
      counter-reset: instruction;
    }

    .instruction-list li {
      position: relative;
      padding-left: 28px;
      margin-bottom: var(--space-3, 12px);
      font-size: 14px;
    }

    .instruction-list li::before {
      counter-increment: instruction;
      content: counter(instruction);
      position: absolute;
      left: 0;
      top: 0;
      width: 20px;
      height: 20px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      font-weight: 600;
    }

    .action-button {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2, 8px);
      padding: var(--space-2, 8px) var(--space-4, 16px);
      border: 1px solid var(--vscode-button-border);
      border-radius: var(--radius-sm, 4px);
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .action-button:hover:not(:disabled) {
      background: var(--vscode-button-hoverBackground);
    }

    .action-button:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    .btn-primary {
      background: var(--accent);
      border-color: var(--accent);
      color: white;
    }

    .btn-primary:hover:not(:disabled) {
      background: var(--accent-strong);
    }

    .btn-secondary {
      background: var(--vscode-button-secondaryBackground);
      border-color: var(--vscode-button-secondaryBorder);
      color: var(--vscode-button-secondaryForeground);
    }

    .btn-secondary:hover:not(:disabled) {
      background: var(--vscode-button-secondaryHoverBackground);
    }

    .btn-success {
      background: var(--success);
      border-color: var(--success);
      color: white;
    }

    .status-message {
      display: flex;
      align-items: flex-start;
      gap: var(--space-3, 12px);
      padding: var(--space-4, 16px);
      border-radius: var(--radius-sm, 4px);
      margin-top: var(--space-3, 12px);
      font-size: 14px;
    }

    .status-message.checking {
      background: var(--vscode-textBlockQuote-background);
      border-left: 3px solid var(--vscode-textLink-foreground);
    }

    .status-message.success {
      background: rgba(47, 157, 115, 0.1);
      border-left: 3px solid var(--success);
      color: var(--success);
    }

    .status-message.error {
      background: rgba(200, 93, 74, 0.1);
      border-left: 3px solid var(--danger);
      color: var(--danger);
    }

    .status-spinner {
      width: 16px;
      height: 16px;
      border: 2px solid var(--vscode-textLink-foreground);
      border-top-color: transparent;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      flex-shrink: 0;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .status-icon {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      flex-shrink: 0;
    }

    .status-message.success .status-icon {
      background: var(--success);
      color: white;
    }

    .status-message.error .status-icon {
      background: var(--danger);
      color: white;
    }

    .troubleshoot-list {
      list-style: none;
      margin: var(--space-3, 12px) 0;
    }

    .troubleshoot-list li {
      position: relative;
      padding-left: 20px;
      margin-bottom: var(--space-2, 8px);
      font-size: 14px;
    }

    .troubleshoot-list li::before {
      content: '•';
      position: absolute;
      left: 0;
      color: var(--vscode-textLink-foreground);
      font-weight: bold;
    }

    .troubleshoot-actions {
      display: flex;
      gap: var(--space-2, 8px);
      margin-top: var(--space-3, 12px);
    }

    .step.troubleshooting {
      border-color: var(--vscode-textLink-foreground);
    }

    .step.troubleshooting .step-header {
      background: var(--vscode-textLink-activeForeground);
      color: white;
    }

    .step.troubleshooting .step-number {
      background: white;
      color: var(--vscode-textLink-activeForeground);
    }

    code {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 12px;
      padding: 2px 6px;
      background: var(--vscode-textCodeBlock-background);
      border-radius: 3px;
    }

    .button-group {
      display: flex;
      gap: var(--space-2, 8px);
      margin-top: var(--space-3, 12px);
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Browser Extension Setup</h1>
    <p>Follow these steps to install and connect the ifin browser extension</p>
  </div>

  <div class="steps-container">
    <!-- Step 1: Platform Detection -->
    <div class="step">
      <div class="step-header">
        <div class="step-number">1</div>
        <div class="step-title">Platform Detected: ${this.escapeHtml(this.state.platform)}</div>
      </div>
      <div class="step-content">
        ${platformInstructions}
      </div>
    </div>

    <!-- Step 2: Extension Location -->
    <div class="step">
      <div class="step-header">
        <div class="step-number">2</div>
        <div class="step-title">Locate Extension Files</div>
      </div>
      <div class="step-content">
        <p>The browser extension is located in the <code>chrome-extension/</code> directory of your workspace.</p>
        <div class="platform-note">
          <strong>Extension Path:</strong>
          <code>${this.escapeHtml(this.state.extensionPath || 'Not available - open a workspace first')}</code>
        </div>
        <div class="button-group">
          <button class="action-button btn-secondary" id="copy-path-btn" type="button">
            Copy Path
          </button>
          <button class="action-button btn-secondary" id="open-folder-btn-2" type="button">
            Open Folder
          </button>
        </div>
      </div>
    </div>

    <!-- Step 3: Load Extension -->
    <div class="step">
      <div class="step-header">
        <div class="step-number">3</div>
        <div class="step-title">Load Extension in Chrome</div>
      </div>
      <div class="step-content">
        <ol class="instruction-list">
          <li>Open Chrome or Edge and navigate to <code>chrome://extensions</code></li>
          <li>Enable <strong>Developer mode</strong> (toggle in top-right corner)</li>
          <li>Click <strong>Load unpacked</strong> button</li>
          <li>Select the <code>chrome-extension</code> folder from your workspace</li>
          <li>The ifin extension should now appear in your extensions list</li>
        </ol>
      </div>
    </div>

    <!-- Step 4: Verify Connection -->
    <div class="step">
      <div class="step-header">
        <div class="step-number">4</div>
        <div class="step-title">Verify Connection</div>
      </div>
      <div class="step-content">
        <p>Click the button below to verify the browser extension is connected to the MCP router.</p>
        <div class="button-group">
          ${verificationButton}
        </div>
        ${statusIndicator}
      </div>
    </div>

    ${troubleshootingSection}
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    document.getElementById('copy-path-btn')?.addEventListener('click', () => {
      vscode.postMessage({ command: 'copyPath' });
    });

    document.getElementById('open-folder-btn')?.addEventListener('click', () => {
      vscode.postMessage({ command: 'openExtensionFolder' });
    });

    document.getElementById('open-folder-btn-2')?.addEventListener('click', () => {
      vscode.postMessage({ command: 'openExtensionFolder' });
    });

    document.getElementById('verify-btn')?.addEventListener('click', () => {
      vscode.postMessage({ command: 'verifyConnection' });
    });

    document.getElementById('refresh-btn')?.addEventListener('click', () => {
      vscode.postMessage({ command: 'refresh' });
    });
  </script>
</body>
</html>`;
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
    BrowserPairingPanel.currentPanel = undefined;
    this.panel.dispose();
    while (this.disposables.length > 0) {
      const disposable = this.disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
    logger.info('BrowserPairingPanel disposed');
  }
}
