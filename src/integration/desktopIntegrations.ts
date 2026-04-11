import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export type IntegrationKind = 'mcp-client' | 'ide-extension' | 'browser-extension' | 'runtime';

export type IntegrationStatus =
  | 'not_configured'
  | 'available'
  | 'configured'
  | 'invalid_config'
  | 'ready'
  | 'connected'
  | 'degraded'
  | 'error';

export type LauncherMode = 'auto' | 'installed' | 'repo';
export type ResolvedLauncherMode = Exclude<LauncherMode, 'auto'>;
export type RuntimePlaneId = 'mcpLauncher' | 'localApi' | 'browserBridge';

export interface IntegrationRecord {
  id: string;
  kind: IntegrationKind;
  label: string;
  status: IntegrationStatus;
  path: string | null;
  summary: string;
  detail: string;
  remediation: string;
  launcherMode?: LauncherMode | undefined;
  metadata: Record<string, string | boolean | null>;
}

export interface IntegrationPreview {
  targetId: string;
  targetLabel: string;
  configPath: string | null;
  launcherMode: LauncherMode;
  resolvedMode: ResolvedLauncherMode | null;
  command: string | null;
  args: string[];
  env: Record<string, string>;
  configJson: string;
  requiresReplace: boolean;
  writable: boolean;
  reason?: string | undefined;
}

export interface IntegrationTestResult {
  targetId: string;
  success: boolean;
  status: IntegrationStatus;
  message: string;
  detail?: string | undefined;
}

export interface BrowserPathMap {
  chrome: string | null;
  edge: string | null;
  firefox: string | null;
  safari: string | null;
}

export interface BrowserSettingsRecord {
  enabled: boolean;
  path: string | null;
}

export interface RuntimePlaneStatus {
  id: RuntimePlaneId;
  label: string;
  status: IntegrationStatus;
  summary: string;
  detail: string;
  remediation: string;
  path: string | null;
  port: number | null;
  metadata: Record<string, string | boolean | null>;
}

export interface ChecklistItem {
  id: string;
  label: string;
  status: IntegrationStatus;
  summary: string;
  remediation: string;
}

export interface SystemReadiness {
  status: IntegrationStatus;
  launcherMode: LauncherMode;
  resolvedLauncherMode: ResolvedLauncherMode | null;
  summary: string;
  warnings: string[];
  planes: RuntimePlaneStatus[];
  integrations: IntegrationRecord[];
  checklist: ChecklistItem[];
}

export interface RuntimeProbeStatus {
  status: IntegrationStatus;
  detail?: string | undefined;
}

export interface ReadinessProbeSnapshot {
  localApi?: RuntimeProbeStatus | undefined;
  browserBridge?: RuntimeProbeStatus | undefined;
}

export interface IntegrationContext {
  platform: NodeJS.Platform;
  homedir: string;
  appDataDir: string;
  localAppDataDir: string;
  repoRoot: string | null;
  installedExecutablePath: string | null;
  localApiPort: number;
  bridgePort: number;
  env: NodeJS.ProcessEnv;
}

export interface McpClientDefinition {
  id: string;
  label: string;
  configPath: string;
  appPath: string | null;
}

interface LauncherResolution {
  requestedMode: LauncherMode;
  resolvedMode: ResolvedLauncherMode | null;
  available: boolean;
  command: string | null;
  args: string[];
  env: Record<string, string>;
  displayPath: string | null;
  reason?: string | undefined;
}

interface JsonReadResult {
  exists: boolean;
  valid: boolean;
  value: Record<string, unknown> | null;
  error?: string | undefined;
}

export const ROUTER_SERVER_NAME = 'mcp-router';
const DEFAULT_LOCAL_API_PORT = 3000;
const BRIDGE_PORT = 9315;
const KNOWN_PACKAGE_NAMES = new Set(['ifin-platform', 'mcp-router-for-antigravity', 'mcp-router']);
const CONFIG_ENV_KEYS = [
  'ROUTER_DEFAULT_PROVIDER',
  'ROUTER_DEFAULT_MODEL',
  'ROUTER_TIMEOUT_MS',
  'ROUTER_LOG_LEVEL',
  'TOTAL_REQUEST_BUDGET_MS',
  'GLOBAL_CONCURRENCY_LIMIT',
  'ALLOWED_PROVIDERS',
  'ALLOWED_MODELS',
  'MAX_INPUT_CHARS',
  'MAX_OUTPUT_TOKENS',
  'MAX_COST_USD_PER_REQUEST',
  'MAX_ATTEMPTS_PER_REQUEST',
  'RETRY_BASE_DELAY_MS',
  'RETRY_MAX_DELAY_MS',
  'RETRY_BACKOFF_MULTIPLIER',
  'RETRY_JITTER_FACTOR',
  'CIRCUIT_BREAKER_FAILURE_THRESHOLD',
  'CIRCUIT_BREAKER_COOLDOWN_MS',
  'CIRCUIT_BREAKER_HALF_OPEN_COUNT',
  'CIRCUIT_BREAKER_FAILURE_WINDOW_MS',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'GLM_API_KEY',
  'GLM_BASE_URL',
  'OLLAMA_BASE_URL',
  'CHUTES_API_KEY',
  'CHUTES_BASE_URL',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_BASE_URL',
  'AZURE_OPENAI_API_KEY',
  'AZURE_OPENAI_RESOURCE',
  'AZURE_OPENAI_DEPLOYMENT',
  'AZURE_OPENAI_API_VERSION',
  'AZURE_OPENAI_BASE_URL',
];

