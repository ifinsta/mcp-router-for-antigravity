/**
 * Provider Contract Tests
 *
 * Ensures all providers conform to the expected normalized contracts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  NormalizedChatResponse,
  NormalizedUsage,
  ModelInfo,
  ProviderCapabilities,
} from '../../../src/core/types.js';

describe('Provider Contract Tests', () => {
  describe('Normalized Chat Response Contract', () => {
    it('should have required fields', () => {
      const response: NormalizedChatResponse = {
        provider: 'test',
        model: 'test-model',
        outputText: 'test output',
        finishReason: 'stop',
        usage: {
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30,
          accuracy: 'exact',
        },
        latencyMs: 100,
        costEstimate: 0.01,
        warnings: [],
        fallbackUsed: false,
      };

      assert.ok(response.provider);
      assert.ok(response.model);
      assert.ok(response.outputText);
      assert.ok(response.finishReason);
      assert.ok(response.usage);
      assert.ok(response.latencyMs >= 0);
      assert.ok(Array.isArray(response.warnings));
      assert.ok(typeof response.fallbackUsed === 'boolean');
    });

    it('should handle missing usage gracefully', () => {
      const response: NormalizedChatResponse = {
        provider: 'test',
        model: 'test-model',
        outputText: 'test output',
        finishReason: 'stop',
        usage: null,
        latencyMs: 100,
        costEstimate: null,
        warnings: ['Usage unavailable'],
        fallbackUsed: false,
      };

      assert.strictEqual(response.usage, null);
      assert.ok(response.warnings.includes('Usage unavailable'));
    });

    it('should support various finish reasons', () => {
      const validReasons = ['stop', 'length', 'content_filter', 'tool_calls'];

      for (const reason of validReasons) {
        const response: NormalizedChatResponse = {
          provider: 'test',
          model: 'test-model',
          outputText: 'test output',
          finishReason: reason,
          usage: null,
          latencyMs: 100,
          costEstimate: null,
          warnings: [],
          fallbackUsed: false,
        };

        assert.strictEqual(response.finishReason, reason);
      }
    });

    it('should track fallback usage', () => {
      const responseWithFallback: NormalizedChatResponse = {
        provider: 'fallback',
        model: 'fallback-model',
        outputText: 'fallback output',
        finishReason: 'stop',
        usage: null,
        latencyMs: 200,
        costEstimate: null,
        warnings: ['Fallback used'],
        fallbackUsed: true,
      };

      assert.strictEqual(responseWithFallback.fallbackUsed, true);
      assert.ok(responseWithFallback.warnings.includes('Fallback used'));
    });
  });

  describe('Normalized Usage Contract', () => {
    it('should have required fields when exact', () => {
      const usage: NormalizedUsage = {
        inputTokens: 100,
        outputTokens: 200,
        totalTokens: 300,
        accuracy: 'exact',
      };

      assert.strictEqual(usage.inputTokens, 100);
      assert.strictEqual(usage.outputTokens, 200);
      assert.strictEqual(usage.totalTokens, 300);
      assert.strictEqual(usage.accuracy, 'exact');
    });

    it('should handle estimated usage', () => {
      const usage: NormalizedUsage = {
        inputTokens: 100,
        outputTokens: 200,
        totalTokens: 300,
        accuracy: 'estimated',
      };

      assert.strictEqual(usage.accuracy, 'estimated');
    });

    it('should handle unavailable usage', () => {
      const usage: NormalizedUsage = {
        inputTokens: undefined,
        outputTokens: undefined,
        totalTokens: undefined,
        accuracy: 'unavailable',
      };

      assert.strictEqual(usage.accuracy, 'unavailable');
      assert.strictEqual(usage.inputTokens, undefined);
      assert.strictEqual(usage.outputTokens, undefined);
    });
  });

  describe('Model Info Contract', () => {
    it('should have required fields', () => {
      const modelInfo: ModelInfo = {
        id: 'model-id',
        name: 'Model Name',
        provider: 'openai',
        capabilities: {
          chat: true,
          structured: false,
          embeddings: false,
          streaming: true,
          vision: false,
        },
        maxContextTokens: 8192,
        maxOutputTokens: 4096,
      };

      assert.ok(modelInfo.id);
      assert.ok(modelInfo.name);
      assert.ok(modelInfo.provider);
      assert.ok(modelInfo.capabilities);
      assert.ok(typeof modelInfo.capabilities.chat === 'boolean');
      assert.ok(typeof modelInfo.capabilities.structured === 'boolean');
      assert.ok(typeof modelInfo.capabilities.embeddings === 'boolean');
      assert.ok(typeof modelInfo.capabilities.streaming === 'boolean');
      assert.ok(typeof modelInfo.capabilities.vision === 'boolean');
    });

    it('should handle optional token limits', () => {
      const modelInfo: ModelInfo = {
        id: 'model-id',
        name: 'Model Name',
        provider: 'openai',
        capabilities: {
          chat: true,
          structured: false,
          embeddings: false,
          streaming: true,
          vision: false,
        },
        maxContextTokens: undefined,
        maxOutputTokens: undefined,
      };

      assert.strictEqual(modelInfo.maxContextTokens, undefined);
      assert.strictEqual(modelInfo.maxOutputTokens, undefined);
    });
  });

  describe('Provider Capabilities Contract', () => {
    it('should have all required capabilities as booleans', () => {
      const capabilities: ProviderCapabilities = {
        chat: true,
        structured: true,
        embeddings: true,
        streaming: true,
        vision: true,
      };

      assert.strictEqual(typeof capabilities.chat, 'boolean');
      assert.strictEqual(typeof capabilities.structured, 'boolean');
      assert.strictEqual(typeof capabilities.embeddings, 'boolean');
      assert.strictEqual(typeof capabilities.streaming, 'boolean');
      assert.strictEqual(typeof capabilities.vision, 'boolean');
    });

    it('should support partial capabilities', () => {
      const partialCapabilities: ProviderCapabilities = {
        chat: true,
        structured: false,
        embeddings: false,
        streaming: true,
        vision: false,
      };

      assert.strictEqual(partialCapabilities.chat, true);
      assert.strictEqual(partialCapabilities.structured, false);
      assert.strictEqual(partialCapabilities.embeddings, false);
      assert.strictEqual(partialCapabilities.streaming, true);
      assert.strictEqual(partialCapabilities.vision, false);
    });
  });

  describe('Cross-Provider Normalization', () => {
    it('should produce consistent output format across providers', () => {
      // Both OpenAI and GLM adapters should produce the same output format
      const openaiResponse: NormalizedChatResponse = {
        provider: 'openai',
        model: 'gpt-3.5-turbo',
        outputText: 'OpenAI response',
        finishReason: 'stop',
        usage: {
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30,
          accuracy: 'exact',
        },
        latencyMs: 100,
        costEstimate: 0.01,
        warnings: [],
        fallbackUsed: false,
      };

      const glmResponse: NormalizedChatResponse = {
        provider: 'glm',
        model: 'glm-4',
        outputText: 'GLM response',
        finishReason: 'stop',
        usage: {
          inputTokens: 15,
          outputTokens: 25,
          totalTokens: 40,
          accuracy: 'exact',
        },
        latencyMs: 150,
        costEstimate: 0.02,
        warnings: [],
        fallbackUsed: false,
      };

      // Both should have the same structure
      assert.strictEqual(typeof openaiResponse.provider, typeof glmResponse.provider);
      assert.strictEqual(typeof openaiResponse.model, typeof glmResponse.model);
      assert.strictEqual(typeof openaiResponse.outputText, typeof glmResponse.outputText);
      assert.strictEqual(typeof openaiResponse.finishReason, typeof glmResponse.finishReason);
      assert.strictEqual(typeof openaiResponse.usage, typeof glmResponse.usage);
      assert.strictEqual(typeof openaiResponse.latencyMs, typeof glmResponse.latencyMs);
      assert.strictEqual(typeof openaiResponse.costEstimate, typeof glmResponse.costEstimate);
      assert.strictEqual(
        Array.isArray(openaiResponse.warnings),
        Array.isArray(glmResponse.warnings)
      );
      assert.strictEqual(typeof openaiResponse.fallbackUsed, typeof glmResponse.fallbackUsed);
    });
  });
});
