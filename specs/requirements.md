# requirements.md

## Project

MCP Router for Antigravity

## Purpose

Build an MCP router that allows Antigravity to use external tools and external LLM providers that are not natively supported by Antigravity.

The router will present a single MCP server interface to Antigravity and internally route requests to supported external providers such as OpenAI, GLM, local models, internal APIs, and optionally other MCP servers.

## Problem Statement

Antigravity can connect to MCP servers, but an external provider may not be directly supported in Antigravity. We need a stable integration layer that:

* exposes a small, consistent MCP tool surface to Antigravity
* hides provider-specific API differences
* centralizes authentication and secrets
* supports routing, fallback, and policy controls
* makes it easy to add new providers later without changing Antigravity integration

## Objectives

### Primary objectives

* Enable Antigravity to call unsupported external LLMs through MCP.
* Enable Antigravity to call selected external tools through MCP.
* Provide a single router layer that normalizes all provider requests and responses.
* Keep the Antigravity-facing integration stable even when providers change.

### Secondary objectives

* Support multiple providers with explicit provider selection.
* Support provider fallback on timeout, rate limit, or failure.
* Enforce security, policy, and cost controls.
* Provide health visibility and basic observability.

## Scope

### In scope

* MCP server implementation for Antigravity integration
* External LLM routing
* Provider adapters for OpenAI and GLM
* Optional adapter for local/self-hosted models such as Ollama or vLLM
* Request and response normalization
* Policy validation before provider execution
* Secret management through environment variables or secret manager
* Logging, timeout handling, and health checks
* Provider fallback support

### Out of scope for v1

* Full automatic model routing
* Advanced billing dashboards
* Multi-tenant workspace isolation
* Arbitrary open internet HTTP proxying
* Unrestricted passthrough to remote MCP servers
* Complex approval workflows

## Users

* Developer using Antigravity
* Platform engineer maintaining integrations
* Team managing external model providers and credentials

## Assumptions

* Antigravity can connect to the router as an MCP server.
* External providers expose reachable APIs.
* Credentials are available outside source control.
* The first version will run in a trusted developer or team environment.

## High-Level Architecture

```text
Antigravity
   │
   │ MCP
   ▼
MCP Router
   ├── MCP Tool Handlers
   ├── Router Core
   ├── Provider Registry
   ├── Provider Adapters
   ├── Policy Engine
   ├── Request/Response Normalizer
   ├── Secrets/Auth Layer
   ├── Logging and Metrics
   └── Health and Fallback Logic
```

## Functional Requirements

### FR-1 MCP server interface

The system shall expose a valid MCP server interface that Antigravity can connect to.

#### Acceptance criteria

* Antigravity can start and communicate with the router as an MCP server.
* The router registers and exposes the configured MCP tools successfully.
* Invalid MCP requests return structured errors.

### FR-2 Stable tool surface

The system shall expose a small and stable tool surface to Antigravity.

#### Required tools

* `llm.chat`
* `llm.list_models`
* `router.health`

#### Optional future tools

* `llm.generate_structured`
* `llm.embed`
* `router.list_providers`
* `router.switch_default_provider`
* `tool.call_remote_mcp`

#### Acceptance criteria

* Tools appear consistently regardless of underlying provider.
* Tool names and input structure remain stable across providers.

### FR-3 External LLM provider support

The system shall support routing requests to external LLM providers.

#### Minimum provider support for initial release

* OpenAI
* GLM

#### Optional early provider support

* Ollama
* vLLM or another OpenAI-compatible self-hosted endpoint

#### Acceptance criteria

* A request can be sent to a selected provider and return a normalized response.
* Provider-specific authentication is applied correctly.
* Unsupported provider operations return a clear error.

### FR-4 Provider abstraction layer

The system shall implement each provider through a common adapter contract.

#### Acceptance criteria

* New providers can be added without changing the Antigravity-facing MCP tools.
* Providers declare supported capabilities such as chat, embeddings, structured output, or streaming.
* Router logic depends on the common adapter contract instead of provider-specific code.

### FR-5 Request normalization

The system shall convert incoming MCP tool inputs into a normalized internal request format.

#### Acceptance criteria

* Chat requests from Antigravity are mapped into a standard internal schema.
* Provider-specific field differences are handled inside adapters.
* Invalid or incomplete requests are rejected before provider execution.

### FR-6 Response normalization

The system shall normalize provider responses into a consistent MCP tool output.

#### Acceptance criteria

