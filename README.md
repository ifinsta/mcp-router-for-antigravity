# README.md

## ifin Platform

A production-grade MCP platform that connects supported clients, local extensions, browser tooling, and external LLM providers through one stable, resilient MCP server.

The software is built for developers and teams that want:

* one stable MCP layer across multiple supported clients
* a strict compatibility layer between local clients and provider APIs
* resilience under degraded provider conditions
* strong typing, strong validation, and strong operational visibility
* one clean integration point instead of many fragile direct integrations

---

## What it is

ifin Platform is an MCP server that sits between supported clients and external providers.

Clients talk to the router through MCP.
The router handles:

* request validation
* transport-to-domain normalization
* provider selection
* provider-specific request/response translation
* retry and fallback decisions
* circuit-breaker and concurrency protection
* health and observability
* response normalization back to the calling client

The result is a small, stable MCP-facing tool surface, even when the underlying providers differ significantly.

---

## What problem it solves

MCP-capable clients can connect to MCP servers, but external model providers often differ in:

* authentication style
* payload format
* response format
* model discovery behavior
* token usage reporting
* timeout and error behavior
* compatibility with so-called OpenAI-compatible APIs

This project isolates those differences behind provider adapters and exposes one predictable execution model to supported clients.

---

## Key capabilities

### Dual-Mode Architecture

ifin Platform supports two operational modes:

* **Agent Mode** — Use your IDE's AI with ifin tools. No provider keys required for basic use. The host IDE's AI owns chat.
* **Router Mode** — Use ifin tools plus ifin-managed models. Provider keys enable routed chat features.

The key principle: **Modes change only chat ownership, not the core tool or browser experience.**

| Feature | Agent Mode | Router Mode |
|---------|------------|-------------|
| MCP tools | ✓ | ✓ |
| Browser automation | ✓ | ✓ |
| Browser bridge | ✓ | ✓ |
| Native LM provider (VS Code) | ✗ | ✓ |
| Provider key configuration | Optional | Required |

Mode is selectable on first run and can be switched at any time via:
* VS Code: QuickPick command or `ifin-platform.mode` setting
* Electron: Settings panel toggle
* Chrome: Badge click in popup

### Stable MCP tool surface

The software exposes a small, stable set of tools:

* `llm.chat`
* `llm.list_models`
* `router.health`
* `browser.*`

Optional extensions can be enabled without weakening the core contract.

### Local integrations

The repository also includes optional local integrations around the core router:

* a Windows desktop application for local setup, packaging, and runtime management
* an IDE extension for VS Code-compatible editors
* a browser extension that gives the router a live in-browser bridge

The browser extension exists to support:

* browser automation and tab-aware control
* page-context script execution
* browser diagnostics and runtime inspection
* real-time metrics collection and WebSocket-based event streaming
* Chrome DevTools Protocol-backed profiling and extension-assisted browser control

### Unified browser MCP

The default browser-facing contract is now one `browser.*` family that combines
general automation and performance-oriented workflows:

* `browser.capabilities`
* `browser.session.open`, `browser.session.close`, `browser.session.list`
* `browser.navigate`, `browser.screenshot`, `browser.evaluate`
* `browser.click`, `browser.type`, `browser.fill_form`, `browser.hover`, `browser.wait_for`
* `browser.tabs.list`, `browser.tabs.create`, `browser.tabs.activate`, `browser.tabs.close`
* `browser.network.set_conditions`, `browser.network.reset`
* `browser.metrics`, `browser.web_vitals`, `browser.audit.design`
* `browser.profile.start`, `browser.profile.stop`

### Browser Intelligence Tools

Tools for evidence capture, failure analysis, and workflow verification:

* `browser.evidence.capture`, `browser.evidence.explain`, `browser.evidence.analyze_flake`, `browser.evidence.root_cause`
* `browser.tabs.list_all`, `browser.tabs.switch`
* `browser.recorder.start`, `browser.recorder.stop`, `browser.recorder.export`
* `browser.assertions.evaluate`
* `browser.verification.run`
* `browser.pr_summary.generate`

