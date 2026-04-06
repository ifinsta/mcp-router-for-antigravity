# implementation.md

## Project

MCP Router for Antigravity

## Purpose

Translate `requirements.md`, `architecture.md`, and `README.md` into a concrete execution plan that a strong engineering team can implement step by step without ambiguity.

This plan is optimized for:

* fast delivery of a working core
* strong resilience foundations early
* minimal waste
* clear acceptance gates
* safe expansion after the core works

---

## 1. Delivery Strategy

### Core principle

Build the smallest working router first, but do not postpone the hard architectural seams.

That means:

* build the MCP boundary early
* build normalized contracts early
* build provider adapters behind strict interfaces
* build resilience as a first-class layer, not a patch later
* keep the initial tool surface very small

### Initial release target

A working MCP router that:

* connects to Antigravity
* exposes `llm.chat`, `llm.list_models`, and `router.health`
* supports OpenAI and GLM
* normalizes outputs across both providers
* enforces policy before execution
* supports bounded retries and fallback
* returns actionable health and error information

---

## 2. Execution Principles

* Do not build speculative features before the core path works.
* Do not leak provider-specific payloads across boundaries.
* Do not defer resilience boundaries into ad hoc adapter logic.
* Do not hide degraded execution.
* Do not implement retries without budget accounting.
* Do not add more tools before the first three are stable.
* Do not accept “works in happy path” as done.
* Do not permit weak typing at core system boundaries.
* Do not permit unvalidated external input to enter the domain layer.
* Do not permit `any`-style escape hatches in critical request, response, resilience, or provider modules.

### Non-negotiable engineering standards

* Strong typing must be enforced at all domain, provider, resilience, and transport boundaries.
* Every MCP tool input must be validated at runtime before entering normalized contracts.
* Every provider response must be validated before it is treated as successful normalized output.
* Every retry, fallback, and breaker decision must be driven by explicit typed error classification.
* Every provider adapter must implement the same interface and pass the same contract-test suite.
* Every phase must produce executable code, tests, and observable signals, not just structure.

### Strong typing enforcement requirements

* Enable TypeScript `strict` mode if TypeScript is chosen.
* Enable no-implicit-any, strict-null-checks, noUncheckedIndexedAccess, and exactOptionalPropertyTypes.
* Ban `any` in application code except in isolated external compatibility wrappers with explicit justification.
* Validate external JSON using runtime schemas before conversion to domain objects.
* Keep transport DTOs separate from domain models.
* Keep provider-native payload types separate from normalized internal types.
* Treat error objects as typed domain entities, not loose thrown strings.
* Define explicit enums or string unions for roles, error codes, breaker states, attempt phases, and health states.

### Code quality gates

* No phase exits with unresolved TODOs in critical execution paths.
* No direct provider SDK calls outside provider adapters.
* No resilience logic inside MCP handlers.
* No config access through raw environment lookups outside config module.
* No logging of secrets, raw auth headers, or full prompts by default.

---

## 3. Phase Overview

### Phase 0: Foundation and repo skeleton

Goal: create the implementation base and freeze key interfaces.

### Phase 1: Minimal working MCP router

Goal: make Antigravity talk to the router with one provider path working end to end.

### Phase 2: Multi-provider support and normalization

Goal: support OpenAI and GLM with consistent contracts.

### Phase 3: Resilience baseline

Goal: add retry, fallback, request budget, and failure classification.

### Phase 4: Operational hardening

Goal: add circuit breakers, bulkheads, observability, health depth, and tests.

### Phase 5: Controlled expansion

Goal: add local runtime adapters and future-safe extensions.

---

## 4. Work Breakdown Structure

## Phase 0: Foundation and Repo Skeleton

### Objectives

* initialize repository structure
* lock major domain interfaces
* set up config, logging, and test scaffolding
* choose runtime language and MCP SDK

### Tasks

#### 0.1 Repository bootstrap

* create root project structure
* create source directories from architecture
* create test directories
* add package manager and build scripts
* add linting and formatting setup

#### 0.2 Technical decisions freeze

