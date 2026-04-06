# Quick Start Guide

Get the MCP router running and connected to Antigravity in under 5 minutes.

## Prerequisites

- **Node.js >= 20.10.0** - [Check version](#verify-node-version)
- **API key** for at least one provider:
  - OpenAI API key, or
  - GLM API key, or
  - Ollama running locally

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Create Environment File

Copy the example and add your API key:

```bash
cp .env.example .env
```

Edit `.env` and add at minimum:

```env
ROUTER_DEFAULT_PROVIDER=openai
ROUTER_DEFAULT_MODEL=gpt-4.1-mini
OPENAI_API_KEY=your-api-key-here
```

**Alternative providers:**

For GLM:

```env
ROUTER_DEFAULT_PROVIDER=glm
ROUTER_DEFAULT_MODEL=glm-4.5
GLM_API_KEY=your-glm-key-here
```

For Ollama (no API key needed):

```env
ROUTER_DEFAULT_PROVIDER=ollama
ROUTER_DEFAULT_MODEL=llama3.3:70b
OLLAMA_BASE_URL=http://127.0.0.1:11434
```

### 3. Build the Project

```bash
npm run build
```

No output means success. The compiled files are in `dist/`.

### 4. Verify the Server Starts

```bash
npm run start
```

You should see logs like:

```
[INFO] MCP Router starting...
[INFO] Provider initialized: openai
[INFO] MCP server listening on stdio
```

Press `Ctrl+C` to stop the server.

### 5. Configure Antigravity

Add the router to your Antigravity MCP configuration file:

**On macOS/Linux (~/.config/antigravity/mcp_servers.json):**

```json
{
  "mcpServers": {
    "mcp-router": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-router-for-antigravity/dist/index.js"],
      "env": {
        "OPENAI_API_KEY": "${OPENAI_API_KEY}",
        "GLM_API_KEY": "${GLM_API_KEY}"
      }
    }
  }
}
```

**On Windows (%APPDATA%\antigravity\mcp_servers.json):**

```json
{
  "mcpServers": {
    "mcp-router": {
      "command": "node",
      "args": ["C:\\Users\\yourusername\\path\\to\\mcp-router-for-antigravity\\dist\\index.js"],
      "env": {
        "OPENAI_API_KEY": "${OPENAI_API_KEY}",
        "GLM_API_KEY": "${GLM_API_KEY}"
      }
    }
  }
}
```

**Important:** Replace the path with your actual absolute path to `dist/index.js`.

## Verify It Works

In Antigravity, ask it to use the router:

```
Use the llm.chat tool to say "Hello, world!" with provider=openai
```

Or check router health:

```
Call router.health to check the router status
```

## Basic Usage Examples

### Chat with an LLM

```
Use llm.chat with:
- provider: "openai"
- model: "gpt-4.1-mini"
- messages: [{"role": "user", "content": "Hello!"}]
```

### List Available Models

```
Use llm.list_models to see all available models
```

### Check Router Health

```
Use router.health to check configuration and provider status
```

## Common Issues

### Missing API Key

**Error:** `Configuration error: Missing required environment variable`

**Fix:** Ensure your `.env` file contains the API key for your default provider:

```env
OPENAI_API_KEY=sk-...
```

### Wrong File Path in Antigravity Config

**Error:** Antigravity can't start the MCP server

**Fix:** Use an absolute path to `dist/index.js`:

- ✅ `"args": ["/home/user/projects/mcp-router/dist/index.js"]`
- ❌ `"args": ["dist/index.js"]`

### Node Version Mismatch

**Error:** Syntax errors or module not found

**Fix:** Check your Node version:

```bash
node --version
```

Must be >= 20.10.0. Upgrade at [nodejs.org](https://nodejs.org/).

### Server Won't Start

**Check logs:**

```bash
npm run start
```

Look for error messages about:

- Missing environment variables
- Invalid configuration
- Provider initialization failures

## Verify Node Version

```bash
node --version
```

Should output `v20.10.0` or higher.

## Next Steps

- Read the [README.md](README.md) for detailed documentation
- Check [specs/architecture.md](specs/architecture.md) for system design
- See [specs/requirements.md](specs/requirements.md) for capabilities

## Need Help?

- Check the [Common Issues](#common-issues) section above
- Review logs with `npm run start`
- Verify your `.env` configuration
- Ensure all prerequisites are met
