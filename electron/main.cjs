const { app, BrowserWindow, clipboard, ipcMain, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const { pathToFileURL } = require('url');

function getRuntimeLogPath() {
  const appDataDir = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(appDataDir, 'ifin Platform', 'logs', 'main.log');
}

function formatErrorDetails(error) {
  if (error instanceof Error) {
    return error.stack || error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function logRuntime(message, error) {
  try {
    const logPath = getRuntimeLogPath();
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    const detail = error ? `\n${formatErrorDetails(error)}` : '';
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${message}${detail}\n`);
  } catch {
    // Logging must not break app startup.
  }
}

function buildBootstrapErrorPage(error) {
  const message = formatErrorDetails(error)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>ifin Platform Startup Error</title>
  <style>
    body {
      margin: 0;
      padding: 24px;
      background: #1e1e1e;
      color: #d4d4d4;
      font: 13px/1.5 "Segoe UI", sans-serif;
    }
    h1 {
      margin: 0 0 12px;
      font-size: 18px;
      font-weight: 600;
    }
    p {
      margin: 0 0 16px;
      color: #9da3ad;
    }
    pre {
      margin: 0;
      padding: 16px;
      border: 1px solid #31363f;
      background: #181818;
      color: #ce9178;
      white-space: pre-wrap;
      word-break: break-word;
      font: 12px/1.5 Consolas, "Courier New", monospace;
    }
  </style>
</head>
<body>
  <h1>Application startup failed</h1>
  <p>Review the log file in AppData\\Roaming\\ifin Platform\\logs for the full startup trace.</p>
  <pre>${message}</pre>
</body>
</html>`;
}

function getIntegrationSettingsPath() {
  return path.join(os.homedir(), '.mcp-router-integration-settings.json');
}

function readIntegrationSettings() {
  try {
    const parsed = JSON.parse(fs.readFileSync(getIntegrationSettingsPath(), 'utf-8'));
    return typeof parsed === 'object' && parsed !== null
      ? parsed
      : { launcherMode: 'auto', localApiPort: 3000, bridgePort: 9315 };
  } catch {
    return { launcherMode: 'auto', localApiPort: 3000, bridgePort: 9315 };
  }
}

function readLauncherMode() {
  const settings = readIntegrationSettings();
  return settings.launcherMode === 'installed' || settings.launcherMode === 'repo'
    ? settings.launcherMode
    : 'auto';
}

function writeLauncherMode(launcherMode) {
  const currentSettings = readIntegrationSettings();
  const nextSettings = { ...currentSettings, launcherMode };
  fs.mkdirSync(path.dirname(getIntegrationSettingsPath()), { recursive: true });
  fs.writeFileSync(getIntegrationSettingsPath(), JSON.stringify(nextSettings, null, 2));
  return nextSettings.launcherMode;
}

function readLocalApiPort() {
  const settings = readIntegrationSettings();
  return Number.isInteger(settings.localApiPort) && settings.localApiPort > 0
    ? settings.localApiPort
    : 3000;
}

function readBridgePort() {
  const settings = readIntegrationSettings();
  return Number.isInteger(settings.bridgePort) && settings.bridgePort > 0
    ? settings.bridgePort
    : 9315;
}

async function bootstrap() {
  logRuntime('Bootstrapping Electron main process');
  const { AssignmentManager } = await import(pathToFileURL(path.join(__dirname, '../dist/src/core/assignmentModes.js')).href);
  const { resolveElectronAssetPaths } = await import(pathToFileURL(path.join(__dirname, '../dist/src/infra/electronPaths.js')).href);
  const {
    createIntegrationContext,
    detectAllIntegrationRecords,
    detectRepoRoot,
    previewMcpClientConfig,
    applyMcpClientConfig,
    buildSystemReadiness,
  } = await import(pathToFileURL(path.join(__dirname, '../dist/src/integration/desktopIntegrations.js')).href);

  const assetPaths = resolveElectronAssetPaths(path.resolve(__dirname, '../dist/electron'));
  const assignmentManager = new AssignmentManager();
  const allAssignments = new Map();

  let mainWindow = null;
  let mcpServerProcess = null;
  const browserProcesses = new Map();

  const isDev = process.env.NODE_ENV === 'development';

  function resolveRepoRootForIntegrations() {
    const candidates = [
      process.cwd(),
      path.resolve(__dirname, '..'),
      path.resolve(__dirname, '../..'),
    ];

    for (const candidate of candidates) {
      const repoRoot = detectRepoRoot(candidate);
      if (repoRoot) {
        return repoRoot;
      }
    }

    return null;
  }

  function getIntegrationContext() {
    return createIntegrationContext({
      platform: process.platform,
      homedir: os.homedir(),
      appDataDir: process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
      localAppDataDir: process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
      repoRoot: resolveRepoRootForIntegrations(),
      installedExecutablePath: app.isPackaged ? process.execPath : null,
      localApiPort: readLocalApiPort(),
      bridgePort: readBridgePort(),
      env: process.env,
    });
  }

  async function readStoredBrowserConfig() {
    try {
      const configPath = path.join(os.homedir(), '.mcp-router-browser.json');
      const config = await fs.promises.readFile(configPath, 'utf-8');
      return JSON.parse(config);
    } catch {
      return getDefaultBrowserConfig();
    }
  }

  function getBrowserPathsSnapshot() {
    return {
      chrome: findChromePath(),
      edge: findEdgePath(),
      firefox: findFirefoxPath(),
      safari: findSafariPath(),
    };
  }

  async function previewIntegration(targetId, requestedMode) {
    const launcherMode = requestedMode || readLauncherMode();
    return previewMcpClientConfig(getIntegrationContext(), targetId, launcherMode);
  }

  async function testMcpIntegration(targetId, requestedMode) {
    const preview = await previewIntegration(targetId, requestedMode);
    if (!preview.command) {
      return {
        targetId,
        success: false,
        status: 'error',
        message: preview.reason || 'No launcher target is available.',
      };
    }

    return await new Promise((resolve) => {
      const child = spawn(preview.command, preview.args, {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '', ...preview.env },
        stdio: 'pipe',
        windowsHide: true,
      });

      let stderr = '';
      let resolved = false;

      const finish = (result) => {
        if (resolved) {
          return;
        }
        resolved = true;
        if (child.exitCode === null) {
          child.kill();
        }
        resolve(result);
      };

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('error', (error) => {
        finish({
          targetId,
          success: false,
          status: 'error',
          message: 'Failed to start MCP launcher.',
          detail: error instanceof Error ? error.message : String(error),
        });
      });

      child.on('exit', (code) => {
        finish({
          targetId,
          success: false,
          status: 'error',
          message: `Launcher exited early with code ${code ?? 'null'}.`,
          detail: stderr || null,
        });
      });

      setTimeout(() => {
        finish({
          targetId,
          success: true,
          status: 'connected',
          message: 'Launcher started and remained active long enough to accept MCP connections.',
          detail: preview.configPath || null,
        });
      }, 1500);
    });
  }

  async function testExtensionApi() {
    const localApiPort = readLocalApiPort();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    try {
      const response = await fetch(`http://127.0.0.1:${localApiPort}/health`, {
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        return {
          targetId: 'ide-extension',
          success: false,
          status: 'degraded',
          message: `Extension API responded with HTTP ${response.status}.`,
        };
      }

      return {
        targetId: 'ide-extension',
        success: true,
        status: 'connected',
        message: `Extension API is reachable on localhost:${localApiPort}.`,
      };
    } catch (error) {
      clearTimeout(timeout);
      return {
        targetId: 'ide-extension',
        success: false,
        status: 'degraded',
        message: 'Extension API is not reachable.',
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async function testBrowserExtensionBridge() {
    const bridgePort = readBridgePort();
    return await new Promise((resolve) => {
      const socket = net.connect({ host: '127.0.0.1', port: bridgePort });
      let finished = false;

      const finish = (result) => {
        if (finished) {
          return;
        }
        finished = true;
        socket.destroy();
        resolve(result);
      };

      socket.once('connect', () => {
        finish({
          targetId: 'browser-extension',
          success: true,
          status: 'connected',
          message: `Browser extension bridge is reachable on localhost:${bridgePort}.`,
        });
      });

      socket.once('error', (error) => {
        finish({
          targetId: 'browser-extension',
          success: false,
          status: 'degraded',
          message: 'Browser extension bridge is not reachable.',
          detail: error instanceof Error ? error.message : String(error),
        });
      });

      socket.setTimeout(2500, () => {
        finish({
          targetId: 'browser-extension',
          success: false,
          status: 'degraded',
          message: 'Browser extension bridge connection timed out.',
        });
      });
    });
  }

  async function runBrowserExecutableTest(browserType) {
    const browserPath = getBrowserExecutablePath(browserType);
    if (!browserPath) {
      return { success: false, error: `No ${browserType} executable found` };
    }

    const testProcess = spawn(browserPath, ['--version'], {
      stdio: 'pipe',
      windowsHide: true,
    });

    return await new Promise((resolve) => {
      let output = '';

      testProcess.stdout?.on('data', (data) => {
        output += data.toString();
      });

      testProcess.stderr?.on('data', (data) => {
        output += data.toString();
      });

      testProcess.on('close', (code) => {
        resolve({ success: code === 0, output, path: browserPath });
      });

      setTimeout(() => {
        testProcess.kill();
        resolve({ success: false, error: 'Timeout' });
      }, 10000);
    });
  }

  async function getReadinessSnapshot() {
    const [localApiResult, browserBridgeResult] = await Promise.all([
      testExtensionApi(),
      testBrowserExtensionBridge(),
    ]);

    return {
      localApi: {
        status: localApiResult.status,
        detail: localApiResult.detail || localApiResult.message,
      },
      browserBridge: {
        status: browserBridgeResult.status,
        detail: browserBridgeResult.detail || browserBridgeResult.message,
      },
    };
  }

  function createWindow() {
    mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      minWidth: 900,
      minHeight: 600,
      show: false,
      webPreferences: {
        preload: assetPaths.preloadScript,
        nodeIntegration: false,
        contextIsolation: true,
      },
      titleBarStyle: 'default',
      backgroundColor: '#1e1e1e',
      icon: assetPaths.appIcon,
    });

    mainWindow.once('ready-to-show', () => {
      mainWindow?.show();
    });

    mainWindow.webContents.on('did-finish-load', () => {
      logRuntime('Renderer finished loading');
    });

    mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      logRuntime(
        `Renderer failed to load (code=${errorCode}, mainFrame=${isMainFrame}, url=${validatedURL || 'unknown'})`,
        errorDescription
      );
    });

    mainWindow.webContents.on('render-process-gone', (_event, details) => {
      logRuntime(`Renderer process exited (reason=${details.reason}, exitCode=${details.exitCode})`);
    });

    mainWindow.on('unresponsive', () => {
      logRuntime('Main window became unresponsive');
    });

    if (isDev) {
      mainWindow.loadURL('http://localhost:3000').catch((error) => {
        logRuntime('Failed to load development renderer', error);
      });
      mainWindow.webContents.openDevTools();
    } else {
      mainWindow.loadFile(assetPaths.rendererIndexHtml).catch((error) => {
        logRuntime('Failed to load packaged renderer', error);
        mainWindow?.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildBootstrapErrorPage(error))}`);
      });
    }

    mainWindow.on('closed', () => {
      logRuntime('Main window closed');
      mainWindow = null;
    });

    return mainWindow;
  }

  ipcMain.handle('get-system-info', async () => ({
    platform: os.platform(),
    version: os.release(),
    arch: os.arch(),
    cpus: os.cpus().length,
    totalMemory: os.totalmem(),
    freeMemory: os.freemem(),
    homedir: os.homedir(),
  }));

  ipcMain.handle('get-browser-paths', async () => ({
    chrome: findChromePath(),
    edge: findEdgePath(),
    firefox: findFirefoxPath(),
    safari: findSafariPath(),
  }));

  ipcMain.handle('start-mcp-server', async (event, config) => {
    try {
      if (mcpServerProcess) {
        return { success: false, error: 'MCP server already running' };
      }

      mcpServerProcess = spawn(process.execPath, ['--mcp-stdio'], {
        stdio: 'pipe',
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '', ...(config?.env ?? {}) },
        windowsHide: true,
      });

      mcpServerProcess.stdout?.on('data', (data) => {
        event.sender.send('mcp-server-log', data.toString());
      });

      mcpServerProcess.stderr?.on('data', (data) => {
        event.sender.send('mcp-server-error', data.toString());
      });

      mcpServerProcess.on('close', (code) => {
        logRuntime(`MCP server process exited with code ${code ?? 'null'}`);
        mcpServerProcess = null;
        event.sender.send('mcp-server-stopped', { code });
      });

      return { success: true, pid: mcpServerProcess.pid };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  });

  ipcMain.handle('stop-mcp-server', async () => {
    if (mcpServerProcess) {
      mcpServerProcess.kill();
      mcpServerProcess = null;
      return { success: true };
    }
    return { success: false, error: 'MCP server not running' };
  });

  ipcMain.handle('get-mcp-server-status', async () => ({
    running: mcpServerProcess !== null,
    pid: mcpServerProcess?.pid ?? null,
  }));

  ipcMain.handle('configure-browsers', async (_event, config) => {
    try {
      const configPath = path.join(os.homedir(), '.mcp-router-browser.json');
      await fs.promises.writeFile(configPath, JSON.stringify(config, null, 2));
      return { success: true, path: configPath };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  });

  ipcMain.handle('get-browser-config', async () => {
    return await readStoredBrowserConfig();
  });

  ipcMain.handle('test-browser-connection', async (_event, browserType) => {
    try {
      return await runBrowserExecutableTest(browserType);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  });

  ipcMain.handle('open-url', async (_event, url) => {
    await shell.openExternal(url);
    return { success: true };
  });

  ipcMain.handle('open-path', async (_event, targetPath) => {
    const result = await shell.openPath(targetPath);
    return {
      success: result.length === 0,
      error: result || null,
    };
  });

  ipcMain.handle('copy-text', async (_event, value) => {
    clipboard.writeText(String(value ?? ''));
    return { success: true };
  });

  ipcMain.handle('get-app-version', async () => app.getVersion());

  ipcMain.handle('integration:get-launcher-mode', async () => ({
    success: true,
    launcherMode: readLauncherMode(),
  }));

  ipcMain.handle('integration:set-launcher-mode', async (_event, launcherMode) => {
    if (!['auto', 'installed', 'repo'].includes(launcherMode)) {
      return { success: false, error: 'Invalid launcher mode' };
    }

    return {
      success: true,
      launcherMode: writeLauncherMode(launcherMode),
    };
  });

  ipcMain.handle('integration:list', async () => {
    try {
      const launcherMode = readLauncherMode();
      const browserConfig = await readStoredBrowserConfig();
      const context = getIntegrationContext();
      const records = detectAllIntegrationRecords(
        context,
        launcherMode,
        getBrowserPathsSnapshot(),
        browserConfig?.browsers ?? null
      );
      const readiness = buildSystemReadiness(
        context,
        launcherMode,
        records,
        await getReadinessSnapshot()
      );

      return {
        success: true,
        launcherMode,
        records,
        readiness,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle('integration:preview', async (_event, targetId, requestedMode) => {
    try {
      return {
        success: true,
        preview: await previewIntegration(targetId, requestedMode),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle('integration:apply', async (_event, targetId, requestedMode, replaceInvalid) => {
    try {
      const launcherMode = requestedMode || readLauncherMode();
      const preview = applyMcpClientConfig(
        getIntegrationContext(),
        targetId,
        launcherMode,
        Boolean(replaceInvalid)
      );

      return {
        success: true,
        preview,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle('integration:test', async (_event, targetId, requestedMode) => {
    try {
      if (targetId === 'ide-extension') {
        return { success: true, result: await testExtensionApi() };
      }

      if (targetId === 'browser-extension') {
        return { success: true, result: await testBrowserExtensionBridge() };
      }

      if (String(targetId).startsWith('runtime:')) {
        const browserType = String(targetId).split(':')[1];
        const browserTest = await runBrowserExecutableTest(browserType);
        return {
          success: true,
          result: {
            targetId,
            success: Boolean(browserTest.success),
            status: browserTest.success ? 'connected' : 'degraded',
            message: browserTest.success
              ? `${browserType} executable responded successfully.`
              : browserTest.error || `${browserType} executable test failed.`,
            detail: browserTest.output || browserTest.path || null,
          },
        };
      }

      return { success: true, result: await testMcpIntegration(targetId, requestedMode) };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle('assignment:list', async () => {
    try {
      return { success: true, assignments: Array.from(allAssignments.values()) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  });

  ipcMain.handle('assignment:create', async (_event, config) => {
    try {
      const assignment = await assignmentManager.createAssignment(config);
      allAssignments.set(assignment.id, assignment);
      return { success: true, assignment };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  });

  ipcMain.handle('assignment:start', async (_event, assignmentId) => {
    try {
      const assignment = await assignmentManager.startAssignment(assignmentId);
      allAssignments.set(assignment.id, assignment);
      return { success: true, assignment };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  });

  ipcMain.handle('assignment:pause', async (_event, assignmentId) => {
    try {
      const current = assignmentManager.getCurrentAssignment();
      if (!current || current.id !== assignmentId) {
        return { success: false, error: 'Can only pause the current active assignment' };
      }

      const assignment = await assignmentManager.pauseAssignment();
      if (!assignment) {
        return { success: false, error: 'Failed to pause assignment' };
      }

      allAssignments.set(assignment.id, assignment);
      return { success: true, assignment };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  });

  ipcMain.handle('assignment:resume', async (_event, assignmentId) => {
    try {
      const assignment = await assignmentManager.resumeAssignment(assignmentId);
      allAssignments.set(assignment.id, assignment);
      return { success: true, assignment };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  });

  ipcMain.handle('assignment:complete-objective', async (_event, assignmentId, objectiveId, evidence) => {
    try {
      const current = assignmentManager.getCurrentAssignment();
      if (!current || current.id !== assignmentId) {
        return { success: false, error: 'Can only complete objectives on the current active assignment' };
      }

      const assignment = await assignmentManager.completeObjective(objectiveId, evidence);
      allAssignments.set(assignment.id, assignment);
      return { success: true, assignment };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  });

  ipcMain.handle('assignment:add-checkpoint', async (_event, objectiveId, description, evidence) => {
    try {
      const assignment = await assignmentManager.addCheckpoint(objectiveId, description, evidence);
      allAssignments.set(assignment.id, assignment);
      return { success: true, assignment };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  });

  ipcMain.handle('assignment:get-report', async (_event, assignmentId) => {
    try {
      return { success: true, report: assignmentManager.getAssignmentReport(assignmentId) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  });

  ipcMain.handle('assignment:cancel', async (_event, assignmentId) => {
    try {
      const assignment = await assignmentManager.cancelAssignment(assignmentId);
      allAssignments.set(assignment.id, assignment);
      return { success: true, assignment };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  });

  function findChromePath() {
    const possiblePaths = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(os.homedir(), 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'),
    ];

    return possiblePaths.find((browserPath) => fs.existsSync(browserPath)) ?? null;
  }

  function findEdgePath() {
    const possiblePaths = [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      path.join(os.homedir(), 'AppData\\Local\\Microsoft\\Edge\\Application\\msedge.exe'),
    ];

    return possiblePaths.find((browserPath) => fs.existsSync(browserPath)) ?? null;
  }

  function findFirefoxPath() {
    const possiblePaths = [
      'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
      'C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe',
      path.join(os.homedir(), 'AppData\\Local\\Mozilla Firefox\\firefox.exe'),
    ];

    return possiblePaths.find((browserPath) => fs.existsSync(browserPath)) ?? null;
  }

  function findSafariPath() {
    return null;
  }

  function getBrowserExecutablePath(browserType) {
    switch (browserType) {
      case 'chrome':
        return findChromePath();
      case 'edge':
        return findEdgePath();
      case 'firefox':
        return findFirefoxPath();
      case 'safari':
        return findSafariPath();
      default:
        return null;
    }
  }

  function getDefaultBrowserConfig() {
    return {
      browsers: {
        chrome: {
          enabled: true,
          path: findChromePath(),
          headless: true,
          userDataDir: null,
        },
        edge: {
          enabled: true,
          path: findEdgePath(),
          headless: true,
          userDataDir: null,
        },
        firefox: {
          enabled: true,
          path: findFirefoxPath(),
          headless: true,
          userDataDir: null,
        },
        safari: {
          enabled: false,
          path: null,
          headless: true,
          userDataDir: null,
        },
      },
      performance: {
        timeout: 30000,
        retryAttempts: 3,
        concurrentSessions: 5,
      },
      logging: {
        level: 'info',
        fileLogging: true,
        logPath: path.join(os.homedir(), '.mcp-router-logs'),
      },
    };
  }

  app.whenReady().then(() => {
    logRuntime('Electron app ready');
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });

  app.on('window-all-closed', () => {
    logRuntime('All windows closed');
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('before-quit', () => {
    logRuntime('Electron app quitting');
    if (mcpServerProcess) {
      mcpServerProcess.kill();
    }

    browserProcesses.forEach((processRef) => {
      processRef.kill();
    });
  });

  app.on('quit', () => {
    logRuntime('Electron app exited');
    mcpServerProcess = null;
    browserProcesses.clear();
  });
}

process.on('uncaughtException', (error) => {
  logRuntime('Uncaught exception in Electron main process', error);
});

process.on('unhandledRejection', (reason) => {
  logRuntime('Unhandled rejection in Electron main process', reason);
});

if (process.argv.includes('--mcp-stdio')) {
  import(pathToFileURL(path.join(__dirname, '../dist/src/index.js')).href).catch((error) => {
    logRuntime('Failed to start packaged stdio launcher', error);
    console.error('Failed to start packaged stdio launcher:', error);
    process.exit(1);
  });
} else {
  bootstrap().catch((error) => {
    logRuntime('Failed to bootstrap Electron app', error);
    console.error('Failed to bootstrap Electron app:', error);
    app.whenReady()
      .then(() => {
        const errorWindow = new BrowserWindow({
          width: 960,
          height: 640,
          minWidth: 720,
          minHeight: 480,
          backgroundColor: '#1e1e1e',
          title: 'ifin Platform Startup Error',
        });
        return errorWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildBootstrapErrorPage(error))}`);
      })
      .catch(() => {
        app.quit();
      });
  });
}
