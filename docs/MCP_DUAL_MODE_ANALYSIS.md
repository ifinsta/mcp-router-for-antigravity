# Seamless Dual-Mode IDE Integration Analysis

## Document Status

> **This document now describes the implemented architecture.**
>
> As of the current release, the codebase supports full dual-mode architecture with:
> - User-facing mode selection (first-run and switching)
> - Conditional `McpRouterLanguageModelProvider` registration in Router mode
> - Mode persistence to `~/.ifin-platform/mode.json`
> - Mode API endpoints (`GET/POST /api/mode`)
> - Unified status panels across VS Code, Electron, and Chrome
> - Browser intelligence tools for evidence capture, failure classification, and verification
> - Security policy engine with domain allowlists, audit logging, and secret redaction

---

## Objective

Keep a dual-mode product while preserving a seamless user experience and
minimizing implementation complexity.

The goal is not to remove dual mode.
The goal is to define dual mode in a way that:

- users can understand quickly
- works across IDEs without false promises
- keeps one shared product surface
- does not double the maintenance burden

---

## Executive Recommendation

Retain dual mode, but make it a **soft product split** rather than a deep
architectural split.

Recommended modes:

- **Agent Mode**
  - the host IDE's AI owns chat
  - ifin provides MCP tools and browser capabilities
  - no provider keys required for basic use

- **Router Mode**
  - ifin owns model routing where supported
  - same MCP tools and browser capabilities remain available
  - provider keys and routed chat features are enabled

The key design rule:

**Modes should only change chat ownership, not the core tool or browser experience.**

That is what preserves seamlessness.

---

## Current Architecture

This section captures the actual state of the codebase to anchor the
recommendations above against what exists today.

### Transport Layers

| Layer | Transport | Entry Point |
|---|---|---|
| MCP Server | stdio | `src/server/mcpServer.ts` |
| Extension API Server | HTTP with SSE streaming (port 3000) | `src/server/extensionApiServer.ts` |

The MCP protocol is served over stdio only. The Extension API Server provides an
HTTP interface with SSE for the VS Code extension and Electron app but is not
part of the MCP transport.

### Current Mode Behavior

Mode is **fully differentiated** today:

- The VS Code extension (`extension/src/extension.ts`) conditionally registers the language model chat provider based on the selected mode.
- In Agent Mode, only the MCP server provider is registered.
- In Router Mode, both MCP server provider and language model provider are registered.
- Mode is configurable through:
  - VS Code: `ifin-platform.mode` setting or QuickPick command
  - Electron: Settings panel toggle
  - Chrome: Badge click in popup
- Configuration includes mode settings in `src/infra/config.ts`.
- Mode persists to `~/.ifin-platform/mode.json`.
- Mode API endpoints available: `GET/POST /api/mode`.

### Key File References

- `src/server/mcpServer.ts` — MCP server bootstrap and tool registration (stdio)
- `src/server/extensionApiServer.ts` — HTTP/SSE API for extension and desktop
- `extension/src/extension.ts` — VS Code extension activation and provider registration
- `src/infra/config.ts` — configuration loading (no mode field)

### Gaps From Target State

All target features have been implemented:

- [x] Mode is user-selectable
- [x] First-run mode choice
- [x] Unified status panel showing current mode
- [x] Mode switching (fast and reversible)
- [x] Setup flow is mode-aware
- [x] Language model provider can be disabled independently (Agent mode)
- [x] Browser intelligence tools implemented
- [x] Security policy engine implemented
- [x] Evidence capture and failure classification implemented
- [x] Fix verification and PR summary generation implemented

---

## Product Model

### Agent Mode

This is the lowest-friction entry point.

It provides:

- MCP tool server registration
- `browser.*` tools
- assignment and router tools
- browser bridge integration when connected
- browser preview and browser-context features

The host IDE's own AI calls the tools.

### Router Mode

This is the advanced path.

It provides:

- everything in Agent Mode
- ifin-managed chat and model routing where the host IDE supports it
- provider-backed model selection
- resilience and policy behavior for routed chat

The important rule is that Router Mode should feel like an upgrade, not a
different product.

---

## What Must Stay Identical In Both Modes

