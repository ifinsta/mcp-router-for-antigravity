# Antigravity Custom Models Extension

VS Code/Antigravity extension that integrates custom LLM providers (OpenAI, GLM) into Antigravity's built-in model selector via the MCP Router backend.

## Architecture

This extension is a **thin UI bridge** that:
- Registers custom models in Antigravity's model selector
- Forwards chat requests to the MCP Router backend
- Streams responses back to the UI

All routing, resilience, and provider logic remains in the MCP Router.

## Development

```bash
npm install
npm run build
```

## Testing

Load the extension in Antigravity:
1. Open Antigravity
2. Go to Extensions → Install from VSIX
3. Select the packaged `.vsix` file
4. Check the model selector for "MCP Router Models"

## Configuration

- `mcpRouter.baseUrl`: MCP Router backend URL (default: `http://localhost:3000`)
- `mcpRouter.timeout`: Request timeout in ms (default: `60000`)
- `mcpRouter.showOnlyHealthyModels`: Filter unhealthy models (default: `true`)
