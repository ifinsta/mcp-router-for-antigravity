@echo off
REM Windows Build Script for MCP Router Browser Control Installer

echo ========================================
echo MCP Router Windows Build
echo ========================================
echo.

REM Clean previous builds
echo [1/6] Cleaning previous builds...
npm run clean
if errorlevel 1 (
    echo ERROR: Failed to clean previous builds.
    pause
    exit /b 1
)
echo Clean completed.
echo.

REM Install dependencies
echo [2/6] Installing dependencies...
npm ci
if errorlevel 1 (
    echo ERROR: Failed to install dependencies.
    pause
    exit /b 1
)
echo Dependencies installed.
echo.

REM Build TypeScript
echo [3/6] Building TypeScript...
npm run build
if errorlevel 1 (
    echo ERROR: Failed to build TypeScript.
    pause
    exit /b 1
)
echo TypeScript built successfully.
echo.

REM Build React frontend
echo [4/6] Building React frontend...
npm run build:renderer
if errorlevel 1 (
    echo ERROR: Failed to build React frontend.
    pause
    exit /b 1
)
echo React frontend built successfully.
echo.

REM Build Electron
echo [5/6] Building Electron...
npm run build:electron
if errorlevel 1 (
    echo ERROR: Failed to build Electron.
    pause
    exit /b 1
)
echo Electron built successfully.
echo.

REM Create installer
echo [6/6] Creating Windows installer...
npm run build:installer
if errorlevel 1 (
    echo ERROR: Failed to create installer.
    pause
    exit /b 1
)
echo Installer created successfully.
echo.

echo ========================================
echo Build completed successfully!
echo ========================================
echo.
echo Installer location: installers/MCP Router Browser Control Setup.exe
echo.
echo To test the installer:
echo 1. Navigate to installers directory
echo 2. Double-click MCP Router Browser Control Setup.exe
echo.
pause