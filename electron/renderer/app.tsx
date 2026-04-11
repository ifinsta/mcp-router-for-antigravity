import React, { useEffect, useMemo, useState } from 'react';
import Integrations from './integrations';
import { ModeSelection } from './modeSelection';
import { BrowserPreview } from './preview';
import { BrowserPairing } from './browserPairing';
import type {
  IntegrationPreview,
  IntegrationRecord,
  RuntimePlaneStatus,
  SystemReadiness,
  IntegrationTestResult,
  LauncherMode,
} from './types';
import './types';
import './app.css';

interface BrowserConfig {
  chrome: Browser;
  edge: Browser;
  firefox: Browser;
  safari: Browser;
}

interface Browser {
  enabled: boolean;
  path: string | null;
  version: string;
  status: 'idle' | 'testing' | 'success' | 'error';
}

type BrowserType = keyof BrowserConfig;

interface StoredBrowserConfig {
  enabled: boolean;
  path: string | null;
  headless: boolean;
  userDataDir: string | null;
}

interface BrowserSettings {
  browsers: Record<BrowserType, StoredBrowserConfig>;
  performance: {
    timeout: number;
    retryAttempts: number;
    concurrentSessions: number;
  };
  logging: {
    level: string;
    fileLogging: boolean;
    logPath: string;
  };
}

interface SystemInfo {
  platform: string;
  version: string;
  arch: string;
  cpus: number;
  totalMemory: number;
  freeMemory: number;
}

type TabId = 'dashboard' | 'integrations' | 'browser' | 'logs' | 'settings';
type ThemeMode = 'dark' | 'light';

interface SectionConfig {
  id: TabId;
  code: string;
  label: string;
  heading: string;
  description: string;
}

const THEME_STORAGE_KEY = 'ifin-platform-theme';
const browserTypes: BrowserType[] = ['chrome', 'edge', 'firefox', 'safari'];

const sections: SectionConfig[] = [
  {
    id: 'dashboard',
    code: 'OV',
    label: 'Overview',
    heading: 'Overview',
    description: 'Operational status, local system summary, and MCP server control.',
  },
  {
    id: 'integrations',
    code: 'IG',
    label: 'Integrations',
    heading: 'Integrations',
    description: 'Manage MCP client setup, launcher mode, and IDE integration readiness.',
  },
  {
    id: 'browser',
    code: 'BR',
    label: 'Browser',
    heading: 'Browser',
    description: 'Manage the browser extension bridge and local automation runtimes.',
  },
  {
    id: 'logs',
    code: 'LG',
    label: 'Logs',
    heading: 'Logs',
    description: 'Review recent MCP server events, failures, and browser diagnostics.',
  },
  {
    id: 'settings',
    code: 'ST',
    label: 'Settings',
    heading: 'Settings',
    description: 'Application details, theme selection, and documentation access.',
  },
];

function StatusCard({ title, status, details, icon }: {
  title: string;
  status: 'good' | 'warning' | 'error';
  details: string;
  icon: string;
}) {
  const colors = { good: 'var(--status-good)', warning: 'var(--status-warning)', error: 'var(--status-poor)' };
  return (
    <div className="status-card">
      <div className="status-card-header">
        <span className="status-card-icon">{icon}</span>
        <span className="status-card-title">{title}</span>
        <span className="status-dot" style={{ backgroundColor: colors[status] }} />
      </div>
      <div className="status-card-details">{details}</div>
    </div>
  );
}

function getInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') {
    return 'dark';
  }

  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  return storedTheme === 'light' ? 'light' : 'dark';
}

function formatMemory(value: number | undefined): string {
  if (!value) {
    return '0 GB';
  }

  return `${Math.round(value / 1024 / 1024 / 1024)} GB`;
}

