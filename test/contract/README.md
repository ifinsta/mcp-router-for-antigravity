# Contract Tests

Contract tests verify that provider adapters conform to the expected normalized contracts.

These tests ensure:
- Provider requests are correctly mapped
- Provider responses are correctly normalized
- Error handling follows the expected taxonomy
- Usage information is accurately extracted

## Running Contract Tests

```bash
npm run test:contract
```

## Test Structure

```
test/contract/
  ├── providers/
  │   ├── openai.test.ts
  │   ├── glm.test.ts
  │   └── ollama.test.ts
  └── fixtures/
      ├── openai-responses/
      └── glm-responses/
```

## Contract Requirements

Each provider adapter must:
1. Accept `NormalizedChatRequest` input
2. Return `NormalizedChatResponse` output
3. Map all required fields correctly
4. Handle provider-specific errors and convert to `RouterError`
5. Validate upstream responses before normalization
