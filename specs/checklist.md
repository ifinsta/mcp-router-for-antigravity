# checklist.md

## Purpose

This checklist is the operational control sheet for the entire `ifin-platform` project.

It is intended to be used for:

* planning
* implementation tracking
* code review
* release readiness
* architecture compliance
* resilience verification
* documentation completeness

This is a whole-project checklist, not only a coding checklist.

---

## 1. Product and Scope Checklist

### Project definition

* [ ] Project purpose is clearly defined in root `README.md`
* [ ] Project purpose is clearly defined in `specs/README.md`
* [ ] The top-level problem statement is stable and agreed
* [ ] In-scope items are explicitly listed
* [ ] Out-of-scope items for v1 are explicitly listed
* [ ] Supported providers for v1 are explicitly listed
* [ ] Required MCP tools for v1 are explicitly listed
* [ ] Future optional tools are clearly separated from v1 scope

### Success criteria

* [ ] Success criteria for first release are written
* [ ] Acceptance summary exists in `specs/requirements.md`
* [ ] Top-level README states what “complete” means
* [ ] The team agrees on what counts as done for v1

---

## 2. Documentation Checklist

### Core docs present

* [ ] Root `README.md` exists and reflects the whole software
* [ ] `AGENTS.md` exists and reflects contributor rules
* [ ] `specs/README.md` exists and explains the design entry point
* [ ] `specs/requirements.md` exists and is current
* [ ] `specs/architecture.md` exists and is current
* [ ] `specs/implementation-plan.md` exists and is current
* [ ] `checklist.md` exists and is current

### Documentation alignment

* [ ] Root `README.md` matches actual repo behavior
* [ ] Specs reflect current architecture rather than aspirational drift
* [ ] Tool contracts are consistent across all docs
* [ ] Provider support is consistent across all docs
* [ ] Resilience rules are consistent across all docs
* [ ] Observability expectations are consistent across all docs
* [ ] Project structure is consistent across all docs
* [ ] Naming is consistent across all docs

### Documentation quality

* [ ] Docs separate v1 from future extensions clearly
* [ ] Docs describe degraded-success behavior clearly
* [ ] Docs describe failure behavior clearly
* [ ] Docs describe operational setup clearly
* [ ] Docs describe test expectations clearly

---

## 3. Repository and Project Structure Checklist

### Root files

* [ ] `README.md`
* [ ] `AGENTS.md`
* [ ] `.gitignore`
* [ ] `.env.example`
* [ ] `package.json`
* [ ] `tsconfig.json`
* [ ] lint configuration
* [ ] formatter configuration
* [ ] CI workflow configuration

### Directory structure

* [ ] `src/`
* [ ] `src/server/`
* [ ] `src/core/`
* [ ] `src/resilience/`
* [ ] `src/providers/`
* [ ] `src/infra/`
* [ ] `test/unit/`
* [ ] `test/contract/`
* [ ] `test/chaos/`
* [ ] `test/load/`
* [ ] `test/integration/`
* [ ] `specs/`

### Boundary structure

* [ ] Provider logic is only in `src/providers/`
* [ ] Resilience logic is only in `src/resilience/`
* [ ] MCP transport logic is only in `src/server/`
* [ ] Raw config access is only in `src/infra/config.ts`
* [ ] Shared domain contracts live in `src/core/types.ts` or equivalent
* [ ] Error taxonomy lives in one canonical place

---

## 4. Strong Typing Checklist

### Compiler and language settings

* [ ] TypeScript `strict` mode is enabled
* [ ] `noImplicitAny` is enabled
* [ ] `strictNullChecks` is enabled
* [ ] `noUncheckedIndexedAccess` is enabled
* [ ] `exactOptionalPropertyTypes` is enabled
* [ ] Incremental build settings are configured appropriately

### Type discipline

* [ ] No `any` exists in critical-path code
* [ ] No provider-native payload type is reused as a domain model
* [ ] No transport DTO is reused as a domain model
* [ ] Error types are explicit and typed
* [ ] Request/response types are explicit and typed
* [ ] Breaker state types are explicit and typed
* [ ] Attempt phase types are explicit and typed
* [ ] Warning code types are explicit and typed
* [ ] Health state types are explicit and typed

### Type safety review

* [ ] Provider adapter interface is stable and typed
* [ ] Normalized request contract is stable and typed
* [ ] Normalized response contract is stable and typed
* [ ] Config object is stable and typed
* [ ] Metric event names are typed or otherwise controlled

---

## 5. Runtime Validation Checklist

### External boundary validation

* [ ] MCP tool inputs are validated at runtime
* [ ] Environment/config values are validated at runtime
* [ ] Provider responses are validated before normalization
* [ ] Optional passthrough/remote-tool responses are validated before use

