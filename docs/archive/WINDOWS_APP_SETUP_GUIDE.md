# Windows Application Setup Guide

Use this file as the short installer checklist. The broader Windows reference
now lives in [`../WINDOWS.md`](../WINDOWS.md).

## Build the Installer

From the repository root:

```bash
pnpm install
pnpm run build:all
pnpm run build:installer
```

The generated installer is placed in `installers/`.

## Install

1. Open the generated `.exe` from `installers/`.
2. Complete the installer flow.
3. Start the app from the installation directory or desktop shortcut if one is created.

## Verify

After first launch, confirm:

1. The application opens without a missing-bundle error.
2. At least one supported browser is detected.
3. The embedded MCP server starts successfully.
4. Logs do not show repeated startup failures.

## Common Paths

- Browser config: `%USERPROFILE%\\.mcp-router-browser.json`
- Logs: `%USERPROFILE%\\.mcp-router-logs`
- Cache: `%USERPROFILE%\\.mcp-router-cache`

## If Setup Fails

- Rebuild with `pnpm run build:all`.
- Recreate the installer with `pnpm run build:installer`.
- Check browser executable paths in the config file.
- See [`../WINDOWS.md`](../WINDOWS.md) for troubleshooting details.
