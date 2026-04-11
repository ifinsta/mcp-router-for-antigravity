# Browser MCP Guide

## Overview

The default browser surface is one `browser.*` MCP family for browser control,
diagnostics, and performance-oriented workflows.

This is the public contract:

- `browser.capabilities`
- `browser.session.open`, `browser.session.close`, `browser.session.list`
- `browser.navigate`, `browser.screenshot`, `browser.evaluate`
- `browser.click`, `browser.type`, `browser.fill_form`, `browser.hover`, `browser.scroll`, `browser.wait_for`
- `browser.console`
- `browser.tabs.list`, `browser.tabs.create`, `browser.tabs.activate`, `browser.tabs.close`
- `browser.network.set_conditions`, `browser.network.reset`
- `browser.metrics`, `browser.web_vitals`, `browser.audit.design`
- `browser.profile.start`, `browser.profile.stop`

The older `test_*` and `perf_*` names are not part of the default MCP bootstrap.

## Contract Rules

Every browser tool returns one normalized result shape with:

- `success`
- `action`
- `browser`
- `sessionId`
- `data`
- `warnings`
- `artifacts`
- `error`

The contract is intentionally strict:

- unsupported operations return structured failures
- degraded execution is surfaced through `warnings`
- browser-specific transport details do not replace the normalized response shape
- screenshots, profiles, and other captured evidence are returned through `artifacts`

Current failure/error semantics:

- unsupported capability: `error.code = "unsupported_browser_feature"`
- session lookup failure: `error.code = "session_not_found"`
- execution failure: `error.code = "browser_action_failed"`
- missing transport/runtime support: `error.code = "transport_unavailable"`

## Capability Model

Use `browser.capabilities` to inspect the reported browser capability matrix.

Capability flags:

- `core_control`
- `tab_management`
- `network_control`
- `web_vitals`
- `design_audit`
- `profiling`
- `extension_augmented`

Current capability matrix:

| Browser | Core Control | Tabs | Network | Web Vitals | Design Audit | Profiling | Extension Augmented |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Chrome | Yes | Yes | Yes | Yes | Yes | Yes | When connected |
| Edge | Yes | Yes | Yes | Yes | Yes | Yes | No |
| Firefox | Yes | No | No | No | No | No | No |
| Safari | No | No | No | No | No | No | No |

Notes:

- `core_control` covers session open/close, navigation, screenshot, evaluation, click, type, fill, hover, and wait flows.
- `browser.scroll` gives agents a direct way to move the visible viewport without dropping into raw script execution.
- `browser.console` returns recent page console entries for any CDP-capable Chromium session, with the Chrome extension path retained as a fallback.
- Chrome `browser.session.open` now requires extension-backed augmentation by default. Callers must set `requireExtension: false` to allow degraded CDP-only execution.
- Firefox and Safari remain first-class entries in the contract because they report capability truthfully instead of pretending to support unsupported flows.

## Transport Model

The MCP boundary stays the same across browsers, while transport selection stays internal:

- Chrome: CDP first, browser extension optional for richer augmentation
- Edge: Chromium CDP
- Firefox: Marionette/WebDriver-style control for core flows
- Safari: limited implementation with explicit capability gating

The public caller should rely on `browser.capabilities` and structured warnings,
not on browser-specific transport assumptions.

## Common Flows

### Open a session

```json
{
  "tool": "browser.session.open",
  "arguments": {
    "browserType": "chrome",
    "headless": false,
    "url": "https://example.com"
  }
}
```

To explicitly allow degraded Chrome launch without the extension:

```json
{
  "tool": "browser.session.open",
  "arguments": {
    "browserType": "chrome",
    "headless": false,
    "requireExtension": false,
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
    "selector": "button[type='submit']"
  }
}
```

```json
{
  "tool": "browser.scroll",
  "arguments": {
    "sessionId": "session_123",
    "direction": "down",
    "amount": 700,
    "behavior": "smooth"
  }
}
```

```json
{
  "tool": "browser.console",
  "arguments": {
    "sessionId": "session_123"
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

### Work with tabs

```json
{
  "tool": "browser.tabs.create",
  "arguments": {
    "sessionId": "session_123",
    "url": "https://example.org"
  }
}
```

### Capture evidence

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

### Run browser-native diagnostics

```json
{
  "tool": "browser.metrics",
  "arguments": {
    "sessionId": "session_123"
  }
}
```

```json
{
  "tool": "browser.web_vitals",
  "arguments": {
    "sessionId": "session_123"
  }
}
```

```json
{
  "tool": "browser.audit.design",
  "arguments": {
    "sessionId": "session_123"
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

## Degraded and Unsupported Behavior

The router is expected to tell the truth about browser state.

Examples:

- Chrome session open fails with `transport_unavailable` when the extension is required but the launched browser connects in CDP-only mode.
- Chrome without the extension only succeeds when `requireExtension: false`, and then the router emits degraded warnings.
- `browser.console` remains available on Chromium sessions that still have CDP even when extension augmentation is absent.
- Firefox tab or profiling requests fail structurally instead of returning placeholders.
- Safari browser calls that are not implemented fail with explicit unsupported or action-failed results.

Example unsupported response shape:

```json
{
  "success": false,
  "action": "browser.click",
  "browser": "safari",
  "sessionId": "session_123",
  "warnings": [],
  "artifacts": [],
  "error": {
    "code": "unsupported_browser_feature",
    "message": "browser.click is not supported for safari."
  }
}
```

## Browser Extension

The browser extension is part of the Chrome execution path, not a separate
public API surface.

It improves Chrome sessions with:

- extension-backed browser evidence
- richer audit and web-vitals capture paths
- local bridge connectivity for browser-side events

If the extension is unavailable, the router continues through CDP where
possible only when the caller explicitly allows degraded execution through
`requireExtension: false`. Otherwise Chrome session launch fails closed.
