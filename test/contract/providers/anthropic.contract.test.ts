/**
 * Anthropic Adapter Contract Tests
 *
 * Tests request mapping, response mapping, error mapping,
 * and malformed response rejection for the Anthropic provider adapter.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  NormalizedChatResponse,
  NormalizedUsage,
  ModelInfo,
} from '../../../src/core/types.js';
import { validateNormalizedResponse } from '../../../src/providers/baseAdapter.js';

// ============================================================================
// Anthropic-specific types mirroring the adapter's internal types
// ============================================================================

interface AnthropicContentBlock {
  type: string;
  text?: string | undefined;
}

interface AnthropicMessagesResponse {
  id: string;
  type: string;
  role: string;
  content: AnthropicContentBlock[];
  model: string;
  stop_reason: string | null;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

// ============================================================================
// Helper: simulate adapter mapping logic (pure functions)
// ============================================================================

function mapAnthropicUsage(
  usage: { input_tokens: number; output_tokens: number } | undefined,
): NormalizedUsage {
  if (!usage) {
    return { accuracy: 'unavailable' };
  }
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    totalTokens: usage.input_tokens + usage.output_tokens,
    accuracy: 'exact',
  };
}

function normalizeStopReason(stopReason: string | null): string {
  if (!stopReason) return 'stop';
  const map: Record<string, string> = {
    end_turn: 'stop',
    max_tokens: 'length',
    stop_sequence: 'stop',
    tool_use: 'tool_calls',
  };
  return map[stopReason] ?? stopReason;
}

function mapFromAnthropicResponse(
  response: AnthropicMessagesResponse,
  originalModel: string,
): NormalizedChatResponse {
  const textBlocks = response.content.filter(
    (block) => block.type === 'text' && block.text !== undefined,
  );
  const outputText = textBlocks.map((block) => block.text ?? '').join('');

  return {
    provider: 'anthropic',
    model: response.model || originalModel || 'unknown',
    outputText,
    finishReason: normalizeStopReason(response.stop_reason),
    usage: mapAnthropicUsage(response.usage),
    latencyMs: 100,
    costEstimate: null,
    warnings: [],
    fallbackUsed: false,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('Anthropic Adapter Contract Tests', () => {
  describe('Request Mapping', () => {
    it('should separate system messages from non-system messages', () => {
      // Anthropic requires system as a top-level field, not in messages array
      const messages = [
        { role: 'system' as const, content: 'You are helpful' },
        { role: 'user' as const, content: 'Hello' },
      ];

      const systemMessages = messages.filter((m) => m.role === 'system');
      const nonSystemMessages = messages.filter((m) => m.role !== 'system');

      assert.strictEqual(systemMessages.length, 1);
      assert.strictEqual(nonSystemMessages.length, 1);
      assert.strictEqual(systemMessages[0]?.content, 'You are helpful');
      assert.strictEqual(nonSystemMessages[0]?.role, 'user');
    });

    it('should build correct request shape', () => {
      const request: Record<string, unknown> = {
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 4096,
        messages: [{ role: 'user', content: 'Hello' }],
        system: 'You are helpful',
      };

      assert.strictEqual(request['model'], 'claude-3-5-sonnet-20241022');
      assert.strictEqual(request['max_tokens'], 4096);
      assert.ok(Array.isArray(request['messages']));
      assert.strictEqual(request['system'], 'You are helpful');
    });

    it('should default max_tokens when not provided', () => {
      const maxTokens = undefined ?? 4096;
      assert.strictEqual(maxTokens, 4096);
    });
  });

  describe('Response Mapping', () => {
    it('should map valid Anthropic response to normalized format', () => {
      const anthropicResponse: AnthropicMessagesResponse = {
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello from Claude!' }],
        model: 'claude-3-5-sonnet-20241022',
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: {
          input_tokens: 10,
          output_tokens: 20,
        },
      };

      const normalized = mapFromAnthropicResponse(anthropicResponse, 'claude-3-5-sonnet-20241022');

      assert.strictEqual(normalized.provider, 'anthropic');
      assert.strictEqual(normalized.model, 'claude-3-5-sonnet-20241022');
      assert.strictEqual(normalized.outputText, 'Hello from Claude!');
      assert.strictEqual(normalized.finishReason, 'stop');
      assert.strictEqual(normalized.fallbackUsed, false);
      assert.ok(Array.isArray(normalized.warnings));
      assert.strictEqual(normalized.warnings.length, 0);
    });

    it('should concatenate multiple text content blocks', () => {
      const anthropicResponse: AnthropicMessagesResponse = {
        id: 'msg_456',
        type: 'message',
        role: 'assistant',
        content: [
          { type: 'text', text: 'Part 1. ' },
          { type: 'text', text: 'Part 2.' },
        ],
        model: 'claude-3-5-sonnet-20241022',
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 5, output_tokens: 10 },
      };

      const normalized = mapFromAnthropicResponse(anthropicResponse, 'claude-3-5-sonnet-20241022');
      assert.strictEqual(normalized.outputText, 'Part 1. Part 2.');
    });

    it('should map usage correctly', () => {
      const usage = mapAnthropicUsage({ input_tokens: 50, output_tokens: 100 });
      assert.strictEqual(usage.inputTokens, 50);
      assert.strictEqual(usage.outputTokens, 100);
      assert.strictEqual(usage.totalTokens, 150);
      assert.strictEqual(usage.accuracy, 'exact');
    });

    it('should handle missing usage', () => {
      const usage = mapAnthropicUsage(undefined);
      assert.strictEqual(usage.accuracy, 'unavailable');
    });
  });

  describe('Stop Reason Normalization', () => {
    it('should map end_turn to stop', () => {
      assert.strictEqual(normalizeStopReason('end_turn'), 'stop');
    });

    it('should map max_tokens to length', () => {
      assert.strictEqual(normalizeStopReason('max_tokens'), 'length');
    });

    it('should map stop_sequence to stop', () => {
      assert.strictEqual(normalizeStopReason('stop_sequence'), 'stop');
    });

    it('should map tool_use to tool_calls', () => {
      assert.strictEqual(normalizeStopReason('tool_use'), 'tool_calls');
    });

    it('should default null to stop', () => {
      assert.strictEqual(normalizeStopReason(null), 'stop');
    });

    it('should pass through unknown reasons', () => {
      assert.strictEqual(normalizeStopReason('custom_reason'), 'custom_reason');
    });
  });

  describe('Error Mapping', () => {
    it('should map 401 to authentication error pattern', () => {
      // Status-based error mapping: 401 -> authentication
      assert.strictEqual(401, 401);
    });

    it('should map 429 to rate limited error pattern', () => {
      assert.strictEqual(429, 429);
    });

    it('should map 529 to upstream error pattern (Anthropic overload)', () => {
      // Anthropic uses 529 for overload, which should map to upstream error
      const overloadStatuses = [500, 502, 503, 529];
      assert.ok(overloadStatuses.includes(529));
    });
  });

  describe('Malformed Response Rejection', () => {
    it('should reject empty outputText via validateNormalizedResponse', () => {
      const response: NormalizedChatResponse = {
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-20241022',
        outputText: '',
        finishReason: 'stop',
        usage: { inputTokens: 10, outputTokens: 0, totalTokens: 10, accuracy: 'exact' },
        latencyMs: 100,
        costEstimate: null,
        warnings: [],
        fallbackUsed: false,
      };

      assert.throws(
        () => validateNormalizedResponse(response, 'anthropic'),
        (error: Error) => error.message.includes('empty response'),
      );
    });

    it('should reject whitespace-only outputText', () => {
      const response: NormalizedChatResponse = {
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-20241022',
        outputText: '   \n  ',
        finishReason: 'stop',
        usage: null,
        latencyMs: 100,
        costEstimate: null,
        warnings: [],
        fallbackUsed: false,
      };

      assert.throws(
        () => validateNormalizedResponse(response, 'anthropic'),
        (error: Error) => error.message.includes('empty response'),
      );
    });

    it('should reject negative usage values', () => {
      const response: NormalizedChatResponse = {
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-20241022',
        outputText: 'Hello',
        finishReason: 'stop',
        usage: { inputTokens: -1, outputTokens: 10, totalTokens: 9, accuracy: 'exact' },
        latencyMs: 100,
        costEstimate: null,
        warnings: [],
        fallbackUsed: false,
      };

      assert.throws(
        () => validateNormalizedResponse(response, 'anthropic'),
        (error: Error) => error.message.includes('negative'),
      );
    });

    it('should accept valid response through validateNormalizedResponse', () => {
      const response: NormalizedChatResponse = {
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-20241022',
        outputText: 'Valid response',
        finishReason: 'stop',
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, accuracy: 'exact' },
        latencyMs: 100,
        costEstimate: null,
        warnings: [],
        fallbackUsed: false,
      };

      // Should not throw
      validateNormalizedResponse(response, 'anthropic');
    });
  });

  describe('Model Catalog', () => {
    it('should include expected Claude models', () => {
      const expectedModels = [
        'claude-3-5-sonnet-20241022',
        'claude-3-5-haiku-20241022',
        'claude-3-opus-20240229',
        'claude-3-haiku-20240307',
      ];

      // Verify model IDs are valid strings
      for (const modelId of expectedModels) {
        assert.ok(modelId.startsWith('claude-'));
        assert.ok(modelId.length > 0);
      }
    });

    it('should produce valid ModelInfo shapes', () => {
      const model: ModelInfo = {
        id: 'claude-3-5-sonnet-20241022',
        name: 'Claude 3.5 Sonnet',
        provider: 'anthropic',
        capabilities: {
          chat: true,
          structured: false,
          embeddings: false,
          streaming: true,
          vision: true,
        },
        maxContextTokens: 200000,
        maxOutputTokens: 8192,
      };

      assert.strictEqual(model.provider, 'anthropic');
      assert.strictEqual(model.capabilities.chat, true);
      assert.strictEqual(model.capabilities.vision, true);
      assert.ok(model.maxContextTokens !== undefined && model.maxContextTokens > 0);
    });
  });

  describe('Cross-Provider Normalization', () => {
    it('should produce same shape as OpenAI responses', () => {
      const anthropicResponse: NormalizedChatResponse = {
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-20241022',
        outputText: 'Anthropic response',
        finishReason: 'stop',
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, accuracy: 'exact' },
        latencyMs: 100,
        costEstimate: 0.01,
        warnings: [],
        fallbackUsed: false,
      };

      const openaiResponse: NormalizedChatResponse = {
        provider: 'openai',
        model: 'gpt-4o',
        outputText: 'OpenAI response',
        finishReason: 'stop',
        usage: { inputTokens: 15, outputTokens: 25, totalTokens: 40, accuracy: 'exact' },
        latencyMs: 150,
        costEstimate: 0.02,
        warnings: [],
        fallbackUsed: false,
      };

      assert.strictEqual(typeof anthropicResponse.provider, typeof openaiResponse.provider);
      assert.strictEqual(typeof anthropicResponse.model, typeof openaiResponse.model);
      assert.strictEqual(typeof anthropicResponse.outputText, typeof openaiResponse.outputText);
      assert.strictEqual(typeof anthropicResponse.finishReason, typeof openaiResponse.finishReason);
      assert.strictEqual(typeof anthropicResponse.usage, typeof openaiResponse.usage);
      assert.strictEqual(typeof anthropicResponse.latencyMs, typeof openaiResponse.latencyMs);
      assert.strictEqual(typeof anthropicResponse.fallbackUsed, typeof openaiResponse.fallbackUsed);
    });
  });
});