export function createIntegrationContext(overrides: Partial<IntegrationContext> = {}): IntegrationContext {
  const homedir = overrides.homedir ?? os.homedir();
  return {
    platform: overrides.platform ?? process.platform,
    homedir,
    appDataDir:
      overrides.appDataDir ??
      process.env['APPDATA'] ??
      path.join(homedir, 'AppData', 'Roaming'),
    localAppDataDir:
      overrides.localAppDataDir ??
      process.env['LOCALAPPDATA'] ??
      path.join(homedir, 'AppData', 'Local'),
    repoRoot: overrides.repoRoot ?? null,
    installedExecutablePath: overrides.installedExecutablePath ?? null,
    localApiPort: overrides.localApiPort ?? DEFAULT_LOCAL_API_PORT,
    bridgePort: overrides.bridgePort ?? BRIDGE_PORT,
    env: overrides.env ?? process.env,
  };
}

export function detectRepoRoot(startDir: string): string | null {
  let currentDir = path.resolve(startDir);

  while (true) {
    const packageJsonPath = path.join(currentDir, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as { name?: string };
        if (packageJson.name && KNOWN_PACKAGE_NAMES.has(packageJson.name)) {
          return currentDir;
        }
      } catch {
        // Ignore malformed package manifests while traversing.
      }
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }
    currentDir = parentDir;
  }
}

export function getConfiguredEnv(context: IntegrationContext): Record<string, string> {
  const envFromFile = context.repoRoot ? parseDotEnvFile(path.join(context.repoRoot, '.env')) : {};
  const merged: Record<string, string> = {};

  for (const key of CONFIG_ENV_KEYS) {
    const fromProcess = context.env[key];
    if (typeof fromProcess === 'string' && fromProcess.trim().length > 0) {
      merged[key] = fromProcess.trim();
      continue;
    }

    const fromFile = envFromFile[key];
    if (typeof fromFile === 'string' && fromFile.trim().length > 0) {
      merged[key] = fromFile.trim();
    }
  }

  return merged;
}

export function getMcpClientDefinitions(context: IntegrationContext): McpClientDefinition[] {
  if (context.platform === 'win32') {
    return [
      {
        id: 'antigravity',
        label: 'Antigravity',
        configPath: path.join(context.appDataDir, 'antigravity', 'mcp_servers.json'),
        appPath: path.join(context.localAppDataDir, 'Programs', 'Antigravity', 'Antigravity.exe'),
      },
      {
        id: 'cursor',
        label: 'Cursor',
        configPath: path.join(context.appDataDir, 'Cursor', 'User', 'mcp.json'),
        appPath: path.join(context.localAppDataDir, 'Programs', 'Cursor', 'Cursor.exe'),
      },
      {
        id: 'windsurf',
        label: 'Windsurf',
        configPath: path.join(context.homedir, '.codeium', 'windsurf', 'mcp_config.json'),
        appPath: path.join(context.localAppDataDir, 'Programs', 'Windsurf', 'Windsurf.exe'),
      },
      {
        id: 'qoder',
        label: 'Qoder',
        configPath: path.join(context.appDataDir, 'Qoder', 'User', 'mcp.json'),
        appPath: path.join(context.localAppDataDir, 'Programs', 'Qoder', 'Qoder.exe'),
      },
      {
        id: 'claude-desktop',
        label: 'Claude Desktop',
        configPath: path.join(context.appDataDir, 'Claude', 'claude_desktop_config.json'),
        appPath: path.join(context.localAppDataDir, 'Programs', 'Claude', 'Claude.exe'),
      },
    ];
  }

  return [
    {
      id: 'antigravity',
      label: 'Antigravity',
      configPath: path.join(context.homedir, '.config', 'antigravity', 'mcp_servers.json'),
      appPath: null,
    },
    {
      id: 'cursor',
      label: 'Cursor',
      configPath: path.join(context.homedir, '.cursor', 'mcp.json'),
      appPath: null,
    },
    {
      id: 'windsurf',
      label: 'Windsurf',
      configPath: path.join(context.homedir, '.codeium', 'windsurf', 'mcp_config.json'),
      appPath: null,
    },
    {
      id: 'qoder',
      label: 'Qoder',
      configPath: path.join(context.homedir, '.config', 'Qoder', 'User', 'mcp.json'),
      appPath: null,
    },
    {
      id: 'claude-desktop',
      label: 'Claude Desktop',
      configPath: path.join(
        context.homedir,
        'Library',
        'Application Support',
        'Claude',
        'claude_desktop_config.json'
      ),
      appPath: null,
    },
  ];
}