These tools support:
* **Evidence capsules** — capture screenshots, DOM, console, network, performance
* **Failure classification** — classify into app_code, timing, selector_drift, backend_failure, environment
* **Flake detection** — multi-run analysis with recommendations
* **Root cause mapping** — map evidence to probable code ownership
* **Assertion evaluation** — 6-category (functional, visual, a11y, performance, ux, network)
* **Fix verification** — compare before/after with verdicts
* **PR summaries** — GitHub-ready markdown reports
* **Workflow recording** — record-to-test code generation

Browser execution stays transport-neutral at the MCP boundary:

* Chrome uses CDP first and augments with the browser extension when available
* Edge uses Chromium CDP without extension augmentation
* Firefox uses Marionette/WebDriver-style control for core actions
* Safari is surfaced through the same contract, but with limited capabilities called out explicitly

### Multi-provider support

Supported provider paths include:

* OpenAI
* GLM
* Ollama
* self-hosted OpenAI-compatible endpoints

### Strong normalization

The router separates:

* MCP transport DTOs
* internal normalized domain contracts
* provider-native request/response types

This prevents provider-specific quirks from leaking into the rest of the system.

### Resilience-first execution

The router includes:

* bounded retries
* exponential backoff
* jitter
* request-budget accounting
* provider fallback
* circuit breakers
* bulkheads and concurrency limits
* degraded-success warnings

### Operational safety

The router includes:

* provider and model allowlists
* strict runtime validation
* typed error classification
* secret redaction
* sanitized provider errors
* metrics and health signals good enough for operations

### Security policy engine

The router includes browser security controls:

* domain allowlists for browser navigation
* action audit logs for compliance and debugging
* secret redaction from logs and responses
* high-risk action warnings
* session isolation and permission control

### Browser context auto-injection

The router can automatically attach browser context to AI conversations:

* URL, page title, active tab id
* selected text when available
* last screenshot/artifact reference
* configurable for privacy and noise control

---

## System overview

```text
Supported MCP client
   │
   │ MCP
   ▼
MCP Router
   ├── MCP server
   ├── tool handlers
   ├── validation and normalization
   ├── policy engine
   ├── router core
   ├── resilience layer
   │    ├── retry policy
   │    ├── request budget manager
   │    ├── circuit breakers
   │    └── concurrency limits
   ├── provider registry
   ├── provider adapters
   │    ├── OpenAI
   │    ├── GLM
   │    ├── Ollama
   │    └── self-hosted compatible endpoints
   └── health, logs, and metrics
```

---

## Why the architecture works

The software succeeds because it keeps the boundary to supported clients simple while keeping the inside disciplined.

### The client side stays simple

Supported clients see:

* one MCP server
* few tools
* stable request/response contracts
* explicit errors
* clear warnings when execution is degraded

### The inside stays strict

The router enforces:

* strong typing at critical boundaries
* runtime validation for all external input and output
* typed error taxonomy
* adapter isolation
* resilience logic in one dedicated layer
* config access through one typed config module

This keeps the system understandable, testable, and hard to break accidentally.

---

## How requests flow

### `llm.chat`

```text
Supported MCP client
  → calls `llm.chat`
  → tool input is validated
  → request is normalized into domain format
  → policy checks run
  → provider/model are resolved
  → attempt planner builds execution path
  → resilience layer manages retries, fallback, budget, and breaker rules
  → provider adapter executes upstream request
  → provider response is validated
  → response is normalized
  → warnings and execution metadata are attached
  → result is returned to the calling client
```

### Terminal failure behavior

A request fails only when no safe useful path remains.

That means the router will stop only when:

* the error is non-retryable
* remaining paths are blocked by policy
* fallback is unavailable or invalid
* circuit breakers block remaining providers
* maximum attempts are exhausted
* request budget is no longer sufficient for useful work

---