### Request validation

* [ ] Empty messages arrays are rejected
* [ ] Contentless requests are rejected
* [ ] Unsupported roles are rejected
* [ ] Invalid numeric fields are rejected
* [ ] Negative or invalid `maxTokens` are rejected
* [ ] Invalid schema payloads are rejected
* [ ] Aggregate input size is validated
* [ ] Provider and model identifiers are normalized before validation

### Response validation

* [ ] Empty successful-looking provider responses are rejected
* [ ] Malformed JSON from providers is rejected safely
* [ ] Missing output content is rejected
* [ ] Unknown finish reasons are normalized safely
* [ ] Missing usage is handled explicitly
* [ ] Provider-specific metadata is filtered from user-facing output

---

## 6. MCP Interface Checklist

### Tool surface

* [ ] `llm.chat` exists
* [ ] `llm.list_models` exists
* [ ] `router.health` exists
* [ ] Tool names are stable and documented
* [ ] Tool inputs are stable and documented
* [ ] Tool outputs are stable and documented

### MCP behavior

* [ ] MCP server starts successfully
* [ ] Tool registration succeeds completely
* [ ] Invalid MCP requests return structured errors
* [ ] MCP transport failures are handled safely
* [ ] Stdio transport is stable under normal conditions
* [ ] Large outputs are handled or capped safely

---

## 7. Core Routing Checklist

### Router behavior

* [ ] Provider default resolution works
* [ ] Model default resolution works
* [ ] Unknown provider is rejected early
* [ ] Unknown or unsupported model is rejected clearly
* [ ] Provider-model mismatch is rejected clearly
* [ ] Actual executed provider is returned
* [ ] Actual executed model is returned

### Planner behavior

* [ ] Primary path planning works
* [ ] Retry path planning works
* [ ] Fallback path planning works
* [ ] Same-provider useless fallback is blocked
* [ ] Cyclic fallback is blocked
* [ ] Futile final attempts are blocked when budget is too low

---

## 8. Provider Adapter Checklist

### Common adapter rules

* [ ] Each provider uses its own adapter
* [ ] Each adapter implements the common provider interface
* [ ] Each adapter handles request mapping internally
* [ ] Each adapter handles response mapping internally
* [ ] Each adapter handles provider-specific auth internally
* [ ] Each adapter handles provider-specific errors internally
* [ ] Each adapter declares supported capabilities

### OpenAI adapter

* [ ] OpenAI auth works
* [ ] OpenAI request mapping works
* [ ] OpenAI response normalization works
* [ ] OpenAI usage mapping works
* [ ] OpenAI health check works
* [ ] OpenAI model listing works

### GLM adapter

* [ ] GLM auth works
* [ ] GLM request mapping works
* [ ] GLM response normalization works
* [ ] GLM usage handling works
* [ ] GLM health check works
* [ ] GLM compatibility drift is handled explicitly

### Local/self-hosted adapters

* [ ] Local adapter design exists
* [ ] Base URL configuration works
* [ ] Local provider normalization works
* [ ] Local provider health check works

---

## 9. Capability and Model Discovery Checklist

* [ ] Capability declarations exist per provider
* [ ] Unsupported capabilities fail before execution
* [ ] Model listing can target one provider
* [ ] Model listing can target all providers
* [ ] Partial failure in model listing is tolerated where appropriate
* [ ] Model discovery health is separate from execution health

---

## 10. Policy and Governance Checklist

### Policy enforcement

* [ ] Provider allowlist is enforced
* [ ] Model allowlist is enforced
* [ ] Input size policy is enforced
* [ ] Output token policy is enforced
* [ ] Optional cost cap policy is enforced or explicitly unsupported
* [ ] Restricted passthrough policy is enforced

### Policy correctness

* [ ] Retry cannot bypass policy
* [ ] Fallback cannot bypass policy
* [ ] Policy precedence is defined
* [ ] Normalized identifiers are used before policy evaluation
* [ ] Policy-related warnings and errors are understandable

### Sensitive-routing concerns

* [ ] Policy can support local-only routing if required
* [ ] Missing request metadata for policy is handled explicitly
* [ ] Override behavior is explicit and auditable if supported

---

## 11. Error Handling Checklist

### Error model

* [ ] Validation errors are explicit
* [ ] Policy errors are explicit
* [ ] Configuration errors are explicit
* [ ] Authentication errors are explicit
* [ ] Timeout errors are explicit
* [ ] Network errors are explicit
* [ ] Overload errors are explicit
* [ ] Upstream errors are explicit
* [ ] Unsupported capability errors are explicit
* [ ] Provider-not-found errors are explicit

