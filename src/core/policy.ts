/**
 * Policy Engine
 *
 * Validates requests against policy rules including:
 * - Allowed providers and models
 * - Input size limits
 * - Output token limits
 * - Cost limits
 */

import { getLogger } from '../infra/logger.js';
import { getConfig, AppConfig } from '../infra/config.js';
import {
  NormalizedChatRequest,
  PolicyCheckResult,
  PolicyConfig,
  RouterError,
  ErrorCode,
} from './types.js';
import {
  createProviderNotAllowedError,
  createModelNotAllowedError,
  createInputTooLargeError,
  createCostLimitExceededError,
  createPolicyError,
} from './errors.js';
import { hasProvider } from './registry.js';

const logger = getLogger('policy');

export class PolicyEngine {
  constructor(private config: PolicyConfig) {}

  check(request: NormalizedChatRequest): PolicyCheckResult {
    const warnings: string[] = [];
    const errors: RouterError[] = [];

    const provider = request.provider ?? getConfig().router.defaultProvider;
    const model = request.model ?? getConfig().router.defaultModel;

    const providerCheck = this.checkProvider(provider);
    if (!providerCheck.allowed) {
      errors.push(createProviderNotAllowedError(provider));
    }

    const modelCheck = this.checkModel(model);
    if (!modelCheck.allowed) {
      errors.push(createModelNotAllowedError(model));
    }

    const inputCheck = this.checkInputSize(request);
    if (!inputCheck.allowed) {
      errors.push(createInputTooLargeError(inputCheck.actualSize, this.config.maxInputChars));
    }
    warnings.push(...inputCheck.warnings);

    const outputCheck = this.checkOutputTokens(request.maxTokens);
    if (!outputCheck.allowed) {
      warnings.push(
        `Requested maxTokens (${request.maxTokens}) exceeds policy limit (${this.config.maxOutputTokens})`
      );
    }

    if (this.config.maxCostUsdPerRequest !== undefined) {
      const costCheck = this.checkCostEstimate(request);
      if (!costCheck.allowed && costCheck.estimatedCost !== undefined) {
        errors.push(
          createCostLimitExceededError(costCheck.estimatedCost, this.config.maxCostUsdPerRequest)
        );
      }
    }

    const result: PolicyCheckResult = {
      allowed: errors.length === 0,
      warnings,
    };

    if (!result.allowed) {
      result.denialReason = errors.map((e) => e.message).join('; ');
    }

    logger.debug('Policy check completed', {
      allowed: result.allowed,
      provider,
      model,
      warningCount: warnings.length,
      errorCount: errors.length,
    });

    return result;
  }

  checkProviderForFallback(provider: string): PolicyCheckResult {
    const warnings: string[] = [];

    if (!this.config.allowedProviders.includes(provider)) {
      return {
        allowed: false,
        denialReason: `Provider '${provider}' is not allowed for fallback`,
        warnings,
      };
    }

    if (!hasProvider(provider)) {
      return {
        allowed: false,
        denialReason: `Provider '${provider}' is not configured`,
        warnings,
      };
    }

    return { allowed: true, warnings };
  }

  private checkProvider(provider: string): PolicyCheckResult {
    const warnings: string[] = [];

    if (!this.config.allowedProviders.includes(provider)) {
      return {
        allowed: false,
        denialReason: `Provider '${provider}' is not allowed`,
        warnings,
      };
    }

    if (!hasProvider(provider)) {
      warnings.push(`Provider '${provider}' is allowed but not configured (missing API key)`);
    }

    return { allowed: true, warnings };
  }

  private checkModel(model: string): PolicyCheckResult {
    const warnings: string[] = [];

    if (this.config.allowedModels.length > 0 && !this.isModelAllowed(model)) {
      return {
        allowed: false,
        denialReason: `Model '${model}' is not allowed`,
        warnings,
      };
    }

    return { allowed: true, warnings };
  }

  private isModelAllowed(model: string): boolean {
    if (this.config.allowedModels.length === 0) {
      return true;
    }

    return this.config.allowedModels.some((allowed) => {
      if (allowed.endsWith('*')) {
        return model.startsWith(allowed.slice(0, -1));
      }
      return model === allowed;
    });
  }

  private checkInputSize(request: NormalizedChatRequest): {
    allowed: boolean;
    actualSize: number;
    warnings: string[];
  } {
    const warnings: string[] = [];
    let totalSize = 0;

    for (const message of request.messages) {
      totalSize += message.content.length;
    }

    const allowed = totalSize <= this.config.maxInputChars;

    if (!allowed) {
      logger.warn('Input size exceeds limit', {
        actualSize: totalSize,
        maxSize: this.config.maxInputChars,
      });
    }

    return { allowed, actualSize: totalSize, warnings };
  }

  private checkOutputTokens(maxTokens?: number): { allowed: boolean } {
    if (maxTokens === undefined) {
      return { allowed: true };
    }

    return { allowed: maxTokens <= this.config.maxOutputTokens };
  }

  private checkCostEstimate(request: NormalizedChatRequest): {
    allowed: boolean;
    estimatedCost?: number | undefined;
  } {
    const maxCost = this.config.maxCostUsdPerRequest;
    if (maxCost === undefined) {
      return { allowed: true };
    }

    const estimatedCost = this.estimateCost(request);

    return {
      allowed: estimatedCost <= maxCost,
      estimatedCost,
    };
  }

  private estimateCost(request: NormalizedChatRequest): number {
    let inputTokens = 0;
    for (const message of request.messages) {
      inputTokens += Math.ceil(message.content.length / 4);
    }

    const outputTokens = request.maxTokens ?? 1000;

    const model = request.model ?? getConfig().router.defaultModel;
    const pricing = this.getModelPricing(model);

    const inputCost = (inputTokens / 1000) * pricing.inputPerK;
    const outputCost = (outputTokens / 1000) * pricing.outputPerK;

    return inputCost + outputCost;
  }

  private getModelPricing(model: string): { inputPerK: number; outputPerK: number } {
    const lowerModel = model.toLowerCase();

    if (lowerModel.includes('gpt-4') || lowerModel.includes('gpt4')) {
      if (
        lowerModel.includes('turbo') ||
        lowerModel.includes('1106') ||
        lowerModel.includes('0125')
      ) {
        return { inputPerK: 0.01, outputPerK: 0.03 };
      }
      return { inputPerK: 0.03, outputPerK: 0.06 };
    }

    if (lowerModel.includes('gpt-3.5') || lowerModel.includes('gpt35')) {
      return { inputPerK: 0.0005, outputPerK: 0.0015 };
    }

    if (lowerModel.includes('glm')) {
      return { inputPerK: 0.001, outputPerK: 0.001 };
    }

    return { inputPerK: 0.001, outputPerK: 0.002 };
  }
}

export function createPolicyEngine(config?: Partial<PolicyConfig>): PolicyEngine {
  const appConfig = getConfig();

  return new PolicyEngine({
    allowedProviders: config?.allowedProviders ?? appConfig.policy.allowedProviders,
    allowedModels: config?.allowedModels ?? appConfig.policy.allowedModels,
    maxInputChars: config?.maxInputChars ?? appConfig.policy.maxInputChars,
    maxOutputTokens: config?.maxOutputTokens ?? appConfig.policy.maxOutputTokens,
    maxCostUsdPerRequest: config?.maxCostUsdPerRequest ?? appConfig.policy.maxCostUsdPerRequest,
  });
}

let policyInstance: PolicyEngine | null = null;

export function getPolicyEngine(): PolicyEngine {
  if (!policyInstance) {
    policyInstance = createPolicyEngine();
  }
  return policyInstance;
}
