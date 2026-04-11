# ifin Platform on Windows

This is the canonical Windows reference for local desktop development, packaging,
and installer verification.

## Requirements

- Windows 10 or Windows 11, 64-bit
- Node.js 20.10.0 or newer
- npm
- Chrome, Edge, or Firefox for browser-backed workflows

## Local Development

```bash
npm install
npm run doctor
npm run dev:all
```

To launch the desktop shell after building the router and renderer:

```bash
npm run start:electron
```

## Build an Installer

For a local installer-only build:

```bash
npm run build:installer
```

For the full local release path:

```bash
npm run release:local
```

Installer artifacts are written to `installers/`.

## Setup and Verification

Use the setup helper instead of hand-editing client config files:

```bash
npm run setup -- antigravity --mode repo
npm run setup -- cursor --mode repo
npm run setup -- qoder --mode repo
npm run setup -- codex --mode repo
npm run setup -- all --mode repo
```

Run `npm run doctor` after setup to verify:

- router build artifacts exist
- extension and desktop builds are present
- client MCP configs contain `mcp-router`
- Codex has an `mcp-router` registration
- Windows packaging prerequisites are intact

## Main Paths

- Router entrypoint: `dist/src/index.js`
- Browser configuration: `%USERPROFILE%\\.mcp-router-browser.json`
- Logs directory: `%USERPROFILE%\\.mcp-router-logs`
- Cache directory: `%USERPROFILE%\\.mcp-router-cache`
- Installer output: `installers\\`

For installed Windows app launchers, use the bundled `app.asar` router entrypoint
with `ELECTRON_RUN_AS_NODE=1`. Do not launch the packaged Electron binary with
`--mcp-stdio`.

## Troubleshooting

### Installer build fails

- Run `npm run doctor`
- Confirm `npm install` completed successfully
- Re-run `npm run build:all` before packaging if the desktop bundle is stale

### Desktop app starts but browser automation is unavailable

- Verify Chrome, Edge, or Firefox is installed locally
- Check `%USERPROFILE%\\.mcp-router-browser.json`
- Review logs for startup or connection errors

### The router starts from terminal mode but not in Electron

- Run `npm run build:all`
- Confirm `electron/dist/main.js` and `electron/renderer/dist/index.html` exist

## Related Documents

- [BROWSER.md](./BROWSER.md)
- [CLAUDE_CODE.md](./CLAUDE_CODE.md)
- [DEVELOPMENT.md](./DEVELOPMENT.md)
