/**
 * Router Core
 *
 * Main orchestration component that ties together all router functionality:
 * - Provider resolution and selection
 * - Request routing and execution
 * - Fallback and retry coordination
 * - Response aggregation
 */

import { getLogger } from '../infra/logger.js';
import { getConfig, AppConfig } from '../infra/config.js';
import { getMetricsCollector } from '../infra/metrics.js';
import {
  NormalizedChatRequest,
  NormalizedChatResponse,
  ModelInfo,
  RouterStatus,
  HealthResponse,
  ConfigurationHealth,
  DiscoveryHealth,
  ExecutionHealth,
  AttemptPhase,
  AttemptStatus,
  RouterError,
} from './types.js';
import {
  getProvider,
  getAllProviders,
  getProviderHealth,
  initializeProviderRegistry,
  getProviderRegistry,
  hasProvider,
} from '../core/registry.js';
import {
  createValidationError,
  createTimeoutError,
  createNetworkError,
  createProviderNotFoundError,
  isRouterError,
  createPolicyError,
} from '../core/errors.js';
import { ProtectedExecutor, ExecutorConfig } from '../resilience/executor.js';
import { AttemptPlanner, ExecutionPlan, PlannedAttempt } from './planner.js';
import { PolicyEngine } from './policy.js';
import { AttemptHistoryRecorder } from '../resilience/attemptHistory.js';
import { createProviderFactory } from '../providers/providerFactory.js';

const logger = getLogger('router-core');

export class Router {
  private initialized: boolean = false;
  private executor: ProtectedExecutor | null = null;
  private planner: AttemptPlanner | null = null;
  private policyEngine: PolicyEngine | null = null;