* Responses include a consistent shape for provider, model, output text, finish reason, usage, latency, and warnings.
* Provider-specific response differences do not leak to Antigravity.
* Error responses are mapped into clear and actionable router errors.

### FR-7 Explicit provider selection

The system shall support explicit provider selection in tool input.

#### Acceptance criteria

* A caller can specify `provider` and `model` in `llm.chat`.
* The router rejects requests for disallowed providers or models.
* The router uses configured defaults when optional fields are omitted.

### FR-8 Provider fallback

The system shall support fallback to a secondary provider when the primary provider fails under defined conditions.

#### Fallback conditions

* timeout
* rate limit
* transient upstream failure
* provider unavailable

#### Acceptance criteria

* Fallback is attempted only when configured.
* The response indicates whether fallback occurred.
* Non-retryable validation or policy errors do not trigger fallback.

### FR-9 Policy enforcement

The system shall apply policy checks before sending requests to external providers.

#### Minimum policy checks

* allowed providers
* allowed models
* maximum input size
* maximum output token limit
* optional per-request cost cap
* restricted remote tool access

#### Acceptance criteria

* Disallowed requests are blocked before upstream execution.
* Policy failures return clear messages.
* Policy rules are configurable through environment or config.

### FR-10 Secret and authentication handling

The system shall manage provider credentials securely.

#### Acceptance criteria

* Secrets are loaded from environment variables or secret manager.
* Secrets are never returned in responses.
* Secrets are not written to normal logs.

### FR-11 Health reporting

The system shall expose router and provider health through `router.health`.

#### Acceptance criteria

* The health tool returns router status.
* The health tool includes provider health or availability state.
* Misconfiguration is surfaced as warnings when possible.

### FR-12 Model discovery

The system shall expose available models through `llm.list_models`.

#### Acceptance criteria

* The tool can list models for one provider or all configured providers.
* Model capability metadata can be returned when available.
* Failures from one provider do not prevent partial results from others when possible.

## Non-Functional Requirements

### NFR-1 Clarity and maintainability

* The codebase must be organized so that provider logic, routing logic, policy logic, and MCP server logic are clearly separated.
* Adding a new provider should require minimal change outside the provider adapter and registration layer.

### NFR-2 Reliability

* Provider calls must support timeout configuration.
* The system should handle transient upstream failures gracefully.
* The router must fail safely and return structured errors.
* The system must implement bounded retry policies with exponential backoff, jitter, and maximum-attempt limits.
* Retry policy must support separate rules per provider and per retryable error class.
* The system must implement circuit-breaker behavior to stop hammering persistently failing providers and reopen cautiously after cooldown.
* The system must implement bulkheads and concurrency limits so that one failing provider cannot exhaust the whole router.
* The system must enforce total request-budget accounting across all attempts and recovery paths.

### NFR-3 Security

* Raw secrets must never be exposed in output.
* Arbitrary URL access must be disabled by default.
* Remote MCP passthrough must be disabled or allowlisted.
* Logs should avoid storing full prompt bodies by default.

### NFR-4 Performance

* The router should add minimal overhead beyond provider response time.
* Health and model listing tools should return within reasonable operational limits.
* Request validation should happen before expensive upstream execution.

### NFR-5 Observability

* The system should log request metadata, provider selection, latency, fallback events, and errors.
* The system must provide actionable observability beyond logs alone.
* The system must expose or support counters, latency metrics, failure-rate metrics, and fallback-rate metrics.
* The system should support future metrics integration.

### NFR-6 Configurability

* Default provider, default model, timeouts, allowlists, and policy limits must be configurable.
* Configuration should be environment-driven for the first release.

## Interface Requirements

### Tool: `llm.chat`

#### Inputs

* `provider`: string, optional if default exists
* `model`: string, optional if default exists
* `messages`: array, required
* `temperature`: number, optional
* `maxTokens`: number, optional
* `schema`: object, optional for future structured output mode
* `fallbackProvider`: string, optional
* `timeoutMs`: number, optional

#### Outputs

* `provider`: string
* `model`: string
* `outputText`: string
* `finishReason`: string
* `usage`: object or null
* `latencyMs`: number
* `costEstimate`: number or null
* `warnings`: array
* `fallbackUsed`: boolean

### Tool: `llm.list_models`

#### Inputs

* `provider`: string, optional

#### Outputs

* `providers`: array
* `models`: array
* `capabilities`: object or array depending on implementation
* `warnings`: array

### Tool: `router.health`

#### Inputs

* none

#### Outputs

* `status`: string
* `router`: object
* `providers`: array
* `warnings`: array

