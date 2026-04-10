@echo off
REM Windows Development Setup Script for MCP Router Browser Control

echo ========================================
echo MCP Router Windows Dev Setup
echo ========================================
echo.

REM Check Node.js version
echo [1/5] Checking Node.js version...
node --version
if errorlevel 1 (
    echo ERROR: Node.js is not installed. Please install Node.js 20+ from https://nodejs.org/
    pause
    exit /b 1
)
echo.

REM Check npm version
echo [2/5] Checking npm version...
npm --version
if errorlevel 1 (
    echo ERROR: npm is not installed.
    pause
    exit /b 1
)
echo.

REM Install dependencies
echo [3/5] Installing dependencies...
npm install
if errorlevel 1 (
    echo ERROR: Failed to install dependencies.
    pause
    exit /b 1
)
echo Dependencies installed successfully.
echo.

REM Build the project
echo [4/5] Building the project...
npm run build:all
if errorlevel 1 (
    echo ERROR: Failed to build the project.
    pause
    exit /b 1
)
echo Project built successfully.
echo.

REM Run tests
echo [5/5] Running tests...
npm run test:windows
if errorlevel 1 (
    echo WARNING: Some tests failed, but setup continues.
)
echo.

echo ========================================
echo Setup completed successfully!
echo ========================================
echo.
echo Next steps:
echo 1. Run the application: npm run start:electron
echo 2. Build the installer: npm run build:installer
echo 3. Full rebuild: npm run rebuild
echo.
pause