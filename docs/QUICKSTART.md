# Quick Start Guide

Get the MCP router running and connected to Antigravity or Qoder in under 5 minutes.

If your AI agent can launch `npx`-based MCP servers, you can run this router directly from GitHub without cloning the repository.

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
ROUTER_DEFAULT_PROVIDER=glm
ROUTER_DEFAULT_MODEL=glm-4.5
GLM_API_KEY=your-api-key-here
```

**Alternative providers:**

For OpenAI:

```env
ROUTER_DEFAULT_PROVIDER=openai
ROUTER_DEFAULT_MODEL=gpt-4.1-mini
OPENAI_API_KEY=your-openai-key-here
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
[INFO] Provider initialized: glm
[INFO] MCP server listening on stdio
```

Press `Ctrl+C` to stop the server.

### 5. Configure Antigravity or Qoder

#### For Qoder

1. Open **Qoder Settings** (Ctrl+Shift+, or click user icon in top-right)
2. Click **MCP** in the left navigation
3. Click **+ Add** on the My Servers tab
4. Add the following configuration:

```json
{
  "mcpServers": {
    "mcp-router": {
      "command": "npx",
      "args": ["-y", "git+https://github.com/ifinsta/mcp-router-for-antigravity.git"],
      "env": {
        "GLM_API_KEY": "your-glm-api-key",
        "OPENAI_API_KEY": "your-openai-api-key",
        "CHUTES_API_KEY": "your-chutes-api-key",
        "ROUTER_DEFAULT_PROVIDER": "glm",
        "ROUTER_DEFAULT_MODEL": "glm-4.5"
      }
    }
  }
}
```

5. Click **Save** when prompted
6. The link icon should appear, indicating successful connection

**Alternative: Local setup for Qoder**

If you've cloned the repository:

```json
{
  "mcpServers": {
    "mcp-router": {
      "command": "node",
      "args": ["C:\\Users\\yourusername\\mcp-router-for-antigravity\\dist\\index.js"],
      "env": {
        "GLM_API_KEY": "your-glm-api-key",
        "ROUTER_DEFAULT_PROVIDER": "glm",
        "ROUTER_DEFAULT_MODEL": "glm-4.5"
      }
    }
  }
}
```

#### For Antigravity

Add the router to your Antigravity MCP configuration file.

Preferred setup when Antigravity supports `npx`:

**On macOS/Linux (~/.config/antigravity/mcp_servers.json):**

```json
{
  "mcpServers": {
    "mcp-router": {
      "command": "npx",
      "args": ["-y", "git+https://github.com/ifinsta/mcp-router-for-antigravity.git"],
      "env": {
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
      "command": "npx",
      "args": ["-y", "git+https://github.com/ifinsta/mcp-router-for-antigravity.git"],
      "env": {
        "GLM_API_KEY": "${GLM_API_KEY}"
      }
    }
  }
}
```

Fallback setup if Antigravity only supports local commands:

**On macOS/Linux (~/.config/antigravity/mcp_servers.json):**

```json
{
  "mcpServers": {
    "mcp-router": {
      "command": "node",
      "args": ["/home/yourusername/mcp-router-for-antigravity/dist/index.js"],
      "env": {
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
      "args": ["C:\\Users\\yourusername\\mcp-router-for-antigravity\\dist\\index.js"],
      "env": {
        "GLM_API_KEY": "${GLM_API_KEY}"
      }
    }
  }
}
```

**Important:** If you use the local `node` setup, replace `yourusername` with your actual username. The path should point to where you cloned the repository.

## Verify It Works

### In Qoder (Agent mode)

```text
Use the llm.list_models tool to see all available models
```

Or check router health:

```text
Use the router_health tool to check the router status
```

### In Antigravity

Ask it to use the router:

```
Use the llm.chat tool to say "Hello, world!" with provider=openai
```

Or check router health:

```
Call router.health to check the router status
```

## Basic Usage Examples

### Chat with an LLM

**In Qoder:**

```text
Use llm.chat with:
- provider: "chutes"
- model: "Qwen/Qwen2.5-72B-Instruct"
- messages: [{"role": "user", "content": "Hello!"}]
```

**In Antigravity:**

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

### GitHub Launch Fails

**Error:** Antigravity fails when using `npx github:ifinsta/mcp-router-for-antigravity`

**Fix:** Some MCP hosts only allow local commands or do not support `npx`. Use the local fallback config with `node` and a built `dist/index.js` path.

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

- Read the [README.md](../README.md) for detailed documentation
- Check [specs/architecture.md](../specs/architecture.md) for system design
- See [specs/requirements.md](../specs/requirements.md) for capabilities

## Need Help?

- Check the [Common Issues](#common-issues) section above
- Review logs with `npm run start`
- Verify your `.env` configuration
- Ensure all prerequisites are met
- Browse the [GitHub repository](https://github.com/ifinsta/mcp-router-for-antigravity)
- Report issues on [GitHub Issues](https://github.com/ifinsta/mcp-router-for-antigravity/issues)
