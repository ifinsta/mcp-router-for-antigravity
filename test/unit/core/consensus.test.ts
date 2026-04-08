/**
 * Unit tests for ConsensusEngine
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { ConsensusEngine, ChatExecutor } from '../../../src/core/consensus.js';
import type {
  NormalizedChatRequest,
  NormalizedChatResponse,
  ConsensusRequest,
} from '../../../src/core/types.js';

// ============================================================================
// Helpers
// ============================================================================

function makeResponse(
  overrides: Partial<NormalizedChatResponse> = {},
): NormalizedChatResponse {
  return {
    provider: 'test-provider',
    model: 'test-model',
    outputText: 'A'.repeat(120), // > 100 chars by default
    finishReason: 'stop',
    usage: null,
    latencyMs: 100,
    costEstimate: null,
    warnings: [],
    fallbackUsed: false,
    ...overrides,
  };
}

function makeRequest(
  overrides: Partial<ConsensusRequest> = {},
): ConsensusRequest {
  return {
    models: [
      { provider: 'p1', model: 'm1' },
      { provider: 'p2', model: 'm2' },
    ],
    messages: [{ role: 'user' as const, content: 'Hello' }],
    strategy: 'all',
    ...overrides,
  };
}

/**
 * Build a mock executor that returns controlled responses per-model.
 * The map keys use "provider/model" format.
 * An entry whose value is an Error will cause that call to reject.
 */
