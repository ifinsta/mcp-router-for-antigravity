# README.md

## MCP Router for Antigravity

A production-grade MCP router that allows Antigravity to use external LLMs and selected external tools through one stable, resilient MCP server.

The software is built for teams that want:

* unsupported external LLM providers inside Antigravity
* a strict compatibility layer between Antigravity and provider APIs
* resilience under degraded provider conditions
* strong typing, strong validation, and strong operational visibility
* one clean integration point instead of many fragile direct integrations

---

## What it is

MCP Router for Antigravity is an MCP server that sits between Antigravity and external providers.

Antigravity talks to the router through MCP.
The router handles:

* request validation
* transport-to-domain normalization
* provider selection
* provider-specific request/response translation
* retry and fallback decisions
* circuit-breaker and concurrency protection
* health and observability
* response normalization back to Antigravity

The result is a small, stable Antigravity-facing tool surface, even when the underlying providers differ significantly.

---

## What problem it solves

Antigravity can connect to MCP servers, but external model providers often differ in:

* authentication style
* payload format
* response format
* model discovery behavior
* token usage reporting
* timeout and error behavior
* compatibility with so-called OpenAI-compatible APIs

This project isolates those differences behind provider adapters and exposes one predictable execution model to Antigravity.

---

## Key capabilities

### Stable MCP tool surface

The software exposes a small, stable set of tools:

* `llm.chat`
* `llm.list_models`
* `router.health`

Optional extensions can be enabled without weakening the core contract.

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

---

## System overview

```text
Antigravity
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

The software succeeds because it keeps the boundary to Antigravity simple while keeping the inside disciplined.

### The Antigravity side stays simple

Antigravity sees:

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
Antigravity
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
  → result is returned to Antigravity
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
mcp-router-for-antigravity/
  README.md
  package.json
  tsconfig.json
  .env.example
  src/
    index.ts
    server/
      mcpServer.ts
      toolHandlers.ts
    core/
      router.ts
      planner.ts
      registry.ts
      policy.ts
      normalizer.ts
      errors.ts
      types.ts
    resilience/
      retryPolicy.ts
      requestBudget.ts
      circuitBreaker.ts
      concurrency.ts
      executor.ts
      attemptHistory.ts
    providers/
      openaiAdapter.ts
      glmAdapter.ts
      ollamaAdapter.ts
      compatibleAdapter.ts
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
* access to Antigravity MCP configuration
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
```

### Start the router

```bash
npm run start
```

### Connect Antigravity

Configure Antigravity to launch the router as an MCP server.

Example shape:

```json
{
  "mcpServers": {
    "mcp-router": {
      "command": "node",
      "args": ["dist/index.js"],
      "env": {
        "OPENAI_API_KEY": "${OPENAI_API_KEY}",
        "GLM_API_KEY": "${GLM_API_KEY}"
      }
    }
  }
}
```

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
* Antigravity communication
* end-to-end tool invocation
* degraded-success warnings
* structured failures

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

### Use OpenAI in Antigravity through the router

Ask Antigravity to use `llm.chat` with `provider=openai` and a supported model. The router validates the request, executes it, and returns normalized output.

### Use GLM even if Antigravity does not support it natively

Ask Antigravity to call the same `llm.chat` tool but with `provider=glm`. The router adapts request and response behavior without changing the Antigravity-facing contract.

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
* Antigravity integration works end to end

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

**Antigravity should experience a simple, stable, predictable MCP interface, even when the outside world is unreliable, inconsistent, or hostile.**
