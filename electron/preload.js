const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // System Information
  getSystemInfo: () => ipcRenderer.invoke('get-system-info'),
  getBrowserPaths: () => ipcRenderer.invoke('get-browser-paths'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),

  // MCP Server Control
  startMCPServer: (config) => ipcRenderer.invoke('start-mcp-server', config),
  stopMCPServer: () => ipcRenderer.invoke('stop-mcp-server'),
  getMCPServerStatus: () => ipcRenderer.invoke('get-mcp-server-status'),

  // Browser Configuration
  configureBrowsers: (config) => ipcRenderer.invoke('configure-browsers', config),
  getBrowserConfig: () => ipcRenderer.invoke('get-browser-config'),
  testBrowserConnection: (browserType) => ipcRenderer.invoke('test-browser-connection', browserType),

  // Utility
  openURL: (url) => ipcRenderer.invoke('open-url', url),
  openPath: (targetPath) => ipcRenderer.invoke('open-path', targetPath),
  copyText: (value) => ipcRenderer.invoke('copy-text', value),

  // Event listeners
  onMCPServerLog: (callback) => ipcRenderer.on('mcp-server-log', (event, message) => callback(message)),
  onMCPServerError: (callback) => ipcRenderer.on('mcp-server-error', (event, error) => callback(error)),
  onMCPServerStopped: (callback) => ipcRenderer.on('mcp-server-stopped', (event, data) => callback(data)),

  // Remove listeners
  removeAllListeners: () => ipcRenderer.removeAllListeners('mcp-server-log')
    .removeAllListeners('mcp-server-error')
    .removeAllListeners('mcp-server-stopped'),

  // Assignment API
  assignmentAPI: {
    list: () => ipcRenderer.invoke('assignment:list'),
    create: (config) => ipcRenderer.invoke('assignment:create', config),
    start: (id) => ipcRenderer.invoke('assignment:start', id),
    pause: (id) => ipcRenderer.invoke('assignment:pause', id),
    resume: (id) => ipcRenderer.invoke('assignment:resume', id),
    completeObjective: (assignmentId, objectiveId, evidence) => ipcRenderer.invoke('assignment:complete-objective', assignmentId, objectiveId, evidence),
    addCheckpoint: (objectiveId, description, evidence) => ipcRenderer.invoke('assignment:add-checkpoint', objectiveId, description, evidence),
    getReport: (id) => ipcRenderer.invoke('assignment:get-report', id),
    cancel: (id) => ipcRenderer.invoke('assignment:cancel', id)
  },

  // Integration API
  integrationAPI: {
    list: () => ipcRenderer.invoke('integration:list'),
    preview: (targetId, requestedMode) => ipcRenderer.invoke('integration:preview', targetId, requestedMode),
    apply: (targetId, requestedMode, replaceInvalid) => ipcRenderer.invoke('integration:apply', targetId, requestedMode, replaceInvalid),
    test: (targetId, requestedMode) => ipcRenderer.invoke('integration:test', targetId, requestedMode),
    openPath: (targetPath) => ipcRenderer.invoke('open-path', targetPath),
    getLauncherMode: () => ipcRenderer.invoke('integration:get-launcher-mode'),
    setLauncherMode: (launcherMode) => ipcRenderer.invoke('integration:set-launcher-mode', launcherMode),
  }
});