* select exact runtime stack
* select exact MCP SDK
* select HTTP client library
* select schema validation approach
* select metrics interface approach
* select test runner and coverage tooling
* select lint rules and formatting rules
* select type-checking policy and forbidden language features

#### 0.3 Core contracts

* define normalized request types
* define normalized response types
* define provider adapter interface
* define error taxonomy
* define attempt record schema
* define health status schema
* define typed config schema
* define typed metric event names
* define warning code taxonomy
* define validation error payload shape

#### 0.4 Config foundation

* implement typed config loader
* validate required environment variables
* validate provider-specific configuration
* fail startup on critical config gaps

#### 0.5 Logging foundation

* create structured logger
* add log redaction boundaries
* add request id support
* define standard log event schema
* define severity rules

#### 0.6 Type safety and validation foundation

* enable strict compiler configuration
* enforce lint rules blocking weak typing in critical paths
* create runtime validation schemas for MCP tool input
* create runtime validation schemas for provider output normalization
* create conversion helpers from transport DTOs to domain models
* create typed error constructors

#### 0.7 Test foundation

* configure unit test runner
* configure coverage reporting
* configure contract-test structure
* configure chaos-test harness structure
* configure CI checks for type-check, lint, and tests

### Deliverables

* bootstrapped repo
* initial build scripts
* typed config module
* domain type definitions
* error model
* logger baseline
* strict type-checking configuration
* runtime validation layer baseline
* test and CI foundation

### Exit criteria

* repository builds successfully
* config validation works
* domain interfaces compile cleanly
* no provider-specific assumptions leak into core contracts
* strict type-check passes
* lint passes with no critical-rule violations
* runtime validation schemas exist for MCP inputs and normalized provider outputs
* CI runs type-check, lint, and tests automatically

---

## Phase 1: Minimal Working MCP Router

### Objectives

* expose MCP server
* register initial tools
* make one end-to-end request path work cleanly

### Tasks

#### 1.1 MCP server bootstrap

* initialize MCP server
* register `llm.chat`
* register `llm.list_models`
* register `router.health`
* wire stdio transport

#### 1.2 Tool handlers

* implement `handleLlmChat`
* implement `handleListModels`
* implement `handleRouterHealth`
* validate presence and shape of required tool inputs
* convert validated tool DTOs into normalized domain requests only through typed mappers
* ensure handlers return only normalized output DTOs

#### 1.3 Normalization layer

* map tool input into normalized internal requests
* define normalized response shaping
* define warning field behavior
* define explicit transport-to-domain conversion rules
* define explicit provider-output-to-domain conversion rules
* reject malformed successful-looking provider payloads

#### 1.4 Provider registry

* implement provider registration
* implement provider lookup
* reject unknown provider ids early

#### 1.5 Basic health service

* expose router startup health
* expose registered provider state
* expose configuration warnings

### Deliverables

* runnable MCP server
* initial tools visible to Antigravity
* one stable end-to-end tool execution path

### Exit criteria

* Antigravity can connect to the router
* tool registration is successful
* invalid requests return structured validation errors
* `router.health` returns meaningful status

---

## Phase 2: Multi-Provider Support and Normalization

### Objectives

* support OpenAI and GLM
* ensure provider outputs are normalized
* ensure provider-specific behavior stays inside adapters

### Tasks

#### 2.1 OpenAI adapter

* implement auth mapping
* implement request mapping
* implement response extraction
* implement usage mapping
* implement error mapping
* implement model listing
* implement health check
* validate upstream response shape before normalization
* isolate provider-specific types inside adapter module

#### 2.2 GLM adapter

* implement auth mapping
* implement request mapping
* implement response extraction
* implement usage mapping
* implement error mapping
* implement model listing if supported
* implement health check
* validate upstream response shape before normalization
* isolate provider-specific types inside adapter module
* explicitly handle OpenAI-compatibility drift instead of assuming parity

#### 2.3 Capability modeling

* define provider capability declarations
* expose capability awareness in registry
* gate unsupported features clearly

#### 2.4 Output normalization verification

* ensure `llm.chat` returns same shape across providers
* ensure `llm.list_models` can aggregate partial results
* ensure `router.health` reports provider states consistently

### Deliverables

