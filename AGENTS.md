# AGENTS.md

## Purpose

This file defines how humans and coding agents must work in the `ifin-platform` repository.

It exists to protect the architecture, resilience model, typing discipline, and operational clarity of the project.

This is not a style suggestion document.
This is an execution contract.

---

## Project identity

This repository contains a production-grade MCP router for Antigravity.

The system exists to provide:

* a stable MCP interface to Antigravity
* support for external LLM providers not natively supported by Antigravity
* strong normalization across providers
* resilience under degraded provider conditions
* strong typing, strong runtime validation, and strong observability

Primary docs:

* `README.md`
* `specs/README.md`
* `specs/requirements.md`
* `specs/architecture.md`
* `specs/implementation-plan.md`

When code or behavior is ambiguous, follow this precedence order:

1. `specs/requirements.md`
2. `specs/architecture.md`
3. `specs/implementation-plan.md`
4. `README.md`

---

## Mission rules

### Rule 1: Protect the MCP boundary

Antigravity must see a small, stable, predictable MCP tool surface.

Do not:

* leak provider-specific response formats into MCP outputs
* expose experimental tools casually
* change tool contracts without updating specs and tests

### Rule 2: Keep the inside strict

The internals must stay disciplined even if providers are inconsistent.

Do not:

* mix transport DTOs with domain models
* reuse provider-native payloads as normalized types
* place provider-specific behavior outside adapters
* place resilience logic outside the resilience layer

### Rule 3: Never hide degraded execution

If fallback happened, the answer was truncated, usage is estimated, or capability was reduced, the response must say so.

### Rule 4: Stop only when no safe useful path remains

The router is allowed to retry and recover, but only when:

* the operation is safe
* policy allows it
* budget remains
* no breaker blocks it
* the path is still useful

### Rule 5: No weak shortcuts in critical paths

This system depends on clear boundaries and typed decisions.

Do not use shortcuts that make future failures harder to understand.

---

## Non-negotiable engineering rules

### Strong typing is mandatory

If the implementation is in TypeScript:

* use `strict` mode
* use `strictNullChecks`
* use `noImplicitAny`
* use `noUncheckedIndexedAccess`
* use `exactOptionalPropertyTypes`

In critical-path code, do not:

* use `any`
* use broad untyped objects as domain data
* pass raw JSON across layers without validation
* throw untyped string errors

Critical paths include:

* `src/server/`
* `src/core/`
* `src/resilience/`
* `src/providers/`
* `src/infra/config.ts`
* `src/infra/logger.ts`

If a compatibility wrapper truly requires weak typing, isolate it at the edge and immediately convert it into validated typed domain data.

### Runtime validation is mandatory

All external boundaries must validate input and output.

Required validation points:

* MCP tool inputs
* environment/config input
* provider responses before normalization
* optional remote-tool or passthrough responses

Malformed successful-looking provider responses must be rejected, not treated as success.

### Explicit error taxonomy is mandatory

Retry, fallback, breaker, and alerting behavior must be driven by typed error classification.

Do not:

* make retry decisions from raw message strings
* infer policy decisions from provider text
* mix user-facing error text with internal classification logic

---

## Required architecture boundaries

### `src/server/`

Owns:

* MCP server bootstrap
* tool registration
* transport-level parsing
* transport-level response formatting

Must not own:

* provider-specific logic
* retry logic
* fallback logic
* circuit-breaker decisions

### `src/core/`

Owns:

* routing orchestration
* planning
* normalization
* policy checks
* typed domain contracts
* error taxonomy

Must not own:

* provider-native payload handling beyond adapter interfaces
* raw environment access

### `src/resilience/`

Owns:

* retry policy
* request-budget accounting
* circuit breakers
* concurrency limits
* protected execution wrappers
* attempt history

Must not own:

* MCP transport concerns
* provider-specific request-shape logic

### `src/providers/`

Owns:

* provider-native request mapping
* provider-native response mapping
* provider-native auth handling
* provider-native health checks
* provider-native error mapping into internal taxonomy

Must not own:

* MCP concerns
* fallback policy
* global retry logic
* raw config lookup outside typed config injection

### `src/infra/`

Owns:

* config loading
* logging
* metrics plumbing
* HTTP client helpers
* clock helpers
* secret helpers

Must not own:

* domain decisions
* provider-specific orchestration
* fallback or retry policy

---

## Repository rules

Expected repository shape:

```text
ifin-platform/
  README.md
  AGENTS.md
  src/
  test/
  specs/
```

### `specs/`

This is the design authority zone.

Before changing major behavior, check:

* `specs/requirements.md`
* `specs/architecture.md`
* `specs/implementation-plan.md`

If code and specs diverge, either:

* bring code back into alignment, or
* update the specs intentionally in the same change

Do not silently drift.

---

## How agents should approach work

### Before writing code

1. Read the relevant section in `README.md` and `specs/`.
2. Identify which layer the change belongs to.
3. Identify the external boundaries involved.
4. Identify the validation requirements.
5. Identify the observability requirements.
6. Identify whether the change affects retry, fallback, budget, or breaker behavior.

### While writing code

