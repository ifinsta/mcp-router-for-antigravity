# Chaos Tests

Chaos tests verify system behavior under failure conditions and adversarial inputs.

These tests ensure:
- System recovers gracefully from transient failures
- Circuit breakers prevent hammering failing providers
- Request budget enforcement prevents wasteful retries
- Fallback logic works as expected
- Degraded execution is properly surfaced

## Running Chaos Tests

```bash
npm run test:chaos
```

## Test Scenarios

### Network Failures
- Connection refused
- DNS failures
- Timeouts
- Connection drops

### Provider Failures
- Rate limiting
- Invalid responses
- Malformed JSON
- Empty responses
- Partial responses

### Auth Failures
- Invalid credentials
- Expired credentials
- Missing credentials

### Resource Exhaustion
- Concurrency limits exceeded
- Memory pressure
- Request budget exhaustion

## Test Infrastructure

```
test/chaos/
  ├── network/
  ├── provider/
  ├── auth/
  └── resources/
```

## Fault Injection

Chaos tests use fault injection to simulate real-world failure conditions:

```typescript
// Example: Inject timeout
async function withTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("Timeout")), timeoutMs),
    ),
  ]);
}
```
