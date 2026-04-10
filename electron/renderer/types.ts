// Shared types for Electron renderer

export interface AssignmentAPI {
  list: () => Promise<{ success: boolean; assignments?: any[]; error?: string }>;
  create: (config: any) => Promise<{ success: boolean; assignment?: any; error?: string }>;
  start: (id: string) => Promise<{ success: boolean; assignment?: any; error?: string }>;
  pause: (id: string) => Promise<{ success: boolean; assignment?: any; error?: string }>;
  resume: (id: string) => Promise<{ success: boolean; assignment?: any; error?: string }>;
  completeObjective: (assignmentId: string, objectiveId: string, evidence?: string) => Promise<{ success: boolean; assignment?: any; error?: string }>;
  addCheckpoint: (objectiveId: string, description: string, evidence?: string) => Promise<{ success: boolean; assignment?: any; error?: string }>;
  getReport: (id: string) => Promise<{ success: boolean; report?: any; error?: string }>;
  cancel: (id: string) => Promise<{ success: boolean; assignment?: any; error?: string }>;
}

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
export type ResolvedLauncherMode = 'installed' | 'repo';

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
  detail?: string | null | undefined;
}

export interface RuntimePlaneStatus {
  id: 'mcpLauncher' | 'localApi' | 'browserBridge';
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

export interface IntegrationAPI {
  list: () => Promise<{ success: boolean; launcherMode?: LauncherMode; records?: IntegrationRecord[]; readiness?: SystemReadiness; error?: string }>;
  preview: (
    targetId: string,
    requestedMode?: LauncherMode
  ) => Promise<{ success: boolean; preview?: IntegrationPreview; error?: string }>;
  apply: (
    targetId: string,
    requestedMode?: LauncherMode,
    replaceInvalid?: boolean
  ) => Promise<{ success: boolean; preview?: IntegrationPreview; error?: string }>;
  test: (
    targetId: string,
    requestedMode?: LauncherMode
  ) => Promise<{ success: boolean; result?: IntegrationTestResult; error?: string }>;
  openPath: (targetPath: string) => Promise<{ success: boolean; error?: string | null }>;
  getLauncherMode: () => Promise<{ success: boolean; launcherMode?: LauncherMode; error?: string }>;
  setLauncherMode: (
    launcherMode: LauncherMode
  ) => Promise<{ success: boolean; launcherMode?: LauncherMode; error?: string }>;
}

export interface ElectronAPI {
  // System APIs
  getSystemInfo: () => Promise<any>;
  getBrowserPaths: () => Promise<any>;
  getAppVersion: () => Promise<string>;
  
  // MCP Server APIs
  startMCPServer: (config: any) => Promise<any>;
  stopMCPServer: () => Promise<any>;
  getMCPServerStatus: () => Promise<any>;
  
  // Browser APIs
  configureBrowsers: (config: any) => Promise<any>;
  getBrowserConfig: () => Promise<any>;
  testBrowserConnection: (browserType: string) => Promise<any>;
  
  // Navigation
  openURL: (url: string) => Promise<any>;
  copyText: (value: string) => Promise<{ success: boolean }>;
  
  // Event listeners
  onMCPServerLog: (callback: (message: string) => void) => void;
  onMCPServerError: (callback: (error: string) => void) => void;
  onMCPServerStopped: (callback: (data: any) => void) => void;
  removeAllListeners: () => void;

  // File / shell
  openPath: (targetPath: string) => Promise<{ success: boolean; error?: string | null }>;
  
  // Assignment APIs
  assignmentAPI: AssignmentAPI;

  // Integration APIs
  integrationAPI: IntegrationAPI;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
