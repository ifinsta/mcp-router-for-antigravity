# ifin Platform Integrations Extension

VS Code-compatible IDE extension that connects local editor workflows to ifin Platform through a lightweight UI and setup surface.

## Architecture

This extension is a **thin UI bridge** that:
- exposes the local ifin Platform setup inside the editor
- forwards editor-side requests to the ifin Platform backend
- reflects router-backed capability state in the UI

All routing, resilience, and provider logic remains in ifin Platform.

## Development

```bash
npm install
npm run build
npm run test:unit
```

From the repo root you can run:

```bash
npm run dev:extension
```

Use an Extension Development Host for day-to-day iteration. Package a VSIX only
when you need an installable artifact:

```bash
npm run build:ide-extension
npm run test:ide-extension
npm run package:ide-extension
```

## Testing

Load the extension in a VS Code-compatible editor:
1. Open the editor
2. Go to Extensions -> Install from VSIX
3. Select the packaged `.vsix` file from `extension/`
4. Open the ifin Platform panel and verify the local connection state

## Configuration

- `ifinPlatform.baseUrl`: ifin Platform backend URL (default: `http://localhost:3000`)
- `ifinPlatform.timeout`: Request timeout in ms (default: `60000`)
- `ifinPlatform.showOnlyHealthyModels`: Filter unhealthy models (default: `true`)
- `ifinPlatform.routerPath`: Optional path to the router repo root or built `dist/src/index.js` entrypoint
- `ifinPlatform.models.defaultModel`: Primary model for conversations in the settings UI
- `ifinPlatform.models.smallModel`: Lightweight model preference for quick tasks
- `ifinPlatform.models.byMode.*`: Optional per-mode overrides for `code`, `plan`, `debug`, `orchestrator`, and `ask`