* OpenAI adapter
* GLM adapter
* provider capability metadata
* consistent normalized outputs

### Exit criteria

* `llm.chat` works against OpenAI
* `llm.chat` works against GLM
* actual executed provider and model are reported
* provider-native weirdness does not leak into tool outputs

---

## Phase 3: Resilience Baseline

### Objectives

* add bounded retries
* add fallback handling
* add request budget management
* classify failures correctly

### Tasks

#### 3.1 Failure classification

* classify validation vs policy vs auth vs timeout vs upstream vs network failures
* mark retryable vs non-retryable
* map failures into structured router errors
* define typed error-code-to-action matrix
* ensure breaker, retry, fallback, and alerting all consume the same classification result

#### 3.2 Retry policy engine

* define max attempts
* define exponential backoff
* define jitter
* define provider-specific rules
* define error-class-specific rules
* define minimum remaining budget required for another attempt
* define no-retry behavior for unsafe or non-idempotent paths

#### 3.3 Request budget manager

* define total request budget
* define per-attempt budget allocation
* prevent futile final attempts
* enforce remaining-budget checks before retry or fallback

#### 3.4 Fallback execution

* validate fallback provider independently
* prevent same-provider useless fallback
* prevent fallback loops
* expose fallback usage in response warnings and metadata

#### 3.5 Attempt history

* record all attempts
* record retry/fallback path
* attach explainable recovery information to terminal failures

### Deliverables

* retry policy engine
* request budget manager
* fallback logic
* attempt history recording
* structured failure classification

### Exit criteria

* retryable failures can retry safely
* non-retryable failures stop immediately
* fallback works only when configured and allowed
* request budget prevents wasteful recovery behavior
* final failure explains what was tried

---

## Phase 4: Operational Hardening

### Objectives

* stop hammering failing providers
* isolate unstable providers
* make system observable enough for incidents
* add strong testing layers

### Tasks

#### 4.1 Circuit breakers

* implement provider-level breaker state
* implement open/closed/cooldown-probe transitions
* prevent dispatch to persistently failing providers
* expose breaker state in health and metrics

#### 4.2 Bulkheads and concurrency controls

* implement global concurrency limit
* implement provider-specific concurrency limit
* implement graceful overload rejection
* ensure one unstable provider cannot drain all execution capacity

#### 4.3 Observability layer

* add request counters
* add latency metrics
* add failure-rate metrics
* add retry counts
* add fallback-rate metrics
* add overload metrics
* add circuit-breaker metrics
* add active concurrency metrics
* define metric names, labels, and cardinality rules
* define alertable signals for dead provider, overload, high failure rate, and breaker-open conditions

#### 4.4 Health depth

* distinguish configuration health
* distinguish discovery health
* distinguish execution-path health
* surface partial degradation warnings

#### 4.5 Sanitization and safety

* sanitize upstream errors
* verify secret redaction
* verify prompt logging defaults are safe

### Deliverables

* circuit-breaker implementation
* concurrency limiter
* metrics baseline
* hardened health reporting
* sanitized operational outputs

### Exit criteria

* dead providers are not hammered continuously
* overload is controlled and observable
* provider isolation is functioning
* metrics are sufficient for debugging and alerting
* health output reflects real degraded states

---

## Phase 5: Testing and Verification

### Objectives

* verify correctness under normal, degraded, and adversarial conditions
* prevent provider drift from breaking the system silently

### Tasks

#### 5.1 Unit tests

* validation logic
* policy logic
* retry classification
* request budget logic
* breaker transitions
* concurrency limiter behavior
* typed mapper behavior
* error-code-to-action matrix behavior

#### 5.2 Adapter contract tests

* OpenAI mapping correctness
* GLM mapping correctness
* response normalization consistency
* compatibility drift detection

#### 5.3 Chaos tests

* simulate timeout
* simulate malformed JSON
* simulate partial response
* simulate DNS failure
* simulate rate limit
* simulate credential revocation

#### 5.4 Load tests

* test concurrency saturation
* test provider isolation
* test overload response behavior
* test fallback behavior under pressure

#### 5.5 Antigravity integration tests

* validate MCP tool registration
* validate tool invocation end to end
* validate structured failures returned cleanly
* validate degraded success warnings are visible

