# architecture.md

## Project

MCP Router

## Purpose

Define the runtime architecture, module boundaries, resilience mechanisms, data flow, provider integration model, observability model, and implementation structure for the MCP router described in `requirements.md`.

This version aligns the architecture directly with the hardened resilience and operational requirements.

---

## 1. Architectural Overview

The MCP Router is a local or team-hosted service that exposes a single MCP server interface to supported clients and internally routes requests to external LLM providers and selected external tools, including the unified `browser.*` browser surface.

### Core principle

Supported clients should only need to understand one integration point:

* one MCP server
* one stable tool contract
* zero awareness of provider-specific API differences

The router is responsible for translating between:

* **client-facing MCP tools**
* **internal normalized router contracts**
* **provider-specific HTTP APIs or remote services**

### Survival principle

The router should keep trying when safe recovery paths still exist, stop when further attempts are unsafe or futile, and always make its execution path understandable.

---

## 2. Context Diagram

```text
┌─────────────────┐
│   Antigravity   │
│  MCP client     │
└────────┬────────┘
         │ MCP over stdio
         ▼
┌─────────────────────────────────────────────────────┐
│                    MCP Router                       │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │ MCP Server / Tool Handlers                    │  │
│  └──────────────────┬────────────────────────────┘  │
│                     ▼                               │
│  ┌───────────────────────────────────────────────┐  │
│  │ Validation + Policy Engine                    │  │
│  └──────────────────┬────────────────────────────┘  │
│                     ▼                               │
│  ┌───────────────────────────────────────────────┐  │
│  │ Router Core / Attempt Planner                 │  │
│  └──────────────────┬────────────────────────────┘  │
│                     ▼                               │
│  ┌───────────────────────────────────────────────┐  │
│  │ Resilience Layer                              │  │
│  │ - retry policy                                │  │
│  │ - request budget                              │  │
│  │ - circuit breakers                            │  │
│  │ - bulkheads / concurrency guards              │  │
│  └──────────────────┬────────────────────────────┘  │
│                     ▼                               │
│  ┌───────────────────────────────────────────────┐  │
│  │ Provider Registry / Capability Resolver       │  │
│  └────────┬─────────────────┬─────────────────┬──┘  │
│           ▼                 ▼                 ▼      │
│    OpenAI Adapter      GLM Adapter      Ollama      │
│           ▼                 ▼                 ▼      │
│      External APIs / Local Runtime / Remote Tools   │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │ Observability Layer                           │  │
│  │ - logs                                        │  │
│  │ - counters                                    │  │
│  │ - latency metrics                             │  │
│  │ - failure/fallback metrics                    │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

---

## 3. Architecture Style

The system follows a **layered modular architecture** with explicit provider adapters and a dedicated resilience layer.

### Layers

1. **Transport layer**

   * MCP server transport
   * tool registration
   * tool input/output handling

2. **Application layer**

   * tool orchestration
   * request validation
   * policy enforcement
   * routing decisions
   * attempt planning
   * fallback behavior

3. **Resilience layer**

   * retry policy
   * exponential backoff and jitter
   * circuit breakers
   * bulkheads and concurrency control
   * request-budget accounting
   * cancellation propagation

4. **Domain layer**

   * normalized request/response contracts
   * provider capability model
   * error taxonomy
   * attempt history model
   * degraded-success model

5. **Infrastructure layer**

   * provider HTTP clients
   * secrets/config loading
   * logging and metrics
   * health checking
   * fault-injection hooks for tests

### Why this style

This keeps Antigravity integration stable while allowing provider-specific logic and resilience policies to evolve independently.

---

## 4. Primary Components

### 4.1 MCP Server

Responsible for exposing tools to Antigravity.

#### Responsibilities

* register MCP tools
* receive tool calls
* validate raw input presence and basic shape
* call application services
* map application results to MCP output
* map failures to structured MCP errors

#### Does not

* contain provider-specific logic
* perform provider HTTP calls directly
* make retry or circuit-breaker decisions itself

---

### 4.2 Tool Handlers

Thin application entry points for each tool.

#### Initial handlers

* `handleLlmChat`
* `handleListModels`
* `handleRouterHealth`
* `handleBrowserTool`

#### Responsibilities

* parse tool input
* invoke validation and normalization
* call router services
* return normalized response payloads

---

### 4.3 Router Core

The central orchestration component.

#### Responsibilities

* resolve provider/model defaults
* build execution plan
* call policy engine
* delegate to resilience layer for safe execution
* collect attempt history
* normalize success and failure output
* expose warnings and actual execution path

#### Core rule

The router core only speaks the internal normalized domain contracts.

---

### 4.4 Attempt Planner

A dedicated planning component inside the router core.

#### Responsibilities

* determine primary attempt
* determine retry eligibility
* determine fallback eligibility
* allocate request budget across attempts
* prevent futile recovery paths

#### Design constraints

* no fallback loops
* no same-provider no-op fallback
* no recovery path that violates policy
* no new attempt when insufficient budget remains

---

### 4.5 Provider Registry

Maps provider names to adapter instances.

#### Responsibilities

* register configured adapters at startup
* expose lookup by provider id
* expose provider capability metadata
* reject unknown providers early

#### Example registry entries

* `openai`
* `glm`
* `ollama`

---

### 4.6 Provider Adapters

Encapsulate provider-specific API details.

Each provider adapter translates internal router requests into provider-native requests and converts provider-native responses back into normalized router responses.

#### Responsibilities

* auth header or credential mapping
* endpoint/path selection
* request shape mapping
* response extraction
* usage/token parsing
* provider-specific error mapping
* capability declaration
* execution health probing

#### Rule

No other part of the system should know provider-specific payload formats.

---

### 4.7 Policy Engine

Validates whether a request is allowed before execution.

#### Responsibilities

* validate allowed providers
* validate allowed models
* enforce max input size
* enforce max output tokens
* enforce optional cost caps
* enforce restricted passthrough rules
* ensure retry and fallback do not bypass policy

#### Result

* allow
* deny with policy error
* allow with warnings

---

### 4.8 Resilience Layer

Owns all recovery, protection, and security logic.

#### Responsibilities

* classify retryable and non-retryable failures
* apply bounded retries
* apply exponential backoff with jitter
* enforce maximum attempts per request and per provider
* enforce total request budget across all attempts
* maintain attempt history
* trigger fallback when safe and configured
* consult circuit breakers before dispatch
* enforce bulkheads and concurrency limits
* propagate cancellation to upstream calls when supported
* enforce security policy for browser and external operations

#### Subcomponents

* `RetryPolicyEngine`
* `RequestBudgetManager`
* `CircuitBreakerRegistry`
* `ConcurrencyLimiter`
* `AttemptRecorder`
* `SecurityPolicyEngine`

---

### 4.9 Browser Orchestration Layer

Owns browser-session lifecycle, browser capability reporting, transport
selection, browser evidence collection, and browser-specific execution mapping
behind one normalized contract.

#### Responsibilities

* manage browser sessions and session identifiers
* expose browser capability truth through a typed capability model
* select browser transport internally without leaking transport-specific payloads
* normalize browser artifacts such as screenshots, profiles, audits, and metrics
* surface degraded browser execution through warnings
* reject unsupported browser operations with structured sanitized errors

#### Transport policy

* Chrome uses CDP as the primary control path and may use the extension for augmentation.
* Edge uses Chromium CDP.
* Firefox uses Marionette/WebDriver-style control for core actions.
* Safari remains contract-visible with explicit capability gating for unsupported areas.

#### Boundary rule

The MCP-facing browser contract must stay transport-neutral.

Public tools may expose session IDs, tab IDs, warnings, artifacts, and
structured failures, but must not expose raw transport-native payloads as the
primary contract.

---

### 4.11 Browser Intelligence Layer

Owns evidence collection, failure analysis, and browser-assisted diagnostics.

#### Responsibilities

* capture structured evidence capsules from browser sessions
* classify failures into categories (app_code, timing, selector_drift, backend_failure, environment)
* detect flaky tests and patterns across multiple runs
* map evidence to probable code ownership and root causes
* evaluate assertions across functional, visual, a11y, performance, ux, and network categories
* verify fixes by comparing runs before and after changes
* generate PR-ready markdown summaries from browser evidence

#### Subcomponents

* `EvidenceCapsule` — capture screenshots, DOM, console, network, performance
* `FailureClassifier` — rule-based failure classification
* `FlakeAnalyzer` — multi-run flake detection with historical tracking
* `RootCauseMapper` — heuristic mapping from evidence to code ownership
* `AssertionModel` — multi-category browser assertion evaluation
* `FixVerification` — rerun comparison with verdicts
* `PRSummaryGenerator` — GitHub-ready markdown reports

---

### 4.12 Workflow Recording Layer

Owns record-to-test generation and browser workflow capture.

#### Responsibilities

* record browser interactions as structured workflows
* generate executable `browser.*` workflow code from recordings
* export workflows with stable assertions
* support visual and performance expectation generation

#### Subcomponents

* `WorkflowRecorder` — record-to-test with code generation

---

### 4.13 Browser Context Layer

Owns automatic injection of browser context into AI conversations.

#### Responsibilities

* automatically attach compact browser context when active session exists
* include URL, page title, active tab id, selected text, and artifact references
* make injection configurable for privacy and noise control
* support both Agent Mode and Router Mode contexts

#### Subcomponents

* `BrowserContext` — auto-injection of browser context into AI conversations

---

### 4.14 Security Policy Engine

Enforces security controls for browser and external operations.

#### Responsibilities

* enforce domain allowlists for browser navigation
* maintain action audit logs for compliance and debugging
* redact secrets from logs and responses
* support high-risk action warnings
* enable session isolation and permission control

#### Configuration

* `SECURITY_ALLOWED_DOMAINS` — comma-separated domain allowlist
* `SECURITY_AUDIT_LOG_ENABLED` — enable/disable audit logging
* `SECURITY_SECRET_REDACTION_PATTERNS` — patterns for secret redaction

---

### 4.15 Circuit Breaker Registry

Tracks health state per provider and optionally per provider+operation.

#### Responsibilities

* open circuit after persistent failure threshold
* block known-bad dispatches temporarily
* enter cautious reopen state after cooldown
* close again on proven healthy execution
* expose breaker state to health and metrics

#### States

* `closed`
* `open`
* `half_open` or `cooldown_probe`

---

### 4.16 Request Budget Manager

Controls total budget over the full execution path.

#### Responsibilities

* start request with total time budget
* allocate attempt budgets conservatively
* ensure fallback or retry attempts have remaining useful time
* stop execution when insufficient budget remains

#### Guardrail

The first attempt must not consume nearly all available time when safe recovery paths are configured.

---

### 4.17 Concurrency Limiter / Bulkheads

Prevents one failing provider from exhausting the router.

#### Responsibilities

* enforce per-provider concurrency limits
* enforce optional global concurrency limits
* reject excess work gracefully when overloaded
* isolate unstable providers from unrelated providers

---

### 4.18 Dual-Mode Architecture

The router supports two operational modes with conditional feature registration.

#### Modes

* **Agent Mode** — host IDE's AI owns chat; ifin provides MCP tools and browser capabilities
* **Router Mode** — ifin owns model routing where supported; same MCP tools and browser capabilities

#### Key principle

Modes should only change chat ownership, not the core tool or browser experience.

#### Implementation

* `RouterMode` type with values `'agent' | 'router'`
* Mode persistence to `~/.ifin-platform/mode.json`
* Conditional `McpRouterLanguageModelProvider` registration in VS Code extension (Router mode only)
* Mode API: `GET/POST /api/mode` endpoints
* First-run mode selection UI on all platforms
* Mode switching via VS Code QuickPick, Electron Settings, Chrome badge click

#### Mode-specific behavior

| Feature | Agent Mode | Router Mode |
|---------|------------|-------------|
| MCP tools | ✓ | ✓ |
| Browser automation | ✓ | ✓ |
| Browser bridge | ✓ | ✓ |
| Native LM provider | ✗ | ✓ (VS Code) |
| Provider key config | Optional | Required |

---

### 4.19 Normalizer

Defines the common request and response contracts.

#### Responsibilities

* convert MCP input into internal request shape
* ensure consistent response format from all adapters
* ensure consistent error payload shape
* filter provider-specific metadata from user-facing output
* normalize degraded-success warnings

---

### 4.20 Health Service

Provides runtime status of router and providers.

#### Responsibilities

* report startup/config state
* report provider registration state
* report circuit-breaker state
* distinguish configuration health, discovery health, and execution health
* surface warnings for partial degradation

---

### 4.21 Config and Secrets Layer

Loads environment-driven configuration and secrets.

#### Responsibilities

* parse environment variables
* validate required settings
* provide typed configuration objects
* make secrets accessible only where needed

---

### 4.22 Logging and Metrics Layer

Provides operational visibility.

#### Responsibilities

* structured logs for request path and failures
* counters for request volume, retries, failures, and fallbacks
* latency histograms or timers
* circuit-breaker and overload metrics
* support alerting and runtime diagnosis

---

## 5. Module Boundaries

```text
src/
  index.ts                  # startup entry
  server/
    mcpServer.ts            # MCP bootstrap and registration
    toolHandlers.ts          # MCP tool handlers
    extensionApiServer.ts    # HTTP/SSE API for extension and desktop
  core/
    router.ts               # orchestration and final response shaping
    planner.ts               # attempt planning and path selection
    registry.ts              # provider registry
    policy.ts                # policy engine
    normalizer.ts            # internal schema mapping
    errors.ts                # error taxonomy and helpers
    types.ts                 # domain types and interfaces
    evidenceCapsule.ts       # evidence capture for browser diagnostics
    failureClassifier.ts     # failure classification engine
    flakeAnalyzer.ts         # flaky test detection
    rootCauseMapper.ts       # evidence to code ownership mapping
    assertionModel.ts        # multi-category assertion evaluation
    fixVerification.ts       # fix verification with reruns
    prSummaryGenerator.ts    # PR-ready summary generation
    workflowRecorder.ts      # record-to-test generation
    browserContext.ts        # auto-injection of browser context
    browserContract.ts       # browser capability matrix
    modeManager.ts           # dual-mode state management
  resilience/
    retryPolicy.ts          # retry rules and backoff
    requestBudget.ts        # total budget accounting
    circuitBreaker.ts       # breaker state machine
    concurrency.ts          # bulkheads and overload control
    executor.ts             # protected provider execution wrapper
    attemptHistory.ts       # attempt recording
    securityPolicy.ts       # security policy engine
  providers/
    openaiAdapter.ts        # OpenAI integration
    glmAdapter.ts           # GLM integration
    ollamaAdapter.ts        # local/self-hosted integration
  infra/
    config.ts               # typed config loading
    logger.ts               # logger creation
    metrics.ts              # metrics implementation
    secrets.ts              # secret access utilities
    http.ts                 # shared HTTP client helpers
    clocks.ts               # monotonic timing helpers
  browser/
    browserBridge.ts        # browser bridge communication
    browserManager.ts       # browser session management
    cdpClient.ts            # Chrome DevTools Protocol client
    extensionBridge.ts      # Chrome extension bridge
    multiTabManager.ts      # multi-tab orchestration
  test/
    contract/
    chaos/
    load/
    integration/
    unit/