export function resolveLauncher(context: IntegrationContext, launcherMode: LauncherMode): LauncherResolution {
  const installedAvailable =
    typeof context.installedExecutablePath === 'string' &&
    context.installedExecutablePath.length > 0 &&
    fs.existsSync(context.installedExecutablePath);

  const installedEntryPath = installedAvailable && context.installedExecutablePath
    ? path.join(path.dirname(context.installedExecutablePath), 'resources', 'app.asar', 'dist', 'src', 'index.js')
    : null;
  const installedEntryAvailable = typeof installedEntryPath === 'string' && installedEntryPath.length > 0;

  const repoEntryPath = context.repoRoot
    ? path.join(context.repoRoot, 'dist', 'src', 'index.js')
    : null;
  const repoAvailable = typeof repoEntryPath === 'string' && fs.existsSync(repoEntryPath);

  const buildResolution = (
    resolvedMode: ResolvedLauncherMode | null,
    available: boolean,
    command: string | null,
    args: string[],
    env: Record<string, string>,
    displayPath: string | null,
    reason?: string
  ): LauncherResolution => ({
    requestedMode: launcherMode,
    resolvedMode,
    available,
    command,
    args,
    env,
    displayPath,
    reason,
  });

  if (launcherMode === 'installed') {
    if (!installedAvailable || !installedEntryAvailable || !installedEntryPath || !context.installedExecutablePath) {
      return buildResolution(
        null,
        false,
        null,
        [],
        {},
        null,
        'Installed launcher is not available on this machine.',
      );
    }

    return buildResolution(
      'installed',
      true,
      context.installedExecutablePath,
      [installedEntryPath],
      { ELECTRON_RUN_AS_NODE: '1' },
      context.installedExecutablePath,
    );
  }

  if (launcherMode === 'repo') {
    if (!repoAvailable || !repoEntryPath) {
      return buildResolution(null, false, null, [], {}, null, 'Repo launcher is not available from this app context.');
    }

    return buildResolution('repo', true, 'node', [repoEntryPath], {}, repoEntryPath);
  }

  if (installedAvailable && installedEntryAvailable && installedEntryPath && context.installedExecutablePath) {
    return buildResolution(
      'installed',
      true,
      context.installedExecutablePath,
      [installedEntryPath],
      { ELECTRON_RUN_AS_NODE: '1' },
      context.installedExecutablePath,
    );
  }

  if (repoAvailable && repoEntryPath) {
    return buildResolution('repo', true, 'node', [repoEntryPath], {}, repoEntryPath);
  }

  return buildResolution(null, false, null, [], {}, null, 'No launcher target is currently available.');
}

export function previewMcpClientConfig(
  context: IntegrationContext,
  targetId: string,
  launcherMode: LauncherMode
): IntegrationPreview {
  const target = requireMcpClientDefinition(context, targetId);
  const launcher = resolveLauncher(context, launcherMode);
  const env = { ...launcher.env, ...getConfiguredEnv(context) };
  const existing = readJsonObject(target.configPath);
  const requiresReplace = existing.exists && !existing.valid;

  if (!launcher.available || !launcher.command || launcher.resolvedMode === null) {
    return {
      targetId,
      targetLabel: target.label,
      configPath: target.configPath,
      launcherMode,
      resolvedMode: null,
      command: null,
      args: [],
      env,
      configJson: JSON.stringify({}, null, 2),
      requiresReplace,
      writable: !requiresReplace,
      reason: launcher.reason ?? 'No launcher is available.',
    };
  }

  const nextConfig = buildMcpConfigObject(
    existing.valid ? existing.value : null,
    buildServerDefinition(launcher.command, launcher.args, env)
  );

  return {
    targetId,
    targetLabel: target.label,
    configPath: target.configPath,
    launcherMode,
    resolvedMode: launcher.resolvedMode,
    command: launcher.command,
    args: launcher.args,
    env,
    configJson: JSON.stringify(nextConfig, null, 2),
    requiresReplace,
    writable: !requiresReplace,
  };
}