  /**
   * Initialize the router
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.warn('Router already initialized');
      return;
    }

    logger.info('Initializing router core...');

    try {
      await initializeProviderRegistry();

      // Use ProviderFactory for clean, decoupled adapter creation
      const factory = createProviderFactory(getConfig());
      const adapters = await factory.createAllAdapters();
      
      logger.debug('Provider config keys check', {
        hasOpenAI: !!getConfig().providers.openai,
        hasGLM: !!getConfig().providers.glm,
        hasChutes: !!getConfig().providers.chutes,
      });

      for (const adapter of adapters) {
        logger.debug(`Registering ${adapter.name} adapter`);
        getProviderRegistry().register(adapter);
      }

      this.initializeResilienceComponents();

      this.initialized = true;
      logger.info('Router core initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize router core', error);
      throw error;
    }
  }

  private initializeResilienceComponents(): void {
    const executorConfig: ExecutorConfig = {
      timeoutMs: getConfig().router.timeoutMs,
      retry: {
        maxAttempts: getConfig().resilience.maxAttemptsPerRequest,
        baseDelayMs: getConfig().resilience.retry.baseDelayMs,
        maxDelayMs: getConfig().resilience.retry.maxDelayMs,
        backoffMultiplier: getConfig().resilience.retry.backoffMultiplier,
        jitterFactor: getConfig().resilience.retry.jitterFactor,
      },
      circuitBreaker: {
        failureThreshold: getConfig().resilience.circuitBreaker.failureThreshold,
        cooldownMs: getConfig().resilience.circuitBreaker.cooldownMs,
        halfOpenSuccessCount: getConfig().resilience.circuitBreaker.halfOpenSuccessCount,
        failureRateWindowMs: getConfig().resilience.circuitBreaker.failureRateWindowMs,
      },
      concurrency: {
        globalLimit: getConfig().router.globalConcurrencyLimit,
        providerLimits: getConfig().resilience.providerConcurrency,
        queueSize: 0,
      },
      budget: {
        totalBudgetMs: getConfig().router.totalRequestBudgetMs,
        minRemainingMs: 1000,
      },
    };

    this.executor = new ProtectedExecutor(executorConfig);

    this.planner = new AttemptPlanner({
      defaultProvider: getConfig().router.defaultProvider,
      defaultModel: getConfig().router.defaultModel,
      maxAttempts: getConfig().resilience.maxAttemptsPerRequest,
      totalBudgetMs: getConfig().router.totalRequestBudgetMs,
    });

    this.policyEngine = new PolicyEngine({
      allowedProviders: getConfig().policy.allowedProviders,
      allowedModels: getConfig().policy.allowedModels,
      maxInputChars: getConfig().policy.maxInputChars,
      maxOutputTokens: getConfig().policy.maxOutputTokens,
      maxCostUsdPerRequest: getConfig().policy.maxCostUsdPerRequest,
    });

    logger.debug('Resilience components initialized', {
      maxAttempts: executorConfig.retry.maxAttempts,
      timeoutMs: executorConfig.timeoutMs,
      budgetMs: executorConfig.budget.totalBudgetMs,
    });
  }

  /**
   * Execute chat completion request through router
   */
  async executeChat(request: NormalizedChatRequest): Promise<NormalizedChatResponse> {
    const startTime = Date.now();
    const metrics = getMetricsCollector();
    metrics.incrementRequestCount();

    logger.debug('Executing chat request through router', {
      messageCount: request.messages.length,
      provider: request.provider,
      model: request.model,
    });

    try {
      if (!this.initialized) {
        await this.initialize();
      }

      if (!this.policyEngine || !this.planner || !this.executor) {
        throw createValidationError('Router not properly initialized');
      }

      const policyResult = this.policyEngine.check(request);
      if (!policyResult.allowed) {
        throw createPolicyError(policyResult.denialReason ?? 'Policy check failed');
      }

      const allowedProviders = getConfig().policy.allowedProviders;
      const plan = this.planner.plan(request, allowedProviders);
      const history = new AttemptHistoryRecorder();

      logger.debug('Execution plan created', {
        primary: `${plan.primary.provider}/${plan.primary.model}`,
        retryCount: plan.retries.length,
        fallback: plan.fallback ? `${plan.fallback.provider}/${plan.fallback.model}` : 'none',
      });

      let currentAttempt: PlannedAttempt = plan.primary;
      let attemptCount = 0;

      while (attemptCount < plan.maxAttempts + (plan.fallback ? 1 : 0)) {
        attemptCount++;

        const adapter = getProvider(currentAttempt.provider);
        if (!adapter) {
          logger.warn('Provider not found for attempt', {
            provider: currentAttempt.provider,
            attempt: attemptCount,
          });
          break;
        }

        try {
          const response = await this.executor.execute(
            adapter,
            request,
            currentAttempt.phase,
            currentAttempt.attemptNumber,
            history
          );

          const historyData = history.getHistory();
          response.fallbackUsed = historyData.fallbackUsed;

          if (policyResult.warnings.length > 0) {
            response.warnings.push(...policyResult.warnings);
          }

          metrics.incrementSuccessCount();
          metrics.recordLatencyMs(response.latencyMs);

          if (response.fallbackUsed) {
            metrics.incrementFallbackCount();
          }

          logger.info('Chat request completed successfully', {
            provider: response.provider,
            model: response.model,
            latencyMs: response.latencyMs,
            attemptCount,
            fallbackUsed: response.fallbackUsed,
            warningsCount: response.warnings.length,
          });

          return response;
        } catch (error) {
          const elapsed = Date.now() - startTime;
          const remainingBudgetMs = plan.totalBudgetMs - elapsed;

          const continueResult = this.planner.shouldContinueAfterFailure(
            error,
            attemptCount,
            plan,
            remainingBudgetMs
          );

          if (!continueResult.continue) {
            logger.warn('Execution stopped after failure', {
              attempt: attemptCount,
              error: isRouterError(error) ? error.code : 'unknown',
            });
            throw error;
          }

          const nextAttempt = this.planner.getNextAttempt(
            attemptCount,
            plan,
            continueResult.nextPhase!
          );

          if (!nextAttempt) {
            logger.warn('No more attempts available', { attempt: attemptCount });
            throw error;
          }

          currentAttempt = nextAttempt;

          const delayMs = this.calculateRetryDelay(attemptCount);
          logger.info('Retrying with delay', {
            nextProvider: currentAttempt.provider,
            nextPhase: currentAttempt.phase,
            delayMs,
            attempt: attemptCount + 1,
          });

          await this.sleep(delayMs);
        }
      }

      throw createProviderNotFoundError('No available provider after all attempts');
    } catch (error) {
      metrics.incrementFailureCount();
      metrics.recordLatencyMs(Date.now() - startTime);

      logger.error('Failed to execute chat request', {
        error: error instanceof Error ? error.message : String(error),
        code: isRouterError(error) ? error.code : undefined,
      });

      if (isRouterError(error)) {
        throw error;
      }

      return {
        provider: 'unknown',
        model: 'unknown',
        outputText: '',
        finishReason: 'error',
        usage: null,
        latencyMs: Date.now() - startTime,
        costEstimate: null,
        warnings: [error instanceof Error ? error.message : String(error)],
        fallbackUsed: false,
      };
    }
  }