### Deliverables

* automated test suites
* fault-injection harness
* integration verification results

### Exit criteria

* provider adapters pass contract tests
* resilience logic passes chaos tests
* MCP integration works reliably inside Antigravity
* strict type-check, lint, and coverage gates pass in CI
* critical-path modules meet agreed minimum coverage threshold

---

## Phase 6: Controlled Expansion

### Objectives

* expand safely after the core is strong

### Candidate tasks

* add Ollama adapter
* add self-hosted OpenAI-compatible adapter
* add structured output mode
* add embeddings support
* add stronger policy controls
* add remote MCP passthrough with allowlist

### Rule

No expansion work should weaken the stability of the initial three tools.

---

## 5. Dependency Order

The safest dependency order is:

1. config + types + errors
2. MCP server + handlers
3. provider registry
4. first provider adapter
5. second provider adapter
6. normalization verification
7. retry and failure classification
8. request budget and fallback
9. circuit breakers and concurrency limits
10. metrics and deeper health
11. contract tests, chaos tests, integration tests
12. optional expansion

---

## 5A. Required Engineering Gates

These gates apply to every phase and are not optional.

### Type gate

* strict type-check must pass
* no banned weak-typing patterns in critical-path modules
* transport, domain, resilience, and provider layers must remain type-separated

### Validation gate

* all external inputs must pass runtime validation
* all provider outputs must pass runtime validation before normalization
* malformed-success responses must be rejected

### Test gate

* unit tests must exist for newly introduced decision logic
* contract tests must exist for every new provider adapter
* resilience logic must include negative-path tests

### Observability gate

* every new critical flow must produce logs and metrics sufficient for debugging
* every new degraded path must emit warnings or failure signals consistently

### Boundary gate

* no provider-specific logic may escape adapters
* no resilience logic may escape resilience layer
* no raw config lookups may escape config module

## 6. Milestone Gates

### Milestone A: Router skeleton complete

Requires:

* repo bootstrapped
* config loader
* domain contracts
* logger
* MCP server startup path
* strict typing enabled and enforced
* runtime validation baseline present
* CI running type-check, lint, and tests

### Milestone B: Basic Antigravity integration complete

Requires:

* Antigravity connects successfully
* tools register successfully
* `router.health` works

### Milestone C: Multi-provider execution complete

Requires:

* OpenAI adapter works
* GLM adapter works
* normalized outputs verified
* provider output validation active
* contract tests passing for both adapters

### Milestone D: Recovery model complete

Requires:

* retries bounded and classified
* fallback works safely
* request budget enforced
* attempt history exposed

### Milestone E: Production hardening baseline complete

Requires:

* circuit breakers active
* concurrency isolation active
* metrics available
* health depth available
* sanitization verified
* alertable observability signals defined

### Milestone F: Verification complete

Requires:

* contract tests passing
* chaos tests passing
* Antigravity integration tests passing

---

## 7. Risk Register

### Risk 1: GLM compatibility drift

**Impact:** medium to high

**Mitigation:**

* dedicated adapter
* contract tests
* no assumption of full OpenAI compatibility

### Risk 2: Retry logic becomes harmful

**Impact:** high

**Mitigation:**

* bounded retries
* request budgets
* provider-specific policies
* circuit breakers

### Risk 3: One provider exhausts router resources

**Impact:** high

**Mitigation:**

* bulkheads
* per-provider concurrency limits
* overload rejection

### Risk 4: Observability too weak during incidents

**Impact:** high

**Mitigation:**

* counters
* latency metrics
* failure-rate metrics
* fallback metrics
* breaker metrics

### Risk 5: Tool contract drift harms Antigravity UX

**Impact:** medium

**Mitigation:**

* very small tool surface
* stable normalized contracts
* integration tests inside Antigravity

### Risk 6: Raw provider errors leak secrets or confusing details

**Impact:** high

**Mitigation:**

* sanitization layer
* structured error mapping
* redaction at logger boundary

---

## 8. Definition of Done

A phase is done only when:

