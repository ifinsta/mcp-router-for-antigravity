# README.md

## MCP Router for Antigravity

A resilient MCP router that lets Antigravity use external LLMs and selected external tools through one stable MCP server.

It is designed for providers that Antigravity does not natively support, including providers such as OpenAI, GLM, and local/self-hosted runtimes.

---

## Why this exists

Antigravity can talk to MCP servers, but unsupported external LLM providers still need a compatibility layer.

This project provides that layer.

Instead of teaching Antigravity how to speak to every provider directly, we expose one MCP server to Antigravity and handle the complexity inside the router:

* provider-specific request mapping
* provider-specific authentication
* retries and fallback
* policy enforcement
* health and observability
* normalized request and response contracts

The result is a simple Antigravity integration with a much stronger execution model behind it.

---

## What this router does

The router sits between Antigravity and external providers.

```text
Antigravity
   │
   │ MCP
   ▼
MCP Router
   ├── validates requests
   ├── enforces policy
   ├── selects provider and model
   ├── applies retry and fallback logic
   ├── normalizes provider responses
   └── returns a stable MCP tool response
```

Supported provider directions for the first versions:

* OpenAI
* GLM
* Ollama or another local/self-hosted runtime

---

## Design goals

### Primary goals

* Give Antigravity one stable MCP integration point.
* Allow external LLM providers that are not natively supported in Antigravity.
* Hide provider-specific differences behind adapters.
* Keep the tool contract small, predictable, and easy to extend.

### Survival goals

* Keep trying while safe recovery paths still exist.
* Stop when further attempts are unsafe or useless.
* Never hide degraded execution.
* Fail clearly and explain what was tried.

### Engineering goals

* Strong boundaries between MCP, routing, providers, resilience, and infrastructure.
* Resilience that is explicit and testable.
* Operational visibility good enough for real incidents.

---

## Core features

### Stable MCP tool surface

Initial tools:

* `llm.chat`
* `llm.list_models`
* `router.health`

### Provider abstraction

Each provider is implemented as an adapter behind a normalized internal contract.

### Resilience-first execution

The router includes:

* bounded retries
* exponential backoff
* jitter
* fallback providers
* circuit breakers
* request-budget accounting
* bulkheads and concurrency limits

### Policy and safety controls

The router can enforce:

* provider allowlists
* model allowlists
* input size limits
* output token limits
* optional cost caps
* restricted passthrough behavior

### Clean output contract

Antigravity sees one consistent result shape even when providers differ internally.

---

## What makes this different

This is not just a proxy.

It is a controlled execution layer.

A normal proxy forwards requests and passes back whatever happened.
This router does more:

* it validates before execution
* it protects against known-bad recovery paths
* it tracks attempt history
* it warns when fallback or degraded paths were used
* it isolates provider-specific weirdness from Antigravity
* it stops only when there is no safe useful path left

---

## Architecture summary

The system is built around five major layers:

1. **Transport layer**

   * MCP server integration for Antigravity

2. **Application layer**

   * tool handlers
   * routing
   * policy checks
   * attempt planning

3. **Resilience layer**

   * retry policy
   * circuit breakers
   * request budgets
   * bulkheads
   * cancellation handling

4. **Domain layer**

   * normalized request/response contracts
   * error taxonomy
   * capability model
   * attempt history

5. **Infrastructure layer**

   * config
   * secrets
   * provider HTTP clients
   * logs
   * metrics

See `architecture.md` for the full design.

---

## Request flow

### `llm.chat`

```text
Antigravity
  → calls MCP tool llm.chat
  → router validates and normalizes input
  → router resolves provider/model
  → policy engine checks request
  → attempt planner builds execution plan
  → resilience layer applies budget, retry, and breaker rules
  → provider adapter executes
  → response is normalized
  → warnings and execution metadata are attached
  → stable MCP response is returned to Antigravity
```

### Final failure rule

A request should fail only when:

* the error is non-retryable
* policy blocks remaining paths
* fallback is unavailable or invalid
* circuit breakers block remaining paths
* request budget is exhausted
* maximum attempts are exhausted

---

## Initial tool contracts

### `llm.chat`

Input:

* `provider` optional if default exists
* `model` optional if default exists
* `messages`
* `temperature` optional
* `maxTokens` optional
* `timeoutMs` optional
* `fallbackProvider` optional
* `schema` optional for future structured output mode

Output:

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

Lists configured models by provider.

### `router.health`

Returns router and provider health, including useful degradation signals.

---

## Resilience model

This router is designed to behave like a survivor under pressure.

### Retry behavior

* retries are bounded
* retries use exponential backoff and jitter
* retries follow provider-specific and error-class-specific rules
* retries do not happen for unsafe or non-idempotent operations unless explicitly allowed

### Fallback behavior

* fallback only happens when configured
* fallback must pass the same policy checks as the primary path
* fallback loops are forbidden
* same-provider useless fallback is forbidden

### Circuit breakers

* dead or unstable providers should not be hammered continuously
* providers can be temporarily opened, blocked, and cautiously probed again after cooldown