  private calculateRetryDelay(attemptNumber: number): number {
    const baseDelayMs = getConfig().resilience.retry.baseDelayMs;
    const maxDelayMs = getConfig().resilience.retry.maxDelayMs;
    const multiplier = getConfig().resilience.retry.backoffMultiplier;
    const jitterFactor = getConfig().resilience.retry.jitterFactor;

    const exponentialDelay = baseDelayMs * Math.pow(multiplier, attemptNumber - 1);
    const cappedDelay = Math.min(exponentialDelay, maxDelayMs);
    const jitter = cappedDelay * jitterFactor * Math.random();
    const delay = cappedDelay + jitter;

    return Math.min(delay, maxDelayMs);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Check router health
   */
  async checkHealth(): Promise<HealthResponse> {
    logger.debug('Checking router health');

    try {
      if (!this.initialized) {
        await this.initialize();
      }

      // Import health service components
      const { getHealth } = await import('../core/health.js');

      const health = await getHealth();

      logger.info('Router health check completed', {
        status: health.status,
        providerCount: health.providers.length,
      });

      return health;
    } catch (error) {
      logger.error('Failed to check router health', error);

      // Return degraded health on error
      return {
        status: RouterStatus.UNHEALTHY,
        version: '1.0.0',
        config: {
          status: 'invalid',
          warnings: [],
          errors: [error instanceof Error ? error.message : String(error)],
        },
        discovery: {
          status: 'failed',
          providers: [],
          warnings: [error instanceof Error ? error.message : String(error)],
        },
        execution: {
          status: 'failed',
          activeRequests: 0,
          concurrencyUtilization: 0,
          warnings: [error instanceof Error ? error.message : String(error)],
        },
        providers: [],
        warnings: [error instanceof Error ? error.message : String(error)],
        timestamp: Date.now(),
      };
    }
  }

  /**
   * List all available models
   */
  async listModels(
    provider?: string
  ): Promise<Array<{ provider: string; models: ModelInfo[]; errors: string[] }>> {
    logger.debug('Listing models', { provider });

    try {
      if (!this.initialized) {
        await this.initialize();
      }

      // Import provider registry functions
      const { listAllModels } = await import('../core/registry.js');

      // Get models from all providers
      const providerModels = await listAllModels();

      logger.info('Models listed successfully', {
        providerCount: providerModels.length,
      });

      return providerModels;
    } catch (error) {
      logger.error('Failed to list models', error);

      return [
        {
          provider: 'error',
          models: [],
          errors: [error instanceof Error ? error.message : String(error)],
        },
      ];
    }
  }
}

// Export router instance
let routerInstance: Router | null = null;

/**
 * Get router instance
 */
export function getRouter(): Router {
  if (!routerInstance) {
    routerInstance = new Router();
  }
  return routerInstance;
}

/**
 * Initialize router singleton
 */
export async function initializeRouter(): Promise<void> {
  const router = getRouter();
  await router.initialize();
}
