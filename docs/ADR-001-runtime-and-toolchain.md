# ADR-001: Runtime and Toolchain Selection

## Status
Accepted

## Date
2026-04-06

## Context
The MCP Router for Antigravity requires a modern runtime and toolchain that supports:
- Strong typing with strict mode
- Runtime validation at boundaries
- MCP protocol support
- Resilience patterns (retry, circuit breakers)
- Observable execution with metrics
- Production-grade error handling

## Decision

### 1. Runtime: Node.js >= 20.10.0

**Rationale:**
- Native TypeScript support via ES modules
- Built-in fetch API for HTTP client needs
- Strong async/await support
- Mature ecosystem and LTS availability
- Official MCP SDK supports Node.js
- Required by @modelcontextprotocol/sdk

**Alternatives Considered:**
- Deno: Too experimental, less ecosystem support
- Bun: Not sufficiently battle-tested for production systems

### 2. Language: TypeScript 5.3.0

**Rationale:**
- Strong static typing with strict mode
- Excellent IDE support and tooling
- Mature ecosystem
- Required for production-grade error prevention
- Official MCP SDK provides TypeScript definitions

**Strict Mode Configuration:**
- `strict: true` (all strict checks enabled)
- `strictNullChecks: true`
- `noImplicitAny: true`
- `noUncheckedIndexedAccess: true`
- `exactOptionalPropertyTypes: true`
- `noUnusedLocals: true`
- `noUnusedParameters: true`

**Forbidden in Critical Paths:**
- `any` type (except isolated compatibility wrappers)
- Raw JSON casts to domain models
- Untyped external payload propagation

### 3. MCP SDK: @modelcontextprotocol/sdk v1.0.4

**Rationale:**
- Official Anthropic MCP protocol implementation
- Type-safe interface definitions
- Stdio transport support
- Active maintenance and updates

**Usage:**
- Server bootstrap and tool registration
- Stdio transport handling
- Tool input/output parsing

### 4. HTTP Client: Native fetch API (Node.js >= 20)

**Rationale:**
- Built into Node.js 20+
- No additional dependency overhead
- Modern async/await interface
- Supports timeout and abort signals
- Sufficient for provider API needs

**Provider-Specific HTTP:**
- OpenAI: Standard fetch with API key auth
- GLM: Standard fetch with API key auth
- Ollama: Standard fetch to localhost

**Fallback Consideration:**
- If provider requires complex auth (OAuth), may introduce additional library

### 5. Schema Validation: Zod 3.22.4

**Rationale:**
- Runtime type checking and validation
- TypeScript type inference from schemas
- Excellent error messages
- Lightweight and fast
- Active development
- Supports complex validation rules

**Usage Points:**
- MCP tool input validation
- Provider response validation
- Configuration validation
- Domain model guards

**Example:**
```typescript
import { z } from 'zod';

const ChatRequestSchema = z.object({
  provider: z.string().optional(),
  model: z.string().optional(),
  messages: z.array(z.object({
    role: z.enum(['system', 'user', 'assistant', 'tool']),
    content: z.string(),
  })),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().positive().optional(),
});
```

### 6. Test Stack: Node.js built-in test runner (node --test)

**Rationale:**
- Built into Node.js 20+
- No test framework dependency
- Native support for ESM
- Simple and fast
- Sufficient for unit, integration, and chaos tests
- c8 for coverage

**Coverage Tool:**
- c8 9.0.0 for coverage reporting

### 7. Metrics Interface: Structured logging with placeholder metrics

**Rationale:**
- Start with comprehensive structured logging
- Define metrics interface for future integration (Prometheus, CloudWatch, etc.)
- Avoid premature complex metric system dependencies
- Metrics emitted through centralized interface

**Metrics Categories:**
- Counters: request volume, retry counts, failure counts
- Timers: latency by provider/operation
- Gauges: active concurrency, circuit-breaker state
- Histograms: latency distributions

**Future Integration:**
- Can swap in Prometheus client, OpenTelemetry, or custom system
- Interface remains stable through swap

### 8. Linting: ESLint with TypeScript plugin

**Configuration:**
- `eslint:recommended` base rules
- `@typescript-eslint/recommended`
- `@typescript-eslint/recommended-requiring-type-checking`
- `prettier` for formatting compatibility