* code exists
* tests for the phase exist
* health and logging are good enough to debug that phase
* error paths are handled, not only happy paths
* deliverables match the architecture boundaries
* no major provider-specific leakage exists outside adapters
* strict type-check passes
* runtime validation exists for every new external boundary introduced in the phase
* no critical-path weak-typing or boundary-rule violations remain

The project’s first release is done only when:

* Antigravity can use the router through MCP
* OpenAI and GLM both work through `llm.chat`
* outputs are normalized
* policy enforcement works
* retries and fallback are bounded and explainable
* degraded success is visible through warnings
* circuit breakers and concurrency controls protect the router
* metrics and health are actionable
* contract tests and chaos tests pass
* CI enforces type-check, lint, tests, and agreed coverage thresholds

## 9. Suggested Build Sequence for an Individual Engineer

If one strong engineer is building this sequentially, the most efficient order is:

1. bootstrap repo and config
2. define types and errors
3. stand up MCP server
4. implement `router.health`
5. implement provider registry
6. implement OpenAI adapter
7. wire `llm.chat`
8. implement `llm.list_models`
9. implement GLM adapter
10. normalize outputs across both
11. add retry classification and policy
12. add request budget and fallback
13. add circuit breaker and concurrency limits
14. add metrics and health depth
15. add tests and fault injection
16. validate live in Antigravity

---

## 10. Execution Matrix

This section turns the plan into an execution contract.

Each task should be tracked with:

* task id
* phase
* objective
* inputs and dependencies
* exact outputs
* acceptance criteria
* tests required
* observability required
* blocked by
* unlocks

---

### Phase 0 Matrix

| Task ID | Task                         | Objective                           | Inputs / Dependencies                      | Exact Outputs                                                                                                               | Acceptance Criteria                                              | Tests Required                    | Observability Required               | Blocks / Unlocks                             |
| ------- | ---------------------------- | ----------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------- | ------------------------------------ | -------------------------------------------- |
| P0-001  | Repository bootstrap         | Create implementation base          | requirements, architecture, chosen runtime | repo structure, package manifest, build scripts, lint config, formatter config                                              | repo installs and builds locally and in CI                       | build smoke test                  | startup/build logs                   | unlocks all later tasks                      |
| P0-002  | Runtime and toolchain freeze | Remove ambiguity in stack choices   | P0-001                                     | ADR or decision record covering runtime, MCP SDK, HTTP client, schema library, test stack, metrics approach                 | decisions documented and referenced by repo config               | none beyond doc review            | decision log entry                   | unlocks P0-003 to P0-007                     |
| P0-003  | Core type contracts          | Freeze domain interfaces            | P0-002                                     | normalized request/response types, provider adapter interface, error taxonomy, attempt record, health schema, warning codes | types compile, no provider-specific leakage in domain layer      | type-level tests where applicable | none beyond compile success          | unlocks P1, P2, P3                           |
| P0-004  | Typed config module          | Centralize and validate config      | P0-002, P0-003                             | config schema, typed loader, env validation, startup failure rules                                                          | invalid config fails clearly, valid config produces typed object | config unit tests                 | config validation logs               | blocks startup-related tasks, unlocks P1-001 |
| P0-005  | Logger baseline              | Create safe structured logging      | P0-002, P0-003                             | logger module, redaction rules, request-id support, log schema                                                              | secrets are redacted, structured logs emitted consistently       | logger unit tests                 | log event samples                    | unlocks all runtime tasks                    |
| P0-006  | Validation foundation        | Enforce runtime boundary validation | P0-003                                     | MCP input schemas, provider-output schemas, DTO-to-domain mappers, typed validation errors                                  | malformed external input cannot enter domain layer               | validation unit tests             | validation failure logs/metrics stub | unlocks P1-002, P1-003, P2 adapters          |
| P0-007  | Test and CI foundation       | Prevent silent regressions          | P0-001, P0-002                             | unit test setup, coverage config, contract-test folders, chaos-test harness skeleton, CI workflow                           | CI runs type-check, lint, and tests automatically                | CI smoke test                     | CI status reporting                  | unlocks all later phases                     |

---

### Phase 1 Matrix

