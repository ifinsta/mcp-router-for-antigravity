# ifin Platform on Windows

This guide is the canonical Windows reference for the Electron desktop application
and installer flow.

Use it when you need to:

- build the desktop app from source
- create a Windows installer
- run the packaged app locally
- find the main configuration and log locations
- verify that the MCP server and browser integration start correctly

## Requirements

- Windows 10 or Windows 11, 64-bit
- Node.js 20.10.0 or newer
- `pnpm` available on the command line
- Chrome, Edge, or Firefox installed if you want browser-backed features

## Build and Run From Source

Install dependencies:

```bash
pnpm install
```

Build the router and Electron renderer:

```bash
pnpm run build:all
```

Start the desktop application directly:

```bash
pnpm run start:electron
```

This is the fastest path for local development and verification.

## Build an Installer

Create the distributable package:

```bash
pnpm run build:installer
```

The installer is written to `installers/` with the product name and version in
the filename, for example `ifin Platform-1.1.0-setup.exe`.

If you want a clean end-to-end packaging run, use:

```bash
pnpm run package
```

## First Launch Checklist

On first launch, confirm the application can do the following:

1. Open without missing dependency errors.
2. Detect the browsers you expect to use.
3. Start the MCP server successfully.
4. Show logs without repeated startup failures.

If the app opens but browser features do not work, check executable paths and
browser availability before changing router code.

## Main Paths

Common Windows locations used by the application:

- Browser configuration: `%USERPROFILE%\\.mcp-router-browser.json`
- Logs directory: `%USERPROFILE%\\.mcp-router-logs`
- Cache directory: `%USERPROFILE%\\.mcp-router-cache`
- Installer output: `installers\\`

For MCP client launchers that target the installed Windows app, use the bundled
router entrypoint inside `app.asar` and set `ELECTRON_RUN_AS_NODE=1`. The
packaged Electron binary should not be launched with `--mcp-stdio`.

## Useful Commands

```bash
pnpm run build:all
pnpm run start:electron
pnpm run build:installer
pnpm run package
pnpm run test:windows
```

## Troubleshooting

### Installer build fails

- Confirm `pnpm install` completed successfully.
- Check that Electron build dependencies are installed.
- Re-run with a clean workspace using `pnpm run clean` if needed.

### Desktop app starts but browser automation is unavailable

- Verify Chrome, Edge, or Firefox is installed locally.
- Check the browser paths in `%USERPROFILE%\\.mcp-router-browser.json`.
- Review application logs for startup or connection errors.

### The router starts in terminal mode but not in Electron

- Run `pnpm run build:all` again to refresh the renderer bundle.
- Verify the Electron entry point exists at `electron/dist/main.js`.

## Related Documents

- [`BROWSER.md`](./BROWSER.md): browser-driven workflows
- [`CLAUDE_CODE.md`](./CLAUDE_CODE.md): MCP client setup guidance
- [`README.md`](./README.md): documentation index
