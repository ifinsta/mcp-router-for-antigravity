/**
 * Provider Response Validation Tests
 *
 * Ensures that malformed "successful-looking" provider responses
 * are rejected with typed UpstreamError, and that sanitization
 * strips sensitive data while preserving actionable messages.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { validateNormalizedResponse } from '../../../src/providers/baseAdapter.js';
import { sanitizeUpstreamError, isRouterError, ErrorCode } from '../../../src/core/errors.js';
import type { NormalizedChatResponse } from '../../../src/core/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a valid NormalizedChatResponse for use as a baseline. */
function validResponse(overrides: Partial<NormalizedChatResponse> = {}): NormalizedChatResponse {
  return {
    provider: 'test-provider',
    model: 'test-model',
    outputText: 'Hello, world!',
    finishReason: 'stop',
    usage: {
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
      accuracy: 'exact',
    },
    latencyMs: 42,
    costEstimate: null,
    warnings: [],
    fallbackUsed: false,
    ...overrides,
  };
}

/** Assert that calling fn throws a RouterError with UPSTREAM_ERROR code. */
function assertUpstreamError(fn: () => void, messageSubstring?: string): void {
  assert.throws(
    fn,
    (err: unknown) => {
      if (!isRouterError(err)) return false;
      if (err.code !== ErrorCode.UPSTREAM_ERROR) return false;
      if (messageSubstring && !err.message.includes(messageSubstring)) return false;
      return true;
    },
  );
}

// ---------------------------------------------------------------------------
// validateNormalizedResponse
// ---------------------------------------------------------------------------

describe('validateNormalizedResponse', () => {
  it('should accept a fully valid response', () => {
    // Must not throw
    validateNormalizedResponse(validResponse(), 'test');
  });

  it('should accept a response with null usage (usage unavailable)', () => {
    validateNormalizedResponse(
      validResponse({ usage: null }),
      'test',
    );
  });

  // -- outputText -----------------------------------------------------------

  it('should reject empty outputText', () => {
    assertUpstreamError(
      () => validateNormalizedResponse(validResponse({ outputText: '' }), 'test'),
      'empty response content',
    );
  });

  it('should reject whitespace-only outputText', () => {
    assertUpstreamError(
      () => validateNormalizedResponse(validResponse({ outputText: '   \n\t  ' }), 'test'),
      'empty response content',
    );
  });

  // -- finishReason ---------------------------------------------------------

  it('should reject missing finishReason (empty string)', () => {
    assertUpstreamError(
      () => validateNormalizedResponse(validResponse({ finishReason: '' }), 'test'),
      'finishReason',
    );
  });

  // -- usage ----------------------------------------------------------------

  it('should reject negative inputTokens', () => {
    assertUpstreamError(
      () =>
        validateNormalizedResponse(
          validResponse({
            usage: { inputTokens: -1, outputTokens: 10, totalTokens: 9, accuracy: 'exact' },
          }),
          'test',
        ),
      'negative',
    );
  });

  it('should reject negative outputTokens', () => {
    assertUpstreamError(
      () =>
        validateNormalizedResponse(
          validResponse({
            usage: { inputTokens: 10, outputTokens: -5, totalTokens: 5, accuracy: 'exact' },
          }),
          'test',
        ),
      'negative',
    );
  });

  it('should reject negative totalTokens', () => {
    assertUpstreamError(
      () =>
        validateNormalizedResponse(
          validResponse({
            usage: { inputTokens: 10, outputTokens: 10, totalTokens: -20, accuracy: 'exact' },
          }),
          'test',
        ),
      'negative',
    );
  });

  it('should reject NaN inputTokens', () => {
    assertUpstreamError(
      () =>
        validateNormalizedResponse(
          validResponse({
            usage: { inputTokens: NaN, outputTokens: 10, totalTokens: 10, accuracy: 'exact' },
          }),
          'test',
        ),
      'NaN',
    );
  });

  it('should reject NaN outputTokens', () => {
    assertUpstreamError(
      () =>
        validateNormalizedResponse(
          validResponse({
            usage: { inputTokens: 10, outputTokens: NaN, totalTokens: 10, accuracy: 'exact' },
          }),
          'test',
        ),
      'NaN',
    );
  });

  it('should reject NaN totalTokens', () => {
    assertUpstreamError(
      () =>
        validateNormalizedResponse(
          validResponse({
            usage: { inputTokens: 10, outputTokens: 10, totalTokens: NaN, accuracy: 'exact' },
          }),
          'test',
        ),
      'NaN',
    );
  });

  it('should allow zero token counts (valid edge case)', () => {
    validateNormalizedResponse(
      validResponse({
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, accuracy: 'exact' },
      }),
      'test',
    );
  });

  it('should allow undefined token counts when accuracy is unavailable', () => {
    validateNormalizedResponse(
      validResponse({
        usage: {
          inputTokens: undefined,
          outputTokens: undefined,
          totalTokens: undefined,
          accuracy: 'unavailable',
        },
      }),
      'test',
    );
  });
});