| Task ID | Task                 | Objective                      | Inputs / Dependencies          | Exact Outputs                                                                   | Acceptance Criteria                                                   | Tests Required      | Observability Required              | Blocks / Unlocks                       |
| ------- | -------------------- | ------------------------------ | ------------------------------ | ------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------- | ----------------------------------- | -------------------------------------- |
| P1-001  | MCP server bootstrap | Expose MCP entrypoint          | P0-004, P0-005, P0-007         | server bootstrap, stdio transport wiring, tool registration skeleton            | server starts cleanly and registers required tools                    | startup smoke test  | startup log, registration log       | unlocks P1-002 to P1-005               |
| P1-002  | Tool handlers        | Handle tool calls safely       | P0-003, P0-006, P1-001         | `handleLlmChat`, `handleListModels`, `handleRouterHealth`                       | handlers reject invalid input and return only normalized DTOs         | handler unit tests  | request log, validation failure log | unlocks P1-003 and P2 execution wiring |
| P1-003  | Normalization layer  | Separate transport from domain | P0-003, P0-006, P1-002         | transport-to-domain mappers, domain-to-transport mappers, warning shaping rules | malformed success payloads are rejected, normalized shapes are stable | mapper unit tests   | normalization warnings              | unlocks P2 adapters                    |
| P1-004  | Provider registry    | Resolve providers safely       | P0-003, P1-001                 | registry module, registration API, lookup API                                   | unknown providers fail early and clearly                              | registry unit tests | provider registration log           | unlocks P2 adapters and P3 fallback    |
| P1-005  | Basic health service | Report router status           | P0-003, P0-004, P0-005, P1-001 | health service baseline, startup/config health reporting                        | `router.health` returns meaningful router status and warnings         | health unit tests   | health log baseline                 | unlocks P4 health depth                |

---

### Phase 2 Matrix

| Task ID | Task                              | Objective                         | Inputs / Dependencies                  | Exact Outputs                                                                              | Acceptance Criteria                                      | Tests Required                     | Observability Required                         | Blocks / Unlocks                                  |
| ------- | --------------------------------- | --------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------- | ---------------------------------- | ---------------------------------------------- | ------------------------------------------------- |
| P2-001  | OpenAI adapter                    | Support first external provider   | P0-003, P0-004, P0-006, P1-003, P1-004 | OpenAI adapter with request mapping, response mapping, errors, model listing, health check | `llm.chat` works against OpenAI with normalized output   | adapter unit tests, contract tests | provider request logs, provider latency metric | unlocks end-to-end external execution             |
| P2-002  | GLM adapter                       | Support second external provider  | P0-003, P0-004, P0-006, P1-003, P1-004 | GLM adapter with explicit compatibility handling                                           | `llm.chat` works against GLM with normalized output      | adapter unit tests, contract tests | provider request logs, provider latency metric | unlocks multi-provider routing                    |
| P2-003  | Capability model                  | Make feature support explicit     | P0-003, P2-001, P2-002                 | capability declarations and resolver logic                                                 | unsupported capabilities fail clearly before execution   | capability unit tests              | capability mismatch warnings/errors            | unlocks future structured-output/embeddings gates |
| P2-004  | Output normalization verification | Prove provider interchangeability | P2-001, P2-002, P2-003                 | golden examples or test fixtures showing consistent output shape                           | both providers return the same normalized contract shape | normalization contract tests       | normalization success/failure metrics stub     | milestone C gate                                  |

---

### Phase 3 Matrix

