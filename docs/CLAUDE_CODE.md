# Claude Code MCP Setup Guide

## Overview

Claude Code should use the router through the unified public browser contract:

- `browser.capabilities`
- `browser.session.*`
- `browser.navigate`, `browser.screenshot`, `browser.evaluate`
- `browser.click`, `browser.type`, `browser.fill_form`, `browser.hover`, `browser.wait_for`
- `browser.tabs.*`
- `browser.network.*`
- `browser.metrics`, `browser.web_vitals`, `browser.audit.design`
- `browser.profile.*`

The older `test_*` and `perf_*` browser names are not the preferred public
surface and are not registered by default in the MCP bootstrap.

## Quick Start

### Build the router

```bash
cd C:\Users\user\CascadeProjects\mcp-router-for-antigravity
npm install
npm run build
```

### Configure Claude Code

Use either the Claude Code MCP settings UI or `C:\Users\user\.claude\mcp-servers.json`.

Example config:

```json
{
  "mcpServers": {
    "ifin-platform": {
      "command": "node",
      "args": ["C:\\Users\\user\\CascadeProjects\\mcp-router-for-antigravity\\dist\\index.js"],
      "env": {
        "NODE_ENV": "production",
        "LOG_LEVEL": "info"
      },
      "timeout": 30000,
      "alwaysAllow": [
        "browser.capabilities",
        "browser.session.open",
        "browser.navigate",
        "browser.screenshot",
        "browser.click",
        "browser.type"
      ]
    }
  }
}
```

After saving the config, restart Claude Code and verify the MCP server shows as
connected.

## Common Claude Code Flows

### Open a browser session

```json
{
  "tool": "browser.session.open",
  "arguments": {
    "browserType": "chrome",
    "headless": true,
    "url": "https://example.com"
  }
}
```

### Navigate and interact

```json
{
  "tool": "browser.navigate",
  "arguments": {
    "sessionId": "session_123",
    "url": "https://example.com/dashboard",
    "waitFor": "networkidle",
    "timeoutMs": 30000
  }
}
```

```json
{
  "tool": "browser.click",
  "arguments": {
    "sessionId": "session_123",
    "selector": "#submit-button"
  }
}
```

```json
{
  "tool": "browser.type",
  "arguments": {
    "sessionId": "session_123",
    "selector": "#email",
    "text": "user@example.com",
    "clearFirst": true
  }
}
```

### Fill a form

```json
{
  "tool": "browser.fill_form",
  "arguments": {
    "sessionId": "session_123",
    "fields": [
      {
        "selector": "#username",
        "value": "testuser",
        "type": "text"
      },
      {
        "selector": "#password",
        "value": "testpass",
        "type": "text"
      }
    ]
  }
}
```

### Capture artifacts

```json
{
  "tool": "browser.screenshot",
  "arguments": {
    "sessionId": "session_123",
    "fullPage": true,
    "type": "png"
  }
}
```

```json
{
  "tool": "browser.profile.start",
  "arguments": {
    "sessionId": "session_123"
  }
}
```

### Inspect capabilities first

```json
{
  "tool": "browser.capabilities",
  "arguments": {
    "browser": "firefox"
  }
}
```

This is the recommended way to decide whether tabs, profiling, network control,
or audits should be attempted in a given browser.

## Troubleshooting

### Claude Code cannot connect

Check:

- the `dist/index.js` path is correct
- Node.js is installed and on `PATH`
- the MCP server process starts locally without crashing

### A browser action fails on Firefox or Safari

Call `browser.capabilities` first. The router now reports unsupported browser
features explicitly rather than returning placeholder success payloads.

### Chrome works but returns warnings

The most common warning is reduced Chrome fidelity when the browser extension is
not connected. The call may still succeed through CDP, but the response should
be treated as degraded if warnings are present.
