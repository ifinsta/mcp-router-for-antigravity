import * as vscode from 'vscode';
import { getLogger } from '../infra/logger';

const logger = getLogger('mode-selection-panel');

/**
 * Webview panel for first-run mode selection.
 * Shows two options: Agent Mode (use IDE's AI) and Router Mode (use ifin-managed models).
 */
export class ModeSelectionPanel {
  private static currentPanel: ModeSelectionPanel | undefined;
  private static readonly viewType = 'ifinPlatform.modeSelection';

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly context: vscode.ExtensionContext;
  private onComplete: (() => void) | undefined;
  private disposables: vscode.Disposable[] = [];
  
  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    context: vscode.ExtensionContext,
    onComplete?: () => void,
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.context = context;
    if (onComplete) {
      this.onComplete = onComplete;
    }

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (message) => this.handleMessage(message),
      null,
      this.disposables,
    );
  }

  /**
   * Show the mode selection panel.
   * @param context Extension context for globalState access
   * @param onComplete Optional callback after mode selection completes
   */
  public static show(
    context: vscode.ExtensionContext,
    onComplete?: () => void,
  ): void {
    if (ModeSelectionPanel.currentPanel) {
      ModeSelectionPanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      ModeSelectionPanel.viewType,
      'ifin Platform - Choose Your Mode',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: false,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
      },
    );

    ModeSelectionPanel.currentPanel = new ModeSelectionPanel(panel, context.extensionUri, context, onComplete);
    panel.webview.html = ModeSelectionPanel.getHtml(panel.webview, context.extensionUri);
  }

  private async handleMessage(message: { command?: string; mode?: string }): Promise<void> {
    if (message.command !== 'selectMode' || !message.mode) {
      return;
    }

    const mode = message.mode as 'agent' | 'router';

    try {
      // Update VS Code setting
      await vscode.workspace
        .getConfiguration('ifinPlatform')
        .update('mode', mode, vscode.ConfigurationTarget.Global);

      // Mark as selected in globalState
      await this.context.globalState.update('ifinPlatform.modeSelected', true);

      // Try to sync to router (non-blocking, ignore errors)
      this.syncModeToRouter(mode).catch(() => {
        // Ignore - router may not be running yet
      });

      logger.info(`Mode selected: ${mode}`);

      // Close panel and trigger completion callback
      this.panel.dispose();
      this.onComplete?.();
    } catch (error) {
      logger.error('Failed to save mode selection', error);
      vscode.window.showErrorMessage('Failed to save mode selection. Please try again.');
    }
  }

  private async syncModeToRouter(mode: string): Promise<void> {
    const baseUrl = vscode.workspace
      .getConfiguration('ifinPlatform')
      .get<string>('baseUrl', 'http://localhost:3000');

    const response = await fetch(`${baseUrl}/api/mode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    });

    if (!response.ok) {
      throw new Error(`Router returned ${response.status}`);
    }
  }

  private static getHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    const variablesCssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'media', 'variables.css'),
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'unsafe-inline';">
  <title>ifin Platform - Choose Your Mode</title>
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
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: var(--space-6);
    }

    .container {
      max-width: 800px;
      width: 100%;
    }

    .header {
      text-align: center;
      margin-bottom: var(--space-8);
    }

    .header h1 {
      font-size: 28px;
      font-weight: 600;
      margin-bottom: var(--space-3);
      color: var(--text-primary);
    }

    .header p {
      font-size: 15px;
      color: var(--text-secondary);
      max-width: 500px;
      margin: 0 auto;
      line-height: 1.5;
    }

    .cards {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: var(--space-5);
    }

    @media (max-width: 640px) {
      .cards {
        grid-template-columns: 1fr;
      }
    }

    .card {
      background: var(--shell-panel);
      border: 1px solid var(--shell-border);
      border-radius: var(--radius-lg);
      padding: var(--space-6);
      display: flex;
      flex-direction: column;
      transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
      cursor: pointer;
    }

    .card:hover {
      border-color: var(--shell-border-strong);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }

    .card-icon {
      font-size: 32px;
      margin-bottom: var(--space-4);
    }

    .card-title {
      font-size: 18px;
      font-weight: 600;
      color: var(--text-primary);
      margin-bottom: var(--space-2);
    }

    .card-description {
      font-size: 13px;
      color: var(--text-secondary);
      line-height: 1.6;
      flex-grow: 1;
      margin-bottom: var(--space-5);
    }

    .card-button {
      background: var(--accent);
      color: var(--text-on-accent);
      border: none;
      border-radius: var(--radius-md);
      padding: var(--space-3) var(--space-4);
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: background-color var(--transition-fast);
      width: 100%;
    }

    .card-button:hover {
      background: var(--accent-hover);
    }

    .card-button:focus {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }

    .footer {
      margin-top: var(--space-6);
      text-align: center;
      font-size: 12px;
      color: var(--text-muted);
    }

    .footer a {
      color: var(--accent);
      text-decoration: none;
    }

    .footer a:hover {
      text-decoration: underline;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Welcome to ifin Platform</h1>
      <p>Choose how you'd like to use AI in your IDE. You can change this later in settings.</p>
    </div>

    <div class="cards">
      <div class="card" id="card-agent">
        <div class="card-icon">IDE</div>
        <div class="card-title">Use my IDE's AI</div>
        <div class="card-description">
          Your IDE's built-in AI handles conversations. ifin provides browser automation, MCP tools, and multi-provider access as background capabilities.
        </div>
        <button class="card-button" type="button" id="select-agent">Select Agent Mode</button>
      </div>

      <div class="card" id="card-router">
        <div class="card-icon">ifin</div>
        <div class="card-title">Use ifin-managed models</div>
        <div class="card-description">
          ifin manages your AI model connections directly. Get access to multiple providers (OpenAI, Anthropic, GLM, and more) with intelligent routing and fallback.
        </div>
        <button class="card-button" type="button" id="select-router">Select Router Mode</button>
      </div>
    </div>

    <div class="footer">
      You can change this anytime in VS Code settings under ifinPlatform.mode
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    function selectMode(mode) {
      vscode.postMessage({
        command: 'selectMode',
        mode: mode
      });
    }

    document.getElementById('select-agent').addEventListener('click', () => selectMode('agent'));
    document.getElementById('select-router').addEventListener('click', () => selectMode('router'));

    // Allow clicking the entire card
    document.getElementById('card-agent').addEventListener('click', (e) => {
      if (e.target.tagName !== 'BUTTON') {
        selectMode('agent');
      }
    });
    document.getElementById('card-router').addEventListener('click', (e) => {
      if (e.target.tagName !== 'BUTTON') {
        selectMode('router');
      }
    });
  </script>
</body>
</html>`;
  }

  public dispose(): void {
    ModeSelectionPanel.currentPanel = undefined;
    this.panel.dispose();
    while (this.disposables.length > 0) {
      const disposable = this.disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }
}
