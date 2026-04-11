import * as vscode from 'vscode';
import { RouterClient } from '../client/routerClient';
import { sanitizeErrorMessage } from './errors';
import { COMMAND_SETUP_MCP } from './identifiers';
import { getLogger } from './logger';

const logger = getLogger('connection-manager');

interface LegacyHealthResponse {
  kind: 'legacy_text';
  message: string;
}

interface JsonHealthResponse {
  kind: 'json';
  payload: Record<string, unknown>;
}

interface InvalidHealthResponse {
  kind: 'invalid_text';
  message: string;
}

type ParsedHealthResponse = LegacyHealthResponse | JsonHealthResponse | InvalidHealthResponse;

export function parseHealthResponseBody(body: string): ParsedHealthResponse {
  const trimmed = body.trim();

  if (trimmed.length === 0) {
    return {
      kind: 'invalid_text',
      message: 'Health endpoint returned an empty response.',
    };
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return {
        kind: 'json',
        payload: parsed as Record<string, unknown>,
      };
    }

    return {
      kind: 'invalid_text',
      message: 'Health endpoint returned JSON in an unexpected shape.',
    };
  } catch {
    if (trimmed.toLowerCase() === 'healthy' || trimmed.toLowerCase() === 'ok') {
      return {
        kind: 'legacy_text',
        message: 'Router is reachable, but the health endpoint returned legacy plain text.',
      };
    }

    return {
      kind: 'invalid_text',
      message: `Health endpoint returned non-JSON content: ${trimmed.slice(0, 80)}`,
    };
  }
}

export function humanizeConnectionError(error: string): string {
  const normalized = sanitizeErrorMessage(new Error(error));

  if (normalized.includes('Unexpected token') && normalized.includes('JSON')) {
    return 'Health endpoint returned plain text instead of JSON. Check ifinPlatform.baseUrl or update the router.';
  }

  if (normalized.includes('Failed to fetch')) {
    return 'Could not reach the local router.';
  }

  if (normalized.includes('timed out')) {
    return 'Timed out while checking the local router.';
  }

  return normalized;
}

function getStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export function deriveRouterStatusDetail(
  health: Record<string, unknown>,
  providers: Array<{ name: string; status: string }>
): string | null {
  const warnings = [
    ...getStringArray(health['warnings']),
    ...getStringArray(
      typeof health['config'] === 'object' && health['config'] !== null
        ? (health['config'] as Record<string, unknown>)['warnings']
        : undefined
    ),
    ...getStringArray(
      typeof health['discovery'] === 'object' && health['discovery'] !== null
        ? (health['discovery'] as Record<string, unknown>)['warnings']
        : undefined
    ),
  ];

  const missingProviderWarning = warnings.find((warning) => {
    const normalized = warning.toLowerCase();
    return normalized.includes('no providers configured') || normalized.includes('no providers available for discovery');
  });

  if (providers.length === 0 && missingProviderWarning) {
    return 'Router reachable, but no providers are configured in the router yet.';
  }

  return warnings[0] ?? null;
}

export type ConnectionStatus = 'connected' | 'degraded' | 'disconnected';

export interface ConnectionInfo {
  status: ConnectionStatus;
  routerVersion: string | null;
  modelCount: number;
  providers: Array<{ name: string; status: string }>;
  browserConnected: boolean;
  browserTabCount: number;
  lastCheck: number | null;
  error: string | null;
  statusDetail: string | null;
  mode: 'agent' | 'router' | null;
}

export class RouterConnectionManager implements vscode.Disposable {
  private client: RouterClient;
  private readonly statusBarItem: vscode.StatusBarItem;
  private readonly _onDidChangeStatus = new vscode.EventEmitter<ConnectionStatus>();
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private currentStatus: ConnectionStatus = 'disconnected';
  private connectionInfo: ConnectionInfo = {
    status: 'disconnected',
    routerVersion: null,
    modelCount: 0,
    providers: [],
    browserConnected: false,
    browserTabCount: 0,
    lastCheck: null,
    error: null,
    statusDetail: null,
    mode: null,
  };
  private disposables: vscode.Disposable[] = [];