export function applyMcpClientConfig(
  context: IntegrationContext,
  targetId: string,
  launcherMode: LauncherMode,
  replaceInvalid: boolean = false
): IntegrationPreview {
  const preview = previewMcpClientConfig(context, targetId, launcherMode);

  if (preview.command === null || preview.resolvedMode === null) {
    throw new Error(preview.reason ?? 'Cannot generate config without a launcher target.');
  }

  if (preview.requiresReplace && !replaceInvalid) {
    throw new Error('Existing config is malformed JSON. Use repair to replace it explicitly.');
  }

  if (!preview.configPath) {
    throw new Error('Target config path is unavailable.');
  }

  fs.mkdirSync(path.dirname(preview.configPath), { recursive: true });
  fs.writeFileSync(preview.configPath, preview.configJson, 'utf-8');

  return preview;
}

export function detectAllIntegrationRecords(
  context: IntegrationContext,
  launcherMode: LauncherMode,
  browserPaths: BrowserPathMap,
  browserSettings?: Record<string, BrowserSettingsRecord> | null
): IntegrationRecord[] {
  const records: IntegrationRecord[] = [];

  records.push(...detectMcpClientRecords(context, launcherMode));

  records.push(detectIdeExtensionRecord(context));
  records.push(detectBrowserExtensionRecord(context, browserPaths));
  records.push(...detectRuntimeRecords(browserPaths, browserSettings));

  return records;
}

export function detectMcpClientRecords(
  context: IntegrationContext,
  launcherMode: LauncherMode
): IntegrationRecord[] {
  return getMcpClientDefinitions(context).map((client) => detectMcpClientRecord(context, client, launcherMode));
}

function detectMcpClientRecord(
  context: IntegrationContext,
  client: McpClientDefinition,
  launcherMode: LauncherMode
): IntegrationRecord {
  const launcher = resolveLauncher(context, launcherMode);
  const existing = readJsonObject(client.configPath);
  const appDetected = client.appPath ? fs.existsSync(client.appPath) : false;
  const targetDirExists = fs.existsSync(path.dirname(client.configPath));
  const preview = previewMcpClientConfig(context, client.id, launcherMode);

  if (existing.exists && !existing.valid) {
    return {
      id: client.id,
      kind: 'mcp-client',
      label: client.label,
      status: 'invalid_config',
      path: client.configPath,
      summary: 'Config file exists but contains invalid JSON.',
      detail: 'Use Repair to replace the malformed MCP config file.',
      remediation: 'Repair the malformed config before applying the selected launcher target.',
      launcherMode,
      metadata: {
        appDetected,
        configExists: true,
        configValid: false,
        launcherResolvedMode: preview.resolvedMode,
      },
    };
  }

  const serverConfig = existing.valid && existing.value
    ? readMcpServerDefinition(existing.value, ROUTER_SERVER_NAME)
    : null;

  if (serverConfig) {
    const matches = launcher.available && matchesServerDefinition(serverConfig, launcher);
    return {
      id: client.id,
      kind: 'mcp-client',
      label: client.label,
      status: matches ? 'ready' : 'configured',
      path: client.configPath,
      summary: matches
        ? 'ifin Platform is configured with the current launcher target.'
        : 'ifin Platform is configured, but the launch target differs from the current mode.',
      detail: matches
        ? `Launcher mode resolves to ${preview.resolvedMode}.`
        : 'Preview and Apply will update only the mcp-router server entry.',
      remediation: matches
        ? 'Run Test to validate the configured launcher from this client.'
        : 'Apply the selected launcher mode to update only the mcp-router entry.',
      launcherMode,
      metadata: {
        appDetected,
        configExists: true,
        configValid: true,
        launcherResolvedMode: preview.resolvedMode,
      },
    };
  }

  if (appDetected || targetDirExists || existing.exists) {
    return {
      id: client.id,
      kind: 'mcp-client',
      label: client.label,
      status: launcher.available ? 'available' : 'degraded',
      path: client.configPath,
      summary: 'Client target detected and ready for ifin Platform setup.',
      detail: launcher.available
        ? 'Apply will upsert the mcp-router entry without touching other servers.'
        : launcher.reason ?? 'No launcher is currently available for this client.',
      remediation: launcher.available
        ? 'Apply the selected launcher mode to generate the client config.'
        : 'Fix the launcher target first, then return here to apply client config.',
      launcherMode,
      metadata: {
        appDetected,
        configExists: existing.exists,
        configValid: existing.valid,
        launcherResolvedMode: preview.resolvedMode,
      },
    };
  }

  return {
    id: client.id,
    kind: 'mcp-client',
    label: client.label,
    status: 'not_configured',
    path: client.configPath,
    summary: 'Client install or config location was not detected.',
    detail: 'The config path is known, but no client install or config directory is present yet.',
    remediation: 'Install the client or create its profile directory, then refresh detection.',
    launcherMode,
    metadata: {
      appDetected: false,
      configExists: false,
      configValid: false,
      launcherResolvedMode: preview.resolvedMode,
    },
  };
}

