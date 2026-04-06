/**
 * Unit tests for core types
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  ErrorCode,
  isRetryableError,
  AttemptPhase,
  AttemptStatus,
  CircuitBreakerState,
} from '../../../src/core/types.js';

describe('ErrorCode', () => {
  it('should define all expected error codes', () => {
    assert.ok(ErrorCode.VALIDATION_ERROR);
    assert.ok(ErrorCode.AUTHENTICATION_ERROR);
    assert.ok(ErrorCode.TIMEOUT_ERROR);
    assert.ok(ErrorCode.NETWORK_ERROR);
    assert.ok(ErrorCode.UPSTREAM_ERROR);
    assert.ok(ErrorCode.PROVIDER_NOT_FOUND);
  });
});

describe('isRetryableError', () => {
  it('should classify timeout errors as retryable', () => {
    assert.strictEqual(isRetryableError(ErrorCode.TIMEOUT_ERROR), true);
  });

  it('should classify network errors as retryable', () => {
    assert.strictEqual(isRetryableError(ErrorCode.NETWORK_ERROR), true);
  });

  it('should classify upstream errors as retryable', () => {
    assert.strictEqual(isRetryableError(ErrorCode.UPSTREAM_ERROR), true);
  });

  it('should classify validation errors as not retryable', () => {
    assert.strictEqual(isRetryableError(ErrorCode.VALIDATION_ERROR), false);
  });

  it('should classify authentication errors as not retryable', () => {
    assert.strictEqual(isRetryableError(ErrorCode.AUTHENTICATION_ERROR), false);
  });
});

describe('AttemptPhase', () => {
  it('should define primary phase', () => {
    assert.strictEqual(AttemptPhase.PRIMARY, 'primary');
  });

  it('should define retry phase', () => {
    assert.strictEqual(AttemptPhase.RETRY, 'retry');
  });

  it('should define fallback phase', () => {
    assert.strictEqual(AttemptPhase.FALLBACK, 'fallback');
  });
});

describe('AttemptStatus', () => {
  it('should define success status', () => {
    assert.strictEqual(AttemptStatus.SUCCESS, 'success');
  });

  it('should define failed status', () => {
    assert.strictEqual(AttemptStatus.FAILED, 'failed');
  });

  it('should define skipped status', () => {
    assert.strictEqual(AttemptStatus.SKIPPED, 'skipped');
  });

  it('should define blocked status', () => {
    assert.strictEqual(AttemptStatus.BLOCKED, 'blocked');
  });
});

describe('CircuitBreakerState', () => {
  it('should define closed state', () => {
    assert.strictEqual(CircuitBreakerState.CLOSED, 'closed');
  });

  it('should define open state', () => {
    assert.strictEqual(CircuitBreakerState.OPEN, 'open');
  });

  it('should define half_open state', () => {
    assert.strictEqual(CircuitBreakerState.HALF_OPEN, 'half_open');
  });
});