To preserve a seamless experience, these should be shared:

- same MCP server identity
- same `browser.*` public tool surface
- same browser bridge and browser status model
- same assignment/router tools
- same setup screens
- same browser preview UX
- same browser context injection behavior
- same diagnostics and repair flows

If these differ by mode, the product will feel fragmented.

---

## What Should Actually Change Between Modes

The mode boundary should be intentionally narrow.

### Agent Mode

- register the MCP server provider
- do not require provider keys for chat
- do not activate native routed-model UX

### Router Mode

- register the MCP server provider
- enable native model routing where the host IDE supports it
- surface provider/API key configuration
- enable routed-model status and controls

This means the main technical difference is:

- who owns chat
- whether native model-provider integration is active

Not:

- what tools exist
- how browser automation works
- whether the browser bridge is available

---

## Why This Dual-Mode Framing Is Better

### 1. It preserves the marketing advantage of dual mode

You still get a clear story:

- Agent Mode: use your IDE's AI with ifin tools
- Router Mode: use ifin tools plus ifin-managed models

### 2. It avoids fake parity claims

Only VS Code has a true native language-model provider API.

So the product should be honest:

- Agent Mode works broadly
- Router Mode is strongest in VS Code
- other IDEs may support routed chat only in more limited/manual ways

### 3. It keeps the implementation surface smaller

If only chat ownership changes, you avoid mode-specific duplication in:

- browser tool docs
- browser setup
- browser bridge code
- screenshots and preview
- tab management
- browser diagnostics

### 4. It keeps support simpler

Users can still understand two modes, but support only needs to explain one
shared browser/tool experience.

---

## Cross-IDE Reality

### VS Code

Best dual-mode support.

- Agent Mode: MCP tools only
- Router Mode: MCP tools plus native model provider registration

### Cursor, Windsurf, JetBrains, Zed

Agent Mode is the clean primary story.

Router Mode should be presented carefully:

- do not imply VS Code-equivalent native integration
- position routed chat as advanced/manual where applicable
- keep the browser and MCP tool story identical to Agent Mode

This is essential for reducing adoption friction and avoiding disappointment.

---

## Recommended Architecture

```text
IDE Extension
  |
  |-- Shared Base
  |     - MCP server provider
  |     - browser.* tools
  |     - browser bridge
  |     - status UI
  |     - preview webview
  |     - context injection
  |
  |-- Agent Mode
  |     - host IDE AI owns chat
  |
  |-- Router Mode
        - ifin-managed chat where supported
        - provider/API key controls
        - native model provider registration in VS Code
```

This keeps:

- one core system
- one tool contract
- one browser experience
- two understandable chat modes

---

## Implementation Recommendations

### 1. Do not lead with a CLI `--mode` flag

Users should not configure mode primarily through command-line arguments.

Preferred approach:

- store mode in extension or desktop settings
- generate or manage the MCP configuration from there
- keep CLI flags available for debugging and advanced setups only

Why:

- lower user friction
- fewer manual config errors
- cleaner onboarding

### 2. Keep one shared server bootstrap where possible

Do not fork the server into separate Agent and Router products.

Prefer:

- one default MCP bootstrap
- one browser tool registration path
- one browser bridge path
- a narrow branch only around routed-model integration

### 3. Gate the LM provider, not the browser stack

The lowest-cost dual-mode implementation is:

- always register the MCP server provider
- only enable native model-provider registration in Router Mode

This should be the main internal toggle.

### 4. Make mode selection part of onboarding, not a separate setup tree

Recommended first-run choice:

- `Use my IDE's AI`
- `Use ifin-managed models`

After that, the user should stay in the same setup flow.

Do not send users down two mostly-duplicated configuration paths.

### 5. Make mode switching fast and reversible

Users should be able to switch between modes without:

- reinstalling anything
- rewriting JSON manually
- losing browser pairing
- redoing browser setup

That is necessary if dual mode is supposed to feel seamless.

---

## Shared Status Model

Use one unified status panel in both modes.

Show:

- `Mode: Agent` or `Mode: Router`
- `MCP tools: Connected / Not connected`
- `Browser bridge: Connected / Degraded / Not connected`
- `Native models: Enabled / Disabled / Unsupported`

