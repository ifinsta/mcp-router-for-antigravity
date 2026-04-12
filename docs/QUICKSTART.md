# Quick Start Guide

Get the router built, validated, and connected to a supported MCP client quickly.

## Prerequisites

- Node.js `>= 20.10.0`
- npm
- At least one provider credential, or Ollama running locally

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Create `.env`

```bash
cp .env.example .env
```

Minimum example:

```env
ROUTER_DEFAULT_PROVIDER=glm
ROUTER_DEFAULT_MODEL=glm-4.5
GLM_API_KEY=your-api-key-here
```

OpenAI example:

```env
ROUTER_DEFAULT_PROVIDER=openai
ROUTER_DEFAULT_MODEL=gpt-4.1-mini
OPENAI_API_KEY=your-openai-key-here
```

Ollama example:

```env
ROUTER_DEFAULT_PROVIDER=ollama
ROUTER_DEFAULT_MODEL=llama3.3:70b
OLLAMA_BASE_URL=http://127.0.0.1:11434
```

### 3. Build the router

```bash
npm run build
```

The canonical local router entrypoint is:

```text
dist/src/index.js
```

### 4. Validate the local setup

```bash
npm run doctor
```

`doctor` is read-only. It checks toolchain state, build artifacts, `.env`, client
config readiness, Codex registration, and Windows packaging prerequisites.

### 5. Configure a client

Use the setup helper instead of editing MCP config files by hand:

```bash
npm run setup -- qoder --mode repo
npm run setup -- cursor --mode repo
npm run setup -- codex --mode repo
```

To configure every detected target in one pass:

```bash
npm run setup -- all --mode repo
```

### 6. Start the router

```bash
npm run start
```

You should see startup logs showing the MCP server listening on stdio.

## Manual Config Fallback

If a client only supports local command-based MCP setup, use:

```json
{
  "mcpServers": {
    "ifin-platform": {
      "command": "node",
      "args": ["C:\\Users\\yourusername\\ifin-platform\\dist\\src\\index.js"],
      "env": {
        "GLM_API_KEY": "your-glm-api-key",
        "ROUTER_DEFAULT_PROVIDER": "glm",
        "ROUTER_DEFAULT_MODEL": "glm-4.5"
      }
    }
  }
}
```

On macOS/Linux, the equivalent path is:

```json
{
  "mcpServers": {
    "ifin-platform": {
      "command": "node",
      "args": ["/home/yourusername/ifin-platform/dist/src/index.js"],
      "env": {
        "GLM_API_KEY": "${GLM_API_KEY}"
      }
    }
  }
}
```

## Verify It Works

### Qoder or another MCP client

```text
Use llm.list_models to see all available models
```

```text
Use router.health to check the router status
```

### ifin Platform

```text
Use llm.chat to say "Hello, world!" with provider=openai
```

## Common Issues

### Missing API key

Ensure your `.env` file contains the credential needed for your default provider.

### Wrong router path

Use an absolute path to `dist/src/index.js`, not `dist/index.js`.

### Client config drift

Re-run:

```bash
npm run setup -- <target> --mode repo
```

Then confirm with:

```bash
npm run doctor
```

### Server will not start

Run:

```bash
npm run start
```

Look for missing environment variables, invalid configuration, or provider
initialization failures.

## Next Steps

- Read [README.md](../README.md)
- Review [DEVELOPMENT.md](./DEVELOPMENT.md)
- Review additional documentation in [docs/](./)
