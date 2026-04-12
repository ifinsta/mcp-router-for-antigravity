import pkg from 'electron';
import type { BrowserWindow as BrowserWindowType } from 'electron';
const { app, BrowserWindow, ipcMain, shell } = pkg;
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import { fileURLToPath } from 'url';
import { AssignmentManager, Assignment } from '../src/core/assignmentModes.js';
import { resolveElectronAssetPaths } from '../src/infra/electronPaths.js';

// ESM-compatible __dirname and __filename
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const assetPaths = resolveElectronAssetPaths(__dirname);

// Assignment manager singleton
const assignmentManager = new AssignmentManager();

// Local tracking of all assignments (for list operation)
const allAssignments: Map<string, Assignment> = new Map();

// Global reference to browser windows
let mainWindow: BrowserWindowType | null = null;
let mcpServerProcess: ChildProcess | null = null;
let browserProcesses: Map<string, ChildProcess> = new Map();

// Development mode detection
const isDev = process.env['NODE_ENV'] === 'development';

function createWindow(): BrowserWindowType {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: assetPaths.preloadScript,
      nodeIntegration: false,
      contextIsolation: true,
    },
    titleBarStyle: 'default',
    backgroundColor: '#1a1a2e',
    icon: assetPaths.appIcon,
  });

  // Load the app
  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(assetPaths.rendererIndexHtml);
  }

  // Handle window closure
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

// IPC Handlers
ipcMain.handle('get-system-info', async () => {
  return {
    platform: os.platform(),
    version: os.release(),
    arch: os.arch(),
    cpus: os.cpus().length,
    totalMemory: os.totalmem(),
    freeMemory: os.freemem(),
    homedir: os.homedir(),
  };
});

ipcMain.handle('get-browser-paths', async () => {
  const browserPaths = {
    chrome: findChromePath(),
    edge: findEdgePath(),
    firefox: findFirefoxPath(),
    safari: findSafariPath(),
  };
  return browserPaths;
});