function getDefaultBrowserSettings(): BrowserSettings {
  return {
    browsers: {
      chrome: { enabled: true, path: null, headless: true, userDataDir: null },
      edge: { enabled: true, path: null, headless: true, userDataDir: null },
      firefox: { enabled: true, path: null, headless: true, userDataDir: null },
      safari: { enabled: false, path: null, headless: true, userDataDir: null },
    },
    performance: {
      timeout: 30000,
      retryAttempts: 3,
      concurrentSessions: 5,
    },
    logging: {
      level: 'info',
      fileLogging: true,
      logPath: '~/.mcp-router-logs',
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function hasNoProviderConfigurationWarning(warnings: string[]): boolean {
  return warnings.some((warning) => {
    const normalized = warning.toLowerCase();
    return normalized.includes('no providers configured') || normalized.includes('no providers available for discovery');
  });
}

function normalizeBrowserSettings(value: unknown): BrowserSettings {
  const defaults = getDefaultBrowserSettings();

  if (!isRecord(value)) {
    return defaults;
  }

  const rawBrowsers = isRecord(value.browsers) ? value.browsers : {};
  const browsers = browserTypes.reduce<Record<BrowserType, StoredBrowserConfig>>((accumulator, browserType) => {
    const candidate = isRecord(rawBrowsers[browserType]) ? rawBrowsers[browserType] : {};
    accumulator[browserType] = {
      enabled:
        typeof candidate.enabled === 'boolean'
          ? candidate.enabled
          : defaults.browsers[browserType].enabled,
      path:
        typeof candidate.path === 'string' || candidate.path === null
          ? candidate.path
          : defaults.browsers[browserType].path,
      headless:
        typeof candidate.headless === 'boolean'
          ? candidate.headless
          : defaults.browsers[browserType].headless,
      userDataDir:
        typeof candidate.userDataDir === 'string' || candidate.userDataDir === null
          ? candidate.userDataDir
          : defaults.browsers[browserType].userDataDir,
    };
    return accumulator;
  }, {} as Record<BrowserType, StoredBrowserConfig>);

  const rawPerformance = isRecord(value.performance) ? value.performance : {};
  const rawLogging = isRecord(value.logging) ? value.logging : {};

  return {
    browsers,
    performance: {
      timeout:
        typeof rawPerformance.timeout === 'number'
          ? rawPerformance.timeout
          : defaults.performance.timeout,
      retryAttempts:
        typeof rawPerformance.retryAttempts === 'number'
          ? rawPerformance.retryAttempts
          : defaults.performance.retryAttempts,
      concurrentSessions:
        typeof rawPerformance.concurrentSessions === 'number'
          ? rawPerformance.concurrentSessions
          : defaults.performance.concurrentSessions,
    },
    logging: {
      level: typeof rawLogging.level === 'string' ? rawLogging.level : defaults.logging.level,
      fileLogging:
        typeof rawLogging.fileLogging === 'boolean'
          ? rawLogging.fileLogging
          : defaults.logging.fileLogging,
      logPath: typeof rawLogging.logPath === 'string' ? rawLogging.logPath : defaults.logging.logPath,
    },
  };
}

function buildBrowserViewModel(settings: BrowserSettings): BrowserConfig {
  return browserTypes.reduce<BrowserConfig>((accumulator, browserType) => {
    const browser = settings.browsers[browserType];
    accumulator[browserType] = {
      enabled: browser.enabled,
      path: browser.path,
      version: '',
      status: 'idle',
    };
    return accumulator;
  }, {
    chrome: { enabled: false, path: null, version: '', status: 'idle' },
    edge: { enabled: false, path: null, version: '', status: 'idle' },
    firefox: { enabled: false, path: null, version: '', status: 'idle' },
    safari: { enabled: false, path: null, version: '', status: 'idle' },
  });
}

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>('dashboard');
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [browserConfig, setBrowserConfig] = useState<BrowserConfig | null>(null);
  const [browserSettings, setBrowserSettings] = useState<BrowserSettings>(getDefaultBrowserSettings);
  const [launcherMode, setLauncherMode] = useState<LauncherMode>('auto');
  const [integrationRecords, setIntegrationRecords] = useState<IntegrationRecord[]>([]);
  const [systemReadiness, setSystemReadiness] = useState<SystemReadiness | null>(null);
  const [integrationPreview, setIntegrationPreview] = useState<IntegrationPreview | null>(null);
  const [integrationTestResult, setIntegrationTestResult] = useState<IntegrationTestResult | null>(null);
  const [mcpServerStatus, setMcpServerStatus] = useState<{ running: boolean; pid: number | null }>({
    running: false,
    pid: null,
  });
  const [logs, setLogs] = useState<string[]>([]);
  const [appVersion, setAppVersion] = useState('');
  const [modeSelected, setModeSelected] = useState<boolean>(true); // assume selected until checked
  const [currentMode, setCurrentMode] = useState<string>('agent');
  const [browserBridgeStatus, setBrowserBridgeStatus] = useState<'connected' | 'degraded' | 'not_connected'>('not_connected');
  const [browserTabCount, setBrowserTabCount] = useState<number>(0);
  const [routerVersion, setRouterVersion] = useState<string>('');
  const [routerHealthStatus, setRouterHealthStatus] = useState<'healthy' | 'degraded' | 'disconnected'>('disconnected');
  const [routerHealthDetail, setRouterHealthDetail] = useState<string>('The local API is not reachable.');
  const [providersConfigured, setProvidersConfigured] = useState<boolean>(true);
  const [browserTabs, setBrowserTabs] = useState<Array<{ tabId: string; url: string; title: string; isActive: boolean }>>([]);
  const [showBrowserPairing, setShowBrowserPairing] = useState<boolean>(false);

  useEffect(() => {
    loadInitialData();
    setupEventListeners();

    return () => {
      window.electronAPI.removeAllListeners();
    };
  }, []);

  useEffect(() => {
    const checkHealth = async () => {
      try {
        const res = await fetch('http://localhost:3000/health');
        if (res.ok) {
          const data = await res.json() as unknown;
          if (!isRecord(data)) {
            throw new Error('Health response returned an unexpected shape.');
          }

          setRouterVersion(typeof data.version === 'string' ? data.version : '');

          const warnings = [
            ...getStringArray(data.warnings),
            ...getStringArray(isRecord(data.config) ? data.config.warnings : undefined),
            ...getStringArray(isRecord(data.discovery) ? data.discovery.warnings : undefined),
          ];
          const noProvidersConfigured = hasNoProviderConfigurationWarning(warnings);
          setProvidersConfigured(!noProvidersConfigured);

          const reportedStatus = typeof data.status === 'string' ? data.status : 'degraded';
          if (reportedStatus === 'healthy') {
            setRouterHealthStatus('healthy');
            setRouterHealthDetail('All configured providers are reachable.');
          } else {
            setRouterHealthStatus('degraded');
            setRouterHealthDetail(
              noProvidersConfigured
                ? 'Mode switching available; providers not configured.'
                : warnings[0] || 'Router is reachable with limited provider availability.'
            );
          }

          const bridgeState = isRecord(data.browserBridge)
            ? data.browserBridge
            : isRecord(data.browser)
              ? data.browser
              : null;

          if (bridgeState) {
            setBrowserBridgeStatus(bridgeState.connected === true ? 'connected' : 'not_connected');
            setBrowserTabCount(typeof bridgeState.tabCount === 'number' ? bridgeState.tabCount : 0);
          } else {
            setBrowserBridgeStatus('not_connected');
            setBrowserTabCount(0);
          }
          return;
        }

        setRouterHealthStatus('disconnected');
        setRouterHealthDetail(`The local API returned ${res.status}.`);
        setProvidersConfigured(true);
        setBrowserBridgeStatus('not_connected');
        setBrowserTabCount(0);
      } catch {
        setRouterHealthStatus('disconnected');
        setRouterHealthDetail('The local API is not reachable.');
        setProvidersConfigured(true);
        setBrowserBridgeStatus('not_connected');
        setBrowserTabCount(0);
      }
    };

    const fetchTabs = async () => {
      try {
        const res = await fetch('http://localhost:3000/api/browser/tabs');
        if (res.ok) {
          const data = await res.json();
          setBrowserTabs(data.tabs || []);
        }
      } catch {
        setBrowserTabs([]);
      }
    };

    checkHealth();
    fetchTabs();
    const interval = setInterval(() => {
      checkHealth();
      fetchTabs();
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  const currentSection = useMemo(
    () => sections.find((section) => section.id === activeTab) ?? sections[0],
    [activeTab]
  );

  const browserSummary = useMemo(() => {
    if (!browserConfig) {
      return { enabled: 0, connected: 0 };
    }

    const browsers = Object.values(browserConfig);
    return {
      enabled: browsers.filter((browser) => browser.enabled).length,
      connected: browsers.filter((browser) => browser.status === 'success').length,
    };
  }, [browserConfig]);

  const runtimeRecords = useMemo(
    () => integrationRecords.filter((record) => record.kind === 'runtime'),
    [integrationRecords]
  );

  const browserExtensionRecord = useMemo(
    () => integrationRecords.find((record) => record.id === 'browser-extension') ?? null,
    [integrationRecords]
  );

  const routerCardState = useMemo(() => {
    if (routerHealthStatus === 'healthy') {
      return {
        status: 'good' as const,
        details: `Running${routerVersion ? ` (v${routerVersion})` : ''}. All configured providers are reachable.`,
      };
    }

    if (routerHealthStatus === 'degraded') {
      return {
        status: 'warning' as const,
        details: `Reachable${routerVersion ? ` (v${routerVersion})` : ''}. ${routerHealthDetail}`,
      };
    }

    if (mcpServerStatus.running) {
      return {
        status: 'warning' as const,
        details: 'Starting. Waiting for the local API to respond.',
      };
    }

    return {
      status: 'error' as const,
      details: 'Stopped',
    };
  }, [mcpServerStatus.running, routerHealthDetail, routerHealthStatus, routerVersion]);

  const localApiDetail = useMemo(() => {
    if (!providersConfigured && routerHealthStatus === 'degraded') {
      return 'Reachable. Mode switching available; providers not configured.';
    }

    if (routerHealthStatus === 'healthy') {
      return `Reachable${routerVersion ? ` on router v${routerVersion}` : ''}.`;
    }

    if (mcpServerStatus.running && routerHealthStatus === 'disconnected') {
      return 'Waiting for the local API to finish starting.';
    }

    return systemReadiness?.planes.find((plane) => plane.id === 'localApi')?.detail || 'No local API status yet';
  }, [mcpServerStatus.running, providersConfigured, routerHealthStatus, routerVersion, systemReadiness]);

  const loadIntegrations = async () => {
    try {
      const result = await window.electronAPI.integrationAPI.list();
      if (result.success) {
        setIntegrationRecords(result.records ?? []);
        setSystemReadiness(result.readiness ?? null);
        if (result.launcherMode) {
          setLauncherMode(result.launcherMode);
        }
      }
    } catch (error) {
      setLogs((prev) => [...prev.slice(-119), `[ERROR] Failed to load integrations: ${String(error)}`]);
    }
  };

  const loadInitialData = async () => {
    try {
      const [info, browsers, status, version, integrations, modeConfig] = await Promise.all([
        window.electronAPI.getSystemInfo(),
        window.electronAPI.getBrowserConfig(),
        window.electronAPI.getMCPServerStatus(),
        window.electronAPI.getAppVersion(),
        window.electronAPI.integrationAPI.list(),
        window.electronAPI.modeAPI.get(),
      ]);

      // Check mode selection
      if (!modeConfig) {
        setModeSelected(false);
      } else {
        setCurrentMode(modeConfig.mode);
        setModeSelected(true);
      }

      const normalizedBrowserSettings = normalizeBrowserSettings(browsers);
      setSystemInfo(info);
      setBrowserSettings(normalizedBrowserSettings);
      setBrowserConfig(buildBrowserViewModel(normalizedBrowserSettings));
      setMcpServerStatus(status);
      setAppVersion(version);
      if (integrations.success) {
        setIntegrationRecords(integrations.records ?? []);
        setSystemReadiness(integrations.readiness ?? null);
        if (integrations.launcherMode) {
          setLauncherMode(integrations.launcherMode);
        }
      }
    } catch (error) {
      console.error('Failed to load initial data:', error);
    }
  };

  const handleModeSelect = async (mode: 'agent' | 'router') => {
    await window.electronAPI.modeAPI.set(mode);
    setCurrentMode(mode);
    setModeSelected(true);
    // Also try to sync to router
    try {
      await fetch('http://localhost:3000/api/mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
    } catch { /* router may not be running */ }
  };

  const setupEventListeners = () => {
    window.electronAPI.onMCPServerLog((message) => {
      setLogs((prev) => [...prev.slice(-119), `[INFO] ${message}`]);
    });

    window.electronAPI.onMCPServerError((error) => {
      setLogs((prev) => [...prev.slice(-119), `[ERROR] ${error}`]);
    });

    window.electronAPI.onMCPServerStopped((data) => {
      setMcpServerStatus({ running: false, pid: null });
      setLogs((prev) => [...prev.slice(-119), `[STOPPED] Server stopped with code: ${data.code}`]);
    });
  };

  const toggleBrowser = (browserType: keyof BrowserConfig) => {
    if (!browserConfig) {
      return;
    }

    setBrowserConfig((prev) => ({
      ...prev!,
      [browserType]: {
        ...prev![browserType],
        enabled: !prev![browserType].enabled,
      },
    }));
  };

  const testBrowser = async (browserType: keyof BrowserConfig) => {
    if (!browserConfig) {
      return;
    }

    setBrowserConfig((prev) => ({
      ...prev!,
      [browserType]: {
        ...prev![browserType],
        status: 'testing',
      },
    }));

    try {
      const result = await window.electronAPI.testBrowserConnection(browserType);

      setBrowserConfig((prev) => ({
        ...prev!,
        [browserType]: {
          ...prev![browserType],
          status: result.success ? 'success' : 'error',
        },
      }));

      if (!result.success) {
        setLogs((prev) => [...prev.slice(-119), `[ERROR] ${browserType} test failed: ${result.error}`]);
      }
    } catch (error) {
      setBrowserConfig((prev) => ({
        ...prev!,
        [browserType]: {
          ...prev![browserType],
          status: 'error',
        },
      }));

      setLogs((prev) => [...prev.slice(-119), `[ERROR] ${browserType} test failed: ${String(error)}`]);
    }
  };

  const startMCPServer = async () => {
    try {
      const result = await window.electronAPI.startMCPServer({});
      if (result.success) {
        setMcpServerStatus({ running: true, pid: result.pid });
        setLogs((prev) => [...prev.slice(-119), `[INFO] MCP Server started with PID: ${result.pid}`]);
      } else {
        setLogs((prev) => [...prev.slice(-119), `[ERROR] Failed to start MCP Server: ${result.error}`]);
      }
    } catch (error) {
      setLogs((prev) => [...prev.slice(-119), `[ERROR] Failed to start MCP Server: ${String(error)}`]);
    }
  };

  const stopMCPServer = async () => {
    try {
      const result = await window.electronAPI.stopMCPServer();
      if (result.success) {
        setMcpServerStatus({ running: false, pid: null });
        setLogs((prev) => [...prev.slice(-119), '[INFO] MCP Server stopped']);
      }
    } catch (error) {
      setLogs((prev) => [...prev.slice(-119), `[ERROR] Failed to stop MCP Server: ${String(error)}`]);
    }
  };

  const saveBrowserConfig = async () => {
    if (!browserConfig) {
      return;
    }

    try {
      const nextSettings: BrowserSettings = {
        ...browserSettings,
        browsers: browserTypes.reduce<Record<BrowserType, StoredBrowserConfig>>((accumulator, browserType) => {
          const existing = browserSettings.browsers[browserType];
          const current = browserConfig[browserType];
          accumulator[browserType] = {
            ...existing,
            enabled: current.enabled,
            path: current.path,
          };
          return accumulator;
        }, {} as Record<BrowserType, StoredBrowserConfig>),
      };

      await window.electronAPI.configureBrowsers(nextSettings);
      setBrowserSettings(nextSettings);
      setLogs((prev) => [...prev.slice(-119), '[INFO] Browser configuration saved']);
      await loadIntegrations();
    } catch (error) {
      setLogs((prev) => [...prev.slice(-119), `[ERROR] Failed to save configuration: ${String(error)}`]);
    }
  };

  const setIntegrationLauncherMode = async (nextMode: LauncherMode) => {
    try {
      const result = await window.electronAPI.integrationAPI.setLauncherMode(nextMode);
      if (result.success && result.launcherMode) {
        setLauncherMode(result.launcherMode);
        setIntegrationPreview(null);
        await loadIntegrations();
        setLogs((prev) => [...prev.slice(-119), `[INFO] Launcher mode set to ${result.launcherMode}`]);
      }
    } catch (error) {
      setLogs((prev) => [...prev.slice(-119), `[ERROR] Failed to set launcher mode: ${String(error)}`]);
    }
  };

  const previewIntegration = async (targetId: string) => {
    try {
      const result = await window.electronAPI.integrationAPI.preview(targetId, launcherMode);
      if (result.success && result.preview) {
        const preview = result.preview;
        setIntegrationPreview(preview);
        setLogs((prev) => [...prev.slice(-119), `[INFO] Preview generated for ${preview.targetLabel}`]);
      } else if (result.error) {
        setLogs((prev) => [...prev.slice(-119), `[ERROR] ${result.error}`]);
      }
    } catch (error) {
      setLogs((prev) => [...prev.slice(-119), `[ERROR] Failed to preview integration: ${String(error)}`]);
    }
  };

  const applyIntegration = async (targetId: string, replaceInvalid: boolean = false) => {
    try {
      const result = await window.electronAPI.integrationAPI.apply(targetId, launcherMode, replaceInvalid);
      if (result.success && result.preview) {
        const preview = result.preview;
        setIntegrationPreview(preview);
        await loadIntegrations();
        setLogs((prev) => [...prev.slice(-119), `[INFO] Applied integration for ${preview.targetLabel}`]);
      } else if (result.error) {
        setLogs((prev) => [...prev.slice(-119), `[ERROR] ${result.error}`]);
      }
    } catch (error) {
      setLogs((prev) => [...prev.slice(-119), `[ERROR] Failed to apply integration: ${String(error)}`]);
    }
  };

  const testIntegration = async (targetId: string) => {
    try {
      const result = await window.electronAPI.integrationAPI.test(targetId, launcherMode);
      if (result.success && result.result) {
        const testResult = result.result;
        setIntegrationTestResult(testResult);
        setLogs((prev) => [...prev.slice(-119), `[INFO] ${testResult.message}`]);
      } else if (result.error) {
        setLogs((prev) => [...prev.slice(-119), `[ERROR] ${result.error}`]);
      }
    } catch (error) {
      setLogs((prev) => [...prev.slice(-119), `[ERROR] Failed to test integration: ${String(error)}`]);
    }
  };

  const openIntegrationPath = async (targetPath: string) => {
    try {
      const result = await window.electronAPI.integrationAPI.openPath(targetPath);
      if (!result.success && result.error) {
        setLogs((prev) => [...prev.slice(-119), `[ERROR] ${result.error}`]);
      }
    } catch (error) {
      setLogs((prev) => [...prev.slice(-119), `[ERROR] Failed to open path: ${String(error)}`]);
    }
  };

  const copyBrowserInstructions = async () => {
    const instructions = [
      '1. Open Chrome or Edge and navigate to chrome://extensions.',
      '2. Enable Developer mode.',
      '3. Choose Load unpacked.',
      '4. Select the chrome-extension folder from this repo.',
      '5. Keep the router and browser extension bridge running before testing.',
    ].join('\n');

    try {
      await window.electronAPI.copyText(instructions);
      setLogs((prev) => [...prev.slice(-119), '[INFO] Browser extension load instructions copied']);
    } catch (error) {
      setLogs((prev) => [...prev.slice(-119), `[ERROR] Failed to copy instructions: ${String(error)}`]);
    }
  };

  const openExtensionGuide = () => {
    void window.electronAPI.openURL('https://github.com/ifinsta/ifin-platform/blob/main/docs/INTEGRATIONS.md');
  };

  const openBrowserGuide = () => {
    void window.electronAPI.openURL('https://github.com/ifinsta/ifin-platform/blob/main/docs/BROWSER.md');
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'not_configured':
        return 'Not Configured';
      case 'invalid_config':
        return 'Invalid Config';
      case 'available':
        return 'Available';
      case 'configured':
        return 'Configured';
      case 'ready':
        return 'Ready';
      case 'connected':
        return 'Connected';
      case 'degraded':
        return 'Degraded';
      case 'error':
        return 'Error';
      default:
        return status;
    }
  };

  const openChecklistDestination = (itemId: string) => {
    if (itemId === 'local-api') {
      if (mcpServerStatus.running) {
        void stopMCPServer();
      } else {
        void startMCPServer();
      }
      return;
    }

    if (itemId === 'launcher' || itemId === 'client-configs' || itemId === 'ide-extension') {
      setActiveTab('integrations');
      return;
    }

    if (itemId === 'browser-bridge') {
      setActiveTab('browser');
    }
  };

  const renderWorkspaceActions = () => {
    if (activeTab === 'dashboard') {
      return !mcpServerStatus.running ? (
        <button type="button" className="btn-primary" onClick={startMCPServer}>
          Start Server
        </button>
      ) : (
        <button type="button" className="btn-danger" onClick={stopMCPServer}>
          Stop Server
        </button>
      );
    }

    if (activeTab === 'integrations') {
      return (
        <>
          <button type="button" className="btn-secondary" onClick={loadIntegrations}>
            Refresh
          </button>
        </>
      );
    }

    if (activeTab === 'browser') {
      return (
        <>
          <button type="button" className="btn-primary" onClick={() => setShowBrowserPairing(true)}>
            Setup Guide
          </button>
          <button type="button" className="btn-primary" onClick={saveBrowserConfig}>
            Save Browser Settings
          </button>
          <button type="button" className="btn-secondary" onClick={loadIntegrations}>
            Refresh
          </button>
        </>
      );
    }

    if (activeTab === 'logs') {
      return (
        <button type="button" className="btn-secondary" onClick={() => setLogs([])}>
          Clear Logs
        </button>
      );
    }

    if (activeTab === 'settings') {
      return (
        <div className="theme-switcher">
          <button
            type="button"
            className={`theme-button ${theme === 'dark' ? 'active' : ''}`}
            onClick={() => setTheme('dark')}
          >
            Dark
          </button>
          <button
            type="button"
            className={`theme-button ${theme === 'light' ? 'active' : ''}`}
            onClick={() => setTheme('light')}
          >
            Light
          </button>
        </div>
      );
    }

    return null;
  };

  const renderSidebarContext = () => (
    <div className="sidebar-context">
      <div className="context-card">
        <span className="context-label">Current View</span>
        <h2>{currentSection.label}</h2>
        <p>{currentSection.description}</p>
      </div>

      <div className="context-card">
        <span className="context-label">System Snapshot</span>
        <dl className="summary-grid">
          <div>
            <dt>Server</dt>
            <dd className={mcpServerStatus.running ? 'state-success' : 'state-danger'}>
              {mcpServerStatus.running ? 'Running' : 'Stopped'}
            </dd>
          </div>
          <div>
            <dt>Browsers</dt>
            <dd>{browserSummary.enabled} enabled</dd>
          </div>
          <div>
            <dt>Memory</dt>
            <dd>{formatMemory(systemInfo?.freeMemory)} free</dd>
          </div>
          <div>
            <dt>Theme</dt>
            <dd>{theme === 'dark' ? 'Dark' : 'Light'}</dd>
          </div>
        </dl>
      </div>

      <div className="context-card">
        <span className="context-label">Quick Access</span>
        <div className="context-actions">
          <button type="button" className="btn-secondary" onClick={() => setActiveTab('dashboard')}>
            Overview
          </button>
          <button type="button" className="btn-secondary" onClick={() => setActiveTab('integrations')}>
            Integrations
          </button>
          <button type="button" className="btn-secondary" onClick={() => setActiveTab('browser')}>
            Browser
          </button>
          <button type="button" className="btn-secondary" onClick={() => setActiveTab('logs')}>
            Logs
          </button>
        </div>
      </div>
    </div>
  );

  const renderOverview = () => (
    <div className="workspace-section">
      <div className="status-summary">
        <StatusCard
          icon="⚡"
          title="Mode"
          status="good"
          details={currentMode === 'router' ? 'Router Mode' : 'Agent Mode'}
        />
        <StatusCard
          icon="🔌"
          title="MCP Server"
            status={routerCardState.status}
            details={routerCardState.details}
        />
        <StatusCard
          icon="🌐"
          title="Browser Bridge"
          status={browserBridgeStatus === 'connected' ? 'good' : browserBridgeStatus === 'degraded' ? 'warning' : 'error'}
          details={browserBridgeStatus === 'connected' ? `Connected (${browserTabCount} tab${browserTabCount !== 1 ? 's' : ''})` : 'Not Connected'}
        />
        <StatusCard
          icon="🤖"
          title="Native Models"
          status={currentMode === 'router' ? 'good' : 'warning'}
          details={currentMode === 'router' ? 'Enabled (Router Mode)' : 'Disabled (Agent Mode)'}
        />
      </div>

      <div className="stats-grid">
        <div className="metric-panel">
          <span className="metric-label">System Readiness</span>
          <strong className="metric-value">{getStatusLabel(systemReadiness?.status || 'not_configured')}</strong>
          <span className="metric-detail">{systemReadiness?.summary || 'Readiness data is still loading.'}</span>
        </div>
        <div className="metric-panel">
          <span className="metric-label">Launcher Mode</span>
          <strong className="metric-value">{launcherMode.toUpperCase()}</strong>
          <span className="metric-detail">
            {systemReadiness?.resolvedLauncherMode
              ? `Resolved to ${systemReadiness.resolvedLauncherMode}`
              : 'No launcher target resolved'}
          </span>
        </div>
        <div className="metric-panel">
          <span className="metric-label">Local API</span>
          <strong className="metric-value">
            {getStatusLabel(systemReadiness?.planes.find((plane) => plane.id === 'localApi')?.status || 'degraded')}
          </strong>
          <span className="metric-detail">{localApiDetail}</span>
        </div>
        <div className="metric-panel">
          <span className="metric-label">Browser Bridge</span>
          <strong className={`metric-value ${mcpServerStatus.running ? 'state-success' : 'state-danger'}`}>
            {getStatusLabel(systemReadiness?.planes.find((plane) => plane.id === 'browserBridge')?.status || 'degraded')}
          </strong>
          <span className="metric-detail">
            {systemReadiness?.planes.find((plane) => plane.id === 'browserBridge')?.detail || 'No bridge status yet'}
          </span>
        </div>
      </div>

      <div className="content-grid two-column">
        <section className="panel-block">
          <div className="panel-header">
            <h3>Setup Checklist</h3>
            <span className="panel-note">Local system planes and integrations</span>
          </div>
          <div className="checklist-grid">
            {(systemReadiness?.checklist ?? []).map((item) => (
              <div key={item.id} className="checklist-card">
                <div className="integration-card-header">
                  <div>
                    <h4>{item.label}</h4>
                    <p>{item.summary}</p>
                  </div>
                  <span className={`status-pill status-${item.status}`}>{getStatusLabel(item.status)}</span>
                </div>
                <p className="integration-detail">{item.remediation}</p>
                <div className="integration-card-actions">
                  <button type="button" className="btn-secondary" onClick={() => openChecklistDestination(item.id)}>
                    {item.id === 'local-api'
                      ? mcpServerStatus.running
                        ? 'Restart'
                        : 'Start'
                      : item.id === 'browser-bridge'
                        ? 'Open Browser'
                        : 'Open Integrations'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="panel-block">
          <div className="panel-header">
            <h3>Local Environment</h3>
            <span className="panel-note">Host and runtime configuration</span>
          </div>
          <dl className="detail-stack">
            <div>
              <dt>Platform</dt>
              <dd>{systemInfo?.platform || 'Unknown'} {systemInfo?.version || ''}</dd>
            </div>
            <div>
              <dt>Architecture</dt>
              <dd>{systemInfo?.arch || 'Unknown'} / {systemInfo?.cpus || 0} cores</dd>
            </div>
            <div>
              <dt>Memory</dt>
              <dd>{formatMemory(systemInfo?.freeMemory)} free of {formatMemory(systemInfo?.totalMemory)}</dd>
            </div>
            <div>
              <dt>Server</dt>
              <dd>{mcpServerStatus.running ? `Running${mcpServerStatus.pid ? ` (PID ${mcpServerStatus.pid})` : ''}` : 'Stopped'}</dd>
            </div>
            <div>
              <dt>Browsers Enabled</dt>
              <dd>{browserSummary.enabled}</dd>
            </div>
            <div>
              <dt>App Version</dt>
              <dd>{appVersion || 'Unavailable'}</dd>
            </div>
          </dl>
        </section>
      </div>

      {systemReadiness?.warnings.length ? (
        <section className="panel-block">
          <div className="panel-header">
            <h3>Current Warnings</h3>
            <span className="panel-note">{systemReadiness.warnings.length} issue(s)</span>
          </div>
          <div className="warning-list">
            {systemReadiness.warnings.map((warning) => (
              <div key={warning} className="warning-row">
                {warning}
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );

  const renderIntegrations = () => (
    <Integrations
      launcherMode={launcherMode}
      integrationRecords={integrationRecords}
      integrationPreview={integrationPreview}
      integrationTestResult={integrationTestResult}
      onLauncherModeChange={setIntegrationLauncherMode}
      onPreview={previewIntegration}
      onApply={applyIntegration}
      onTest={testIntegration}
      onOpenPath={openIntegrationPath}
      onOpenExtensionGuide={openExtensionGuide}
      onRefresh={loadIntegrations}
    />
  );

  const renderBrowser = () => {
    const bridgePlane = systemReadiness?.planes.find((plane) => plane.id === 'browserBridge') ?? null;
    const localApiPlane = systemReadiness?.planes.find((plane) => plane.id === 'localApi') ?? null;

    return (
      <div className="workspace-section">
        <BrowserPreview />

        <div className="content-grid two-column">
          {browserExtensionRecord ? (
            <section className="panel-block">
              <div className="panel-header">
                <h3>Browser Extension</h3>
                <span className={`status-pill status-${browserExtensionRecord.status}`}>
                  {getStatusLabel(browserExtensionRecord.status)}
                </span>
              </div>
              <p className="panel-copy">{browserExtensionRecord.summary}</p>
              <div className="detail-stack compact">
                <div>
                  <dt>Path</dt>
                  <dd>{browserExtensionRecord.path || 'Unavailable'}</dd>
                </div>
                <div>
                  <dt>Bridge</dt>
                  <dd>{bridgePlane?.detail || 'No bridge status available'}</dd>
                </div>
              </div>
              <p className="integration-detail">{browserExtensionRecord.remediation}</p>
              <div className="integration-card-actions">
                {browserExtensionRecord.path ? (
                  <button type="button" className="btn-secondary" onClick={() => openIntegrationPath(browserExtensionRecord.path!)}>
                    Open Folder
                  </button>
                ) : null}
                <button type="button" className="btn-secondary" onClick={copyBrowserInstructions}>
                  Copy Load Instructions
                </button>
                <button type="button" className="btn-primary" onClick={() => testIntegration('browser-extension')}>
                  Test Bridge
                </button>
                <button type="button" className="btn-secondary" onClick={openBrowserGuide}>
                  Open Guide
                </button>
              </div>
            </section>
          ) : null}

          {bridgePlane ? (
            <section className="panel-block">
              <div className="panel-header">
                <h3>Runtime Planes</h3>
                <span className="panel-note">Bridge and local API</span>
              </div>
              <div className="plane-list">
                {[localApiPlane, bridgePlane].filter(Boolean).map((plane) => (
                  <div key={plane!.id} className="plane-card">
                    <div className="integration-card-header">
                      <div>
                        <h4>{plane!.label}</h4>
                        <p>{plane!.summary}</p>
                      </div>
                      <span className={`status-pill status-${plane!.status}`}>
                        {getStatusLabel(plane!.status)}
                      </span>
                    </div>
                    <p className="integration-detail">{plane!.detail}</p>
                    <p className="integration-detail">{plane!.remediation}</p>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>

        <section className="panel-block">
          <div className="panel-header">
            <h3>Managed Tabs</h3>
            <span className="panel-note">{browserTabs.length} tab{browserTabs.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="tabs-list" style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '300px', overflowY: 'auto' }}>
            {browserTabs.length === 0 ? (
              <div className="empty-state">No tabs available. Connect a browser to see managed tabs.</div>
            ) : (
              browserTabs.map((tab) => (
                <div
                  key={tab.tabId}
                  className="tab-item"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '12px',
                    background: tab.isActive ? 'rgba(63, 185, 80, 0.1)' : 'var(--bg-secondary)',
                    border: `1px solid ${tab.isActive ? 'var(--accent-green)' : 'var(--border-default)'}`,
                    borderRadius: '8px',
                  }}
                >
                  <span style={{ fontSize: '12px' }}>🌐</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '13px', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {tab.title || 'Untitled'}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {tab.url}
                    </div>
                  </div>
                  {tab.isActive && (
                    <span
                      style={{
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        background: 'var(--accent-green)',
                        boxShadow: '0 0 6px var(--accent-green)',
                      }}
                      title="Active tab"
                    />
                  )}
                </div>
              ))
            )}
          </div>
        </section>

        <section className="panel-block">
          <div className="panel-header">
            <h3>Automation Runtimes</h3>
            <div className="inline-actions">
              <button type="button" className="btn-primary" onClick={saveBrowserConfig}>
                Save Changes
              </button>
            </div>
          </div>
          <div className="integration-runtime-grid">
            {browserConfig &&
              runtimeRecords.map((record) => {
                const browserType = record.id.replace('runtime:', '') as BrowserType;
                const browser = browserConfig[browserType];

                return (
                  <section key={record.id} className="browser-card integration-runtime-card">
                    <div className="browser-header">
                      <div className="browser-info">
                        <h4>{record.label}</h4>
                        <span className="browser-version">{browser?.version || 'Not detected'}</span>
                      </div>
                      <span className={`status-pill status-${record.status}`}>
                        {getStatusLabel(record.status)}
                      </span>
                    </div>

                    <div className="browser-details">
                      <div className="detail-item">
                        <span className="detail-label">Path</span>
                        <span className="detail-value">{record.path || 'Not found'}</span>
                      </div>
                      <div className="detail-item">
                        <span className="detail-label">Enabled</span>
                        <span className="detail-value">{browser?.enabled ? 'Yes' : 'No'}</span>
                      </div>
                    </div>

                    <p className="integration-detail">{record.remediation}</p>

                    <div className="integration-card-actions">
                      <button type="button" className="btn-secondary" onClick={() => toggleBrowser(browserType)}>
                        {browser?.enabled ? 'Disable' : 'Enable'}
                      </button>
                      <button
                        type="button"
                        className={`btn-test ${browser?.status}`}
                        onClick={() => testBrowser(browserType)}
                        disabled={!browser?.enabled || !browser?.path}
                      >
                        {browser?.status === 'testing'
                          ? 'Testing'
                          : browser?.status === 'success'
                            ? 'Connected'
                            : browser?.status === 'error'
                              ? 'Failed'
                              : 'Test'}
                      </button>
                    </div>
                  </section>
                );
              })}
          </div>
        </section>
      </div>
    );
  };

  const renderLogs = () => (
    <div className="workspace-section">
      <section className="panel-block log-panel">
        <div className="panel-header">
          <h3>Recent Events</h3>
          <span className="panel-note">{logs.length} entries</span>
        </div>
        <div className="log-container">
          {logs.length === 0 ? (
            <div className="empty-state">No logs available.</div>
          ) : (
            logs.map((log, index) => (
              <div key={index} className={`log-entry ${log.startsWith('[ERROR]') ? 'error' : 'info'}`}>
                {log}
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );

  const handleModeSwitch = async (mode: 'agent' | 'router') => {
    await window.electronAPI.modeAPI.set(mode);
    setCurrentMode(mode);
    try {
      await fetch('http://localhost:3000/api/mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
    } catch { /* ignore */ }
  };

  const renderSettings = () => (
    <div className="workspace-section">
      <div className="settings-grid">
        {/* Mode Setting */}
        <section className="panel-block">
          <div className="panel-header">
            <h3>Operating Mode</h3>
            <span className="panel-note">Choose how ifin Platform manages your AI models</span>
          </div>
          <div className="mode-toggle">
            <button
              type="button"
              className={`mode-toggle-btn ${currentMode === 'agent' ? 'active' : ''}`}
              onClick={() => handleModeSwitch('agent')}
            >
              🤖 Agent Mode
            </button>
            <button
              type="button"
              className={`mode-toggle-btn ${currentMode === 'router' ? 'active' : ''}`}
              onClick={() => handleModeSwitch('router')}
            >
              🔀 Router Mode
            </button>
          </div>
        </section>

        <section className="panel-block">
          <div className="panel-header">
            <h3>Appearance</h3>
            <span className="panel-note">Renderer preference</span>
          </div>
          <div className="theme-picker">
            <button
              type="button"
              className={`theme-tile ${theme === 'dark' ? 'active' : ''}`}
              onClick={() => setTheme('dark')}
            >
              <strong>Dark</strong>
              <span>Default premium shell</span>
            </button>
            <button
              type="button"
              className={`theme-tile ${theme === 'light' ? 'active' : ''}`}
              onClick={() => setTheme('light')}
            >
              <strong>Light</strong>
              <span>Business daylight workspace</span>
            </button>
          </div>
        </section>

        <section className="panel-block">
          <div className="panel-header">
            <h3>Application</h3>
            <span className="panel-note">Runtime details</span>
          </div>
          <dl className="detail-stack">
            <div>
              <dt>Version</dt>
              <dd>{appVersion}</dd>
            </div>
            <div>
              <dt>Platform</dt>
              <dd>{systemInfo?.platform}</dd>
            </div>
            <div>
              <dt>Architecture</dt>
              <dd>{systemInfo?.arch}</dd>
            </div>
            <div>
              <dt>Configuration Path</dt>
              <dd>~/.mcp-router-browser.json</dd>
            </div>
          </dl>
        </section>

        <section className="panel-block">
          <div className="panel-header">
            <h3>Documentation</h3>
            <span className="panel-note">Repository reference</span>
          </div>
          <p className="panel-copy">
            Open the project documentation for IDE setup, browser extension workflows, and operational guidance.
          </p>
          <div className="inline-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => window.electronAPI.openURL('https://github.com/ifinsta/ifin-platform')}
            >
              Open Repository
            </button>
          </div>
        </section>
      </div>
    </div>
  );

  const renderContent = () => {
    if (activeTab === 'dashboard') {
      return renderOverview();
    }

    if (activeTab === 'integrations') {
      return renderIntegrations();
    }

    if (activeTab === 'browser') {
      return renderBrowser();
    }

    if (activeTab === 'logs') {
      return renderLogs();
    }

    return renderSettings();
  };

  if (!modeSelected) {
    return <ModeSelection onSelect={handleModeSelect} />;
  }

  if (showBrowserPairing) {
    return <BrowserPairing onClose={() => setShowBrowserPairing(false)} />;
  }

  return (
    <div className="app-shell" data-theme={theme}>
      <aside className="activity-rail" aria-label="Primary sections">
        <div className="activity-brand">
          <img
            className="brand-mark-image"
            src={theme === 'dark' ? 'assets/ifin-mark-dark.svg' : 'assets/ifin-mark-light.svg'}
            alt="ifin"
          />
        </div>
        <nav className="activity-nav">
          {sections.map((section) => (
            <button
              key={section.id}
              type="button"
              className={`activity-button ${activeTab === section.id ? 'active' : ''}`}
              onClick={() => setActiveTab(section.id)}
              title={section.label}
              aria-label={section.label}
            >
              {section.code}
            </button>
          ))}
        </nav>
        <div className="activity-footer">
          <button
            type="button"
            className="activity-button utility"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            aria-label="Toggle theme"
            title="Toggle theme"
          >
            {theme === 'dark' ? 'LT' : 'DK'}
          </button>
        </div>
      </aside>

      <aside className="shell-sidebar">
        <div className="sidebar-header">
          <div className="sidebar-brand">
            <img
              className="sidebar-logo"
              src={theme === 'dark' ? 'assets/ifin-logo-dark.svg' : 'assets/ifin-logo-light.svg'}
              alt="ifin Platform"
            />
            <div>
              <h1>ifin Platform</h1>
              <p>Local Control Console</p>
            </div>
          </div>
          <span className="version-tag">v{appVersion}</span>
        </div>

        <nav className="section-list" aria-label="Workspace navigation">
          {sections.map((section) => (
            <button
              key={section.id}
              type="button"
              className={`section-item ${activeTab === section.id ? 'active' : ''}`}
              onClick={() => setActiveTab(section.id)}
            >
              <strong>{section.label}</strong>
              <span>{section.description}</span>
            </button>
          ))}
        </nav>

        {renderSidebarContext()}
      </aside>

      <main className="workspace">
        <header className="workspace-header">
          <div className="workspace-title">
            <span className="workspace-caption">Workspace</span>
            <h2>{currentSection.heading}</h2>
            <p>{currentSection.description}</p>
          </div>
          <div className="workspace-actions">{renderWorkspaceActions()}</div>
        </header>

        <section className="workspace-content">{renderContent()}</section>
      </main>
    </div>
  );
}
