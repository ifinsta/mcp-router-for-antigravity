/**
 * Consensus Engine
 *
 * Dispatches the same prompt to multiple models in parallel,
 * scores each response for quality, and recommends the best one
 * based on a caller-chosen strategy.
 */

import {
  NormalizedChatRequest,
  NormalizedChatResponse,
  ConsensusRequest,
  ConsensusResult,
  ConsensusResponse,
} from './types.js';
import { createValidationError } from './errors.js';

// ============================================================================
// Quality scoring helpers
// ============================================================================

const CODE_FENCE_REGEX = /```[\s\S]*?```/;

/**
 * Compute a quality score (0-100) for a single model response.
 *
 * Scoring rubric:
 *  +50  response succeeded (non-null)
 *  +20  outputText longer than 100 characters
 *  +10  outputText contains at least one code fence
 *  +10  outputText is valid JSON (only checked when it looks like JSON)
 *  +10  finishReason is "stop" (not length-truncated)
 *  -20  response carries warnings
 */
function computeQualityScore(response: NormalizedChatResponse | null): number {
  if (response === null) {
    return 0;
  }

  let score = 50; // base for success

  if (response.outputText.length > 100) {
    score += 20;
  }

  if (CODE_FENCE_REGEX.test(response.outputText)) {
    score += 10;
  }

  // Check for valid JSON when the output looks like JSON
  const trimmed = response.outputText.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      JSON.parse(trimmed);
      score += 10;
    } catch {
      // not valid JSON – no bonus
    }
  }

  if (response.finishReason === 'stop') {
    score += 10;
  }

  if (response.warnings.length > 0) {
    score -= 20;
  }

  return Math.max(0, Math.min(100, score));
}

// ============================================================================
// ConsensusEngine
// ============================================================================

/** Function signature accepted as the chat executor dependency. */
export type ChatExecutor = (
  request: NormalizedChatRequest,
) => Promise<NormalizedChatResponse>;

/**
 * Orchestrates parallel multi-model execution and quality-based selection.
 */
export class ConsensusEngine {
  private readonly executeChat: ChatExecutor;

  constructor(executeChat: ChatExecutor) {
    this.executeChat = executeChat;
  }

  /**
   * Execute a consensus request across multiple models.
   */
  async execute(request: ConsensusRequest): Promise<ConsensusResponse> {
    // ---- Validation ----
    if (request.models.length < 2) {
      throw createValidationError(
        'Consensus requires at least 2 models',
        'models',
        request.models.length,
      );
    }

    if (request.models.length > 4) {
      throw createValidationError(
        'Consensus supports at most 4 models',
        'models',
        request.models.length,
      );
    }

    if (request.messages.length === 0) {
      throw createValidationError(
        'Consensus requires at least one message',
        'messages',
        0,
      );
    }

    // ---- Build per-model requests ----
    const perModelRequests: NormalizedChatRequest[] = request.models.map(
      (target) => ({
        provider: target.provider,
        model: target.model,
        messages: request.messages,
        temperature: request.temperature,
        maxTokens: request.maxTokens,
        timeoutMs: request.timeoutMs,
      }),
    );

    // ---- Dispatch in parallel ----
    const settled = await Promise.allSettled(
      perModelRequests.map(async (chatReq, index) => {
        const start = Date.now();
        const response = await this.executeChat(chatReq);
        const latencyMs = Date.now() - start;
        const target = request.models[index]!;
        return { target, response, latencyMs };
      }),
    );

    // ---- Collect results ----
    const results: ConsensusResult[] = settled.map((outcome, index) => {
      const target = request.models[index]!;

      if (outcome.status === 'fulfilled') {
        const { response, latencyMs } = outcome.value;
        return {
          provider: target.provider,
          model: target.model,
          response,
          error: null,
          latencyMs,
          qualityScore: computeQualityScore(response),
        };
      }

      // rejected
      const reason =
        outcome.reason instanceof Error
          ? outcome.reason.message
          : String(outcome.reason);

      return {
        provider: target.provider,
        model: target.model,
        response: null,
        error: reason,
        latencyMs: 0,
        qualityScore: 0,
      };
    });

    // ---- Strategy-based recommendation ----
    const recommended = this.pickRecommended(results, request.strategy);

    // ---- Total latency = wall-clock max ----
    const totalLatencyMs = results.reduce(
      (max, r) => Math.max(max, r.latencyMs),
      0,
    );

    return {
      responses: results,
      recommended,
      totalLatencyMs,
      strategy: request.strategy,
    };
  }

  /**
   * Pick the recommended index based on strategy.
   */
  private pickRecommended(
    results: ConsensusResult[],
    strategy: ConsensusRequest['strategy'],
  ): number {
    if (strategy === 'fastest') {
      // Among successes, pick lowest latency
      let bestIdx = 0;
      let bestLatency = Infinity;

      for (let i = 0; i < results.length; i++) {
        const r = results[i]!;
        if (r.response !== null && r.latencyMs < bestLatency) {
          bestLatency = r.latencyMs;
          bestIdx = i;
        }
      }
      return bestIdx;
    }

    // 'all' and 'best' both recommend highest quality score
    let bestIdx = 0;
    let bestScore = -1;

    for (let i = 0; i < results.length; i++) {
      const r = results[i]!;
      if (r.qualityScore > bestScore) {
        bestScore = r.qualityScore;
        bestIdx = i;
      }
    }
    return bestIdx;
  }
}