### Error behavior

* [ ] Retryable vs non-retryable distinction exists
* [ ] Error classification drives retry decisions
* [ ] Error classification drives fallback decisions
* [ ] Error classification drives breaker behavior
* [ ] Error classification is safe for logs and user-facing messages
* [ ] Raw upstream errors are sanitized before exposure

---

## 12. Resilience Checklist

### Retry behavior

* [ ] Retries are bounded
* [ ] Exponential backoff is implemented
* [ ] Jitter is implemented
* [ ] Max attempts are configurable
* [ ] Retry rules vary by provider where needed
* [ ] Retry rules vary by error class where needed
* [ ] Unsafe/non-idempotent operations are not retried by default

### Fallback behavior

* [ ] Fallback is optional and explicit
* [ ] Fallback provider is validated independently
* [ ] Fallback loops are impossible
* [ ] Same-provider pointless fallback is impossible
* [ ] Fallback capability mismatch is handled correctly
* [ ] Fallback usage appears in warnings and metadata

### Circuit breakers

* [ ] Circuit breakers exist per provider
* [ ] Open state blocks dispatch
* [ ] Half-open or cooldown probing works
* [ ] Breakers reopen cautiously
* [ ] Breaker state is visible in health
* [ ] Breaker state is visible in metrics

### Bulkheads and concurrency

* [ ] Global concurrency limits exist
* [ ] Per-provider concurrency limits exist
* [ ] Overload rejection is explicit
* [ ] One failing provider cannot drain all capacity
* [ ] Optional queue behavior is bounded if supported

### Request budget

* [ ] Total request budget exists
* [ ] Per-attempt budget allocation exists
* [ ] Recovery attempts preserve enough remaining budget
* [ ] First attempt does not consume almost all budget when fallback exists
* [ ] No new attempt starts without minimum viable budget

### Recovery truthfulness

* [ ] Attempt history is recorded
* [ ] Final failure explains what was tried
* [ ] Successful degraded paths include warnings
* [ ] The system stops only when no safe useful path remains

---

## 13. Observability Checklist

### Logging

* [ ] Structured logging is implemented
* [ ] Request id is logged
* [ ] Provider is logged
* [ ] Model is logged
* [ ] Latency is logged
* [ ] Retry count is logged where relevant
* [ ] Fallback usage is logged where relevant
* [ ] Breaker state is logged where relevant
* [ ] Error code/classification is logged

### Metrics

* [ ] Request count metrics exist
* [ ] Success/failure count metrics exist
* [ ] Failure-rate metrics exist
* [ ] Retry count metrics exist
* [ ] Fallback-rate metrics exist
* [ ] Latency metrics exist
* [ ] Overload metrics exist
* [ ] Breaker transition metrics exist
* [ ] Active concurrency metrics exist

### Health

* [ ] Configuration health is exposed
* [ ] Discovery health is exposed
* [ ] Execution-path health is exposed
* [ ] Partial degradation is surfaced clearly
* [ ] Health includes breaker signals where relevant

---

## 14. Security Checklist

### Secrets

* [ ] Secrets are loaded from env or secret manager only
* [ ] Secrets are never hardcoded in source
* [ ] Secrets are never returned in responses
* [ ] Secrets are redacted from logs
* [ ] Raw auth headers are redacted from logs

### Exposure control

* [ ] Full prompt logging is disabled by default
* [ ] Provider-native payloads are not exposed casually
* [ ] Upstream errors are sanitized before exposure
* [ ] Dangerous passthrough capabilities are off by default
* [ ] Arbitrary outbound access is not enabled casually

### Startup and config security

* [ ] Missing secrets fail clearly
* [ ] Blank secrets fail clearly
* [ ] Malformed base URLs fail clearly
* [ ] Wrong secret/provider mapping is prevented where possible

---

## 15. Performance and Runtime Behavior Checklist

* [ ] Router overhead is acceptable relative to provider latency
* [ ] Validation occurs before expensive external work
* [ ] Health checks are reasonably fast
* [ ] Model listing is reasonably fast
* [ ] Latency measurement uses monotonic timing where possible
* [ ] Cancellation is propagated when supported
* [ ] Shutdown behavior is graceful enough for active work

---

## 16. Testing Checklist

### Unit tests

* [ ] Validation tests exist
* [ ] Policy tests exist
* [ ] Retry classification tests exist
* [ ] Request budget tests exist
* [ ] Breaker transition tests exist
* [ ] Concurrency limiter tests exist
* [ ] Mapper tests exist
* [ ] Error-code-to-action matrix tests exist

### Contract tests