## Provider Requirements

### OpenAI adapter requirements

* Must support chat requests for the selected OpenAI API surface.
* Must authenticate using configured API key.
* Must normalize OpenAI responses into router output format.

### GLM adapter requirements

* Must support chat requests for the selected GLM API surface.
* Must authenticate using configured API key.
* Must map GLM-specific request and response fields into the router contract.
* Must not assume perfect OpenAI compatibility without adapter-level handling.

### Local/self-hosted adapter requirements

* Should support at least one local or self-hosted provider in early versions.
* Must allow base URL configuration.

## Configuration Requirements

The system shall support the following initial configuration values:

* `ROUTER_DEFAULT_PROVIDER`
* `ROUTER_DEFAULT_MODEL`
* `ROUTER_TIMEOUT_MS`
* `ROUTER_LOG_LEVEL`
* `ALLOWED_PROVIDERS`
* `ALLOWED_MODELS`
* `MAX_INPUT_CHARS`
* `MAX_OUTPUT_TOKENS`
* `MAX_COST_USD_PER_REQUEST`
* provider-specific API keys and base URLs

## Security Requirements

* API keys must not be hardcoded in source code.
* The router must reject requests to providers not explicitly allowed.
* The router must reject models not explicitly allowed when model allowlisting is enabled.
* Sensitive fields must be redacted from logs where configured.
* Remote passthrough features must be off by default.

## Edge-Case-Driven Resilience Requirements

* The system must exhaust all configured safe recovery paths before returning final failure.
* The system must distinguish retryable from non-retryable failures at the router level.
* The system must prevent retry storms, fallback loops, recursive routing loops, and self-invocation cycles.
* The system must manage both per-attempt timeout and total request budget.
* The system must prevent degraded provider behavior from being misreported as full success.
* The system must reject provider responses that are technically successful but contain no usable output.
* The system must support bounded retries with backoff and jitter for retryable failure classes.
* The system must track what was attempted during routing, retry, and fallback so that final failures are explainable.
* The system must fail clearly only after all configured safe options are exhausted.

## Validation Requirements

* The system must validate required fields, field types, ranges, supported roles, total input size, and structured schema shape before provider execution.
* The system must reject contentless requests and malformed encodings.
* The system must validate aggregate input size and not only per-message size.
* The system must validate provider and model identifiers in normalized form before routing.
* The system must reject unsupported message roles and malformed numeric inputs with clear field-level errors.

## Recovery and Fallback Requirements

* The system must support fallback only when explicitly configured.
* The system must validate fallback provider and model eligibility independently from the primary path.
* The system must never allow retry or fallback to bypass policy controls.
* The system must prevent fallback to the same provider when it would create a useless recovery path.
* The system must prevent cyclic fallback chains.
* The system must support provider-specific timeout configuration and total request budget enforcement.
* The system must expose whether fallback occurred in successful responses.
* The system must expose what recovery path was attempted in terminal failure responses.
* The system must not retry non-idempotent or side-effecting operations unless explicitly allowed by configuration.
* The system must apply exponential backoff with jitter for retryable failures.
* The system must enforce maximum attempts per request and per provider.
* The system must maintain enough remaining request budget before starting another retry or fallback attempt.
* The system must not waste most of the total request budget on the first attempt when recovery paths are configured.
* The system must support separate retry rules for timeout, rate-limit, DNS/network, and transient upstream errors.

## Warning and Degraded Success Requirements

* The system must include a consistent `warnings` field in successful responses.
* The system must surface warnings for fallback execution, truncation, downgraded provider capability, missing or estimated usage, provider-specific limitations, and output normalization issues.
* The system must expose actual executed provider and model in the response, even when they differ from the requested values.
* The system must distinguish exact usage, estimated usage, and unavailable usage when usage metadata exists.
* The system must surface clear warnings when an answer may be incomplete, degraded, or produced under a reduced capability path.
* The system must filter provider-specific metadata from user-facing output while preserving meaningful content.

## Operational Safety Requirements

* Startup must fail if no usable execution provider is available.
* Startup validation must verify required secrets, provider registration, and critical configuration shape.
* The system must classify configuration, authentication, network, timeout, discovery, and execution failures separately.
* Health reporting must distinguish configuration health, model discovery health, and execution health.
* Health reporting should distinguish passive health from real execution-path health where feasible.
* The system must support concurrency limits and graceful overload responses.
* The system should cancel upstream work when the client cancels a request and cancellation is supported.
* The system must sanitize upstream errors before logging or returning them.
* The system must redact secrets at the logger boundary.
* The system must control logging volume under failure conditions.
* The system must support contract tests for provider adapters to detect compatibility drift.
* The system must support chaos and fault-injection testing for timeout, malformed JSON, partial-response, DNS failure, rate-limit, and credential-revocation scenarios.
* The system must isolate provider failures so one unstable provider cannot degrade unrelated providers beyond shared global safety limits.