function buildMockExecutor(
  responseMap: Map<string, { response: NormalizedChatResponse; delayMs: number } | Error>,
): ChatExecutor {
  return async (request: NormalizedChatRequest): Promise<NormalizedChatResponse> => {
    const key = `${request.provider ?? 'unknown'}/${request.model ?? 'unknown'}`;
    const entry = responseMap.get(key);

    if (!entry) {
      throw new Error(`No mock configured for ${key}`);
    }

    if (entry instanceof Error) {
      throw entry;
    }

    // simulate latency
    if (entry.delayMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, entry.delayMs));
    }

    return entry.response;
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('ConsensusEngine', () => {
  // ---------- Strategy "all" ----------

  describe('strategy "all"', () => {
    it('returns all responses', async () => {
      const map = new Map<string, { response: NormalizedChatResponse; delayMs: number }>([
        ['p1/m1', { response: makeResponse({ provider: 'p1', model: 'm1' }), delayMs: 0 }],
        ['p2/m2', { response: makeResponse({ provider: 'p2', model: 'm2' }), delayMs: 0 }],
      ]);

      const engine = new ConsensusEngine(buildMockExecutor(map));
      const result = await engine.execute(makeRequest());

      assert.strictEqual(result.responses.length, 2);
      assert.strictEqual(result.strategy, 'all');
      assert.strictEqual(result.responses[0]!.provider, 'p1');
      assert.strictEqual(result.responses[1]!.provider, 'p2');
    });

    it('recommends highest quality score', async () => {
      // p1 returns short text (lower score), p2 returns long text with code fence (higher)
      const map = new Map<string, { response: NormalizedChatResponse; delayMs: number }>([
        [
          'p1/m1',
          {
            response: makeResponse({
              provider: 'p1',
              model: 'm1',
              outputText: 'short',
              finishReason: 'length',
            }),
            delayMs: 0,
          },
        ],
        [
          'p2/m2',
          {
            response: makeResponse({
              provider: 'p2',
              model: 'm2',
              outputText: 'A'.repeat(120) + '\n```js\nconsole.log("hi")\n```',
              finishReason: 'stop',
            }),
            delayMs: 0,
          },
        ],
      ]);

      const engine = new ConsensusEngine(buildMockExecutor(map));
      const result = await engine.execute(makeRequest());

      // p2 should be recommended (higher score)
      assert.strictEqual(result.recommended, 1);
    });
  });

  // ---------- Quality scoring ----------

  describe('quality scoring', () => {
    it('computes correct score for good response', async () => {
      // long text + stop + no warnings = 50 + 20 + 10 = 80
      const map = new Map<string, { response: NormalizedChatResponse; delayMs: number }>([
        [
          'p1/m1',
          {
            response: makeResponse({
              provider: 'p1',
              model: 'm1',
              outputText: 'A'.repeat(120),
              finishReason: 'stop',
              warnings: [],
            }),
            delayMs: 0,
          },
        ],
        [
          'p2/m2',
          {
            response: makeResponse({ provider: 'p2', model: 'm2' }),
            delayMs: 0,
          },
        ],
      ]);

      const engine = new ConsensusEngine(buildMockExecutor(map));
      const result = await engine.execute(makeRequest());

      // 50 (success) + 20 (>100 chars) + 10 (stop) = 80
      assert.strictEqual(result.responses[0]!.qualityScore, 80);
    });

    it('penalizes warnings', async () => {
      const map = new Map<string, { response: NormalizedChatResponse; delayMs: number }>([
        [
          'p1/m1',
          {
            response: makeResponse({
              provider: 'p1',
              model: 'm1',
              outputText: 'A'.repeat(120),
              finishReason: 'stop',
              warnings: ['fallback used'],
            }),
            delayMs: 0,
          },
        ],
        [
          'p2/m2',
          {
            response: makeResponse({ provider: 'p2', model: 'm2' }),
            delayMs: 0,
          },
        ],
      ]);

      const engine = new ConsensusEngine(buildMockExecutor(map));
      const result = await engine.execute(makeRequest());

      // 50 + 20 + 10 - 20 = 60
      assert.strictEqual(result.responses[0]!.qualityScore, 60);
    });

    it('rewards code fences and valid JSON', async () => {
      const jsonOutput = JSON.stringify({ key: 'value', arr: [1, 2, 3] });
      // Ensure it's > 100 chars by padding
      const paddedJson = jsonOutput.padEnd(120, ' ');

      const codeOutput = 'A'.repeat(120) + '\n```python\nprint("hi")\n```';

      const map = new Map<string, { response: NormalizedChatResponse; delayMs: number }>([
        [
          'p1/m1',
          {
            response: makeResponse({
              provider: 'p1',
              model: 'm1',
              outputText: codeOutput,
              finishReason: 'stop',
            }),
            delayMs: 0,
          },
        ],
        [
          'p2/m2',
          {
            response: makeResponse({
              provider: 'p2',
              model: 'm2',
              outputText: paddedJson,
              finishReason: 'stop',
            }),
            delayMs: 0,
          },
        ],
      ]);

      const engine = new ConsensusEngine(buildMockExecutor(map));
      const result = await engine.execute(makeRequest());

      // p1: 50 + 20 + 10 (code fence) + 10 (stop) = 90
      assert.strictEqual(result.responses[0]!.qualityScore, 90);

      // p2: 50 + 20 + 10 (valid JSON) + 10 (stop) = 90
      assert.strictEqual(result.responses[1]!.qualityScore, 90);
    });
  });

  // ---------- Strategy "fastest" ----------

  describe('strategy "fastest"', () => {
    it('recommends lowest latency among successes', async () => {
      const map = new Map<string, { response: NormalizedChatResponse; delayMs: number }>([
        ['p1/m1', { response: makeResponse({ provider: 'p1', model: 'm1' }), delayMs: 100 }],
        ['p2/m2', { response: makeResponse({ provider: 'p2', model: 'm2' }), delayMs: 10 }],
      ]);

      const engine = new ConsensusEngine(buildMockExecutor(map));
      const result = await engine.execute(makeRequest({ strategy: 'fastest' }));

      // p2 is faster
      assert.strictEqual(result.recommended, 1);
      assert.strictEqual(result.strategy, 'fastest');
    });
  });

  // ---------- Partial failure ----------

  describe('partial failure', () => {
    it('one model failure does not kill others', async () => {
      const map = new Map<string, { response: NormalizedChatResponse; delayMs: number } | Error>([
        ['p1/m1', new Error('provider down')],
        ['p2/m2', { response: makeResponse({ provider: 'p2', model: 'm2' }), delayMs: 0 }],
      ]);

      const engine = new ConsensusEngine(buildMockExecutor(map));
      const result = await engine.execute(makeRequest());

      assert.strictEqual(result.responses.length, 2);
      assert.strictEqual(result.responses[0]!.error, 'provider down');
      assert.strictEqual(result.responses[0]!.response, null);
      assert.strictEqual(result.responses[0]!.qualityScore, 0);
      assert.ok(result.responses[1]!.response !== null);
      // Recommended should be the successful one (index 1)
      assert.strictEqual(result.recommended, 1);
    });

    it('all models fail returns all errors with quality 0', async () => {
      const map = new Map<string, { response: NormalizedChatResponse; delayMs: number } | Error>([
        ['p1/m1', new Error('provider1 down')],
        ['p2/m2', new Error('provider2 down')],
      ]);

      const engine = new ConsensusEngine(buildMockExecutor(map));
      const result = await engine.execute(makeRequest());

      assert.strictEqual(result.responses.length, 2);
      for (const r of result.responses) {
        assert.strictEqual(r.response, null);
        assert.ok(r.error !== null);
        assert.strictEqual(r.qualityScore, 0);
      }
    });
  });

  // ---------- Validation ----------

  describe('validation', () => {
    it('rejects fewer than 2 models', async () => {
      const engine = new ConsensusEngine(async () => makeResponse());
      await assert.rejects(
        () =>
          engine.execute(
            makeRequest({ models: [{ provider: 'p1', model: 'm1' }] }),
          ),
        (err: Error) => {
          assert.ok(err.message.includes('at least 2'));
          return true;
        },
      );
    });

    it('rejects more than 4 models', async () => {
      const engine = new ConsensusEngine(async () => makeResponse());
      const models = Array.from({ length: 5 }, (_, i) => ({
        provider: `p${i}`,
        model: `m${i}`,
      }));
      await assert.rejects(
        () => engine.execute(makeRequest({ models })),
        (err: Error) => {
          assert.ok(err.message.includes('at most 4'));
          return true;
        },
      );
    });

    it('rejects empty messages', async () => {
      const engine = new ConsensusEngine(async () => makeResponse());
      await assert.rejects(
        () => engine.execute(makeRequest({ messages: [] })),
        (err: Error) => {
          assert.ok(err.message.includes('at least one message'));
          return true;
        },
      );
    });
  });

  // ---------- totalLatencyMs ----------

  describe('totalLatencyMs', () => {
    it('equals the max of individual latencies', async () => {
      const map = new Map<string, { response: NormalizedChatResponse; delayMs: number }>([
        ['p1/m1', { response: makeResponse({ provider: 'p1', model: 'm1' }), delayMs: 50 }],
        ['p2/m2', { response: makeResponse({ provider: 'p2', model: 'm2' }), delayMs: 150 }],
      ]);

      const engine = new ConsensusEngine(buildMockExecutor(map));
      const result = await engine.execute(makeRequest());

      // totalLatencyMs should be the max of measured latencies
      const maxLatency = Math.max(
        ...result.responses.map((r) => r.latencyMs),
      );
      assert.strictEqual(result.totalLatencyMs, maxLatency);
    });
  });
});
