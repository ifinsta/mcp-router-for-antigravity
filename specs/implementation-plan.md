# implementation-plan.md

## Purpose

This document records the current delivery plan for the MCP router and the
browser beta that now ships through the unified `browser.*` contract.

It exists to keep sequencing, scope, and documentation aligned with the actual
public MCP surface.

---

## Current Delivery Focus

The router now has two active product surfaces:

- stable LLM routing through `llm.*`
- unified browser control and diagnostics through `browser.*`

The browser beta is a clean public-contract move away from the older split
between browser testing tools and browser performance tools.

---

## Browser Beta Scope

### Public tools

The default browser-facing tools are:

- `browser.capabilities`
- `browser.session.open`, `browser.session.close`, `browser.session.list`
- `browser.navigate`, `browser.screenshot`, `browser.evaluate`
- `browser.click`, `browser.type`, `browser.fill_form`, `browser.hover`, `browser.wait_for`
- `browser.tabs.list`, `browser.tabs.create`, `browser.tabs.activate`, `browser.tabs.close`
- `browser.network.set_conditions`, `browser.network.reset`
- `browser.metrics`, `browser.web_vitals`, `browser.audit.design`
- `browser.profile.start`, `browser.profile.stop`

The older `test_*` and `perf_*` families are not the preferred public surface
and are not registered by default in the MCP bootstrap.

### Capability truthfulness

The browser beta must:

- report per-browser capability flags through `browser.capabilities`
- return structured unsupported results for unavailable features
- emit warnings when execution is degraded
- keep artifact handling consistent across screenshots, metrics, audits, and profiles

### Browser coverage

Current tiering is capability-based, not forced parity:

- Chrome: strongest coverage, CDP-first, extension-augmented when available
- Edge: strong Chromium coverage through CDP
- Firefox: core control, advanced diagnostics gated off explicitly
- Safari: contract-visible with explicit unsupported behavior for limited areas

---

## Workstreams

### 1. Public MCP contract

- keep the public browser tool family under `browser.*`
- preserve normalized request and response shapes
- ensure unsupported behavior is sanitized and typed

### 2. Browser domain and orchestration

- maintain a transport-neutral browser domain contract in `src/core/`
- keep browser orchestration in `src/browser/`
- prevent transport details from leaking into MCP outputs

### 3. Observability

- surface transport selection and degraded mode through warnings and logs
- record browser action outcomes consistently
- keep artifact creation predictable and inspectable

### 4. Documentation

- root `README.md` documents the public browser contract
- `docs/BROWSER.md` documents capability behavior and examples
- workflow/setup docs reference `browser.*` rather than retired public names

---

## Verification Expectations

### Contract tests

- every public `browser.*` tool has valid-input and invalid-input coverage
- normalized output shape is asserted
- structured unsupported responses are asserted
- structured failure responses are asserted

### Capability tests

- Chrome, Edge, Firefox, and Safari capability reports match actual implementation
- degraded browser states produce warnings instead of silent behavior changes

### Targeted browser workflows

- session open
- navigate
- evaluate
- screenshot
- one interaction action
- clean shutdown

### Chromium-enriched workflows

- tabs
- network controls
- profiling
- web vitals
- design audit

---

## Exit Criteria For This Phase

This browser beta phase is complete when:

- the default MCP server exposes `browser.*`
- browser capability reporting is typed and truthful
- unsupported behavior is explicit and sanitized
- browser artifacts are normalized
- README, browser docs, and specs all describe the same public contract
