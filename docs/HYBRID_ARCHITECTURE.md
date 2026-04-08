# Hybrid Architecture: MCP Router + Antigravity Extension

## Overview

This project now implements a **hybrid architecture** that combines:
1. **MCP Router** - The backend execution brain (resilience, routing, providers)
2. **VS Code Extension** - Thin UI bridge for native model selector integration

```
┌─────────────────────────────────────────────────────┐
│                 Antigravity IDE                     │
│                                                      │
│  ┌──────────────┐          ┌──────────────────┐    │
│  │ Model        │          │   MCP Protocol   │    │
│  │ Selector UI  │          │   (Stdio)        │    │
│  └──────┬───────┘          └────────┬─────────┘    │
│         │                           │               │
│         ▼                           ▼               │
│  ┌──────────────────────────────────────────┐      │
│  │  Antigravity Custom Models Extension     │      │
│  │  - LanguageModelChatProvider             │      │
│  │  - Model Catalog                         │      │
│  │  - Request/Response Mapping              │      │
│  └──────────────────┬───────────────────────┘      │
│                     │ HTTP                         │
└─────────────────────┼──────────────────────────────┘
                      │
                      ▼
         ┌────────────────────────┐
         │   MCP Router Backend   │
         │                        │
         │  ┌──────────────────┐  │
         │  │ Extension API    │  │
         │  │ Server (:3000)   │  │
         │  └──────────────────┘  │
         │                        │
         │  ┌──────────────────┐  │
         │  │ MCP Server       │  │
         │  │ (Stdio)          │  │
         │  └──────────────────┘  │
         │                        │
         │  ┌──────────────────┐  │
         │  │ Routing Engine   │  │
         │  │ - Retry logic    │  │
         │  │ - Fallback       │  │
         │  │ - Circuit breaker│  │
         │  └──────────────────┘  │
         │                        │
         │  ┌──────────────────┐  │
         │  │ Provider Adapters│  │
         │  │ - OpenAI         │  │
         │  │ - GLM            │  │
         │  │ - Ollama         │  │
         │  └──────────────────┘  │
         └────────────────────────┘
```

## Architecture Benefits

### Why Hybrid?

| Approach | Pros | Cons |
|----------|------|------|
| **MCP Only** | Simple, universal, no extension needed | Models don't appear in built-in selector |
| **Extension Only** | Native selector UX | Duplicates routing logic, harder to maintain |
| **Hybrid (This)** | ✅ Native selector + centralized routing | Requires both components |

### Separation of Concerns

**Extension responsibilities:**
- Register models in Antigravity's selector
- Map VS Code API ↔ Router API
- Stream responses to UI
- Lightweight settings management

**Router responsibilities:**
- Provider adapters (OpenAI, GLM, etc.)
- Request validation and policy enforcement
- Retry, fallback, circuit breaker logic
- Request budget management
- Observability and metrics
- Model health checking

## Project Structure

```
mcp-router-for-antigravity/
├── src/                          # MCP Router backend
│   ├── server/
│   │   ├── mcpServer.ts          # MCP stdio server
│   │   └── extensionApiServer.ts # HTTP API for extension
│   ├── core/                     # Routing, resilience, types
│   ├── providers/                # Provider adapters
│   └── infra/                    # Config, logging
│
├── extension/                    # VS Code/Antigravity Extension
│   ├── src/
│   │   ├── extension.ts          # Entry point
│   │   ├── provider/
│   │   │   ├── lmProvider.ts     # LanguageModelChatProvider
│   │   │   ├── modelCatalog.ts   # Model catalog manager
│   │   │   ├── requestMapper.ts  # VS Code → Router mapping
│   │   │   └── responseMapper.ts # Router → VS Code mapping
│   │   ├── client/
│   │   │   └── routerClient.ts   # HTTP client for router
│   │   ├── config/
│   │   │   └── settings.ts       # Extension settings
│   │   └── infra/
│   │       ├── logger.ts         # VS Code logging
│   │       └── errors.ts         # Error types
│   ├── package.json
│   └── tsconfig.json
│
└── docs/
    └── HYBRID_ARCHITECTURE.md    # This file
```

## API Contracts

### Extension API Endpoints

The router exposes HTTP endpoints on port 3000 (configurable):

#### `GET /api/extension/models`
Returns model catalog for the extension.

**Response:**
```json
{
  "models": [
    {
      "id": "openai:gpt-4.1-mini",
      "name": "GPT-4.1 Mini (via MCP Router)",
      "provider": "openai",
      "family": "gpt-4.1-mini",
      "healthy": true,
      "maxTokens": 8192
    }
  ]
}
```

#### `POST /api/extension/chat`
Execute a chat request.

**Request:**
```json
{
  "model": "gpt-4.1-mini",
  "provider": "openai",
  "messages": [
    { "role": "user", "content": "Hello!" }
  ],
  "stream": true
}
```

**Response:**
```json
{
  "id": "chat-1234567890",
  "model": "gpt-4.1-mini",
  "provider": "openai",
  "choices": [{
    "message": {
      "role": "assistant",
      "content": "Hello! How can I help you?"
    },
    "finish_reason": "stop"
  }],
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 15,
    "total_tokens": 25
  }
}
```

