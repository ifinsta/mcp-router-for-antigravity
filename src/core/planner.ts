/**
 * Attempt Planner
 *
 * Plans execution paths for requests including primary, retry, and fallback attempts.
 * Ensures no futile recovery paths and prevents fallback loops.
 */

import { getLogger } from '../infra/logger.js';
import { getConfig, AppConfig } from '../infra/config.js';
import {
  NormalizedChatRequest,
  AttemptPhase,
  ProviderAdapter,
  RouterError,
  ErrorCode,
} from './types.js';
import { createRouterError, isRetryableError } from './types.js';
import { getProvider, hasProvider, getAllProviders } from './registry.js';
import { isRouterError } from './errors.js';

const logger = getLogger('planner');

export interface ExecutionPlan {
  primary: PlannedAttempt;
  retries: PlannedAttempt[];
  fallback: PlannedAttempt | null;
  maxAttempts: number;
  totalBudgetMs: number;
}

export interface PlannedAttempt {
  provider: string;
  model: string;
  phase: AttemptPhase;
  attemptNumber: number;
}

export interface PlannerConfig {
  defaultProvider: string;
  defaultModel: string;
  maxAttempts: number;
  totalBudgetMs: number;
}

export class AttemptPlanner {
  constructor(private config: PlannerConfig) {}

  plan(request: NormalizedChatRequest, allowedProviders: string[]): ExecutionPlan {
    const primaryProvider = request.provider ?? this.config.defaultProvider;
    const primaryModel = request.model ?? this.config.defaultModel;
    const fallbackProvider = request.fallbackProvider;

    const primary = this.planPrimary(primaryProvider, primaryModel);
    const retries = this.planRetries(primaryProvider, primaryModel);
    const fallback = this.planFallback(fallbackProvider, primaryProvider, allowedProviders);

    const plan: ExecutionPlan = {
      primary,
      retries,
      fallback,
      maxAttempts: this.config.maxAttempts,
      totalBudgetMs: this.config.totalBudgetMs,
    };

    logger.debug('Execution plan created', {
      primary: `${primary.provider}/${primary.model}`,
      retryCount: retries.length,
      fallback: fallback ? `${fallback.provider}/${fallback.model}` : 'none',
      maxAttempts: plan.maxAttempts,
    });

    return plan;
  }

  private planPrimary(provider: string, model: string): PlannedAttempt {
    return {
      provider,
      model,
      phase: AttemptPhase.PRIMARY,
      attemptNumber: 1,
    };
  }

  private planRetries(provider: string, model: string): PlannedAttempt[] {
    const retries: PlannedAttempt[] = [];
    const maxRetries = this.config.maxAttempts - 1;

    for (let i = 0; i < maxRetries; i++) {
      retries.push({
        provider,
        model,
        phase: AttemptPhase.RETRY,
        attemptNumber: 2 + i,
      });
    }

    return retries;
  }

  private planFallback(
    fallbackProvider: string | undefined,
    primaryProvider: string,
    allowedProviders: string[]
  ): PlannedAttempt | null {
    if (!fallbackProvider) {
      return null;
    }

    if (fallbackProvider === primaryProvider) {
      logger.warn('Fallback provider same as primary, skipping fallback', {
        provider: fallbackProvider,
      });
      return null;
    }

    if (!allowedProviders.includes(fallbackProvider)) {
      logger.warn('Fallback provider not in allowed list', {
        provider: fallbackProvider,
        allowed: allowedProviders,
      });
      return null;
    }

    return {
      provider: fallbackProvider,
      model: this.config.defaultModel,
      phase: AttemptPhase.FALLBACK,
      attemptNumber: this.config.maxAttempts + 1,
    };
  }

  shouldContinueAfterFailure(
    error: unknown,
    currentAttempt: number,
    plan: ExecutionPlan,
    remainingBudgetMs: number
  ): { continue: boolean; nextPhase: AttemptPhase | null } {
    const routerError = this.classifyError(error);
    const retryable = this.isRetryable(routerError);

    if (!retryable) {
      logger.info('Non-retryable error, stopping execution', {
        errorCode: routerError?.code,
        attempt: currentAttempt,
      });
      return { continue: false, nextPhase: null };
    }

    const hasRetryBudget = currentAttempt < plan.maxAttempts;
    const hasTimeBudget = remainingBudgetMs > 1000;

    if (!hasTimeBudget) {
      logger.warn('Insufficient time budget for retry', {
        remainingMs: remainingBudgetMs,
      });
      return { continue: false, nextPhase: null };
    }

    if (!hasRetryBudget) {
      if (plan.fallback) {
        return { continue: true, nextPhase: AttemptPhase.FALLBACK };
      }
      return { continue: false, nextPhase: null };
    }

    return { continue: true, nextPhase: AttemptPhase.RETRY };
  }

  getNextAttempt(
    currentAttempt: number,
    plan: ExecutionPlan,
    phase: AttemptPhase
  ): PlannedAttempt | null {
    if (phase === AttemptPhase.RETRY) {
      const retryIndex = currentAttempt - 1;
      if (retryIndex < plan.retries.length) {
        const retry = plan.retries[retryIndex];
        if (retry) {
          return retry;
        }
      }
    }

    if (phase === AttemptPhase.FALLBACK) {
      return plan.fallback;
    }

    return null;
  }

  private classifyError(error: unknown): RouterError | null {
    if (isRouterError(error)) {
      return error;
    }

    if (error instanceof Error) {
      return createRouterError(ErrorCode.UNKNOWN_ERROR, error.message, { cause: error });
    }

    return null;
  }

  private isRetryable(error: RouterError | null): boolean {
    if (!error) {
      return false;
    }

    if (error.retryable !== undefined) {
      return error.retryable;
    }

    return isRetryableError(error.code);
  }
}

export function createPlanner(config?: Partial<PlannerConfig>): AttemptPlanner {
  const appConfig = getConfig();

  return new AttemptPlanner({
    defaultProvider: config?.defaultProvider ?? appConfig.router.defaultProvider,
    defaultModel: config?.defaultModel ?? appConfig.router.defaultModel,
    maxAttempts: config?.maxAttempts ?? appConfig.resilience.maxAttemptsPerRequest,
    totalBudgetMs: config?.totalBudgetMs ?? appConfig.router.totalRequestBudgetMs,
  });
}

let plannerInstance: AttemptPlanner | null = null;

export function getPlanner(): AttemptPlanner {
  if (!plannerInstance) {
    plannerInstance = createPlanner();
  }
  return plannerInstance;
}