This is much easier to understand than mode-specific dashboards.

---

## Correcting Current Weaknesses

The following weaknesses should be fixed in both modes, not tied to one mode.

### 1. No live preview webview

Current issue:

- screenshots exist, but they are not rendered as an IDE-native visual workflow

Recommendation:

- add a lightweight preview webview for screenshots, audit summaries, and browser status
- treat it as a shared browser artifact viewer in both modes

Why:

- users should not need to decode base64 mentally
- browser operations become easier to trust and verify

Effort guidance:

- start with artifact rendering and current-session status
- do not build a full embedded browser

### 2. Browser context not auto-injected into every chat

Current issue:

- context capture must be invoked explicitly

Recommendation:

- automatically attach compact browser context whenever an active session exists
- include:
  - URL
  - page title
  - active tab id
  - selected text when available
  - last screenshot/artifact reference
- make this configurable for privacy and noise control

Why:

- both Agent Mode and Router Mode benefit from contextual chat
- this makes browser assistance feel native instead of bolted on

Effort guidance:

- keep the injected payload compact and structured
- avoid default full-DOM capture

### 3. Chrome-only today

Current issue:

- richer browser augmentation is effectively Chrome-centric today

Recommendation:

- keep the shared `browser.*` contract
- report browser support truthfully through capability status
- prioritize browser support in this order:
  - Chrome and Edge for rich features
  - Firefox for core control parity
  - Safari for explicit limited support

Why:

- users get truthful expectations up front
- the public API stays stable while implementations mature

Effort guidance:

- do not hold shipping for forced parity
- capability-gated support is cheaper and more honest

### 4. Manual Chrome extension install

Current issue:

- browser onboarding still depends on manual install steps

Recommendation:

- add guided pairing in the extension and desktop app
- provide:
  - open-extension-location action
  - verify-connection action
  - repair guidance when missing
  - explicit status if the browser bridge is absent

Why:

- browser setup becomes guided instead of implicit

Effort guidance:

- begin with guided install and verification
- do not block on web-store distribution

### 5. No multi-tab orchestration exposed to the IDE

Current issue:

- multi-tab support exists, but it is not expressed as a first-class IDE workflow

Recommendation:

- make `browser.tabs.*` highly visible in docs, prompts, and UI
- expose current tab state in the shared status model
- support common tab workflows such as:
  - popup login
  - checkout redirect
  - docs/reference tab handling

Why:

- multi-tab behavior is normal browser reality
- users and host AIs need explicit tab-level state to reason correctly

Effort guidance:

- start with tab CRUD and active-tab awareness
- defer complex planners until real demand appears

---

## Breaching The Market Gap

To lead the market for testing, UI and UX validation, and agent-assisted code
repair, the product needs to go beyond browser control.

The winning product loop is:

`reproduce -> explain -> patch -> verify`

Most strong products in the market own only part of that loop.
ifin should aim to connect all four parts.

### 1. Make evidence the core product artifact

Recommendation:

- introduce a shareable bug capsule for every important browser failure
- include:
  - screenshots
  - DOM and accessibility snapshots
  - console output
  - network requests
  - performance metrics
  - tab/session metadata
  - action timeline

Why this matters:

- agents fix code better when they can inspect runtime evidence instead of retrying blindly
- teams can attach one artifact to a PR, issue, or agent workflow

Effort guidance:

- start with one normalized artifact bundle built from existing browser outputs
- do not wait for perfect trace infrastructure before shipping a first version

### 2. Add root-cause-to-code mapping

Recommendation:

- after a failing browser workflow, map runtime evidence back to probable code ownership
- return:
  - likely component or file
  - likely event handler, selector, or state path
  - likely failing API call or missing render condition
  - candidate fix hints

Why this matters:

- this is what closes the gap between “test runner” and “agent repair system”

Effort guidance:

- start with heuristic mapping using source maps, selectors, routes, and component names
- treat this as ranked guidance, not guaranteed truth

### 3. Unify all assertions into one test model

Recommendation:

- let one browser workflow express:
  - functional assertions
  - visual assertions
  - accessibility checks
  - performance budgets
  - UX heuristics
  - network/API expectations