```

### Boundary rules

* `server/` may depend on `core/`
* `core/` may depend on `resilience/` and provider registry interfaces
* `resilience/` may depend on provider-agnostic domain types and infra helpers
* `providers/` may depend on `infra/`
* `providers/` must not depend on `server/`
* `infra/` must not depend on `server/` or provider-specific code

---

## 6. Domain Model

### 6.1 Normalized Chat Request

```ts
export interface NormalizedChatRequest {
  provider?: string;
  model?: string;
  messages: Array<{
    role: "system" | "user" | "assistant" | "tool";
    content: string;
    name?: string;
  }>;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  fallbackProvider?: string;
  schema?: Record<string, unknown> | null;
  metadata?: {
    requestId?: string;
    source?: string;
    sensitivity?: string;
  };
}
```

### 6.2 Normalized Chat Response

```ts
export interface NormalizedChatResponse {
  provider: string;
  model: string;
  outputText: string;
  finishReason: string;
  usage: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    accuracy?: "exact" | "estimated" | "unavailable";
  } | null;
  latencyMs: number;
  costEstimate: number | null;
  warnings: string[];
  fallbackUsed: boolean;
}
```

### 6.3 Attempt Record

```ts
export interface AttemptRecord {
  attemptNumber: number;
  provider: string;
  model: string;
  phase: "primary" | "retry" | "fallback";
  startedAtMs: number;
  endedAtMs?: number;
  status: "success" | "failed" | "skipped" | "blocked";
  errorCode?: string;
  retryable?: boolean;
  breakerState?: "closed" | "open" | "half_open";
  warnings?: string[];
}
```

### 6.4 Provider Adapter Contract

```ts
export interface ProviderAdapter {
  readonly name: string;
  readonly capabilities: {
    chat: boolean;
    structured: boolean;
    embeddings: boolean;
    streaming: boolean;
    vision: boolean;
  };