function detectIdeExtensionRecord(context: IntegrationContext): IntegrationRecord {
  const extensionDir = context.repoRoot ? path.join(context.repoRoot, 'extension') : null;
  const vsixPath = extensionDir ? findLatestVsix(extensionDir) : null;
  const buildPath =
    extensionDir && fs.existsSync(path.join(extensionDir, 'dist', 'extension.js'))
      ? path.join(extensionDir, 'dist', 'extension.js')
      : null;
  const extensionDetected = !!extensionDir && fs.existsSync(extensionDir);

  if (!extensionDetected) {
    return {
      id: 'ide-extension',
      kind: 'ide-extension',
      label: 'IDE Extension',
      status: 'not_configured',
      path: extensionDir,
      summary: 'IDE extension sources are not available in this app context.',
      detail: 'Repo mode is required to inspect or package the local VSIX artifact.',
      remediation: 'Use the packaged app for client setup, or open the repo checkout to build the IDE extension.',
      metadata: {
        extensionBuilt: false,
        vsixDetected: false,
      },
    };
  }

  const status: IntegrationStatus =
    buildPath && vsixPath
      ? 'ready'
      : buildPath || vsixPath
        ? 'available'
        : 'degraded';

  return {
    id: 'ide-extension',
    kind: 'ide-extension',
    label: 'IDE Extension',
    status,
    path: extensionDir,
    summary:
      status === 'ready'
        ? 'The IDE extension build and VSIX package are available.'
        : 'IDE extension assets are only partially available. Build and packaging need attention.',
    detail: buildPath && vsixPath
      ? 'Use Test API while the router is running to validate the extension backend path.'
      : 'The repo contains the extension, but either the compiled build or packaged VSIX is missing.',
    remediation: buildPath && vsixPath
      ? 'Use Test API to validate the local extension backend path.'
      : 'Build the extension and create a VSIX package before installation.',
    metadata: {
      extensionBuilt: !!buildPath,
      vsixDetected: !!vsixPath,
      vsixPath,
    },
  };
}

function detectBrowserExtensionRecord(
  context: IntegrationContext,
  browserPaths: BrowserPathMap
): IntegrationRecord {
  const extensionDir = context.repoRoot ? path.join(context.repoRoot, 'chrome-extension') : null;
  const manifestPath =
    extensionDir && fs.existsSync(path.join(extensionDir, 'manifest.json'))
      ? path.join(extensionDir, 'manifest.json')
      : null;
  const serviceWorkerPath =
    extensionDir && fs.existsSync(path.join(extensionDir, 'service-worker.js'))
      ? path.join(extensionDir, 'service-worker.js')
      : null;
  const sidepanelPath =
    extensionDir && fs.existsSync(path.join(extensionDir, 'sidepanel.html'))
      ? path.join(extensionDir, 'sidepanel.html')
      : null;
  const browserDetected = !!browserPaths.chrome || !!browserPaths.edge;

  if (!extensionDir || !fs.existsSync(extensionDir)) {
    return {
      id: 'browser-extension',
      kind: 'browser-extension',
      label: 'Browser Extension',
      status: 'not_configured',
      path: extensionDir,
      summary: 'Chrome extension assets are not available in this app context.',
      detail: 'Repo mode is required to inspect the browser extension source and manifest.',
      remediation: 'Open the repo checkout if you need to build or reload the browser extension locally.',
      metadata: {
        manifestDetected: false,
        serviceWorkerDetected: false,
        browserDetected,
        bridgePort: String(context.bridgePort),
      },
    };
  }

  const ready = !!manifestPath && !!serviceWorkerPath && !!sidepanelPath && browserDetected;

  return {
    id: 'browser-extension',
    kind: 'browser-extension',
    label: 'Browser Extension',
    status: ready ? 'ready' : 'available',
    path: extensionDir,
    summary: ready
      ? 'Chrome extension assets and a supported Chromium browser are available.'
      : 'Browser extension assets exist, but runtime or browser prerequisites are incomplete.',
    detail: 'Use Test Bridge to validate the live extension connection on the default WebSocket port.',
    remediation: ready
      ? 'Load the extension in Chrome or Edge, then run Test Bridge.'
      : 'Confirm Chrome or Edge is installed and complete the browser extension setup.',
    metadata: {
      manifestDetected: !!manifestPath,
      serviceWorkerDetected: !!serviceWorkerPath,
      sidepanelDetected: !!sidepanelPath,
      browserDetected,
      bridgePort: String(context.bridgePort),
    },
  };
}

