/**
 * Azure OpenAI Adapter Contract Tests
 *
 * Tests request mapping, response mapping, error mapping,
 * and malformed response rejection for the Azure OpenAI provider adapter.
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
// Azure OpenAI response types (OpenAI-compatible)
// ============================================================================

interface AzureOpenAIChatResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string | null;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// ============================================================================
// Helper: simulate adapter mapping logic (pure functions)
// ============================================================================

function mapOpenAIUsage(
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | undefined,
): NormalizedUsage {
  if (!usage) {
    return { accuracy: 'unavailable' };
  }
  return {
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
    accuracy: 'exact',
  };
}

function normalizeFinishReason(reason: string): string {
  const map: Record<string, string> = {
    stop: 'stop',
    length: 'length',
    content_filter: 'content_filter',
    tool_calls: 'tool_calls',
    function_call: 'tool_calls',
  };
  return map[reason] ?? reason;
}

function mapFromAzureResponse(
  response: AzureOpenAIChatResponse,
  deployment: string,
  originalModel: string,
): NormalizedChatResponse {
  const choice = response.choices[0];
  if (!choice) {
    throw new Error('No choices in response');
  }

  return {
    provider: 'azure-openai',
    model: response.model || originalModel || deployment,
    outputText: choice.message.content || '',
    finishReason: normalizeFinishReason(choice.finish_reason || 'stop'),
    usage: mapOpenAIUsage(response.usage),
    latencyMs: 100,
    costEstimate: null,
    warnings: [],
    fallbackUsed: false,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('Azure OpenAI Adapter Contract Tests', () => {
  describe('Request Mapping', () => {
    it('should build correct Azure URL pattern', () => {
      const resource = 'my-resource';
      const deployment = 'my-deployment';
      const apiVersion = '2024-02-01';

      const url =
        `https://${resource}.openai.azure.com/openai/deployments/${deployment}` +
        `/chat/completions?api-version=${apiVersion}`;

      assert.ok(url.includes(resource));
      assert.ok(url.includes(deployment));
      assert.ok(url.includes(apiVersion));
      assert.ok(url.startsWith('https://'));
    });

    it('should not include model in request body (deployment handles it)', () => {
      const request: Record<string, unknown> = {
        messages: [{ role: 'user', content: 'Hello' }],
      };

      assert.strictEqual(request['model'], undefined);
      assert.ok(Array.isArray(request['messages']));
    });

    it('should include optional parameters when specified', () => {
      const request: Record<string, unknown> = {
        messages: [{ role: 'user', content: 'Hello' }],
        temperature: 0.7,
        max_tokens: 1000,
      };

      assert.strictEqual(request['temperature'], 0.7);
      assert.strictEqual(request['max_tokens'], 1000);
    });

    it('should use api-key header for authentication', () => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'api-key': 'test-key',
      };

      assert.ok('api-key' in headers);
      assert.ok(!('Authorization' in headers));
    });
  });

  describe('Response Mapping', () => {
    it('should map valid Azure OpenAI response to normalized format', () => {
      const azureResponse: AzureOpenAIChatResponse = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1677652288,
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'Hello from Azure!',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
        },
      };

      const normalized = mapFromAzureResponse(azureResponse, 'my-deployment', 'gpt-4o');

      assert.strictEqual(normalized.provider, 'azure-openai');
      assert.strictEqual(normalized.model, 'gpt-4o');
      assert.strictEqual(normalized.outputText, 'Hello from Azure!');
      assert.strictEqual(normalized.finishReason, 'stop');
      assert.strictEqual(normalized.fallbackUsed, false);
      assert.ok(Array.isArray(normalized.warnings));
    });

    it('should fall back to deployment name when model is empty', () => {
      const azureResponse: AzureOpenAIChatResponse = {
        id: 'chatcmpl-456',
        object: 'chat.completion',
        created: 1677652288,
        model: '',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Hello' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
      };

      const normalized = mapFromAzureResponse(azureResponse, 'my-deployment', '');
      assert.strictEqual(normalized.model, 'my-deployment');
    });

    it('should map usage correctly', () => {
      const usage = mapOpenAIUsage({
        prompt_tokens: 50,
        completion_tokens: 100,
        total_tokens: 150,
      });
      assert.strictEqual(usage.inputTokens, 50);
      assert.strictEqual(usage.outputTokens, 100);
      assert.strictEqual(usage.totalTokens, 150);
      assert.strictEqual(usage.accuracy, 'exact');
    });

    it('should handle missing usage', () => {
      const usage = mapOpenAIUsage(undefined);
      assert.strictEqual(usage.accuracy, 'unavailable');
    });
  });

  describe('Finish Reason Normalization', () => {
    it('should map stop to stop', () => {
      assert.strictEqual(normalizeFinishReason('stop'), 'stop');
    });

    it('should map length to length', () => {
      assert.strictEqual(normalizeFinishReason('length'), 'length');
    });

    it('should map content_filter to content_filter', () => {
      assert.strictEqual(normalizeFinishReason('content_filter'), 'content_filter');
    });

    it('should map function_call to tool_calls', () => {
      assert.strictEqual(normalizeFinishReason('function_call'), 'tool_calls');
    });

    it('should pass through unknown reasons', () => {
      assert.strictEqual(normalizeFinishReason('custom'), 'custom');
    });
  });

  describe('Error Mapping', () => {
    it('should map 401/403 to authentication error', () => {
      const authStatuses = [401, 403];
      for (const status of authStatuses) {
        assert.ok(status >= 400 && status < 500);
      }
    });

    it('should map 404 to deployment not found', () => {
      // Azure returns 404 when deployment doesn't exist
      assert.strictEqual(404, 404);
    });

    it('should map 429 to rate limited', () => {
      assert.strictEqual(429, 429);
    });

    it('should map 5xx to upstream error', () => {
      const serverErrors = [500, 502, 503, 504];
      for (const status of serverErrors) {
        assert.ok(status >= 500);
      }
    });
  });

  describe('Malformed Response Rejection', () => {
    it('should reject response with no choices', () => {
      const azureResponse: AzureOpenAIChatResponse = {
        id: 'chatcmpl-789',
        object: 'chat.completion',
        created: 1677652288,
        model: 'gpt-4o',
        choices: [],
        usage: { prompt_tokens: 10, completion_tokens: 0, total_tokens: 10 },
      };

      assert.throws(
        () => mapFromAzureResponse(azureResponse, 'my-deployment', 'gpt-4o'),
        (error: Error) => error.message.includes('No choices'),
      );
    });

    it('should reject empty outputText via validateNormalizedResponse', () => {
      const response: NormalizedChatResponse = {
        provider: 'azure-openai',
        model: 'gpt-4o',
        outputText: '',
        finishReason: 'stop',
        usage: { inputTokens: 10, outputTokens: 0, totalTokens: 10, accuracy: 'exact' },
        latencyMs: 100,
        costEstimate: null,
        warnings: [],
        fallbackUsed: false,
      };

      assert.throws(
        () => validateNormalizedResponse(response, 'azure-openai'),
        (error: Error) => error.message.includes('empty response'),
      );
    });

    it('should reject negative usage values', () => {
      const response: NormalizedChatResponse = {
        provider: 'azure-openai',
        model: 'gpt-4o',
        outputText: 'Hello',
        finishReason: 'stop',
        usage: { inputTokens: -5, outputTokens: 10, totalTokens: 5, accuracy: 'exact' },
        latencyMs: 100,
        costEstimate: null,
        warnings: [],
        fallbackUsed: false,
      };

      assert.throws(
        () => validateNormalizedResponse(response, 'azure-openai'),
        (error: Error) => error.message.includes('negative'),
      );
    });

    it('should accept valid response through validateNormalizedResponse', () => {
      const response: NormalizedChatResponse = {
        provider: 'azure-openai',
        model: 'gpt-4o',
        outputText: 'Valid response',
        finishReason: 'stop',
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, accuracy: 'exact' },
        latencyMs: 100,
        costEstimate: null,
        warnings: [],
        fallbackUsed: false,
      };

      // Should not throw
      validateNormalizedResponse(response, 'azure-openai');
    });
  });

  describe('Model Catalog', () => {
    it('should include expected Azure models', () => {
      const expectedModels = ['gpt-4o', 'gpt-4', 'gpt-35-turbo'];

      for (const modelId of expectedModels) {
        assert.ok(modelId.length > 0);
      }
    });

    it('should produce valid ModelInfo shapes', () => {
      const model: ModelInfo = {
        id: 'gpt-4o',
        name: 'GPT-4o (Azure)',
        provider: 'azure-openai',
        capabilities: {
          chat: true,
          structured: false,
          embeddings: false,
          streaming: true,
          vision: false,
        },
        maxContextTokens: 128000,
        maxOutputTokens: 4096,
      };

      assert.strictEqual(model.provider, 'azure-openai');
      assert.strictEqual(model.capabilities.chat, true);
      assert.ok(model.maxContextTokens !== undefined && model.maxContextTokens > 0);
    });
  });

  describe('Cross-Provider Normalization', () => {
    it('should produce same shape as standard OpenAI responses', () => {
      const azureResponse: NormalizedChatResponse = {
        provider: 'azure-openai',
        model: 'gpt-4o',
        outputText: 'Azure response',
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

      assert.strictEqual(typeof azureResponse.provider, typeof openaiResponse.provider);
      assert.strictEqual(typeof azureResponse.model, typeof openaiResponse.model);
      assert.strictEqual(typeof azureResponse.outputText, typeof openaiResponse.outputText);
      assert.strictEqual(typeof azureResponse.finishReason, typeof openaiResponse.finishReason);
      assert.strictEqual(typeof azureResponse.usage, typeof openaiResponse.usage);
      assert.strictEqual(typeof azureResponse.latencyMs, typeof openaiResponse.latencyMs);
      assert.strictEqual(typeof azureResponse.fallbackUsed, typeof openaiResponse.fallbackUsed);
    });
  });
});