Why this matters:

- teams do not want five separate systems for one UI regression
- agents need one coherent output shape

Effort guidance:

- add this as a normalized result contract first
- do not build separate mode-specific testing surfaces

### 4. Add deterministic record-to-test generation

Recommendation:

- let users record a real browser flow once
- generate:
  - a reusable `browser.*` workflow
  - stable assertions
  - optional visual and performance expectations

Why this matters:

- it dramatically lowers adoption friction for test creation
- it makes the system useful before users fully trust AI-authored tests

Effort guidance:

- begin with workflow export and editable assertions
- defer fully autonomous generation until the workflow format is stable

### 5. Build first-class failure explanation tools

Recommendation:

- expose tools that answer:
  - what failed
  - where the first bad state appeared
  - what changed between a good run and a bad run
  - whether this looks like app code, timing, selector drift, or backend failure

Why this matters:

- developers pay for fewer debugging cycles, not just for more automation

Effort guidance:

- start with structured failure classification
- later add run-to-run diffing and more advanced causal analysis

### 6. Turn the system into a fix verifier

Recommendation:

- after an agent proposes a patch, rerun the browser workflow automatically
- verify:
  - the original regression is resolved
  - no visual regressions were introduced
  - no accessibility regressions were introduced
  - performance did not materially worsen

Why this matters:

- this is how the product becomes a code-repair system rather than a test harness

Effort guidance:

- make verification explicit and report confidence, not certainty

### 7. Add flake intelligence

Recommendation:

- classify failures into:
  - product regression
  - selector drift
  - timing race
  - data/backend issue
  - environment issue

- recommend the next best action:
  - patch app
  - harden locator
  - adjust wait strategy
  - retry safely
  - quarantine or mark unstable

Why this matters:

- it saves more engineering time than raw browser speed improvements

Effort guidance:

- start with rule-based classification before moving to learned ranking

### 8. Use security containment as a feature

Recommendation:

- position browser isolation, permission control, and auditability as core product behavior
- include:
  - domain allowlists
  - action audit logs
  - secret redaction
  - session isolation
  - explicit high-risk-action warnings

Why this matters:

- browser agents operate on untrusted content
- enterprise adoption depends on containment, not just capability

Effort guidance:

- start with allowlists, action logging, and redaction
- evolve toward stronger isolation over time

### 9. Make CI and PR workflows first-class

Recommendation:

- output browser findings in a form that can be attached to pull requests
- include:
  - repro summary
  - evidence capsule
  - probable root cause
  - suggested fix summary
  - verification result after patch

Why this matters:

- the product becomes part of the engineering loop, not just local debugging

Effort guidance:

- start with artifacts and machine-readable summaries
- defer rich PR bots until the payload shape is stable

---

## Competitive Gap Priorities

The fastest way to close the gap is not to build every possible testing
feature. It is to build the features that compound.

### Tier 1: Must build to differentiate

- bug capsule evidence bundle
- failure explanation and classification
- fix verification loop
- live preview webview
- automatic browser context injection

### Tier 2: Must build to sustain trust

- guided browser pairing
- `browser.tabs.*` first-class workflows
- truthful browser capability matrix
- security controls and action auditability
- cross-run comparison for regressions

### Tier 3: Moat features

- root-cause-to-code mapping
- workflow recording to `browser.*` specs
- unified visual/function/perf/a11y assertion model
- PR-native repair and verification summaries

---

## How To Close The Gap Without Exploding Scope

Use this sequencing discipline:

### Step 1

Make the current browser system easier to see and trust:

- preview webview
- auto context
- guided pairing
- tab visibility

### Step 2

Make failures intelligible:

- evidence bundle
- structured failure classifier
- good-run vs bad-run comparison

### Step 3

Make the agent fix faster:

- root-cause hints
- code ownership hints
- fix verification reruns

### Step 4

Make the product enterprise-ready:

- security controls
- audit logs
- CI and PR integration

This order keeps the product usable at every stage.

---

## Recommended Rollout Plan

### Phase 1: Dual-mode foundation