  listModels(): Promise<ModelInfo[]>;
  chat(request: NormalizedChatRequest): Promise<NormalizedChatResponse>;
  healthCheck(): Promise<ProviderHealthStatus>;
}
```

---

## 7. Request Lifecycle

### 7.1 `llm.chat` flow

```text
Antigravity
  → MCP tool call: llm.chat
  → MCP Server receives request
  → Tool Handler parses input
  → Normalizer builds internal request
  → Validation verifies fields, ranges, roles, and sizes
  → Router Core resolves provider/model defaults
  → Policy Engine validates primary path
  → Attempt Planner builds execution plan
  → Resilience Layer checks circuit breaker and budget
  → Bulkhead acquires execution slot
  → Provider adapter executes request
  → Response or failure classified
  → Retry / fallback considered if safe and useful
  → Attempt history recorded
  → Router Core shapes final success or terminal failure
  → MCP response returned to Antigravity
```

### 7.2 Terminal failure rule

A request may terminate only when one of the following is true:

* the failure is non-retryable
* policy blocks all remaining recovery paths
* no configured fallback path remains
* circuit breakers block remaining paths
* request budget is no longer sufficient for useful work
* maximum attempts have been exhausted

---

## 8. Routing and Recovery Strategy

### Initial routing mode

Use **explicit routing** in v1.

The caller may specify:

* `provider`
* `model`
* optional `fallbackProvider`

If omitted:

* use `ROUTER_DEFAULT_PROVIDER`
* use `ROUTER_DEFAULT_MODEL`

### Recovery path order

1. validate primary path
2. execute primary path
3. if failure is retryable and policy allows, consult retry policy
4. if retry not viable or exhausted, consider fallback path
5. stop only when no safe useful option remains

### Retry rules

Retry rules should be configurable by:

* provider
* operation
* error class

Supported retryable classes:

* timeout
* rate limit
* DNS or network transient failure
* temporary upstream unavailability
* malformed upstream response only if configured safe to retry

Non-retryable classes include:

* validation errors
* policy denial
* unknown provider
* unsupported capability
* clearly invalid credentials detected locally

---

## 9. Circuit Breaker Design

### Breaker scope

Minimum scope:

* one breaker per provider

Optional future scope:

* provider + operation
* provider + model class

### State transitions

* `closed` → normal execution
* `open` → short-circuit requests after failure threshold
* `half_open` → allow limited probe requests after cooldown
* return to `closed` only after successful probe(s)

### Breaker inputs

* recent failure rate
* consecutive failures
* timeout spikes
* upstream unavailability

### Breaker outputs

* execution allowed
* execution blocked
* probe allowed under cooldown

---

## 10. Bulkhead and Concurrency Design

### Goals

* one unstable provider must not starve unrelated providers
* overload must fail fast and clearly
* concurrency limits should be configurable globally and per provider

### Design

* global semaphore for total active work
* provider-local semaphore for provider isolation
* overload rejection error when no slot is available inside configured queue policy
* optional bounded queue for short waiting windows

---

## 11. Request Budget Design

### Budget types

* total request budget
* per-attempt budget
* optional cooldown-aware retry delay budget

### Rules

* budget uses monotonic timers
* planner must reserve enough budget for possible recovery path
* first attempt must not consume nearly all budget when fallback is configured
* no new attempt starts without a minimum viable remaining budget

---

## 12. Provider Integration Design

### 12.1 OpenAI Adapter

#### Responsibilities

* map normalized request to OpenAI request format
* send authenticated request using OpenAI API key
* extract text, usage, finish reason
* translate provider errors into router errors

#### Notes

The adapter should target one selected stable OpenAI API surface and isolate assumptions about that surface.

---

### 12.2 GLM Adapter

#### Responsibilities

* map normalized request into GLM request format
* authenticate using GLM credentials
* normalize GLM response shape
* handle compatibility differences explicitly

#### Design rule

Even if the provider claims OpenAI compatibility, GLM must still have its own adapter to isolate differences in behavior, parameters, usage semantics, and response shapes.

---

### 12.3 Ollama or Local Adapter

#### Responsibilities

* support local endpoint configuration
* normalize local model behavior
* support privacy-sensitive and controlled fallback paths

---

## 13. Error Architecture

### Error categories

* `ValidationError`
* `PolicyError`
* `ConfigurationError`
* `AuthenticationError`
* `TimeoutError`
* `NetworkError`
* `OverloadError`
* `UpstreamError`
* `UnsupportedCapabilityError`
* `ProviderNotFoundError`

### Design goals

* clear enough for debugging
* safe for user-facing output
* no secret leakage
* precise enough to drive retry, fallback, breaker, and alerting decisions

### Retryable errors

* timeout
* rate limit
* temporary upstream unavailability
* transient network failures
* selected malformed upstream responses when configured safe to retry

### Non-retryable errors

* invalid input
* policy denial
* unknown provider
* unsupported model
* unsupported capability
* invalid credentials format detected locally
* overload rejection where queueing is not allowed

---

## 14. Configuration Architecture

### Startup config responsibilities

At startup, the router must:

* load environment variables
* validate required config presence
* build a typed config object
* initialize provider adapters only for configured providers
* initialize breaker and retry settings
* fail fast for invalid critical configuration

### Example config shape

```ts
export interface AppConfig {
  router: {
    defaultProvider: string;
    defaultModel: string;
    timeoutMs: number;
    logLevel: string;
    globalConcurrencyLimit: number;
    totalRequestBudgetMs: number;
  };
  policy: {
    allowedProviders: string[];
    allowedModels: string[];
    maxInputChars: number;
    maxOutputTokens: number;
    maxCostUsdPerRequest?: number;
  };
  resilience: {
    maxAttemptsPerRequest: number;
    retry: Record<string, unknown>;
    circuitBreaker: Record<string, unknown>;
    providerConcurrency: Record<string, number>;
  };
  providers: {
    openai?: {
      apiKey: string;
      baseUrl?: string;
    };
    glm?: {
      apiKey: string;
      baseUrl?: string;
    };
    ollama?: {
      baseUrl: string;
    };
  };
}
```

---

## 15. Security Architecture

### Security controls

* secrets loaded from environment or secret manager only
* secrets are never returned by tools
* secrets are excluded from standard logs
* provider allowlists enforced before execution
* model allowlists enforced before execution
* passthrough features disabled by default
* upstream errors sanitized before exposure
* arbitrary outbound access avoided in v1

### Logging controls

Default logging should include:

* request id
* provider
* model
* latency
* status
* fallback used
* retry count
* breaker state when relevant

Default logging should exclude:

* API keys
* raw auth headers
* full prompt bodies
* full provider-native request payloads

---

## 16. Observability Architecture

### Logs

Use structured logs.

Example fields:

* `requestId`
* `toolName`
* `provider`
* `model`
* `status`
* `latencyMs`
* `fallbackUsed`
* `retryCount`
* `breakerState`
* `errorCode`

### Metrics

The architecture must support at least:

* request counts
* success and failure counts by provider
* failure rate by error class
* latency by provider
* retry counts
* fallback rate
* overload rejections
* circuit-breaker open/close transitions
* active concurrency by provider

### Health views

Expose separate views for:

* configuration health
* model discovery health
* execution-path health

---

## 17. Startup Sequence

```text
Process starts
  → load config
  → validate config and secrets
  → initialize logger and metrics
  → initialize provider adapters
  → register adapters in registry
  → initialize circuit breakers and concurrency guards
  → initialize policy engine and budget manager
  → initialize router core and attempt planner
  → register MCP tools
  → start stdio transport
