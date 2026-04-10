@echo off
setlocal
set "LEGACY_DIR=%LOCALAPPDATA%\Programs\ifin Platform"

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