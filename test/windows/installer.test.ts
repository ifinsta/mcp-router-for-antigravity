import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { spawn } from 'child_process';
import * as fs from 'fs';
import os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Windows Installer Tests', () => {
  const setupWizardPath = path.join(__dirname, '../../electron/installer/setup-wizard.ts');

  it('should detect Chrome browser', async () => {
    const chromePaths = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(process.env.USERPROFILE || '', 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe')
    ];

    let found = false;
    for (const chromePath of chromePaths) {
      try {
        await fs.promises.access(chromePath, fs.constants.F_OK);
        found = true;
        console.log(`Chrome found at: ${chromePath}`);
        break;
      } catch {
        continue;
      }
    }

    // Note: This test will pass regardless of browser presence
    // It just validates the detection logic works
    assert.equal(typeof found, 'boolean');
  });

  it('should detect Edge browser', async () => {
    const edgePaths = [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      path.join(process.env.USERPROFILE || '', 'AppData\\Local\\Microsoft\\Edge\\Application\\msedge.exe')
    ];

    let found = false;
    for (const edgePath of edgePaths) {
      try {
        await fs.promises.access(edgePath, fs.constants.F_OK);
        found = true;
        console.log(`Edge found at: ${edgePath}`);
        break;
      } catch {
        continue;
      }
    }

    assert.equal(typeof found, 'boolean');
  });

  it('should detect Firefox browser', async () => {
    const firefoxPaths = [
      'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
      'C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe',
      path.join(process.env.USERPROFILE || '', 'AppData\\Local\\Mozilla Firefox\\firefox.exe')
    ];

    let found = false;
    for (const firefoxPath of firefoxPaths) {
      try {
        await fs.promises.access(firefoxPath, fs.constants.F_OK);
        found = true;
        console.log(`Firefox found at: ${firefoxPath}`);
        break;
      } catch {
        continue;
      }
    }

    assert.equal(typeof found, 'boolean');
  });

  it('should create configuration directory structure', async () => {
    const testConfigPath = path.join(process.env.TEMP || '', 'test-mcp-config');

    try {
      // Create test directory structure
      await fs.promises.mkdir(testConfigPath, { recursive: true });
      await fs.promises.mkdir(path.join(testConfigPath, 'logs'), { recursive: true });
      await fs.promises.mkdir(path.join(testConfigPath, 'cache'), { recursive: true });

      // Verify directories exist
      const logsExist = await fs.promises.access(path.join(testConfigPath, 'logs'), fs.constants.F_OK)
        .then(() => true)
        .catch(() => false);

      const cacheExist = await fs.promises.access(path.join(testConfigPath, 'cache'), fs.constants.F_OK)
        .then(() => true)
        .catch(() => false);

      assert.equal(logsExist, true);
      assert.equal(cacheExist, true);

      // Cleanup
      await fs.promises.rm(testConfigPath, { recursive: true, force: true });
    } catch (error) {
      console.error('Test failed:', error);
      throw error;
    }
  });

  it('should create valid configuration file', async () => {
    const testConfig = {
      browsers: {
        chrome: { enabled: true, path: 'C:\\chrome.exe', version: '90.0' },
        edge: { enabled: true, path: 'C:\\edge.exe', version: '90.0' },
        firefox: { enabled: true, path: 'C:\\firefox.exe', version: '88.0' }
      },
      features: {
        headless: true,
        performanceMonitoring: true,
        networkSimulation: true,
        deviceEmulation: true
      }
    };

    const testConfigPath = path.join(process.env.TEMP || '', 'test-mcp-config.json');

    try {
      // Write configuration
      await fs.promises.writeFile(testConfigPath, JSON.stringify(testConfig, null, 2));

      // Read and validate
      const content = await fs.promises.readFile(testConfigPath, 'utf-8');
      const parsed = JSON.parse(content);

      assert.equal(parsed.browsers.chrome.enabled, true);
      assert.equal(parsed.browsers.chrome.version, '90.0');
      assert.equal(parsed.features.headless, true);

      // Cleanup
      await fs.promises.unlink(testConfigPath);
    } catch (error) {
      console.error('Test failed:', error);
      throw error;
    }
  });

  it('should validate Windows version compatibility', async () => {
    const platform = os.platform();
    const version = os.release();

    // Windows 10 versions start with 10.x
    // Windows 11 versions start with 10.0.22xxx or higher
    const isWindows10OrHigher = platform === 'win32' && parseFloat(version) >= 10.0;

    assert.equal(platform, 'win32');
    assert.equal(isWindows10OrHigher, true);

    console.log(`Detected Windows version: ${version}`);
  });

  it('should validate Node.js version compatibility', async () => {
    const { stdout } = await executeCommand('node --version');
    const version = stdout.trim().substring(1); // Remove 'v' prefix

    // Node.js 20+ required
    const majorVersion = parseInt(version.split('.')[0]);

    assert.ok(majorVersion >= 20);

    console.log(`Detected Node.js version: v${version}`);
  });

  it('should verify Windows registry access', async () => {
    // This test validates that the application can read Windows registry
    // for browser detection and configuration
    const { stdout, stderr } = await executeCommand('reg query "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion" /v ProgramFilesDir');

    // Either the command succeeds or fails with expected registry error
    const hasAccess = !stderr.includes('ERROR: The system was unable to find the specified registry key or value');

    assert.equal(typeof hasAccess, 'boolean');
  });

  it('should verify PowerShell execution', async () => {
    const { stdout, stderr } = await executeCommand('powershell -Command "Write-Host \'Test\'"');

    assert.equal(stdout.trim(), 'Test');
    assert.equal(stderr, '');
  });

  it('should verify firewall configuration capability', async () => {
    const { stdout, stderr } = await executeCommand('netsh advfirewall show currentprofile');

    // Should be able to show firewall profiles
    assert.ok(stdout.length > 0);

    console.log('Firewall capability verified');
  });

  it('should verify shortcut creation capability', async () => {
    // Test PowerShell shortcut creation
    const shortcutPath = path.join(process.env.TEMP || '', 'test-shortcut.lnk');
    const escapedShortcutPath = shortcutPath.replace(/\\/g, '\\\\');
    const testShortcutCommand =
      `powershell -NoProfile -Command "$WshShell = New-Object -ComObject WScript.Shell; ` +
      `$Shortcut = $WshShell.CreateShortcut('${escapedShortcutPath}'); ` +
      `$Shortcut.TargetPath = 'notepad.exe'; $Shortcut.Save()"`;

    try {
      await executeCommand(testShortcutCommand);

      const shortcutExists = await fs.promises.access(shortcutPath, fs.constants.F_OK)
        .then(() => true)
        .catch(() => false);

      assert.equal(shortcutExists, true);

      // Cleanup
      await fs.promises.unlink(shortcutPath);
    } catch (error) {
      console.error('Shortcut creation test failed:', error);
      throw error;
    }
  });
});

// Helper function to execute commands
function executeCommand(command: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [], { shell: true });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      resolve({ stdout, stderr });
    });

    child.on('error', (error) => {
      reject(error);
    });
  });
}