## Core tool contracts

### `llm.chat`

Primary execution tool for chat completion across supported providers.

Typical input:

* `provider` optional if a default exists
* `model` optional if a default exists
* `messages`
* `temperature` optional
* `maxTokens` optional
* `timeoutMs` optional
* `fallbackProvider` optional

Typical output:

* `provider`
* `model`
* `outputText`
* `finishReason`
* `usage`
* `latencyMs`
* `costEstimate`
* `warnings`
* `fallbackUsed`

### `llm.list_models`

Lists models for configured providers and returns partial results safely if one provider cannot respond.

### `router.health`

Returns router health, provider health, breaker state, and operational warnings.

### `browser.*`

Unified browser automation and diagnostics surface.

Typical results include:

* a typed `sessionId` or `tabId` when applicable
* structured `warnings` for degraded execution
* explicit `error.code` values for unsupported or failed operations
* `artifacts` for screenshots and captured profiles

### Browser capability matrix

The router reports browser support honestly through `browser.capabilities`.

Current contract intent:

* Chrome: strongest coverage for control, tabs, network, web vitals, design audit, and profiling
* Edge: strong Chromium coverage for control, tabs, network, web vitals, design audit, and profiling
* Firefox: core control coverage, with advanced diagnostics intentionally marked unsupported
* Safari: limited support with unsupported features surfaced explicitly instead of hidden behind placeholders

---

## Supported execution behaviors

### Provider selection

The router supports:

* explicit provider selection
* explicit model selection
* configured defaults

### Fallback behavior

Fallback is supported when configured and allowed.

Fallback will not run if:

* the path violates policy
* the fallback provider is the same useless path
* the capability does not match the request
* there is not enough remaining request budget

### Retry behavior

Retries are:

* bounded
* classified by provider and error class
* subject to exponential backoff and jitter
* blocked for unsafe or non-idempotent operations unless explicitly allowed

### Breaker behavior

The router avoids hammering dead providers by using circuit breakers with:

* closed state
* open state
* cautious reopen or half-open probing

### Concurrency behavior

The router isolates failing providers using:

* global concurrency limits
* per-provider concurrency limits
* graceful overload rejection

---

## Resilience model

This project is intentionally built like a survival system.

### It keeps trying when it still makes sense

The router continues only while there is still a safe, useful recovery path.

### It stops when further attempts are wasteful or dangerous

The router refuses endless retries, invalid fallbacks, and low-value recovery paths.

### It never hides degraded execution

A response may still be successful while carrying warnings for:

* fallback used
* truncation
* estimated usage
* reduced provider capability
* normalization issues

### It preserves enough operational truth to act

The system records what happened well enough to debug, alert, and improve.

---

## Strong typing and validation model

This software treats type discipline as a core feature, not a code-style preference.

### Type rules

* strong typing is enforced at transport, domain, provider, resilience, and config boundaries
* provider-native payloads are never reused as domain contracts
* typed error codes drive retry, fallback, and breaker decisions
* weak typing is not allowed in critical execution paths

### Validation rules

* all MCP tool input is validated at runtime
* all provider responses are validated before normalization
* malformed successful-looking responses are rejected
* transport DTOs are converted into normalized domain models through explicit typed mappers

---

## Security model

The router is designed to reduce risk while still allowing powerful external integrations.

### Security properties

* secrets are loaded from environment or secret-management sources
* secrets are never returned in tool output
* logs redact secrets and auth headers
* provider errors are sanitized before exposure
* provider and model allowlists can be enforced
* passthrough behavior is restricted and disabled by default where appropriate

---

## Observability model

The router is built to be operable in production.

### Logs

Structured logs include:

* request id
* provider
* model
* latency
* retry count
* fallback usage
* breaker state when relevant
* error classification

### Metrics

The software emits or supports:

* request counts
* latency metrics
* retry counts
* fallback-rate metrics
* failure-rate metrics by provider and error class
* overload metrics
* breaker transition metrics
* active concurrency metrics