**Critical Lint Rules:**
- `@typescript-eslint/no-explicit-any`: Error
- `@typescript-eslint/no-unsafe-*`: All variants as Error
- `@typescript-eslint/strict-boolean-expressions`: Error
- `no-console`: Warn (allow warn/error)
- `no-debugger`: Error
- `no-eval`: Error

**CI Enforcement:**
- Zero critical-rule violations required
- Type-check must pass with zero errors

### 9. Formatting: Prettier 3.1.0

**Configuration:**
- Semi-colons: enabled
- Single quotes
- 100 character line width
- 2-space indentation
- ES5 trailing commas

**Integration:**
- ESLint configured to use Prettier rules
- `npm run format` for auto-formatting
- `npm run format:check` for CI verification

### 10. Type-Checking Policy

**Mandatory Compiler Flags:**
- `strict: true`
- `strictNullChecks: true`
- `noImplicitAny: true`
- `strictFunctionTypes: true`
- `strictBindCallApply: true`
- `strictPropertyInitialization: true`
- `noImplicitThis: true`
- `useUnknownInCatchVariables: true`
- `alwaysStrict: true`
- `noUnusedLocals: true`
- `noUnusedParameters: true`
- `exactOptionalPropertyTypes: true`
- `noImplicitReturns: true`
- `noFallthroughCasesInSwitch: true`
- `noUncheckedIndexedAccess: true`
- `noImplicitOverride: true`

**Critical Path Enforcement:**
- No `any` types in `src/server/`, `src/core/`, `src/resilience/`, `src/providers/`, `src/infra/`
- Raw environment access only in `src/infra/`
- Provider SDK calls only in `src/providers/`

## Forbidden Language Features

### Type Escapes
- `any` type (except documented compatibility wrappers)
- `unknown` type without validation
- Type assertions `as` without runtime validation
- Index signatures without proper typing

### Error Handling
- Throwing non-Error objects
- Swallowing errors without logging/classification
- Returning raw provider error strings

### Async Patterns
- Nested callbacks
- Promise chains without await
- Unhandled promise rejections

### Security
- `eval()` or `Function()` constructor
- Dynamic imports without allowlist
- Arbitrary URL construction without validation

## Dependencies

### Runtime Dependencies
- `@modelcontextprotocol/sdk`: ^1.0.4
- `zod`: ^3.22.4

### Development Dependencies
- `typescript`: ^5.3.0
- `@types/node`: ^20.10.0
- `eslint`: ^8.55.0
- `@typescript-eslint/eslint-plugin`: ^6.13.0
- `@typescript-eslint/parser`: ^6.13.0
- `eslint-config-prettier`: ^9.1.0
- `prettier`: ^3.1.0
- `c8`: ^9.0.0

## Future Considerations

### Metrics Integration
- Can integrate Prometheus client, OpenTelemetry, or CloudWatch SDK
- Keep metrics interface stable
- Start with logging, add real metrics system when operational needs arise

### HTTP Client
- May add specialized client if providers require complex auth (OAuth, etc.)
- Keep HTTP layer isolated in `src/infra/http.ts`
- Provider adapters call through HTTP abstraction layer

### Streaming
- Future support for streaming responses
- Requires careful resilience handling
- Not in v1 scope

## Consequences

### Positive
- Strong type safety enforced at compile time
- Runtime validation at all external boundaries
- Clear separation of concerns
- Minimal dependency footprint
- Familiar tools for Node.js developers
- Production-ready error handling

### Negative
- Strict typing may increase initial development time
- Learning curve for strict TypeScript patterns
- Some runtime overhead from Zod validation (acceptable for safety)

## Alternatives Considered

| Decision | Alternative | Reason for Rejection |
|-----------|--------------|----------------------|
| Runtime | Bun, Deno | Insufficient maturity and ecosystem support |
| Language | JavaScript | No compile-time type safety |
| Schema | Joi, Yup | Less type inference, larger bundle |
| HTTP | axios, node-fetch | Additional dependencies, native fetch sufficient |
| Test Runner | Jest, Mocha | Heavier dependency, built-in runner sufficient |
| Linting | no strict rules | Would compromise type safety guarantees |

## References
- TypeScript Handbook: https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-3
- MCP Protocol: https://modelcontextprotocol.io/
- Zod Documentation: https://zod.dev/
- Node.js 20 Features: https://nodejs.org/en/blog/announcements/v20-release-announce
