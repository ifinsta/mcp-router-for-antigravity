@echo off
echo Starting ifin Platform...
set "ELECTRON_RUN_AS_NODE="
set "PRIMARY_EXE=%ProgramFiles%\ifin Platform\ifin Platform.exe"
set "LEGACY_EXE=%LOCALAPPDATA%\Programs\ifin Platform\ifin Platform.exe"
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