// ---------------------------------------------------------------------------
// sanitizeUpstreamError
// ---------------------------------------------------------------------------

describe('sanitizeUpstreamError', () => {
  it('should strip URLs with embedded credentials', () => {
    const raw = 'Failed to connect to https://mykey:mysecret@api.example.com/v1';
    const result = sanitizeUpstreamError(raw);
    assert.ok(!result.includes('mykey'));
    assert.ok(!result.includes('mysecret'));
    assert.ok(result.includes('[CREDENTIALS_REDACTED]'));
  });

  it('should strip Bearer tokens', () => {
    const raw = 'Auth failed: Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature';
    const result = sanitizeUpstreamError(raw);
    assert.ok(!result.includes('eyJhbGciOiJIUzI1NiJ9'));
    assert.ok(result.includes('Bearer [REDACTED]'));
  });

  it('should strip OpenAI sk- style keys', () => {
    const raw = 'Invalid key: sk-abcdefghijklmnopqrstuvwxyz1234567890';
    const result = sanitizeUpstreamError(raw);
    assert.ok(!result.includes('abcdefghijklmnopqrstuvwxyz'));
    assert.ok(result.includes('sk-[REDACTED]'));
  });

  it('should strip generic api_key patterns', () => {
    const raw = 'api_key=SuperSecretKey12345678 is invalid';
    const result = sanitizeUpstreamError(raw);
    assert.ok(!result.includes('SuperSecretKey'));
    assert.ok(result.includes('[REDACTED]'));
  });

  it('should strip x-api-key header values', () => {
    const raw = 'x-api-key: abc123def456ghi789jkl012';
    const result = sanitizeUpstreamError(raw);
    assert.ok(!result.includes('abc123def456'), `Expected key to be redacted, got: ${result}`);
    assert.ok(result.includes('[REDACTED]'));
  });

  it('should strip password values', () => {
    const raw = 'password="hunter2" rejected';
    const result = sanitizeUpstreamError(raw);
    assert.ok(!result.includes('hunter2'));
    assert.ok(result.includes('password=[REDACTED]'));
  });

  it('should preserve the actionable error message', () => {
    const raw = 'Rate limit exceeded, retry after 30 seconds';
    const result = sanitizeUpstreamError(raw);
    assert.strictEqual(result, raw);
  });

  it('should accept an Error object and sanitize its message', () => {
    const err = new Error('Bearer sk-AAAAAAAAAAAAAAAAAAAAAAAAA leaked');
    const result = sanitizeUpstreamError(err);
    assert.ok(!result.includes('AAAAAAAAAAAAAAAAAAAAAAAAA'));
  });

  it('should strip long alphanumeric strings that look like API keys', () => {
    const raw = 'Key abcdefghijklmnopqrstuvwxyz1234567890abcd is invalid';
    const result = sanitizeUpstreamError(raw);
    assert.ok(!result.includes('abcdefghijklmnopqrstuvwxyz1234567890'));
    assert.ok(result.includes('[REDACTED'));
  });
});
