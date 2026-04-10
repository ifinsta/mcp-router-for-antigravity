const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const { pathToFileURL } = require('url');

function getRuntimeLogPath() {
  const appDataDir = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(appDataDir, 'MCP Router Browser Control', 'logs', 'main.log');
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
  <title>MCP Router Startup Error</title>
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
  <p>Review the log file in AppData\\Roaming\\MCP Router Browser Control\\logs for the full startup trace.</p>
  <pre>${message}</pre>
</body>
</html>`;
}

async function bootstrap() {
  logRuntime('Bootstrapping Electron main process');
  const { AssignmentManager } = await import(pathToFileURL(path.join(__dirname, '../dist/src/core/assignmentModes.js')).href);
  const { resolveElectronAssetPaths } = await import(pathToFileURL(path.join(__dirname, '../dist/src/infra/electronPaths.js')).href);

  const assetPaths = resolveElectronAssetPaths(path.resolve(__dirname, '../dist/electron'));
  const assignmentManager = new AssignmentManager();
  const allAssignments = new Map();

  let mainWindow = null;
  let mcpServerProcess = null;
  const browserProcesses = new Map();

  const isDev = process.env.NODE_ENV === 'development';

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

      mcpServerProcess = spawn(process.execPath, [assetPaths.serverEntryScript], {
        stdio: 'pipe',
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ...(config?.env ?? {}) },
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
    try {
      const configPath = path.join(os.homedir(), '.mcp-router-browser.json');
      const config = await fs.promises.readFile(configPath, 'utf-8');
      return JSON.parse(config);
    } catch {
      return getDefaultBrowserConfig();
    }
  });

  ipcMain.handle('test-browser-connection', async (_event, browserType) => {
    try {
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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  });

  ipcMain.handle('open-url', async (_event, url) => {
    await shell.openExternal(url);
    return { success: true };
  });

  ipcMain.handle('get-app-version', async () => app.getVersion());

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
        title: 'MCP Router Startup Error',
      });
      return errorWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildBootstrapErrorPage(error))}`);
    })
    .catch(() => {
      app.quit();
    });
});
