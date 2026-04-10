; Custom NSIS installer script for ifin Platform

!macro preInit
  StrCpy $INSTDIR "$LOCALAPPDATA\Programs\ifin Platform"
!macroend

!macro customInstall
  ; Create configuration directory
  CreateDirectory "$PROFILE\.mcp-router-logs"
  CreateDirectory "$PROFILE\.mcp-router-cache"

  ; Write default configuration
  FileOpen $0 "$PROFILE\.mcp-router-browser.json" w
  FileWrite $0 "$\r$\n"
  FileWrite $0 "{$\r$\n"
  FileWrite $0 "  \"browsers\": {$\r$\n"
  FileWrite $0 "    \"chrome\": {\"enabled\": true, \"headless\": true},$\r$\n"
  FileWrite $0 "    \"edge\": {\"enabled\": true, \"headless\": true},$\r$\n"
  FileWrite $0 "    \"firefox\": {\"enabled\": true, \"headless\": true}$\r$\n"
  FileWrite $0 "  },$\r$\n"
  FileWrite $0 "  \"performance\": {$\r$\n"
  FileWrite $0 "    \"timeout\": 30000,$\r$\n"
  FileWrite $0 "    \"retryAttempts\": 3,$\r$\n"
  FileWrite $0 "    \"concurrentSessions\": 5$\r$\n"
  FileWrite $0 "  }$\r$\n"
  FileWrite $0 "}$\r$\n"
  FileClose $0

  ; Set up auto-start on Windows login
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Run" "ifinPlatform" '"$INSTDIR\ifin Platform.exe" --autostart'

  ; Configure Windows Firewall
  ExecWait 'netsh advfirewall firewall add rule name="ifin Platform" dir=in action=allow program="$INSTDIR\ifin Platform.exe"'
!macroend

!macro customUnInstall
  ; Remove auto-start
  DeleteRegValue HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Run" "ifinPlatform"

  ; Remove firewall rule
  ExecWait 'netsh advfirewall firewall delete rule name="ifin Platform"'

  ; Ask user if they want to keep configuration files
  MessageBox MB_YESNO "Do you want to keep configuration files?$\r$\n($PROFILE\.mcp-router-*)" IDNO keep_config
  Abort ; Skip cleanup if user wants to keep config

  keep_config:
  ; Remove configuration directories
  RMDir /r "$PROFILE\.mcp-router-logs"
  RMDir /r "$PROFILE\.mcp-router-cache"
  Delete "$PROFILE\.mcp-router-browser.json"
!macroend

; Modern UI 2.0
!include MUI2.nsh

; Installer configuration
Name "ifin Platform"
OutFile "ifin Platform Setup.exe"
InstallDir "$LOCALAPPDATA\Programs\ifin Platform"
RequestExecutionLevel user
ShowInstDetails show
ShowUnInstDetails show

; Interface settings
!define MUI_ABORTWARNING
!define MUI_ICON "assets\icon.ico"
!define MUI_UNICON "assets\icon.ico"
!define MUI_WELCOMEPAGE_TITLE "Welcome to ifin Platform Setup"
!define MUI_WELCOMEPAGE_TEXT "This will install ifin Platform on your computer.$\r$\n$\r$\nifin Platform provides browser automation capabilities for AI agents."
!define MUI_FINISHPAGE_TEXT "Setup has completed successfully.$\r$\n$\r$\nYou can now start ifin Platform from the Start menu or desktop shortcut."

; Pages
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "LICENSE"
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_WELCOME
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

; Languages
!insertmacro MUI_LANGUAGE "English"

; Installer sections
Section "Main Application" SEC_MAIN
  SetOutPath $INSTDIR
  File /r "dist\*"
  File /r "node_modules\*"
  File "package.json"
  File "electron\*"

  ; Create shortcuts
  CreateShortCut "$DESKTOP\ifin Platform.lnk" "$INSTDIR\ifin Platform.exe"
  CreateShortCut "$SMPROGRAMS\ifin Platform.lnk" "$INSTDIR\ifin Platform.exe"

  ; Write uninstaller
  WriteUninstaller "$INSTDIR\uninstall.exe"

SectionEnd

Section "Browser Configuration" SEC_BROWSERS
  SetOutPath $INSTDIR

  ; Auto-detect browsers and configure
  ExecWait '"$INSTDIR\ifin Platform.exe" --detect-browsers'

SectionEnd

Section "Documentation" SEC_DOCS
  SetOutPath $INSTDIR\docs
  File /r "docs\*"

SectionEnd

; Section descriptions
!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SEC_MAIN} "Install the main ifin Platform application."
  !insertmacro MUI_DESCRIPTION_TEXT ${SEC_BROWSERS} "Configure browser detection and automation settings."
  !insertmacro MUI_DESCRIPTION_TEXT ${SEC_DOCS} "Install documentation files."
!insertmacro MUI_FUNCTION_DESCRIPTION_END

; Uninstaller section
Section Uninstall
  ; Delete files and folders
  RMDir /r "$INSTDIR\dist"
  RMDir /r "$INSTDIR\docs"
  RMDir /r "$INSTDIR\node_modules"
  RMDir /r "$INSTDIR\electron"
  Delete "$INSTDIR\*.*"

  ; Delete shortcuts
  Delete "$DESKTOP\ifin Platform.lnk"
  Delete "$SMPROGRAMS\ifin Platform.lnk"

  ; Delete uninstaller
  Delete "$INSTDIR\uninstall.exe"

  ; Remove install directory
  RMDir "$INSTDIR"
SectionEnd
