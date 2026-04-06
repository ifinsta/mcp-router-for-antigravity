# Development Setup

## Quick Start

```bash
# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Edit .env with your credentials
# Add your OPENAI_API_KEY and GLM_API_KEY

# Run in development mode
npm run dev

# Or build and run
npm run build
npm run start
```

## Development Commands

```bash
# Type checking
npm run typecheck

# Linting
npm run lint
npm run lint:fix

# Formatting
npm run format
npm run format:check

# Testing
npm run test
npm run test:coverage
npm run test:contract
npm run test:chaos
npm run test:load

# Build
npm run build

# Clean build artifacts
npm run clean

# CI pipeline (typecheck + lint + test)
npm run ci
```

## Project Structure

```
mcp-router-for-antigravity/
├── src/
│   ├── index.ts           # Entry point
│   ├── server/           # MCP server and tool handlers
│   ├── core/             # Router core, types, errors
│   ├── resilience/        # Retry, circuit breakers, budgets
│   ├── providers/         # Provider adapters (OpenAI, GLM, Ollama)
│   └── infra/            # Config, logging, metrics, HTTP
├── test/
│   ├── unit/             # Unit tests
│   ├── contract/         # Adapter contract tests
│   ├── chaos/            # Fault injection tests
│   └── load/            # Load and concurrency tests
├── specs/               # Design documents
└── README.md            # Main documentation
```

## Development Requirements

- Node.js >= 20.10.0
- npm or pnpm

## Code Quality

This project enforces strict code quality standards:

- **Strict TypeScript**: All strict mode options enabled
- **Type Safety**: No `any` allowed in critical paths
- **Runtime Validation**: All external inputs validated
- **Test Coverage**: Critical paths must have high coverage
- **Linting**: ESLint with TypeScript rules
- **Formatting**: Prettier with consistent style

## Key Architecture Principles

1. **Boundary Protection**: No provider-specific logic outside adapters
2. **Resilience First**: Dedicated resilience layer for retries, breakers
3. **Strong Typing**: Strict types at all boundaries
4. **Observability**: Logs, metrics, health signals for debugging
5. **Security**: Secrets redacted, sanitized errors only

## Environment Variables

See `.env.example` for all required configuration variables.

Critical variables:
- `ROUTER_DEFAULT_PROVIDER`: Default provider to use
- `ROUTER_DEFAULT_MODEL`: Default model to use
- `OPENAI_API_KEY`: OpenAI API key
- `GLM_API_KEY`: GLM API key

## Troubleshooting

### Type errors
Run `npm run typecheck` to see detailed type errors.

### Linting errors
Run `npm run lint:fix` to auto-fix linting issues.

### Build failures
Ensure all dependencies are installed: `npm install`

### Test failures
Run tests with detailed output to see what's failing.
