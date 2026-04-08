/**
 * Unit tests for validation logic
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  validateChatRequest,
  validateListModelsRequest,
  throwIfInvalid,
  getValidatedData,
} from '../../../src/core/validation.js';

describe('validateChatRequest', () => {
  it('should accept valid minimal chat request', () => {
    const input = {
      model: 'gpt-4.1-mini',
      messages: [{ role: 'user', content: 'Hello' }],
    };

    const result = validateChatRequest(input);
    assert.strictEqual(result.valid, true);
    assert.ok(result.data);
  });

  it('should accept valid complete chat request', () => {
    const input = {
      provider: 'openai',
      model: 'gpt-4.1-mini',
      messages: [
        { role: 'system', content: 'You are a helpful assistant' },
        { role: 'user', content: 'Hello' },
      ],
      temperature: 0.7,
      maxTokens: 1000,
    };

    const result = validateChatRequest(input);
    assert.strictEqual(result.valid, true);
    assert.ok(result.data);
    assert.strictEqual(result.data?.provider, 'openai');
    assert.strictEqual(result.data?.temperature, 0.7);
  });

  it('should reject request without messages', () => {
    const input = {
      messages: [],
    };

    const result = validateChatRequest(input);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.length > 0);
  });

  it('should reject invalid message role', () => {
    const input = {
      messages: [{ role: 'invalid' as any, content: 'Hello' }],
    };

    const result = validateChatRequest(input);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.length > 0);
  });

  it('should reject invalid temperature (too high)', () => {
    const input = {
      messages: [{ role: 'user', content: 'Hello' }],
      temperature: 3.0, // Invalid: must be <= 2.0
    };

    const result = validateChatRequest(input);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.length > 0);
  });

  it('should reject invalid temperature (negative)', () => {
    const input = {
      messages: [{ role: 'user', content: 'Hello' }],
      temperature: -0.5,
    };

    const result = validateChatRequest(input);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.length > 0);
  });
});

describe('validateListModelsRequest', () => {
  it('should accept request without provider filter', () => {
    const input = {};

    const result = validateListModelsRequest(input);
    assert.strictEqual(result.valid, true);
    assert.ok(result.data);
  });

  it('should accept request with provider filter', () => {
    const input = {
      provider: 'openai',
    };

    const result = validateListModelsRequest(input);
    assert.strictEqual(result.valid, true);
    assert.ok(result.data);
    assert.strictEqual(result.data?.provider, 'openai');
  });

  it('should reject request with unexpected fields', () => {
    const input = {
      provider: 'openai',
      unexpected: 'field',
    } as any;

    const result = validateListModelsRequest(input);
    assert.strictEqual(result.valid, false);
  });
});

describe('throwIfInvalid', () => {
  it('should not throw for valid result', () => {
    const result = {
      valid: true,
      data: 'test',
      errors: [],
    };

    assert.doesNotThrow(() => {
      throwIfInvalid(result);
    });
  });

  it('should throw for invalid result with single error', () => {
    const result = {
      valid: false,
      errors: [new Error('Test error')],
    };

    assert.throws(() => {
      throwIfInvalid(result);
    });
  });

  it('should throw for invalid result with multiple errors', () => {
    const result = {
      valid: false,
      errors: [new Error('Error 1'), new Error('Error 2')],
    };

    assert.throws(() => {
      throwIfInvalid(result);
    });
  });
});

describe('getValidatedData', () => {
  it('should return data for valid result', () => {
    const result = {
      valid: true,
      data: 'test data',
      errors: [],
    };

    const data = getValidatedData(result);
    assert.strictEqual(data, 'test data');
  });

  it('should throw for invalid result', () => {
    const result = {
      valid: false,
      errors: [new Error('Test error')],
    };

    assert.throws(() => {
      getValidatedData(result);
    });
  });
});