### Health

Health is visible in three layers:

* configuration health
* discovery health
* execution-path health

---

## Project structure

```text
ifin-platform/
  README.md
  package.json
  tsconfig.json
  .env.example
  chrome-extension/
  electron/
  extension/
  src/
    index.ts
    server/
      mcpServer.ts
      toolHandlers.ts
      extensionApiServer.ts
    core/
      router.ts
      planner.ts
      registry.ts
      policy.ts
      normalizer.ts
      errors.ts
      types.ts
      evidenceCapsule.ts
      failureClassifier.ts
      flakeAnalyzer.ts
      rootCauseMapper.ts
      assertionModel.ts
      fixVerification.ts
      prSummaryGenerator.ts
      workflowRecorder.ts
      browserContext.ts
      browserContract.ts
      modeManager.ts
    resilience/
      retryPolicy.ts
      requestBudget.ts
      circuitBreaker.ts
      concurrency.ts
      executor.ts
      attemptHistory.ts
      securityPolicy.ts
    providers/
      openaiAdapter.ts
      glmAdapter.ts
      ollamaAdapter.ts
      compatibleAdapter.ts
    browser/
      browserBridge.ts
      browserManager.ts
      cdpClient.ts
      extensionBridge.ts
      multiTabManager.ts
    infra/
      config.ts
      logger.ts
      metrics.ts
      secrets.ts
      http.ts
      clocks.ts
  test/
    unit/
    contract/
    chaos/
    load/
    integration/
  specs/
    README.md
    requirements.md
    architecture.md
    implementation-plan.md
```

---

## Getting started

### Prerequisites

* Node.js runtime compatible with the project version
* access to supported client MCP configuration
* credentials for the providers you want to enable

### Installation

```bash
npm install
npm run build
```

### Configure environment

Create an environment file or export variables before startup.

Example:

```env
ROUTER_DEFAULT_PROVIDER=openai
ROUTER_DEFAULT_MODEL=gpt-4.1-mini
ROUTER_TIMEOUT_MS=45000
TOTAL_REQUEST_BUDGET_MS=60000
GLOBAL_CONCURRENCY_LIMIT=20
ALLOWED_PROVIDERS=openai,glm,ollama
ALLOWED_MODELS=gpt-4.1-mini,glm-4.5,llama3.3:70b
MAX_INPUT_CHARS=120000
MAX_OUTPUT_TOKENS=4000
MAX_COST_USD_PER_REQUEST=2.50
OPENAI_API_KEY=
GLM_API_KEY=
OLLAMA_BASE_URL=http://127.0.0.1:11434

# Mode Configuration
ROUTER_MODE=router
AUTO_INJECT_BROWSER_CONTEXT=true

# Security Configuration
SECURITY_ALLOWED_DOMAINS=*.example.com,api.trusted.com
SECURITY_AUDIT_LOG_ENABLED=true
```

### Start the router

```bash
npm run start
```

### Connect an MCP client

Configure a supported MCP client to launch the router as an MCP server.

Repo checkout example:

```json
{
  "mcpServers": {
    "mcp-router": {
      "command": "node",
      "args": ["dist/src/index.js"],
      "env": {
        "OPENAI_API_KEY": "${OPENAI_API_KEY}",
        "GLM_API_KEY": "${GLM_API_KEY}"
      }
    }
  }
}
```

Installed Windows app example:

```json
{
  "mcpServers": {
    "mcp-router": {
      "command": "C:\\Program Files\\ifin Platform\\ifin Platform.exe",
      "args": ["C:\\Program Files\\ifin Platform\\resources\\app.asar\\dist\\src\\index.js"],
      "env": {
        "ELECTRON_RUN_AS_NODE": "1",
        "OPENAI_API_KEY": "${OPENAI_API_KEY}",
        "GLM_API_KEY": "${GLM_API_KEY}"
      }
    }
  }
}
```

### Drive a browser session