## Cognitive Simplicity UX Requirements

* The system must hide provider-specific complexity from the caller while still exposing operational truth.
* The system must return short, specific, and actionable error messages.
* The system must reject malformed or contentless requests before upstream execution.
* The system must explain provider-model mismatch, policy denial, unsupported capability, and authentication failure clearly.
* The system must preserve a stable MCP tool surface even as providers are added.
* The system must make the common path simple through safe defaults while keeping explicit control available.
* The system must not silently degrade behavior without surfacing warnings.
* The system must make partial failure understandable rather than mysterious.

## Error Handling Requirements

* The system must return structured errors for validation failure, policy failure, authentication failure, timeout, upstream failure, unsupported capability, DNS/network failure, and overload rejection.
* Error messages must be clear enough for debugging without leaking secrets.
* Retryable and non-retryable errors should be distinguishable internally.
* Error classification must be precise enough to drive retry, fallback, circuit-breaker, and alerting behavior.

## Logging Requirements

* Log request identifier, selected provider, selected model, latency, status, and fallback events.
* Do not log secrets.
* Full prompt logging must be disabled by default.
* Logging must be complemented by metrics suitable for alerting and operational action.
* Metrics should include request counts, latency, failure rates by provider and error class, retry counts, circuit-breaker state, overload events, and fallback rates.

## Initial Technical Requirements

* Language: TypeScript
* Transport: MCP over stdio for the first release
* Project structure must separate server, core, providers, and infrastructure concerns
* Configuration must support local development through environment variables

## Suggested Folder Structure

```text
mcp-router/
  src/
    index.ts
    server/
      mcpServer.ts
      toolHandlers.ts
    core/
      router.ts
      registry.ts
      policy.ts
      normalizer.ts
      errors.ts
      types.ts
    providers/
      openaiAdapter.ts
      glmAdapter.ts
      ollamaAdapter.ts
    infra/
      config.ts
      logger.ts
      metrics.ts
      secrets.ts
  package.json
  tsconfig.json
  .env.example
  README.md
```

## Delivery Phases

### Phase 1: Minimum viable router

* MCP server bootstrap
* `llm.chat`
* `llm.list_models`
* `router.health`
* OpenAI adapter
* GLM adapter
* configuration loading
* logging and timeout support

### Phase 2: Reliability and control

* provider fallback
* stronger policy enforcement
* improved error mapping
* health checks per provider

### Phase 3: Expansion

* structured output
* embeddings
* local/self-hosted adapters
* remote MCP passthrough with allowlist
* metrics integration

## Acceptance Summary

The project is successful for the initial release when:

* Antigravity can connect to the router as an MCP server.
* Antigravity can call `llm.chat` against OpenAI through the router.
* Antigravity can call `llm.chat` against GLM through the router.
* The router returns normalized results for both providers.
* Policy and allowlist checks are enforced.
* Provider failures return structured errors.
* Fallback works when configured for retryable failures.
* Health and model listing tools are operational.
* The router exhausts configured safe recovery paths before terminal failure.
* Successful degraded execution paths surface warnings clearly.

## Test and Resilience Verification Requirements

* The system must include adapter contract tests, especially for OpenAI and GLM compatibility drift.
* The system must include retry-policy tests covering exponential backoff, jitter, max attempts, and provider/error-specific retry rules.
* The system must include circuit-breaker tests covering open, half-open or cooldown, and reclose behavior.
* The system must include request-budget tests proving that recovery logic preserves enough budget for additional safe attempts.
* The system must include idempotency tests proving retries only occur for safe operations unless explicitly allowed.
* The system must include chaos and fault-injection tests for timeout, malformed JSON, partial responses, DNS failure, rate limiting, and credential revocation.
* The system should include load and concurrency tests to validate bulkheads and overload behavior.

## Recommended First Build

Build the first implementation around a simple, production-clean baseline:

* TypeScript
* official MCP SDK
* OpenAI adapter
* GLM adapter
* stdio transport
* env-based configuration
* logging, timeout, and fallback support

This gives a clear and extensible foundation for unsupported external LLM integration in Antigravity.