| Task ID | Task                     | Objective                             | Inputs / Dependencies                          | Exact Outputs                                                                                    | Acceptance Criteria                                                          | Tests Required             | Observability Required                   | Blocks / Unlocks                        |
| ------- | ------------------------ | ------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- | -------------------------- | ---------------------------------------- | --------------------------------------- |
| P3-001  | Failure classification   | Make decisions typed and explicit     | P0-003, P1-003, P2-001, P2-002                 | classification engine, typed error-code-to-action matrix                                         | all critical failure classes map predictably to retry/fallback/stop behavior | classification unit tests  | error classification counters            | unlocks all resilience tasks            |
| P3-002  | Retry policy engine      | Recover safely from transient failure | P3-001                                         | retry policy module with backoff, jitter, max attempts, provider/error rules                     | retry decisions are bounded and deterministic                                | retry unit tests           | retry count metrics, retry decision logs | unlocks protected execution             |
| P3-003  | Request budget manager   | Preserve useful recovery budget       | P3-001                                         | budget accounting module, per-attempt allocation rules, min-remaining-budget rules               | no new attempt begins without useful remaining budget                        | budget unit tests          | budget exhaustion logs/metrics           | unlocks P3-004 and P3-005               |
| P3-004  | Fallback executor        | Switch providers safely               | P1-004, P2-001, P2-002, P3-001, P3-002, P3-003 | fallback logic with loop prevention and independent validation                                   | fallback only occurs when configured, allowed, and useful                    | fallback unit tests        | fallback logs and metrics                | unlocks milestone D                     |
| P3-005  | Attempt history recorder | Explain what was tried                | P3-001, P3-002, P3-003, P3-004                 | typed attempt history records attached to terminal failure context and degraded success warnings | final failures explain attempts made without leaking secrets                 | attempt-history unit tests | attempt path logs                        | unlocks debug-ready resilience behavior |

---

### Phase 4 Matrix

| Task ID | Task                            | Objective                                        | Inputs / Dependencies                    | Exact Outputs                                                          | Acceptance Criteria                                                   | Tests Required                     | Observability Required                              | Blocks / Unlocks           |
| ------- | ------------------------------- | ------------------------------------------------ | ---------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------- | --------------------------------------------------- | -------------------------- |
| P4-001  | Circuit breaker registry        | Stop hammering dead providers                    | P3-001, P2 adapters                      | provider-level breaker state machine, cooldown-probe logic             | persistently failing providers are short-circuited appropriately      | breaker unit tests                 | breaker state metrics and logs                      | unlocks hardened execution |
| P4-002  | Concurrency limiter / bulkheads | Isolate provider failures                        | P0-004, P4-001                           | global and per-provider concurrency controls, overload rejection logic | one unstable provider cannot exhaust all execution capacity           | concurrency unit tests, load tests | active concurrency and overload metrics             | unlocks milestone E        |
| P4-003  | Metrics layer                   | Make system operable                             | P0-005, P0-007, P3 tasks, P4-001, P4-002 | metrics module with standard names, labels, cardinality rules          | critical flows emit actionable counters and latency metrics           | metrics tests where practical      | request, retry, fallback, breaker, overload metrics | unlocks alerting readiness |
| P4-004  | Health depth                    | Separate config, discovery, and execution health | P1-005, P2 adapters, P4-001, P4-002      | enriched health service with degraded-state reporting                  | health reflects real degraded states, not only startup status         | health integration tests           | health logs and health metrics                      | unlocks ops readiness      |
| P4-005  | Sanitization and safety         | Prevent leaks in failure paths                   | P0-005, P2 adapters, P3-001              | sanitization layer for upstream/provider errors and sensitive fields   | secrets and unsafe payload fragments do not leak in logs or responses | sanitization unit tests            | redaction verification logs                         | milestone E gate           |

---

### Phase 5 Matrix

| Task ID | Task                          | Objective                      | Inputs / Dependencies | Exact Outputs                                                                                                        | Acceptance Criteria                                             | Tests Required    | Observability Required                   | Blocks / Unlocks      |
| ------- | ----------------------------- | ------------------------------ | --------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ----------------- | ---------------------------------------- | --------------------- |
| P5-001  | Unit test suite completion    | Cover decision-heavy logic     | all prior phases      | complete unit tests for validation, policy, retry, budget, breaker, concurrency, mappers                             | critical-path modules meet agreed minimum coverage threshold    | unit tests        | test reporting in CI                     | supports release gate |
| P5-002  | Adapter contract suite        | Detect compatibility drift     | P2-001, P2-002        | provider contract fixtures and shared assertions                                                                     | both adapters pass the same normalized contract expectations    | contract tests    | contract-test result reporting           | supports release gate |
| P5-003  | Chaos test suite              | Prove resilience under failure | P3, P4                | fault injection tests for timeout, malformed JSON, partial responses, DNS failure, rate limit, credential revocation | resilience logic behaves as designed under injected failures    | chaos tests       | chaos-run metrics/log review             | supports release gate |
| P5-004  | Load and concurrency suite    | Validate overload behavior     | P4-002, P4-003        | load tests and overload behavior tests                                                                               | overload is controlled, provider isolation holds under pressure | load tests        | load-test metrics reports                | supports release gate |
| P5-005  | Antigravity integration suite | Verify real MCP behavior       | P1 through P4         | end-to-end integration checks for tool registration, invocation, structured errors, warnings                         | router works reliably inside Antigravity                        | integration tests | integration logs and health observations | milestone F gate      |