  readonly onDidChangeStatus = this._onDidChangeStatus.event;

  get status(): ConnectionStatus {
    return this.currentStatus;
  }

  get info(): Readonly<ConnectionInfo> {
    return this.connectionInfo;
  }

  constructor(client: RouterClient) {
    this.client = client;

    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.statusBarItem.command = COMMAND_SETUP_MCP;
    this.disposables.push(this.statusBarItem);
    this.disposables.push(this._onDidChangeStatus);

    this.startHeartbeat();
  }

  updateClient(client: RouterClient): void {
    this.client = client;
  }

  private isMissingProviderState(info: ConnectionInfo = this.connectionInfo): boolean {
    return (
      info.providers.length === 0 &&
      typeof info.statusDetail === 'string' &&
      info.statusDetail.toLowerCase().includes('no providers are configured')
    );
  }

  private startHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    this.performHealthCheck().catch(() => {
      // Silently fail on initial check; status bar will show disconnected.
    });

    this.heartbeatInterval = setInterval(() => {
      this.performHealthCheck().catch((error) => {
        logger.warn('Heartbeat health check failed', error);
      });
    }, 15_000);

    logger.info('Heartbeat started (15s interval)');
  }

  private async performHealthCheck(): Promise<void> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.client.timeoutMs);

    try {
      const response = await fetch(`${this.getBaseUrl()}/health`, {
        headers: {
          Accept: 'application/json',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        this.updateStatus('disconnected', {
          error: humanizeConnectionError(`Router returned ${response.status}`),
          statusDetail: null,
        });
        return;
      }

      const rawBody = await response.text();
      const parsedHealth = parseHealthResponseBody(rawBody);
      const versionHeader = response.headers.get('x-ifinplatform-router-version');

      if (parsedHealth.kind === 'legacy_text' || parsedHealth.kind === 'invalid_text') {
        const mode = vscode.workspace.getConfiguration('ifinPlatform').get<string>('mode', 'agent') as 'agent' | 'router';
        this.updateStatus('degraded', {
          routerVersion: versionHeader,
          modelCount: 0,
          providers: [],
          browserConnected: false,
          browserTabCount: 0,
          lastCheck: Date.now(),
          error: parsedHealth.message,
          statusDetail: parsedHealth.message,
          mode,
        });
        return;
      }

      const health = parsedHealth.payload;
      const version = (health.version as string) ?? versionHeader ?? this.client.discoveredVersion;
      const apiVersion = (health.apiVersion as number) ?? 1;
      const providers = (health.providers as Array<{ name: string; status: string }>) ?? [];
      const statusDetail = deriveRouterStatusDetail(health, providers);
      const browserBridge = (health.browserBridge as { connected: boolean; tabCount: number }) ?? {
        connected: false,
        tabCount: 0,
      };

      const allHealthy = providers.every((provider) => provider.status === 'healthy' || provider.status === 'degraded');
      const anyHealthy = providers.some((provider) => provider.status === 'healthy' || provider.status === 'degraded');

      const newStatus: ConnectionStatus = anyHealthy ? (allHealthy ? 'connected' : 'degraded') : 'degraded';

      // Approximate count; the detailed catalog comes from the router catalog endpoint.
      const modelCount =
        providers.filter((provider) => provider.status === 'healthy' || provider.status === 'degraded').length * 3;

      const mode = vscode.workspace.getConfiguration('ifinPlatform').get<string>('mode', 'agent') as 'agent' | 'router';

      this.updateStatus(newStatus, {
        routerVersion: version,
        modelCount,
        providers,
        browserConnected: browserBridge.connected,
        browserTabCount: browserBridge.tabCount,
        lastCheck: Date.now(),
        error: null,
        statusDetail,
        mode,
      });

      if (apiVersion < 2) {
        logger.warn(`Router API version ${apiVersion} may be incompatible (expected >= 2)`);
      }
    } catch (error) {
      const mode = vscode.workspace.getConfiguration('ifinPlatform').get<string>('mode', 'agent') as 'agent' | 'router';
      this.updateStatus('disconnected', {
        error: humanizeConnectionError(error instanceof Error ? error.message : 'Unknown error'),
        statusDetail: null,
        mode,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private updateStatus(status: ConnectionStatus, partial: Partial<ConnectionInfo>): void {
    const oldStatus = this.currentStatus;
    this.currentStatus = status;
    this.connectionInfo = { ...this.connectionInfo, ...partial, status };

    if (oldStatus !== status) {
      logger.info(`Connection status changed: ${oldStatus} -> ${status}`);
      this._onDidChangeStatus.fire(status);
    }

    this.updateStatusBar(status);
  }

  private updateStatusBar(status: ConnectionStatus): void {
    const info = this.connectionInfo;

    if (info.mode === 'agent') {
      this.statusBarItem.text = '$(circle-large-outline) ifin Platform: Agent Mode';
      this.statusBarItem.tooltip = [
        'ifin Platform is in Agent mode',
        '',
        'Provider and router warnings are suppressed while the IDE-native path is active.',
        info.lastCheck ? `Last router check: ${Math.round((Date.now() - info.lastCheck) / 1000)}s ago` : 'Last router check: unavailable',
        '',
        'Click to configure',
      ].join('\n');
      this.statusBarItem.backgroundColor = undefined;
      this.statusBarItem.show();
      return;
    }

    switch (status) {
      case 'connected':
        this.statusBarItem.text = `$(check) ifin Platform: ${info.modelCount} models`;
        this.statusBarItem.tooltip = this.buildTooltip(status);
        this.statusBarItem.backgroundColor = undefined;
        this.statusBarItem.show();
        break;

      case 'degraded': {
        if (this.isMissingProviderState(info)) {
          this.statusBarItem.text = '$(warning) ifin Platform: No Providers';
          this.statusBarItem.tooltip = [
            'ifin Platform is reachable',
            '',
            info.statusDetail,
            '',
            'Click to configure',
          ].join('\n');
        } else {
          const degradedProviders =
            info.providers.filter((provider) => provider.status !== 'healthy').map((provider) => provider.name).join(', ') ||
            'unknown';
          this.statusBarItem.text = '$(warning) ifin Platform: Degraded';
          this.statusBarItem.tooltip = [
            this.buildTooltip(status),
            '',
            `Degraded providers: ${degradedProviders}`,
            '',
            'Click to see details',
          ].join('\n');
        }

        this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        this.statusBarItem.show();
        break;
      }

      case 'disconnected':
      default:
        this.statusBarItem.text = '$(error) ifin Platform: Disconnected';
        this.statusBarItem.tooltip = [
          'ifin Platform is unreachable',
          '',
          `Error: ${info.error ?? 'Unknown error'}`,
          '',
          'Click to configure',
        ].join('\n');
        this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        this.statusBarItem.show();
        break;
    }
  }

  private buildTooltip(status: ConnectionStatus): string {
    const info = this.connectionInfo;
    const lines = [
      `ifin Platform - ${status}`,
      '',
      `Router: ${info.routerVersion ?? 'unknown'}`,
      `Models: ${info.modelCount}`,
      `Providers: ${info.providers.map((provider) => `${provider.name} (${provider.status})`).join(', ') || 'none'}`,
    ];

    if (info.browserConnected) {
      lines.push(`Browser: ${info.browserTabCount} tab(s) connected`);
    } else {
      lines.push('Browser: not connected');
    }

    if (info.lastCheck) {
      const ago = Math.round((Date.now() - info.lastCheck) / 1000);
      lines.push(`Last check: ${ago}s ago`);
    }

    if (info.statusDetail) {
      lines.push(`Status: ${info.statusDetail}`);
    }

    return lines.join('\n');
  }

  private getBaseUrl(): string {
    return this.client.baseUrl;
  }

  async refresh(): Promise<void> {
    await this.performHealthCheck();
  }

  dispose(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    for (const disposable of this.disposables) {
      disposable.dispose();
    }

    logger.info('RouterConnectionManager disposed');
  }
}