### Budget control

* each request has a total time budget
* no single attempt should consume almost all of the budget when recovery paths are configured
* a new attempt should not start unless enough time remains for useful work

### Bulkheads

* one unstable provider should not drain the whole router
* per-provider concurrency limits isolate failures
* overload is rejected clearly and early when needed

### Degraded success

Successful responses can still include warnings for:

* fallback used
* truncation
* missing or estimated usage
* reduced provider capability
* normalized provider oddities

---

## Error model

The router uses explicit error categories rather than leaking raw provider errors.

Examples:

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

Errors should be:

* short
* specific
* safe to show
* useful for retry and fallback decisions

---

## Observability model

Logs are not enough by themselves.

The router should provide:

* structured logs
* request counters
* retry counts
* failure-rate metrics
* fallback-rate metrics
* provider latency metrics
* overload metrics
* circuit-breaker state metrics
* active concurrency metrics by provider

Health should be visible across three dimensions:

* configuration health
* discovery health
* execution-path health

---

## Provider strategy

### OpenAI

Supported through a dedicated adapter.

### GLM

Supported through a dedicated adapter.

Even if GLM exposes an OpenAI-compatible surface, it still gets its own adapter so compatibility drift and response differences remain isolated.

### Local/self-hosted runtimes

Local runtimes such as Ollama can be added through separate adapters and used for privacy-sensitive or controlled fallback paths.

---

## Configuration

Expected configuration categories:

* router defaults
* policy limits
* resilience settings
* provider credentials
* provider base URLs
* concurrency settings

Example environment variables:

```env
ROUTER_DEFAULT_PROVIDER=openai
ROUTER_DEFAULT_MODEL=gpt-4.1-mini
ROUTER_TIMEOUT_MS=45000
ROUTER_LOG_LEVEL=info
GLOBAL_CONCURRENCY_LIMIT=20
TOTAL_REQUEST_BUDGET_MS=60000
ALLOWED_PROVIDERS=openai,glm,ollama
ALLOWED_MODELS=gpt-4.1-mini,glm-4.5,llama3.3:70b
MAX_INPUT_CHARS=120000
MAX_OUTPUT_TOKENS=4000
MAX_COST_USD_PER_REQUEST=2.50
OPENAI_API_KEY=
GLM_API_KEY=
OLLAMA_BASE_URL=http://127.0.0.1:11434
```

Secrets must never be hardcoded.

---

## Suggested project structure

```text
mcp-router-for-antigravity/
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
    infra/
      config.ts
      logger.ts
      metrics.ts
      secrets.ts
      http.ts
      clocks.ts
    test/
      contract/
      chaos/
      load/
```

---

## Testing strategy

The router should be verified at multiple levels.

### Unit tests

* validation
* policy checks
* retry classification
* request-budget behavior
* breaker state transitions

### Adapter contract tests

* OpenAI mapping
* GLM mapping
* compatibility drift detection

### Chaos tests

* timeouts
* malformed JSON
* partial responses
* DNS failures
* rate limits
* credential revocation

### Load tests

* overload behavior
* provider isolation
* queue saturation
* concurrency limits

---

## Implementation status

This repository is currently defined by:

* `requirements.md`
* `architecture.md`
* resilience-first system behavior

The first implementation target is:

* MCP server bootstrap
* `llm.chat`
* `llm.list_models`
* `router.health`
* OpenAI adapter
* GLM adapter
* resilience layer baseline
* logging and metrics baseline

---

## Build priorities

### Phase 1

* typed config loading
* domain contracts
* provider registry
* OpenAI adapter
* GLM adapter
* MCP tool registration

### Phase 2

* retry policy
* circuit breakers
* budget management
* bulkheads
* fallback execution

### Phase 3

* health enrichment
* metrics
* local/self-hosted adapters
* stronger policy features
* structured output support

---

## Non-goals for v1

The first release is not trying to solve everything.

Out of scope for v1:

* full automatic model routing
* unrestricted external HTTP proxying
* unrestricted remote MCP passthrough
* multi-tenant isolation
* advanced billing dashboards
* complex approval workflows

---

## Why the system should work well with Antigravity

Because Antigravity already speaks MCP, our router only needs to behave like a clean MCP server with stable tools.

That means the success criteria are straightforward:

* few tools
* predictable schemas
* explicit errors
* fast enough execution
* honest warnings

If we keep those rules, Antigravity does not need to understand provider-specific complexity.

---

## Success criteria

The first release is successful when:

* Antigravity can connect to the router as an MCP server
* `llm.chat` works against OpenAI
* `llm.chat` works against GLM
* outputs are normalized across providers
* retries and fallback are controlled and explainable
* policy is enforced before upstream execution
* degraded success is surfaced through warnings
* health and observability are operational enough for debugging

---

## Related documents

* `requirements.md`
* `architecture.md`
* future: `implementation-plan.md`

---

## Next step

The next practical step is to scaffold the implementation repository and create the first working MCP server with the three initial tools.