```

### Failure mode

Startup must fail if:

* no usable execution provider exists
* critical secrets are missing for enabled providers
* resilience configuration is invalid
* tool registration cannot complete safely

---

## 18. Tool Design

### 18.1 `llm.chat`

Primary execution tool for chat completion.

#### Responsibilities

* receive provider/model/messages
* validate payload
* call router core
* return normalized output

#### Guarantees

* stable response format
* provider-specific fields hidden
* fallback state visible through `fallbackUsed`
* warnings visible for degraded execution
* actual executed provider and model exposed

---

### 18.2 `llm.list_models`

Lists available models from configured adapters.

#### Responsibilities

* query one provider or all providers
* aggregate partial results
* return warnings for providers that fail to respond

---

### 18.3 `router.health`

Provides router and provider health information.

#### Responsibilities

* report overall router status
* list configured providers
* return provider health state
* return breaker and overload signals when relevant
* surface configuration warnings

---

### 18.4 Browser Intelligence Tools

Tools for evidence capture, failure analysis, and workflow verification.

#### `browser.evidence.capture`

Capture structured evidence from a browser session including screenshots, DOM, console, network, and performance data.

#### `browser.evidence.explain`

Generate human-readable explanation of captured evidence with failure classification.

#### `browser.evidence.analyze_flake`

Analyze multiple runs to detect flaky test patterns and classify failure sources.

#### `browser.evidence.root_cause`

Map evidence to probable code ownership and root cause suggestions.

#### `browser.tabs.list_all`

List all tabs across browser sessions with metadata.

#### `browser.tabs.switch`

Switch active tab within a browser session.

#### `browser.recorder.start`, `browser.recorder.stop`, `browser.recorder.export`

Record browser interactions and generate executable workflow code.

#### `browser.assertions.evaluate`

Evaluate assertions across functional, visual, a11y, performance, ux, and network categories.

#### `browser.verification.run`

Run fix verification comparing before and after states.

#### `browser.pr_summary.generate`

Generate GitHub-ready PR summary from browser evidence and verification results.

---

### 18.5 Dual-Mode API Endpoints

HTTP endpoints for mode management and browser intelligence.

#### Mode Management

* `GET /api/mode` — get current mode
* `POST /api/mode` — set mode

#### Browser Tab Management

* `GET /api/browser/tabs` — list all tabs
* `GET /api/browser/auto-context` — get browser context for AI injection
* `GET /api/browser/capabilities` — get per-browser capability matrix

#### Evidence and Intelligence

* `POST /api/evidence/capture` — capture evidence capsule
* `POST /api/evidence/explain` — explain evidence
* `POST /api/evidence/analyze-flake` — analyze flaky patterns
* `POST /api/evidence/root-cause` — map to root cause

#### Assertions and Verification

* `POST /api/assertions/evaluate` — evaluate assertions
* `POST /api/verification/run` — run fix verification

#### Workflow Recording

* `POST /api/recorder/start` — start recording
* `POST /api/recorder/stop` — stop recording
* `GET /api/recorder/export` — export workflow code

#### PR Summary

* `POST /api/pr-summary/generate` — generate PR summary

#### Security

* `GET /api/security/policy` — get security policy
* `GET /api/security/audit-log` — get audit log

---

## 19. Testing and Verification Architecture

### Test layers

1. **unit tests**

   * validation logic
   * retry policy
   * breaker state transitions
   * budget accounting

2. **adapter contract tests**

   * OpenAI response mapping
   * GLM response mapping
   * compatibility drift detection

3. **chaos tests**

   * timeouts
   * malformed JSON
   * partial responses
   * DNS failures
   * rate limits
   * credential revocation

4. **load and concurrency tests**

   * provider isolation
   * overload behavior
   * queue saturation

### Fault injection hooks

Adapters and HTTP layer should support test-mode injection for:

* delayed responses
* corrupt responses
* connection resets
* auth failures
* flaky rate limiting

---

## 20. Scalability and Evolution

### v1 design goal

Build a minimal, clean baseline that supports OpenAI and GLM with reliable normalized routing and explicit resilience controls.

### Extension points

The architecture should later support:

* structured outputs
* embeddings
* streaming
* policy plug-ins
* additional providers
* remote MCP passthrough with allowlists
* cost-aware routing
* multi-tenant isolation

### Stability rule

Future capabilities must extend the router without breaking existing MCP tool contracts.

---

## 21. Architecture Decisions

### AD-1 One MCP server to Antigravity

**Decision:** expose a single MCP router to Antigravity.

**Reason:** keeps the editor integration simple and stable.

### AD-2 Dedicated adapter per provider

**Decision:** create separate adapters for OpenAI and GLM.

**Reason:** avoids hidden incompatibilities and preserves clean boundaries.

### AD-3 Explicit routing in v1

**Decision:** require explicit provider selection or use configured defaults.

**Reason:** simplest reliable approach for first release.

### AD-4 Stdio transport first

**Decision:** use MCP over stdio for the initial implementation.

**Reason:** simplest integration and lowest operational overhead.

### AD-5 Dedicated resilience layer

**Decision:** implement retries, breakers, bulkheads, and budgets as first-class architecture components.

**Reason:** resilience must be explicit and testable, not scattered across adapters.

---

## 22. Open Questions

These do not block v1, but should be resolved during implementation:

* Which exact OpenAI API surface will the adapter target?
* Which exact GLM API surface will be used?
* Should malformed upstream responses ever be retried automatically?
* What is the minimum viable remaining budget required before a retry or fallback attempt?
* Should circuit breakers be provider-wide only in v1 or operation-aware from the start?

---

## 23. Build Readiness Summary

This architecture is implementation-ready for a first release when the following are built:

* typed configuration loader
* domain contracts
* provider registry
* OpenAI adapter
* GLM adapter
* resilience layer with retry, breaker, concurrency, and budget controls
* router core with attempt planning and fallback
* MCP tool registration for `llm.chat`, `llm.list_models`, and `router.health`
* structured logging and metrics
* adapter contract tests and chaos tests

At that point, Antigravity can use unsupported external LLM providers through one stable MCP router with explicit recovery and operational safety.