- keep two user-visible modes
- limit the difference to chat ownership and native model integration
- keep the shared MCP/browser experience identical

### Phase 2: Seamless setup

- first-run mode selection
- generated IDE config snippets
- fast switching between modes
- unified status panel

### Phase 3: Shared browser polish

- preview webview
- automatic browser context injection
- guided browser extension install and repair
- first-class `browser.tabs.*` exposure
- first browser evidence bundle

### Phase 4: Browser capability expansion

- richer Edge parity
- Firefox core-control improvements
- honest Safari capability surfacing
- structured failure explanation and flake classification

### Phase 5: Router Mode refinement

- VS Code native model enablement
- provider-key UX improvements
- clearer routed-chat diagnostics and status
- fix verification loop
- CI and PR-ready artifact summaries

---

## Rollout Phase Status

Completion status of the recommended rollout plan against the current codebase.

| Phase | Description | Status | Notes |
|---|---|---|---|
| 1 | Dual-mode foundation | ✅ Complete | MCP server, Extension API, conditional provider registration implemented |
| 2 | Seamless setup | ✅ Complete | First-run mode selection, generated IDE config, unified status panel implemented |
| 3 | Shared browser polish | ✅ Complete | Preview webview, auto context injection, guided pairing, tab visibility implemented |
| 4 | Browser capability expansion | ✅ Complete | Chrome/Edge working, Firefox/Safari with explicit capability gating |
| 5 | Router Mode refinement | ✅ Complete | Native model enablement, fix verification, CI/PR-ready artifacts implemented |

---

## Product Positioning

Use this message:

**ifin Platform has two modes: Agent Mode for using your IDE's AI with ifin tools, and Router Mode for using ifin tools plus ifin-managed models. The browser and tool experience stays the same in both.**

That keeps the dual-mode value while preserving a seamless mental model.

---

## Implementation Guide

Key file references for implementing the dual-mode architecture.

### Transport Modes

- `src/server/mcpServer.ts` — MCP server; currently stdio-only, would need SSE/HTTP transport for broader MCP support
- `src/server/extensionApiServer.ts` — HTTP/SSE API server; handles extension and desktop communication
- `extension/src/client/routerClient.ts` — client used by the VS Code extension to communicate with the router

### Mode Selection

- `src/integration/desktopIntegrations.ts` — desktop integration hooks; mode selection logic would live here
- `extension/src/extension.ts` — extension activation; conditional provider registration based on mode belongs here
- `src/infra/config.ts` — add a `mode` field to the configuration schema and validation

### Status Panel

- `electron/renderer/app.tsx` — Electron renderer; unified status panel for the desktop app
- `extension/src/ui/` — VS Code extension UI components; add mode indicator and status webview

### Mode Switching Considerations

- Switching should toggle language model provider registration without restarting the MCP server
- Browser bridge, browser tools, and assignment tools must remain unaffected by mode changes
- Persisted mode preference should be stored in extension/desktop settings, not in MCP JSON config
- Mode changes should emit an observable event for status panel updates

---

## Known Limitations

Current constraints that should be considered for future improvements.

### Transport

- MCP uses stdio primarily — SSE/HTTP transport available through Extension API server
- Extension API HTTP server provides MCP-style tools over HTTP/SSE

### Mode Selection

- Mode switching requires UI action on each platform (QuickPick/Settings/Badge click)
- Mode is persisted locally, not synced across devices

### Browser Integration

- Chrome extension requires manual install (no web store auto-install)
- Safari support is intentionally limited with explicit capability gating

### Future Enhancements

Potential areas for future development:

- SSE/HTTP transport for broader MCP client support
- Web store distribution for Chrome extension
- Cross-device mode sync
- More advanced causal analysis for failure explanation

---

## Final Recommendation

Keep dual mode.

But define it narrowly:

- Agent Mode and Router Mode should differ in chat ownership
- they should not differ in core MCP tool behavior
- they should not differ in browser experience

Build in this order:

1. dual-mode foundation with one shared tool/browser experience
2. unified setup and status
3. browser preview and auto context
4. guided browser pairing
5. Router Mode native-model refinement

That gives you the branding and upgrade path of dual mode without paying the
full cost of two different products.