* [ ] OpenAI contract tests exist
* [ ] GLM contract tests exist
* [ ] Normalized output fixtures exist
* [ ] Compatibility drift tests exist

### Chaos tests

* [ ] Timeout chaos tests exist
* [ ] Malformed JSON chaos tests exist
* [ ] Partial response chaos tests exist
* [ ] DNS failure chaos tests exist
* [ ] Rate-limit chaos tests exist
* [ ] Credential revocation chaos tests exist

### Load tests

* [ ] Overload tests exist
* [ ] Provider isolation tests exist
* [ ] Concurrency saturation tests exist
* [ ] Queue behavior tests exist if queues exist

### Integration tests

* [ ] MCP startup integration tests exist
* [ ] Tool registration integration tests exist
* [ ] `llm.chat` integration tests exist
* [ ] `llm.list_models` integration tests exist
* [ ] `router.health` integration tests exist
* [ ] Degraded-success warning tests exist
* [ ] Structured failure tests exist
* [ ] Antigravity integration tests exist

---

## 17. CI and Quality Gate Checklist

* [ ] Type-check runs in CI
* [ ] Lint runs in CI
* [ ] Unit tests run in CI
* [ ] Contract tests run in CI
* [ ] Coverage is reported in CI
* [ ] Coverage thresholds are enforced
* [ ] Critical-path type violations fail CI
* [ ] Critical-path weak-typing violations fail CI
* [ ] Failing tests block merge

### Quantitative gates

* [ ] Critical-path line coverage target is met
* [ ] Critical-path branch coverage target is met
* [ ] Provider adapter contract coverage target is met
* [ ] Zero banned weak-typing violations in critical paths
* [ ] Zero direct provider calls outside adapters
* [ ] Zero raw env lookups outside config module
* [ ] Zero malformed successful-looking provider payloads accepted as success
* [ ] Zero secret leaks in logs

---

## 18. Release Readiness Checklist

### Functional readiness

* [ ] Antigravity can connect to the router
* [ ] `llm.chat` works against OpenAI
* [ ] `llm.chat` works against GLM
* [ ] `llm.list_models` works
* [ ] `router.health` works
* [ ] Outputs are normalized across providers

### Resilience readiness

* [ ] Retries are bounded and observable
* [ ] Fallback is bounded and observable
* [ ] Breakers are active and observable
* [ ] Bulkheads are active and observable
* [ ] Request budget is enforced
* [ ] Final failures explain what was tried
* [ ] Degraded successes surface warnings

### Operational readiness

* [ ] Health output is useful to operators
* [ ] Logs are useful to operators
* [ ] Metrics are useful to operators
* [ ] Alerts can be built from emitted signals
* [ ] Startup diagnostics are clear

### Security readiness

* [ ] Secrets are protected in code and logs
* [ ] Sanitization has been verified
* [ ] Config handling has been verified
* [ ] Policy enforcement has been verified

### Documentation readiness

* [ ] Root `README.md` is current
* [ ] `AGENTS.md` is current
* [ ] `specs/README.md` is current
* [ ] `specs/requirements.md` is current
* [ ] `specs/architecture.md` is current
* [ ] `specs/implementation-plan.md` is current
* [ ] `checklist.md` is current

---

## 19. Reviewer Checklist

Before approving a major change:

* [ ] The change belongs in the correct architectural layer
* [ ] External inputs and outputs are validated
* [ ] Types are strong enough
* [ ] Error classifications are explicit
* [ ] Retry/fallback/breaker behavior is correct
* [ ] Degraded paths are visible through warnings or health
* [ ] Logs and metrics are sufficient
* [ ] Secrets are protected
* [ ] Negative-path tests exist
* [ ] Docs are aligned with the behavior

---

## 20. Final Go/No-Go Checklist

Ship only if all are true:

* [ ] MCP integration is stable
* [ ] OpenAI path is stable
* [ ] GLM path is stable
* [ ] Error handling is explicit and safe
* [ ] Resilience behavior is bounded and explainable
* [ ] Observability is actionable
* [ ] Security posture is acceptable
* [ ] CI quality gates are green
* [ ] Documentation matches reality
* [ ] No critical known gap remains in v1 scope

---

## 21. Stretch and Future Checklist

Use only after v1 is stable.

* [ ] Ollama adapter added safely
* [ ] Self-hosted compatible adapter added safely
* [ ] Structured output mode added safely
* [ ] Embeddings support added safely
* [ ] Remote MCP passthrough added with allowlist
* [ ] More advanced policy controls added safely
* [ ] Cost-aware routing added safely
* [ ] Multi-tenant isolation added safely

---

## Final principle

The project is only truly complete when Antigravity sees simplicity, while the router preserves strictness, resilience, security, and operational truth underneath.
