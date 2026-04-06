# Load Tests

Load tests verify system behavior under concurrent load and resource pressure.

These tests ensure:
- System handles concurrent requests correctly
- Bulkheads isolate provider failures
- Overload conditions are handled gracefully
- Performance degrades predictably under pressure

## Running Load Tests

```bash
npm run test:load
```

## Test Scenarios

### Concurrency Tests
- Multiple simultaneous requests to same provider
- Mixed provider concurrency
- Concurrency limit enforcement

### Overload Tests
- Request volume exceeds capacity
- Queue saturation behavior
- Graceful overload rejection

### Isolation Tests
- One failing provider doesn't affect others
- Provider-specific concurrency limits work
- Global concurrency limits are enforced

## Test Infrastructure

```
test/load/
  ├── concurrency/
  ├── overload/
  └── isolation/
```

## Metrics Collected

During load tests, we measure:
- Request throughput (requests/second)
- Average latency
- P50/P90/P95/P99 latency
- Error rate
- Retry rate
- Fallback rate
- Active concurrency

## Running Load Tests

Load tests should be run in a controlled environment:
```bash
# Run with different concurrency levels
npm run test:load -- --concurrency 10
npm run test:load -- --concurrency 50
npm run test:load -- --concurrency 100

# Run for specific duration
npm run test:load -- --duration 60
```