ipcMain.handle('start-mcp-server', async (event, config: any) => {
  try {
    if (mcpServerProcess) {
      return { success: false, error: 'MCP server already running' };
    }

    const nodePath = process.execPath;
    const serverScript = app.isPackaged
      ? path.join(
          path.dirname(process.execPath),
          'resources',
          'app.asar',
          'dist',
          'src',
          'index.js'
        )
      : assetPaths.serverEntryScript;

    mcpServerProcess = spawn(nodePath, [serverScript], {
      stdio: 'pipe',
      env: {
        ...process.env,
        ...(app.isPackaged ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
        ...config.env,
      },
    });

    mcpServerProcess.stdout?.on('data', (data) => {
      event.sender.send('mcp-server-log', data.toString());
    });

    mcpServerProcess.stderr?.on('data', (data) => {
      event.sender.send('mcp-server-error', data.toString());
    });

    mcpServerProcess.on('close', (code) => {
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

ipcMain.handle('get-mcp-server-status', async () => {
  return {
    running: mcpServerProcess !== null,
    pid: mcpServerProcess?.pid || null,
  };
});

ipcMain.handle('configure-browsers', async (event, config: any) => {
  try {
    const configPath = path.join(os.homedir(), '.ifin-platform-browser.json');
    await fs.promises.writeFile(configPath, JSON.stringify(config, null, 2));
    return { success: true, path: configPath };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
});

ipcMain.handle('get-browser-config', async () => {
  try {
    const configPath = path.join(os.homedir(), '.ifin-platform-browser.json');
    const config = await fs.promises.readFile(configPath, 'utf-8');
    return JSON.parse(config);
  } catch (error) {
    // Return default config if file doesn't exist
    return getDefaultBrowserConfig();
  }
});

ipcMain.handle('test-browser-connection', async (event, browserType: string) => {
  try {
    const browserPath = getBrowserExecutablePath(browserType);
    if (!browserPath) {
      return { success: false, error: `No ${browserType} executable found` };
    }

    const testProcess = spawn(browserPath, ['--version'], {
      stdio: 'pipe',
      windowsHide: true,
    });

    return new Promise((resolve) => {
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

ipcMain.handle('open-url', async (event, url: string) => {
  await shell.openExternal(url);
  return { success: true };
});

ipcMain.handle('get-app-version', async () => {
  return app.getVersion();
});

// ============================================================================
// Assignment IPC Handlers
// ============================================================================

ipcMain.handle('assignment:list', async () => {
  try {
    const assignments = Array.from(allAssignments.values());
    return { success: true, assignments };
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

ipcMain.handle('assignment:start', async (_event, assignmentId: string) => {
  try {
    const assignment = await assignmentManager.startAssignment(assignmentId);
    allAssignments.set(assignment.id, assignment);
    return { success: true, assignment };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
});

ipcMain.handle('assignment:pause', async (_event, assignmentId: string) => {
  try {
    const current = assignmentManager.getCurrentAssignment();
    if (!current || current.id !== assignmentId) {
      return { success: false, error: 'Can only pause the current active assignment' };
    }
    const assignment = await assignmentManager.pauseAssignment();
    if (assignment) {
      allAssignments.set(assignment.id, assignment);
      return { success: true, assignment };
    }
    return { success: false, error: 'Failed to pause assignment' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
});

ipcMain.handle('assignment:resume', async (_event, assignmentId: string) => {
  try {
    const assignment = await assignmentManager.resumeAssignment(assignmentId);
    allAssignments.set(assignment.id, assignment);
    return { success: true, assignment };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
});

ipcMain.handle(
  'assignment:complete-objective',
  async (_event, assignmentId: string, objectiveId: string, evidence?: string) => {
    try {
      const current = assignmentManager.getCurrentAssignment();
      if (!current || current.id !== assignmentId) {
        return {
          success: false,
          error: 'Can only complete objectives on the current active assignment',
        };
      }
      const assignment = await assignmentManager.completeObjective(objectiveId, evidence);
      allAssignments.set(assignment.id, assignment);
      return { success: true, assignment };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  }
);

ipcMain.handle(
  'assignment:add-checkpoint',
  async (_event, objectiveId: string, description: string, evidence?: string) => {
    try {
      const assignment = await assignmentManager.addCheckpoint(objectiveId, description, evidence);
      allAssignments.set(assignment.id, assignment);
      return { success: true, assignment };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  }
);

ipcMain.handle('assignment:get-report', async (_event, assignmentId: string) => {
  try {
    const report = assignmentManager.getAssignmentReport(assignmentId);
    return { success: true, report };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
});

ipcMain.handle('assignment:cancel', async (_event, assignmentId: string) => {
  try {
    const assignment = await assignmentManager.cancelAssignment(assignmentId);
    allAssignments.set(assignment.id, assignment);
    return { success: true, assignment };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
});

// Browser path detection functions
function findChromePath(): string | null {
  const possiblePaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(os.homedir(), 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function findEdgePath(): string | null {
  const possiblePaths = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    path.join(os.homedir(), 'AppData\\Local\\Microsoft\\Edge\\Application\\msedge.exe'),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function findFirefoxPath(): string | null {
  const possiblePaths = [
    'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
    'C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe',
    path.join(os.homedir(), 'AppData\\Local\\Mozilla Firefox\\firefox.exe'),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function findSafariPath(): string | null {
  // Safari is macOS only, return null for Windows
  return null;
}

function getBrowserExecutablePath(browserType: string): string | null {
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
      logPath: path.join(os.homedir(), '.ifin-platform-logs'),
    },
  };
}

// App lifecycle
app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  // Cleanup processes
  if (mcpServerProcess) {
    mcpServerProcess.kill();
  }
  browserProcesses.forEach((process) => {
    process.kill();
  });
});

app.on('quit', () => {
  // Final cleanup
  mcpServerProcess = null;
  browserProcesses.clear();
});