function detectRuntimeRecords(
  browserPaths: BrowserPathMap,
  browserSettings?: Record<string, BrowserSettingsRecord> | null
): IntegrationRecord[] {
  const runtimes: Array<keyof BrowserPathMap> = ['chrome', 'edge', 'firefox', 'safari'];

  return runtimes.map((runtimeId) => {
    const runtimePath = browserPaths[runtimeId];
    const settings = browserSettings?.[runtimeId];
    const enabled = settings?.enabled ?? false;
    const status: IntegrationStatus = runtimePath
      ? enabled
        ? 'ready'
        : 'available'
      : enabled
        ? 'degraded'
        : 'not_configured';

    return {
      id: `runtime:${runtimeId}`,
      kind: 'runtime',
      label: runtimeId.charAt(0).toUpperCase() + runtimeId.slice(1),
      status,
      path: runtimePath,
      summary: runtimePath
        ? enabled
          ? 'Executable detected and enabled for automation flows.'
          : 'Executable detected but currently disabled in browser settings.'
        : 'Executable path was not detected on this machine.',
      detail: runtimePath
        ? runtimePath
        : 'Use Automation Runtimes to review browser paths and run connection checks.',
      remediation: runtimePath
        ? enabled
          ? 'Use Test to validate this runtime before depending on automation flows.'
          : 'Enable the runtime if you want it available for browser automation.'
        : 'Install the browser or configure its path before enabling it.',
      metadata: {
        enabled,
        detected: !!runtimePath,
      },
    };
  });
}

export function buildSystemReadiness(
  context: IntegrationContext,
  launcherMode: LauncherMode,
  records: IntegrationRecord[],
  probes: ReadinessProbeSnapshot = {}
): SystemReadiness {
  const launcher = resolveLauncher(context, launcherMode);

  const planes: [RuntimePlaneStatus, RuntimePlaneStatus, RuntimePlaneStatus] = [
    buildLauncherPlane(launcher),
    buildLocalApiPlane(context.localApiPort, probes.localApi),
    buildBrowserBridgePlane(context.bridgePort, probes.browserBridge),
  ];
  const [launcherPlane, localApiPlane, browserBridgePlane] = planes;

  const mcpClients = records.filter((record) => record.kind === 'mcp-client');
  const ideExtension = records.find((record) => record.id === 'ide-extension');
  const browserExtension = records.find((record) => record.id === 'browser-extension');

  const checklist: ChecklistItem[] = [
    {
      id: 'launcher',
      label: 'MCP launcher',
      status: launcherPlane.status,
      summary: launcherPlane.summary,
      remediation: launcherPlane.remediation,
    },
    {
      id: 'local-api',
      label: 'Local API',
      status: localApiPlane.status,
      summary: localApiPlane.summary,
      remediation: localApiPlane.remediation,
    },
    {
      id: 'ide-extension',
      label: 'IDE extension',
      status: ideExtension?.status ?? 'not_configured',
      summary: ideExtension?.summary ?? 'No IDE extension assets were detected.',
      remediation:
        ideExtension?.remediation ??
        'Build and package the IDE extension before depending on it locally.',
    },
    {
      id: 'browser-bridge',
      label: 'Browser bridge',
      status: mergeStatuses(browserExtension?.status ?? 'not_configured', browserBridgePlane.status),
      summary:
        browserExtension?.status === 'ready' && browserBridgePlane.status === 'connected'
          ? 'Browser extension assets are present and the bridge is reachable.'
          : browserExtension?.summary ?? browserBridgePlane.summary,
      remediation:
        browserExtension?.remediation ??
        'Load the browser extension and reconnect the bridge before testing.',
    },
    {
      id: 'client-configs',
      label: 'Client configs',
      status: summarizeClientConfigStatus(mcpClients),
      summary: summarizeClientConfigMessage(mcpClients),
      remediation:
        mcpClients.some((record) => record.status === 'invalid_config')
          ? 'Repair malformed client configs, then re-apply the selected launcher mode.'
          : 'Use Apply or Repair in Integrations to align client configs with the current launcher mode.',
    },
  ];

  const warnings = [
    ...collectWarnings(planes),
    ...collectWarnings(records),
  ];

  return {
    status: summarizeOverallStatus(checklist),
    launcherMode,
    resolvedLauncherMode: launcher.resolvedMode,
    summary: buildReadinessSummary(checklist, launcher),
    warnings,
    planes,
    integrations: records,
    checklist,
  };
}

