#!/usr/bin/env node

/**
 * Automated Setup Wizard for ifin Platform
 * Windows-specific installation and configuration
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface BrowserConfig {
  path: string | null;
  version: string;
  enabled: boolean;
}

interface SetupConfig {
  browsers: {
    chrome: BrowserConfig;
    edge: BrowserConfig;
    firefox: BrowserConfig;
  };
  installation: {
    appPath: string;
    configPath: string;
    logPath: string;
  };
  features: {
    headless: boolean;
    performanceMonitoring: boolean;
    networkSimulation: boolean;
    deviceEmulation: boolean;
  };
}

class SetupWizard {
  private config: SetupConfig;
  private homedir: string;
  private configPath: string;

  constructor() {
    this.homedir = os.homedir();
    this.configPath = path.join(this.homedir, '.mcp-router-browser.json');
    this.config = this.getDefaultConfig();
  }

  private getDefaultConfig(): SetupConfig {
    return {
      browsers: {
        chrome: { path: null, version: '', enabled: true },
        edge: { path: null, version: '', enabled: true },
        firefox: { path: null, version: '', enabled: true }
      },
      installation: {
        appPath: path.join(this.homedir, 'AppData', 'Local', 'MCPRouter'),
        configPath: this.configPath,
        logPath: path.join(this.homedir, 'AppData', 'Local', 'MCPRouter', 'logs')
      },
      features: {
        headless: true,
        performanceMonitoring: true,
        networkSimulation: true,
        deviceEmulation: true
      }
    };
  }

  async run(): Promise<void> {
    console.log('ifin Platform - Automated Setup Wizard');
    console.log('=' .repeat(50));

    try {
      await this.checkPrerequisites();
      await this.createDirectories();
      await this.detectBrowsers();
      await this.configureBrowsers();
      await this.installDependencies();
      await this.testConfiguration();
      await this.createShortcuts();
      await this.generateReport();

      console.log('✅ Setup completed successfully!');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('❌ Setup failed:', message);
      throw error;
    }
  }

  private async checkPrerequisites(): Promise<void> {
    console.log('\n📋 Checking prerequisites...');

    // Check Node.js
    try {
      const { stdout } = await execAsync('node --version');
      console.log(`✅ Node.js: ${stdout.trim()}`);
    } catch (error) {
      throw new Error('Node.js is required but not installed. Please install Node.js 20+');
    }

    // Check Windows version
    const platform = os.platform();
    if (platform !== 'win32') {
      throw new Error('This setup wizard is designed for Windows. Current platform: ' + platform);
    }
    console.log(`✅ Platform: Windows ${os.release()}`);

    // Check administrative privileges
    try {
      await execAsync('net session');
      console.log('✅ Administrative privileges detected');
    } catch (error) {
      console.log('Running without administrative privileges. Some features may be limited.');
    }
  }

  private async createDirectories(): Promise<void> {
    console.log('\n📁 Creating directories...');

    const directories = [
      this.config.installation.appPath,
      this.config.installation.logPath,
      path.join(this.homedir, '.mcp-router-logs'),
      path.join(this.homedir, '.mcp-router-cache')
    ];

    for (const dir of directories) {
      try {
        await fs.promises.mkdir(dir, { recursive: true });
        console.log(`✅ Created: ${dir}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to create directory ${dir}: ${message}`);
      }
    }
  }

  private async detectBrowsers(): Promise<void> {
    console.log('\n🌐 Detecting browsers...');

    // Detect Chrome
    const chromePath = await this.findBrowser('chrome');
    if (chromePath) {
      this.config.browsers.chrome.path = chromePath;
      this.config.browsers.chrome.version = await this.getBrowserVersion(chromePath);
      console.log(`✅ Chrome found: ${chromePath} (${this.config.browsers.chrome.version})`);
    } else {
      console.log('❌ Chrome not found');
      this.config.browsers.chrome.enabled = false;
    }

    // Detect Edge
    const edgePath = await this.findBrowser('edge');
    if (edgePath) {
      this.config.browsers.edge.path = edgePath;
      this.config.browsers.edge.version = await this.getBrowserVersion(edgePath);
      console.log(`✅ Edge found: ${edgePath} (${this.config.browsers.edge.version})`);
    } else {
      console.log('❌ Edge not found');
      this.config.browsers.edge.enabled = false;
    }

    // Detect Firefox
    const firefoxPath = await this.findBrowser('firefox');
    if (firefoxPath) {
      this.config.browsers.firefox.path = firefoxPath;
      this.config.browsers.firefox.version = await this.getBrowserVersion(firefoxPath);
      console.log(`✅ Firefox found: ${firefoxPath} (${this.config.browsers.firefox.version})`);
    } else {
      console.log('❌ Firefox not found');
      this.config.browsers.firefox.enabled = false;
    }
  }

  private async findBrowser(browserType: string): Promise<string | null> {
    const searchPaths = this.getBrowserSearchPaths(browserType);

    for (const searchPath of searchPaths) {
      try {
        if (fs.existsSync(searchPath)) {
          return searchPath;
        }
      } catch (error) {
        continue;
      }
    }

    return null;
  }

  private getBrowserSearchPaths(browserType: string): string[] {
    const programFiles = [
      'C:\\Program Files',
      'C:\\Program Files (x86)',
      path.join(this.homedir, 'AppData', 'Local')
    ];

    switch (browserType) {
      case 'chrome':
        return [
          'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
          path.join(this.homedir, 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe')
        ];
      case 'edge':
        return [
          'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
          'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
          path.join(this.homedir, 'AppData\\Local\\Microsoft\\Edge\\Application\\msedge.exe')
        ];
      case 'firefox':
        return [
          'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
          'C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe',
          path.join(this.homedir, 'AppData', 'Local\\Mozilla Firefox\\firefox.exe')
        ];
      default:
        return [];
    }
  }

  private async getBrowserVersion(browserPath: string): Promise<string> {
    try {
      const { stdout } = await execAsync(`wmic datafile where name="${browserPath.replace(/\\/g, '\\\\')}" get Version /value`);
      const match = stdout.match(/Version=([^\r\n]+)/);
      return match ? match[1] : 'Unknown';
    } catch (error) {
      return 'Unknown';
    }
  }

  private async configureBrowsers(): Promise<void> {
    console.log('\n⚙️  Configuring browsers...');

    // Save configuration
    await fs.promises.writeFile(
      this.configPath,
      JSON.stringify(this.config, null, 2)
    );
    console.log(`✅ Configuration saved to: ${this.configPath}`);

    // Set environment variables
    const envPath = path.join(this.homedir, '.env');
    const envContent = `
MCP_ROUTER_CONFIG=${this.configPath}
MCP_ROUTER_LOGS=${this.config.installation.logPath}
MCP_ROUTER_CACHE=${path.join(this.homedir, '.mcp-router-cache')}
NODE_ENV=production
`;

    await fs.promises.writeFile(envPath, envContent.trim());
    console.log(`✅ Environment variables set in: ${envPath}`);
  }

  private async installDependencies(): Promise<void> {
    console.log('\n📦 Installing dependencies...');

    try {
      const { stdout } = await execAsync('npm ci', { cwd: process.cwd() });
      console.log('✅ Dependencies installed successfully');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to install dependencies: ${message}`);
    }
  }

  private async testConfiguration(): Promise<void> {
    console.log('\n🧪 Testing configuration...');

    // Test configuration file
    try {
      const config = JSON.parse(await fs.promises.readFile(this.configPath, 'utf-8'));
      console.log('✅ Configuration file is valid');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Configuration file is invalid: ${message}`);
    }

    // Test browser executables
    for (const [browserType, browserConfig] of Object.entries(this.config.browsers)) {
      if (browserConfig.enabled && browserConfig.path) {
        try {
          await fs.promises.access(browserConfig.path, fs.constants.X_OK);
          console.log(`✅ ${browserType} executable is accessible`);
        } catch (error) {
          console.log(`❌ ${browserType} executable is not accessible`);
        }
      }
    }
  }

  private async createShortcuts(): Promise<void> {
    console.log('\n🔗 Creating shortcuts...');

    const desktopPath = path.join(this.homedir, 'Desktop');
    const startMenuPath = path.join(os.homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs');

    // Create desktop shortcut
    const desktopShortcut = path.join(desktopPath, 'ifin Platform.lnk');
    // Note: Creating actual Windows shortcuts requires PowerShell or VBScript
    console.log(`📋 Desktop shortcut would be created at: ${desktopShortcut}`);

    // Create start menu shortcut
    const startMenuShortcut = path.join(startMenuPath, 'ifin Platform.lnk');
    console.log(`📋 Start menu shortcut would be created at: ${startMenuShortcut}`);
  }

  private async generateReport(): Promise<void> {
    console.log('\n📊 Setup Report');
    console.log('=' .repeat(50));

    console.log('\n📁 Installation Paths:');
    console.log(`  Application: ${this.config.installation.appPath}`);
    console.log(`  Configuration: ${this.config.installation.configPath}`);
    console.log(`  Logs: ${this.config.installation.logPath}`);

    console.log('\n🌐 Detected Browsers:');
    for (const [browserType, config] of Object.entries(this.config.browsers)) {
      const status = config.enabled ? '✅' : '❌';
      console.log(`  ${status} ${browserType.charAt(0).toUpperCase() + browserType.slice(1)}: ${config.version || 'Not found'}`);
    }

    console.log('\n⚙️  Enabled Features:');
    console.log(`  ${this.config.features.headless ? '✅' : '❌'} Headless Mode`);
    console.log(`  ${this.config.features.performanceMonitoring ? '✅' : '❌'} Performance Monitoring`);
    console.log(`  ${this.config.features.networkSimulation ? '✅' : '❌'} Network Simulation`);
    console.log(`  ${this.config.features.deviceEmulation ? '✅' : '❌'} Device Emulation`);

    console.log('\n📝 Next Steps:');
    console.log('  1. Start the application using the desktop shortcut');
    console.log('  2. Configure browser preferences in the settings panel');
    console.log('  3. Test browser connections');
    console.log('  4. Start using browser automation tools');
  }
}

// Run setup wizard
const wizard = new SetupWizard();
wizard.run().catch(error => {
  console.error('Setup wizard failed:', error);
  process.exit(1);
});