#### `POST /api/extension/tokens`
Count tokens for text.

**Request:**
```json
{
  "model": "openai:gpt-4.1-mini",
  "text": "Hello world"
}
```

**Response:**
```json
{
  "token_count": 3
}
```

#### `GET /health`
Health check endpoint.

**Response:** Full health status from `getHealth()`.

## Development Workflow

### Building the Router

```bash
npm install
npm run build
npm start
```

The router starts both:
- MCP stdio server (for Antigravity MCP integration)
- Extension API server (HTTP on port 3000)

### Building the Extension

```bash
cd extension
npm install
npm run build
```

### Testing the Extension

1. **Package the extension:**
   ```bash
   cd extension
   npx vsce package
   ```
   This creates a `.vsix` file.

2. **Install in Antigravity:**
   - Open Antigravity
   - Go to Extensions view (Ctrl+Shift+X)
   - Click "..." → "Install from VSIX..."
   - Select the generated `.vsix` file

3. **Verify:**
   - Open Antigravity chat
   - Click the model selector
   - You should see "MCP Router Models" with your custom models

4. **Configure:**
   - Go to Settings → Extensions → Antigravity Custom Models
   - Set `mcpRouter.baseUrl` if your router runs on a different port

### Configuration

#### Router Configuration (`.env`)

```env
# Server configuration
EXTENSION_API_PORT=3000

# Provider configuration
OPENAI_API_KEY=sk-...
GLM_API_KEY=...
```

#### Extension Configuration (Antigravity Settings)

```json
{
  "mcpRouter.baseUrl": "http://localhost:3000",
  "mcpRouter.timeout": 60000,
  "mcpRouter.showOnlyHealthyModels": true,
  "mcpRouter.autoRefreshCatalog": false
}
```

## Request Flow

### Complete Request Lifecycle

1. **User selects model** in Antigravity's built-in selector
2. **Extension receives request** via `provideLanguageModelChatResponse()`
3. **Request mapping**: VS Code messages → Router format
4. **HTTP call** to `POST /api/extension/chat`
5. **Router executes**:
   - Policy validation
   - Provider selection
   - Retry/fallback logic
   - Circuit breaker checks
   - Provider API call
6. **Response streaming**: Router → Extension → Antigravity UI
7. **Error handling**: Structured errors displayed to user

## Error Handling

### Extension-Side Errors

- **Router unreachable**: User-friendly message with troubleshooting steps
- **Invalid response**: Structured error with context
- **Timeout**: Clear timeout message

### Router-Side Errors

- **Provider failure**: Retry/fallback automatically
- **Rate limiting**: Backoff and retry
- **Circuit breaker open**: Fast fail with degradation notice
- **Validation error**: Clear error message

All errors are **sanitized** before display (no secrets leaked).

## Security Considerations

### Secret Management

- ✅ Provider API keys stored in router's `.env` (not extension)
- ✅ Extension only needs router URL
- ✅ Errors sanitized before displaying to user
- ✅ No sensitive data in extension logs

### Network Security

- Extension communicates with router over localhost
- CORS headers configured for local development
- No external network calls from extension

## Maintenance

### Updating the Router

```bash
git pull
npm install
npm run build
npm start
```

### Updating the Extension

```bash
cd extension
git pull
npm install
npm run build
npx vsce package
# Reinstall .vsix in Antigravity
```

### Compatibility

- Router API is versioned internally
- Extension expects router v1.0.0+
- Breaking changes will be documented in CHANGELOG

## Troubleshooting

### Models Don't Appear in Selector

1. Check router is running: `curl http://localhost:3000/health`
2. Check extension logs: View → Output → "MCP Router"
3. Verify router has providers configured
4. Check `showOnlyHealthyModels` setting

### Chat Requests Fail

1. Check router logs for errors
2. Verify provider API keys are set
3. Check network connectivity to provider APIs
4. Review circuit breaker state in health endpoint

### Extension Won't Load

1. Check Antigravity Developer Tools (Help → Toggle Developer Tools)
2. Look for errors in Console
3. Verify extension compiled successfully
4. Reinstall the `.vsix` file

## Future Enhancements

### Planned

- [ ] Proper SSE streaming support
- [ ] Token counting via provider APIs (not approximation)
- [ ] Model catalog auto-refresh on health changes
- [ ] Extension packaging and publishing to Open VSX
- [ ] Authentication for extension API (if needed)

### Considered

- [ ] Support for tool calling in extension
- [ ] Image input support
- [ ] Multiple router instances (load balancing)
- [ ] Extension-side caching optimization

## Design Principles

1. **Extension is thin**: No routing logic, just UI bridge
2. **Router is brain**: All resilience, policy, provider logic
3. **Centralized secrets**: Keys in router, not extension
4. **Graceful degradation**: Extension works even if router is down (with cached models)
5. **Observable**: Both components log and emit metrics
6. **Type-safe**: Full TypeScript with strict mode

## References

- [Antigravity Model Selector Investigation Results](./antigravity-model-selector-investigation-results.md)
- [Custom Models Guide](./antigravity-custom-models.md)
- [VS Code Language Model API](https://code.visualstudio.com/api/extension-guides/chat)
- [MCP Protocol Specification](https://modelcontextprotocol.io/)
