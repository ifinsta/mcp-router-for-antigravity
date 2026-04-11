# Development Setup

## Canonical Workflow

```bash
npm install
cp .env.example .env
npm run doctor
npm run dev:all
```

Use `npm` as the single package manager for this repository. The default daily loop is:

- `npm run dev:router` for router TypeScript watch
- `npm run dev:extension` for the VS Code extension watch build
- `npm run dev:desktop` for the Electron renderer watch build
- `npm run dev:all` to run all three together

When you want to open the desktop shell after building the router and renderer:

```bash
npm run start:electron
```

## Setup and Validation

Use the root setup and doctor commands instead of hand-editing client configs:

```bash
npm run setup -- qoder --mode repo
npm run setup -- cursor --mode repo
npm run setup -- codex --mode repo
npm run setup -- all --mode repo
npm run doctor
```

`npm run doctor` is read-only. It checks toolchain state, build artifacts, `.env`,
client MCP config status, Codex registration, and Windows packaging prerequisites.

## Build and Release Commands

```bash
# Router
npm run build
npm run start

# IDE extension release artifact
npm run build:ide-extension
npm run test:ide-extension
npm run package:ide-extension

# Desktop packaging
npm run build:all
npm run build:installer

# Full local release verification
npm run release:local
```

For normal extension iteration, use `npm run dev:extension` and launch an Extension
Development Host from VS Code instead of packaging a VSIX on every change.

## Project Structure

```text
ifin-platform/
├── src/                  # Router server, core, providers, infra
├── extension/            # VS Code-compatible extension
├── electron/             # Desktop shell and renderer
├── chrome-extension/     # Browser bridge extension
├── test/                 # Unit, contract, chaos, load, windows
├── docs/                 # User and developer documentation
└── specs/                # Design authority
```

## Requirements

- Node.js `>= 20.10.0`
- npm

## Troubleshooting

### Missing build artifacts

Run:

```bash
npm run doctor
```

Then follow the remediation shown for the failing surface.

### Router entrypoint confusion

The canonical local router entrypoint is:

```text
dist/src/index.js
```

Do not point client configs at `dist/index.js`.