function buildLauncherPlane(launcher: LauncherResolution): RuntimePlaneStatus {
  if (!launcher.available || !launcher.command || launcher.resolvedMode === null) {
    return {
      id: 'mcpLauncher',
      label: 'MCP Launcher',
      status: 'error',
      summary: 'No valid MCP launcher is available for the selected mode.',
      detail: launcher.reason ?? 'Launcher resolution failed.',
      remediation: 'Install the Windows app or build the repo launcher, then refresh detection.',
      path: launcher.displayPath,
      port: null,
      metadata: {
        requestedMode: launcher.requestedMode,
        resolvedMode: null,
      },
    };
  }

  return {
    id: 'mcpLauncher',
    label: 'MCP Launcher',
    status: 'ready',
    summary: `The launcher resolves to ${launcher.resolvedMode} mode.`,
    detail: launcher.displayPath ?? launcher.command,
    remediation: 'Apply the current launcher target to detected clients and run Test to validate it.',
    path: launcher.displayPath,
    port: null,
    metadata: {
      requestedMode: launcher.requestedMode,
      resolvedMode: launcher.resolvedMode,
    },
  };
}

function buildLocalApiPlane(port: number, probe?: RuntimeProbeStatus): RuntimePlaneStatus {
  const status = probe?.status ?? 'degraded';

  return {
    id: 'localApi',
    label: 'Local API',
    status,
    summary:
      status === 'connected'
        ? `The local API is reachable on port ${port}.`
        : `The local API is not currently reachable on port ${port}.`,
    detail:
      probe?.detail ??
      'Start the local router process to expose the IDE extension API.',
    remediation: 'Start the local server from Overview, then run Test API again.',
    path: null,
    port,
    metadata: {
      host: '127.0.0.1',
    },
  };
}

function buildBrowserBridgePlane(port: number, probe?: RuntimeProbeStatus): RuntimePlaneStatus {
  const status = probe?.status ?? 'degraded';

  return {
    id: 'browserBridge',
    label: 'Browser Bridge',
    status,
    summary:
      status === 'connected'
        ? `The browser bridge is reachable on port ${port}.`
        : `The browser bridge is not currently reachable on port ${port}.`,
    detail:
      probe?.detail ??
      'Load the browser extension and keep its bridge connection running.',
    remediation: 'Load the extension in Chrome or Edge, then run Test Bridge again.',
    path: null,
    port,
    metadata: {
      host: '127.0.0.1',
    },
  };
}

function summarizeClientConfigStatus(records: IntegrationRecord[]): IntegrationStatus {
  if (records.some((record) => record.status === 'invalid_config')) {
    return 'invalid_config';
  }

  if (records.some((record) => record.status === 'configured')) {
    return 'configured';
  }

  if (records.some((record) => record.status === 'available')) {
    return 'available';
  }

  if (records.some((record) => record.status === 'ready')) {
    return 'ready';
  }

  return records.some((record) => record.status === 'not_configured')
    ? 'not_configured'
    : 'degraded';
}

function summarizeClientConfigMessage(records: IntegrationRecord[]): string {
  const readyCount = records.filter((record) => record.status === 'ready').length;
  const configuredCount = records.filter((record) => record.status === 'configured').length;
  const invalidCount = records.filter((record) => record.status === 'invalid_config').length;

  if (invalidCount > 0) {
    return `${invalidCount} client config file(s) require explicit repair before they can be updated safely.`;
  }

  if (configuredCount > 0) {
    return `${configuredCount} client config file(s) point to a different launcher target.`;
  }

  if (readyCount > 0) {
    return `${readyCount} client config file(s) already target the current launcher mode.`;
  }

  return 'No client configs are ready yet. Use Apply to generate the current launcher target.';
}

function summarizeOverallStatus(checklist: ChecklistItem[]): IntegrationStatus {
  if (checklist.some((item) => item.status === 'error' || item.status === 'invalid_config')) {
    return 'error';
  }

  if (checklist.some((item) => item.status === 'degraded' || item.status === 'not_configured')) {
    return 'degraded';
  }

  if (checklist.every((item) => item.status === 'connected' || item.status === 'ready')) {
    return checklist.some((item) => item.status === 'connected') ? 'connected' : 'ready';
  }

  if (checklist.some((item) => item.status === 'configured')) {
    return 'configured';
  }

  return 'available';
}

