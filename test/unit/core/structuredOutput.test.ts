/**
 * Tests for structured JSON output with schema validation and auto-retry
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractJsonFromText,
  validateJsonOutput,
  buildCorrectionPrompt,
  StructuredOutputProcessor,
} from '../../../src/core/structuredOutput.js';
import type { NormalizedChatRequest, NormalizedChatResponse } from '../../../src/core/types.js';

// ============================================================================
// extractJsonFromText
// ============================================================================

describe('extractJsonFromText', () => {
  it('extracts raw JSON object', () => {
    const input = '{"name": "Alice", "age": 30}';
    const result = extractJsonFromText(input);
    assert.equal(result, input);
  });

  it('extracts JSON in ```json fence', () => {
    const input = 'Here is the result:\n```json\n{"key": "value"}\n```\nDone.';
    const result = extractJsonFromText(input);
    assert.equal(result, '{"key": "value"}');
  });

  it('extracts JSON in plain ``` fence', () => {
    const input = 'Result:\n```\n{"foo": 42}\n```';
    const result = extractJsonFromText(input);
    assert.equal(result, '{"foo": 42}');
  });

  it('extracts JSON embedded in text', () => {
    const input = 'The answer is {"result": true} as expected.';
    const result = extractJsonFromText(input);
    assert.equal(result, '{"result": true}');
  });

  it('returns null for non-JSON text', () => {
    const input = 'This is just plain text with no JSON at all.';
    const result = extractJsonFromText(input);
    assert.equal(result, null);
  });

  it('handles JSON arrays', () => {
    const input = '[1, 2, 3]';
    const result = extractJsonFromText(input);
    assert.equal(result, '[1, 2, 3]');
  });

  it('handles JSON arrays embedded in text', () => {
    const input = 'Here: [{"a": 1}, {"a": 2}] done';
    const result = extractJsonFromText(input);
    assert.equal(result, '[{"a": 1}, {"a": 2}]');
  });
});

// ============================================================================
// validateJsonOutput
// ============================================================================

describe('validateJsonOutput', () => {
  it('valid JSON passes without schema', () => {
    const result = validateJsonOutput('{"name": "test"}');
    assert.equal(result.valid, true);
    assert.deepEqual(result.parsed, { name: 'test' });
    assert.equal(result.error, null);
  });

  it('invalid JSON fails with error', () => {
    const result = validateJsonOutput('not json at all');
    assert.equal(result.valid, false);
    assert.equal(result.parsed, null);
    assert.ok(result.error !== null);
    assert.ok(result.error.includes('No valid JSON'));
  });

  it('schema validation catches missing required field', () => {
    const schema = {
      type: 'object',
      required: ['name', 'age'],
      properties: {
        name: { type: 'string' },
        age: { type: 'number' },
      },
    };
    const result = validateJsonOutput('{"name": "Alice"}', schema);
    assert.equal(result.valid, false);
    assert.ok(result.error !== null);
    assert.ok(result.error.includes('Missing required field'));
    assert.ok(result.error.includes('age'));
  });

  it('schema validation catches wrong type', () => {
    const schema = {
      type: 'object',
      properties: {
        age: { type: 'number' },
      },
    };
    const result = validateJsonOutput('{"age": "not a number"}', schema);
    assert.equal(result.valid, false);
    assert.ok(result.error !== null);
    assert.ok(result.error.includes('Expected type'));
  });

  it('schema validation passes for correct data', () => {
    const schema = {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string' },
      },
    };
    const result = validateJsonOutput('{"name": "Alice"}', schema);
    assert.equal(result.valid, true);
    assert.equal(result.error, null);
  });
});

// ============================================================================
// buildCorrectionPrompt
// ============================================================================

describe('buildCorrectionPrompt', () => {
  const originalMessages: NormalizedChatRequest['messages'] = [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Give me JSON.' },
  ];

  it('includes error message', () => {
    const result = buildCorrectionPrompt(originalMessages, 'Invalid JSON');
    const last = result[result.length - 1];
    assert.ok(last !== undefined);
    assert.ok(last.content.includes('Invalid JSON'));
    assert.ok(last.content.includes('not valid JSON'));
  });

  it('includes schema when provided', () => {
    const schema = { type: 'object', required: ['name'] };
    const result = buildCorrectionPrompt(originalMessages, 'parse error', schema);
    const last = result[result.length - 1];
    assert.ok(last !== undefined);
    assert.ok(last.content.includes('schema'));
    assert.ok(last.content.includes('"required"'));
  });

  it('preserves original messages', () => {
    const result = buildCorrectionPrompt(originalMessages, 'error');
    assert.equal(result.length, originalMessages.length + 1);
    assert.equal(result[0]?.role, 'system');
    assert.equal(result[0]?.content, 'You are a helpful assistant.');
    assert.equal(result[1]?.role, 'user');
    assert.equal(result[1]?.content, 'Give me JSON.');
  });
});

// ============================================================================
// StructuredOutputProcessor
// ============================================================================

describe('StructuredOutputProcessor', () => {
  function makeResponse(outputText: string): NormalizedChatResponse {
    return {
      provider: 'test-provider',
      model: 'test-model',
      outputText,
      finishReason: 'stop',
      usage: null,
      latencyMs: 100,
      costEstimate: null,
      warnings: [],
      fallbackUsed: false,
    };
  }

  it('returns parsed JSON on first attempt', async () => {
    const mockExecute = async (_req: NormalizedChatRequest): Promise<NormalizedChatResponse> => {
      return makeResponse('{"result": 42}');
    };

    const processor = new StructuredOutputProcessor(mockExecute);
    const result = await processor.executeWithValidation({
      messages: [{ role: 'user', content: 'Give JSON' }],
      responseFormat: 'json' as const,
    });

    assert.equal(result.validationAttempts, 1);
    assert.deepEqual(result.structuredOutput, { result: 42 });
  });

  it('retries on invalid JSON and succeeds', async () => {
    let callCount = 0;
    const mockExecute = async (_req: NormalizedChatRequest): Promise<NormalizedChatResponse> => {
      callCount++;
      if (callCount === 1) {
        return makeResponse('Sorry, here is your answer: not json');
      }
      return makeResponse('{"fixed": true}');
    };

    const processor = new StructuredOutputProcessor(mockExecute);
    const result = await processor.executeWithValidation({
      messages: [{ role: 'user', content: 'Give JSON' }],
      responseFormat: 'json' as const,
    });

    assert.equal(callCount, 2);
    assert.equal(result.validationAttempts, 2);
    assert.deepEqual(result.structuredOutput, { fixed: true });
  });

  it('fails after max attempts with clear error', async () => {
    const mockExecute = async (_req: NormalizedChatRequest): Promise<NormalizedChatResponse> => {
      return makeResponse('I cannot produce JSON');
    };

    const processor = new StructuredOutputProcessor(mockExecute);
    const result = await processor.executeWithValidation(
      {
        messages: [{ role: 'user', content: 'Give JSON' }],
        responseFormat: 'json' as const,
      },
      3,
    );

    assert.equal(result.validationAttempts, 3);
    assert.equal(result.structuredOutput, null);
    assert.ok(result.warnings.some((w) => w.includes('validation failed after 3 attempts')));
  });
});
