#!/usr/bin/env node

/**
 * Windows Installer Builder for ifin Platform
 * Creates a professional Windows installer with automated setup
 */

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

class WindowsInstallerBuilder {
  constructor() {
    this.projectRoot = path.dirname(path.dirname(__dirname));
    this.buildDir = path.join(this.projectRoot, 'build');
    this.installerOutput = path.join(this.projectRoot, 'installers');
  }

  async build() {
    console.log('Building Windows Installer for ifin Platform');
    console.log('='.repeat(60));

    try {
      await this.prepareDirectories();
      await this.buildApplication();
      await this.createInstaller();
      await this.createQuickLaunch();
      await this.createLegacyCleanup();
      await this.generateManifest();
      await this.verifyBuild();

      console.log('\nWindows installer created successfully');
      console.log(`Installer location: ${this.installerOutput}`);
    } catch (error) {
      console.error('\nBuild failed:', error.message);
      throw error;
    }
  }

  async prepareDirectories() {
    console.log('\nPreparing build directories...');

    const directories = [
      this.buildDir,
      this.installerOutput,
      path.join(this.buildDir, 'win-unpacked'),
      path.join(this.buildDir, 'resources')
    ];

    for (const dir of directories) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`Created: ${dir}`);
      }
    }

    // Copy icon.ico to buildResources so electron-builder finds it by convention
    const sourceIcon = path.join(this.projectRoot, 'electron', 'icon.ico');
    const destIcon = path.join(this.buildDir, 'resources', 'icon.ico');
    if (fs.existsSync(sourceIcon)) {
      fs.copyFileSync(sourceIcon, destIcon);
      console.log(`Copied icon.ico to buildResources: ${destIcon}`);
    } else {
      console.warn('Warning: electron/icon.ico not found. Run `node scripts/generate-ifin-assets.cjs` first.');
    }
  }

  async buildApplication() {
    console.log('\nBuilding application...');
    console.log('  -> Compiling TypeScript...');
    await this.exec('pnpm run build');
    console.log('  -> Building React frontend...');
    await this.exec('pnpm run build:renderer');
    console.log('Application built successfully');
  }

  async createInstaller() {
    console.log('\nCreating Windows installer...');

    const electronBuilderConfig = {
      appId: 'com.ifinsta.ifin-platform',
      productName: 'ifin Platform',
      copyright: 'Copyright (c) 2024',
      extraMetadata: {
        main: 'electron/main.cjs'
      },
      directories: {
        buildResources: path.join(this.buildDir, 'resources'),
        output: this.installerOutput
      },
      files: [
        'dist/**/*',
        'node_modules/**/*',
        'package.json',
        'electron/**/*'
      ],
      win: {
        target: [
          {
            target: 'nsis',
            arch: ['x64']
          }
        ],
        icon: path.join(this.projectRoot, 'electron', 'icon.ico'),
        artifactName: '${productName}-${version}-setup.${ext}',
        sign: null,
        signDlls: null,
        signAndEditExecutable: null
      },
      nsis: {
        oneClick: false,
        allowElevation: true,
        allowToChangeInstallationDirectory: true,
        createDesktopShortcut: true,
        createStartMenuShortcut: true,
        shortcutName: 'ifin Platform',
        perMachine: true,
        runAfterFinish: false,
        deleteAppDataOnUninstall: false
      },
      publish: null
    };

    const configPath = path.join(this.projectRoot, 'electron-builder.json');
    fs.writeFileSync(configPath, JSON.stringify(electronBuilderConfig, null, 2));

    console.log('  -> Building NSIS installer...');
    await this.exec('npx electron-builder --win');
    console.log('Windows installer created');
  }

  async createQuickLaunch() {
    console.log('\nCreating Quick Launch utilities...');

    const quickLaunchScript = `
@echo off
echo Starting ifin Platform...
set "ELECTRON_RUN_AS_NODE="
set "PRIMARY_EXE=%ProgramFiles%\\ifin Platform\\ifin Platform.exe"
set "LEGACY_EXE=%LOCALAPPDATA%\\Programs\\ifin Platform\\ifin Platform.exe"
if exist "%PRIMARY_EXE%" (
  start "" "%PRIMARY_EXE%"
  exit /b 0
)
echo Installed application was not found at:
echo   %PRIMARY_EXE%
if exist "%LEGACY_EXE%" (
  echo.
  echo A legacy local install was detected at:
  echo   %LEGACY_EXE%
  echo Run cleanup-legacy-install.bat from the installers folder to remove it.
)
exit /b 1
`;

    const quickLaunchPath = path.join(this.installerOutput, 'quick-launch.bat');
    fs.writeFileSync(quickLaunchPath, quickLaunchScript.trim());
    console.log(`Created: ${quickLaunchPath}`);
  }

  async createLegacyCleanup() {
    console.log('\nCreating legacy cleanup utility...');

    const cleanupScript = `
@echo off
setlocal
set "LEGACY_DIR=%LOCALAPPDATA%\\Programs\\ifin Platform"

echo Removing legacy ifin Platform install...
if not exist "%LEGACY_DIR%" (
  echo No legacy install found at:
  echo   %LEGACY_DIR%
  exit /b 0
)

taskkill /IM "ifin Platform.exe" /F >nul 2>&1

if exist "%LEGACY_DIR%" (
  rmdir /s /q "%LEGACY_DIR%"
)

echo Legacy install cleanup complete.
exit /b 0
`;

    const cleanupPath = path.join(this.installerOutput, 'cleanup-legacy-install.bat');
    fs.writeFileSync(cleanupPath, cleanupScript.trim());
    console.log(`Created: ${cleanupPath}`);
  }

  async generateManifest() {
    console.log('\nGenerating installation manifest...');

    const manifest = {
      version: require(path.join(this.projectRoot, 'package.json')).version,
      buildDate: new Date().toISOString(),
      platform: 'windows',
      architecture: 'x64',
      components: {
        application: {
          name: 'ifin Platform',
          executable: 'ifin Platform.exe',
          installPath: '%ProgramFiles%\\ifin Platform',
          uninstallPath: '%ProgramFiles%\\ifin Platform\\Uninstall ifin Platform.exe'
        },
        mcpServer: {
          name: 'ifin Platform Server',
          executable: '%ProgramFiles%\\ifin Platform\\ifin Platform.exe',
          args: ['%ProgramFiles%\\ifin Platform\\resources\\app.asar\\dist\\src\\index.js'],
          env: {
            ELECTRON_RUN_AS_NODE: '1'
          },
          transport: 'stdio',
          timeout: 30000
        },
        browsers: {
          supported: ['chrome', 'edge', 'firefox'],
          autoDetect: true,
          configPath: '%USERPROFILE%\\.mcp-router-browser.json'
        }
      },
      features: {
        headlessMode: true,
        performanceMonitoring: true,
        networkSimulation: true,
        deviceEmulation: true,
        crossBrowser: true,
        multiTab: true
      },
      compatibility: {
        windows: ['10', '11'],
        node: '>=20.10.0',
        chrome: '>=90',
        edge: '>=90',
        firefox: '>=88'
      }
    };

    const manifestPath = path.join(this.installerOutput, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`Created: ${manifestPath}`);
  }

  async verifyBuild() {
    console.log('\nVerifying build...');

    const version = require(path.join(this.projectRoot, 'package.json')).version;
    const expectedFiles = [
      path.join(this.installerOutput, `ifin Platform-${version}-setup.exe`),
      path.join(this.installerOutput, 'manifest.json'),
      path.join(this.installerOutput, 'quick-launch.bat'),
      path.join(this.installerOutput, 'cleanup-legacy-install.bat')
    ];

    for (const file of expectedFiles) {
      if (!fs.existsSync(file)) {
        throw new Error(`Missing expected file: ${file}`);
      }

      const stats = fs.statSync(file);
      console.log(`Verified: ${path.basename(file)} (${this.formatSize(stats.size)})`);
    }
  }

  exec(command, options = {}) {
    return new Promise((resolve, reject) => {
      exec(command, { cwd: this.projectRoot, ...options }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`Command failed: ${command}\nError: ${error.message}\n${stderr}`));
          return;
        }

        resolve(stdout);
      });
    });
  }

  formatSize(bytes) {
    if (bytes === 0) {
      return '0 B';
    }

    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${Math.round((bytes / Math.pow(k, i)) * 100) / 100} ${sizes[i]}`;
  }
}

const builder = new WindowsInstallerBuilder();
builder.build().catch((error) => {
  console.error('Installer build failed:', error);
  process.exit(1);
});