---

### Phase 6 Matrix

| Task ID | Task                           | Objective                                | Inputs / Dependencies          | Exact Outputs                                        | Acceptance Criteria                                                   | Tests Required                | Observability Required       | Blocks / Unlocks   |
| ------- | ------------------------------ | ---------------------------------------- | ------------------------------ | ---------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------- | ---------------------------- | ------------------ |
| P6-001  | Ollama adapter                 | Add local runtime path safely            | milestone F                    | Ollama adapter                                       | local provider works through same normalized contract                 | adapter tests, contract tests | provider metrics and health  | optional expansion |
| P6-002  | Self-hosted compatible adapter | Add controlled self-hosted provider path | milestone F                    | OpenAI-compatible self-hosted adapter                | self-hosted provider works without breaking core tool contracts       | adapter tests, contract tests | provider metrics and health  | optional expansion |
| P6-003  | Structured output mode         | Expand chat capability carefully         | P2-003, milestone F            | structured-output execution path and validation      | invalid structured output is rejected, supported output is normalized | structured-output tests       | warning/error metrics        | optional expansion |
| P6-004  | Embeddings support             | Expand tool surface carefully            | milestone F                    | embedding interface, adapter support where available | new tool does not weaken existing stability                           | unit tests, contract tests    | tool-specific metrics        | optional expansion |
| P6-005  | Remote MCP passthrough         | Controlled advanced expansion            | milestone F, policy extensions | allowlisted passthrough path                         | passthrough remains policy-controlled and observable                  | integration tests             | passthrough logs and metrics | optional expansion |

---

## 11. Suggested Defaults and Quantitative Gates

These values should be finalized early and versioned in the repo.

### Type and quality gates

* type-check must pass with zero errors
* lint must pass with zero critical-rule violations
* banned weak-typing violations in critical paths: 0
* direct provider calls outside adapters: 0
* raw env lookups outside config module: 0

### Coverage gates

* critical-path line coverage target: at least 90%
* critical-path branch coverage target: at least 80%
* provider adapter contract coverage: 100% of supported adapter operations

### Runtime gates

* startup with valid config: success
* startup with invalid critical config: fail fast
* malformed MCP input reaching domain layer: 0 occurrences allowed
* malformed successful-looking provider payload accepted as success: 0 occurrences allowed

### Resilience gates

* retry attempts per request: bounded by config with tested defaults
* fallback loops: 0 allowed
* same-provider useless fallback: 0 allowed
* breaker bypass on open state: 0 allowed
* overload without explicit rejection or queue policy: 0 allowed

### Operational gates

* secrets in logs: 0 allowed
* raw auth headers in logs: 0 allowed
* degraded execution without warning emission: 0 allowed
* critical flow without logs and metrics: 0 allowed

---

## 12. Role Expectations

### For the implementer

* follow the execution matrix strictly
* do not collapse architectural boundaries for speed
* do not mark a task done without its tests and observability hooks

### For the reviewer

* reject code that weakens typing, boundaries, or resilience clarity
* reject code that handles only happy paths
* reject code that lacks runtime validation at external boundaries

### For the project lead

* keep scope fixed to the first three tools until milestone F
* force unresolved ambiguity into written decisions early
* prefer fewer stronger features over more weaker features

---

## 13. Next Artifact After This Plan

After `implementation.md`, the strongest next artifact is the actual repository scaffold:

* root files
* `src/` layout
* core interfaces
* MCP bootstrap file
* stub adapters
* config loader
* logger

That is the point where planning should end and implementation should begin.
