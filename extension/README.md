# ifin Platform Integrations Extension

VS Code extension that connects local editor workflows to ifin Platform through a lightweight UI and setup surface.

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
```

## Testing

Load the extension in a VS Code-compatible editor:
1. Open the editor
2. Go to Extensions → Install from VSIX
3. Select the packaged `.vsix` file
4. Open the ifin Platform panel and verify the local connection state

## Configuration

- `mcpRouter.baseUrl`: ifin Platform backend URL (default: `http://localhost:3000`)
- `mcpRouter.timeout`: Request timeout in ms (default: `60000`)
- `mcpRouter.showOnlyHealthyModels`: Filter unhealthy models (default: `true`)
