#!/usr/bin/env node

/**
 * Simple Electron Packager Script
 * Creates a basic Windows package without the winCodeSign issue
 */

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

class SimplePackager {
  constructor() {
    this.projectRoot = process.cwd();
    this.packageDir = path.join(this.projectRoot, 'installers', 'MCP Router Browser Control-win32-x64');
  }

  async package() {
    console.log('Simple Electron Packaging');
    console.log('='.repeat(50));

    try {
      await this.createPackage();
      await this.createInstaller();
      console.log('\nPackaging complete');
      console.log(`Package location: ${this.packageDir}`);
    } catch (error) {
      console.error('\nPackaging failed:', error.message);
      throw error;
    }
  }

  async createPackage() {
    console.log('\nCreating Windows package...');

    const command =
      'npx electron-packager . "MCP Router Browser Control" --platform=win32 --arch=x64 --out=installers --overwrite --icon=electron/icon.ico --ignore=installers --ignore=.git --ignore=node_modules/.cache --ignore=test';

    console.log('Running:', command);
    await this.exec(command);
    console.log('Package created');
  }

  async createInstaller() {
    console.log('\nCreating simple installer...');

    const installerScript = `@echo off
echo ========================================
echo MCP Router Browser Control Setup
echo ========================================
echo.

set "INSTALL_DIR=%ProgramFiles%\\MCP Router Browser Control"
set "START_MENU_DIR=%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs"

echo Creating installation directory...
if not exist "%INSTALL_DIR%" (
    mkdir "%INSTALL_DIR%"
)

echo Copying files...
xcopy /E /I /Y ".\\*" "%INSTALL_DIR%"

echo Creating desktop shortcut...
powershell -Command "$s=(New-Object -COM WScript.Shell).CreateShortcut('%USERPROFILE%\\Desktop\\MCP Router Browser Control.lnk');$s.TargetPath='%INSTALL_DIR%\\MCP Router Browser Control.exe';$s.Save()"

echo Creating Start Menu shortcut...
powershell -Command "$s=(New-Object -COM WScript.Shell).CreateShortcut('%START_MENU_DIR%\\MCP Router Browser Control.lnk');$s.TargetPath='%INSTALL_DIR%\\MCP Router Browser Control.exe';$s.Save()"

echo.
echo ========================================
echo Installation Complete!
echo ========================================
echo.
echo MCP Router Browser Control has been installed to:
echo %INSTALL_DIR%
echo.
echo Shortcuts created on:
echo - Desktop
echo - Start Menu
echo.

pause
`;

    const installerPath = path.join(this.packageDir, 'install.bat');
    fs.writeFileSync(installerPath, installerScript);
    console.log(`Created installer: ${installerPath}`);

    const uninstallerScript = `@echo off
echo ========================================
echo MCP Router Browser Control Uninstaller
echo ========================================
echo.

set "INSTALL_DIR=%ProgramFiles%\\MCP Router Browser Control"

echo Removing application...
if exist "%INSTALL_DIR%" (
    rmdir /s /q "%INSTALL_DIR%"
    echo Removed: %INSTALL_DIR%
)

echo Removing shortcuts...
if exist "%USERPROFILE%\\Desktop\\MCP Router Browser Control.lnk" (
    del "%USERPROFILE%\\Desktop\\MCP Router Browser Control.lnk"
    echo Removed desktop shortcut
)

if exist "%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\MCP Router Browser Control.lnk" (
    del "%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\MCP Router Browser Control.lnk"
    echo Removed Start Menu shortcut
)

echo.
echo ========================================
echo Uninstallation Complete!
echo ========================================
echo.

pause
`;

    const uninstallerPath = path.join(this.packageDir, 'uninstall.bat');
    fs.writeFileSync(uninstallerPath, uninstallerScript);
    console.log(`Created uninstaller: ${uninstallerPath}`);

    const readme = `# MCP Router Browser Control

## Installation

1. Run \`install.bat\` as administrator
2. Follow the on-screen prompts
3. The application will be installed to: \`%ProgramFiles%\\MCP Router Browser Control\`
4. Shortcuts will be created on your Desktop and Start Menu

## Uninstallation

1. Run \`uninstall.bat\` as administrator
2. All files and shortcuts will be removed

## Running the Application

You can run the application from:
- Desktop shortcut: "MCP Router Browser Control"
- Start Menu: "MCP Router Browser Control"
- Direct executable: \`%ProgramFiles%\\MCP Router Browser Control\\MCP Router Browser Control.exe\`

## Version

Current version: ${require(path.join(this.projectRoot, 'package.json')).version}
`;

    const readmePath = path.join(this.packageDir, 'README_INSTALL.txt');
    fs.writeFileSync(readmePath, readme);
    console.log(`Created installation README: ${readmePath}`);
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
}

const packager = new SimplePackager();
packager.package().catch((error) => {
  console.error('Packaging failed:', error);
  process.exit(1);
});