* keep changes local to the correct layer
* add or update types first
* add runtime validation before external data crosses inward
* add tests for both happy path and failure path
* add logs and metrics for critical flows
* preserve normalized contracts

### Before marking work done

Confirm:

* types are strict
* tests pass
* boundaries remain clean
* degraded paths surface warnings
* no secret leakage is possible through logs or responses
* docs are updated if the contract changed

---

## What must always be tested

### For any MCP tool change

Add or update tests for:

* valid input path
* invalid input path
* normalized output shape
* structured error output
* warnings on degraded execution when applicable

### For any provider adapter change

Add or update tests for:

* request mapping
* response mapping
* malformed upstream response rejection
* provider-specific error mapping
* normalized contract conformance

### For any resilience change

Add or update tests for:

* retry classification
* max attempts
* backoff behavior
* budget behavior
* breaker behavior
* fallback loop prevention
* non-idempotent no-retry protection

### For any observability change

Add or update tests or checks for:

* expected logs exist
* expected metrics emit
* degraded states surface visible signals

---

## Required observability behavior

Logs and metrics are part of the product, not optional extras.

### Logs must support:

* request tracing
* provider/model visibility
* retry/fallback visibility
* breaker visibility
* failure classification visibility

### Metrics must support:

* request count
* success/failure count
* retry count
* fallback rate
* latency
* overload rejection count
* breaker transitions
* active concurrency

### Health must distinguish:

* configuration health
* discovery health
* execution-path health

If a change affects runtime behavior and adds no observable signal, the change is incomplete.

---

## Required security behavior

### Never expose secrets

Do not log or return:

* API keys
* raw auth headers
* secret values from config
* unredacted upstream errors that may contain secrets

### Always sanitize upstream failures

Provider failures must be sanitized before reaching:

* logs
* MCP responses
* test snapshots intended for sharing

### Keep policy enforcement early

Policy checks must happen before expensive or external execution when possible.

Do not rely on upstream providers to enforce local policy rules.

---

## Required resilience behavior

The router must behave like a system that survives pressure intelligently.

### Retries

Must be:

* bounded
* classified
* budget-aware
* safe for the operation type
* observable

### Fallback

Must be:

* explicitly configured
* independently validated
* loop-free
* budget-aware
* warning-emitting on success

### Circuit breakers

Must:

* stop hammering bad providers
* reopen cautiously
* surface state through health and metrics

### Bulkheads

Must:

* isolate provider failure domains
* prevent one unstable provider from consuming all execution capacity

### Request budgets

Must:

* preserve enough time for useful recovery paths
* prevent wasteful last attempts
* stop execution when remaining budget is no longer useful

---

## Forbidden patterns

Do not introduce:

* provider SDK calls outside `src/providers/`
* raw `process.env` reads outside config module
* unvalidated JSON cast directly into domain models
* retries implemented inside adapters
* fallback implemented inside MCP handlers
* hidden degraded execution
* logs that can leak secrets
* provider-specific response shapes returned to Antigravity
* speculative new tools added without normalization and tests
* silent swallowing of upstream parse failures

---

## Preferred patterns

Prefer:

* explicit typed mapper functions
* runtime schema validation at boundaries
* small adapter methods with focused responsibilities
* typed enums or unions for codes and states
* centralized retry classification
* centralized config loading
* structured logs over free-form logs
* metrics with stable names and low-cardinality labels
* test fixtures for adapter contract behavior

---

## Documentation update rules

You must update docs when changing:

* tool contracts
* provider support matrix
* resilience behavior
* observability behavior
* project structure
* setup/config behavior

### Minimum doc expectations

* contract change → update `README.md` and relevant spec
* architecture change → update `specs/architecture.md`
* requirement change → update `specs/requirements.md`
* delivery or sequencing change → update `specs/implementation-plan.md`

---

## Review checklist

Before approving a change, reviewers should ask:

* Is the change in the correct architectural layer?
* Are external inputs and outputs validated?
* Are types strong enough?
* Are error classifications explicit?
* Are retry/fallback/breaker effects correct?
* Are degraded paths visible through warnings or health?
* Are logs and metrics sufficient?
* Are secrets protected?
* Do tests cover negative paths?
* Are docs aligned with behavior?

If the answer to any critical question is no, the change is not ready.

---

## Agent task template

When an agent works on a task, it should internally structure the work like this:

1. Identify the layer.
2. Identify boundary validations needed.
3. Identify types or schemas to add or change.
4. Identify tests to add.
5. Identify logs and metrics to add.
6. Identify spec or README updates needed.
7. Implement smallest correct change.
8. Verify no forbidden pattern was introduced.

---

## Definition of acceptable contribution

A contribution is acceptable only if it:

* preserves the MCP-facing contract
* preserves architectural boundaries
* preserves or improves resilience clarity
* preserves or improves observability
* preserves strong typing and runtime validation
* preserves security and redaction guarantees
* includes tests for affected behavior
* keeps docs aligned

---

## Final instruction to agents

Build the router so that Antigravity experiences simplicity, while the codebase preserves strictness, truthfulness, and survival-grade resilience.

Do not optimize for cleverness.
Optimize for correctness, recovery, transparency, and maintainability.