After the router is running, a supported MCP client can use the browser surface
like this:

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

Then use the returned `sessionId` with follow-up calls such as
`browser.navigate`, `browser.screenshot`, `browser.click`, `browser.metrics`,
or `browser.profile.start`.

---

## Development workflow

### Main development commands

```bash
npm run dev
npm run build
npm run typecheck
npm run lint
npm run test
npm run test:contract
npm run test:chaos
npm run test:load
```

### Expected engineering rules

* keep provider logic inside adapters
* keep resilience logic inside resilience layer
* keep config access inside config module
* keep external validation at every boundary
* do not mark work done without tests and observability hooks

---

## Testing strategy

The project uses several testing layers.

### Unit tests

Covers:

* validation
* policy logic
* retry logic
* budget logic
* breaker transitions
* concurrency control
* typed mappers

### Contract tests

Covers:

* OpenAI adapter
* GLM adapter
* normalized output guarantees
* compatibility drift detection

### Chaos tests

Covers injected failure modes such as:

* timeouts
* malformed JSON
* partial responses
* DNS failures
* rate limits
* credential revocation

### Load tests

Covers:

* overload handling
* provider isolation
* concurrency saturation
* behavior under pressure

### Integration tests

Covers:

* MCP tool registration
* client communication over MCP
* end-to-end tool invocation
* degraded-success warnings
* structured failures

### Test coverage summary

The project includes comprehensive test coverage:

* **232 unit tests** for core modules (evidence, failure classification, flake detection, assertions, verification)
* **74 security/resilience tests** for policy engine, retry, breakers, concurrency
* **163 contract tests** for provider adapters and browser contracts

---

## Quality gates

The complete project enforces:

* strict type-checking with zero type errors
* lint with zero critical-rule violations
* no provider calls outside adapters
* no raw env access outside config module
* no malformed external input entering the domain layer
* no malformed provider success payload accepted as success
* no secrets in logs
* no degraded execution without warnings

Coverage and test thresholds are enforced in CI for critical-path modules.

---

## Example usage scenarios

### Use OpenAI through the router

Ask a supported MCP client to use `llm.chat` with `provider=openai` and a supported model. The router validates the request, executes it, and returns normalized output.

### Use GLM even if your client does not support it natively

Ask the client to call the same `llm.chat` tool but with `provider=glm`. The router adapts request and response behavior without changing the MCP-facing contract.

### Recover from a temporary provider failure

If the primary provider times out and fallback is configured, the router can retry or switch to a fallback provider and return the result with warnings that explain the degraded execution path.

---

## Common failure cases

### Configuration errors

If provider credentials or required config are missing, the router fails fast and surfaces configuration errors through startup diagnostics and health output.

### Validation errors

Malformed MCP inputs are rejected before provider execution.

### Provider errors

Provider-specific failures are sanitized, classified, and mapped into structured router errors.

### Overload

When concurrency limits are reached, the router rejects excess work clearly instead of failing unpredictably.

---

## Documentation map

This repository includes project documentation under `specs/`:

* `specs/README.md` — project-level design introduction
* `specs/requirements.md` — system requirements
* `specs/architecture.md` — technical architecture
* `specs/implementation-plan.md` — execution plan and delivery matrix

This top-level README is the operational entry point for the complete software.

---

## Status

The project is production-complete in this README view.

That means the software described here assumes:

* the MCP server is implemented
* OpenAI and GLM adapters are implemented
* resilience controls are active
* health and metrics are operational
* the test pyramid is in place
* supported client integration works end to end

---

## Contributing

Contributions must preserve the architecture and its discipline.

Do not submit changes that:

* weaken typing in critical paths
* move provider logic outside adapters
* move resilience logic outside resilience layer
* bypass runtime validation
* add new tools without clear normalization, observability, and test strategy

---

## Final principle

This software is built around one idea:

**Supported clients should experience a simple, stable, predictable MCP interface, even when the outside world is unreliable, inconsistent, or hostile.**