function buildReadinessSummary(checklist: ChecklistItem[], launcher: LauncherResolution): string {
  const blockingItems = checklist.filter((item) =>
    item.status === 'error' || item.status === 'invalid_config' || item.status === 'degraded'
  );

  if (blockingItems.length === 0) {
    return `Local system readiness is aligned for ${launcher.resolvedMode ?? 'the selected'} launcher mode.`;
  }

  return `Local system readiness is blocked by ${blockingItems
    .map((item) => item.label.toLowerCase())
    .join(', ')}.`;
}

function mergeStatuses(primary: IntegrationStatus, secondary: IntegrationStatus): IntegrationStatus {
  const severity: Record<IntegrationStatus, number> = {
    error: 7,
    invalid_config: 6,
    degraded: 5,
    not_configured: 4,
    available: 3,
    configured: 2,
    ready: 1,
    connected: 0,
  };

  return severity[primary] >= severity[secondary] ? primary : secondary;
}

function collectWarnings(items: Array<{ label: string; status: IntegrationStatus; summary: string }>): string[] {
  return items
    .filter((item) =>
      item.status === 'error' ||
      item.status === 'invalid_config' ||
      item.status === 'degraded' ||
      item.status === 'not_configured'
    )
    .map((item) => `${item.label}: ${item.summary}`);
}

function parseDotEnvFile(envPath: string): Record<string, string> {
  if (!fs.existsSync(envPath)) {
    return {};
  }

  const result: Record<string, string> = {};
  const content = fs.readFileSync(envPath, 'utf-8');

  for (const line of content.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (key.length > 0 && value.length > 0) {
      result[key] = value;
    }
  }

  return result;
}

function readJsonObject(filePath: string): JsonReadResult {
  if (!fs.existsSync(filePath)) {
    return {
      exists: false,
      valid: false,
      value: null,
    };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as unknown;
    if (!isRecord(parsed)) {
      return {
        exists: true,
        valid: false,
        value: null,
        error: 'Config root must be a JSON object.',
      };
    }

    return {
      exists: true,
      valid: true,
      value: parsed,
    };
  } catch (error) {
    return {
      exists: true,
      valid: false,
      value: null,
      error: error instanceof Error ? error.message : 'Invalid JSON',
    };
  }
}

function buildServerDefinition(command: string, args: string[], env: Record<string, string>) {
  return {
    command,
    args,
    env,
  };
}

function buildMcpConfigObject(
  existing: Record<string, unknown> | null,
  serverDefinition: Record<string, unknown>
): Record<string, unknown> {
  const nextConfig = existing ? { ...existing } : {};
  const existingMcpServers = nextConfig['mcpServers'];
  const mcpServers = isRecord(existingMcpServers) ? { ...existingMcpServers } : {};
  mcpServers[ROUTER_SERVER_NAME] = serverDefinition;
  nextConfig['mcpServers'] = mcpServers;
  return nextConfig;
}

function readMcpServerDefinition(
  configObject: Record<string, unknown>,
  serverName: string
): Record<string, unknown> | null {
  const mcpServers = configObject['mcpServers'];
  if (!isRecord(mcpServers)) {
    return null;
  }

  const server = mcpServers[serverName];
  return isRecord(server) ? server : null;
}

function matchesServerDefinition(serverConfig: Record<string, unknown>, launcher: LauncherResolution): boolean {
  if (!launcher.command) {
    return false;
  }

  if (serverConfig['command'] !== launcher.command) {
    return false;
  }

  const rawArgs = serverConfig['args'];
  const args = Array.isArray(rawArgs)
    ? rawArgs.filter((value): value is string => typeof value === 'string')
    : [];

  return JSON.stringify(args) === JSON.stringify(launcher.args);
}

function requireMcpClientDefinition(context: IntegrationContext, targetId: string): McpClientDefinition {
  const target = getMcpClientDefinitions(context).find((entry) => entry.id === targetId);
  if (!target) {
    throw new Error(`Unknown MCP client target: ${targetId}`);
  }
  return target;
}

function findLatestVsix(extensionDir: string): string | null {
  if (!fs.existsSync(extensionDir)) {
    return null;
  }

  const candidates = fs
    .readdirSync(extensionDir)
    .filter((entry) => entry.endsWith('.vsix'))
    .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));

  return candidates.length > 0 && candidates[0]
    ? path.join(extensionDir, candidates[0])
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
