/**
 * Health Service
 *
 * Provides router health status, provider health, and operational warnings
 */

import { getLogger } from '../infra/logger.js';
import { getMetricsCollector } from '../infra/metrics.js';
import {
  HealthResponse,
  RouterStatus,
  ConfigurationHealth,
  DiscoveryHealth,
  ExecutionHealth,
  ProviderHealthSummary,
  CircuitBreakerState,
} from './types.js';
import { getConfig } from '../infra/config.js';
import { getAllProviders, getProviderHealth } from './registry.js';

const logger = getLogger('health-service');

// Cache health status to avoid repeated expensive checks
let cachedHealth: HealthResponse | null = null;
let healthCacheTimestamp = 0;
const CACHE_DURATION_MS = 5000; // Cache for 5 seconds

/**
 * Get current health status
 */
export async function getHealth(): Promise<HealthResponse> {
  const now = Date.now();

  // Return cached health if still valid
  if (cachedHealth && now - healthCacheTimestamp < CACHE_DURATION_MS) {
    logger.debug('Returning cached health status');
    return cachedHealth;
  }

  logger.debug('Calculating fresh health status');

  try {
    // Check configuration health
    const configHealth = checkConfigurationHealth();

    // Check discovery health
    const discoveryHealth = await checkDiscoveryHealth();

    // Check execution health
    const executionHealth = checkExecutionHealth();

    // Get provider health summaries
    const providerHealth = await getProviderHealthSummaries();

    // Determine overall status
    const status = determineOverallStatus(configHealth, discoveryHealth, executionHealth);

    // Aggregate warnings
    const warnings = [
      ...configHealth.warnings,
      ...discoveryHealth.warnings,
      ...executionHealth.warnings,
    ];

    const health: HealthResponse = {
      status,
      version: '1.0.0',
      config: configHealth,
      discovery: discoveryHealth,
      execution: executionHealth,
      providers: providerHealth,
      warnings,
      metrics: getMetricsCollector().getSnapshot(),
      timestamp: now,
    };

    // Cache the result
    cachedHealth = health;
    healthCacheTimestamp = now;

    logger.debug('Health status calculated', {
      status,
      warningCount: warnings.length,
      providerCount: providerHealth.length,
    });

    return health;
  } catch (error) {
    logger.error('Failed to calculate health status', error);

    // Return degraded status if health check fails
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
        warnings: [],
      },
      execution: {
        status: 'failed',
        activeRequests: 0,
        concurrencyUtilization: 0,
        warnings: [],
      },
      providers: [],
      warnings: [],
      timestamp: Date.now(),
    };
  }
}

/**
 * Check configuration health
 */
function checkConfigurationHealth(): ConfigurationHealth {
  logger.debug('Checking configuration health');

  try {
    const config = getConfig();

    // Check for configuration warnings
    const warnings: string[] = [];

    // Check if no providers are configured
    const providers = Object.keys(config.providers);
    if (providers.length === 0) {
      warnings.push('No providers configured');
    }

    // Check if default provider is configured
    if (!providers.includes(config.router.defaultProvider)) {
      warnings.push(`Default provider '${config.router.defaultProvider}' is not configured`);
    }

    // Check concurrency limits
    const globalLimit = config.router.globalConcurrencyLimit;
    for (const [provider, limit] of Object.entries(config.resilience.providerConcurrency)) {
      if (String(limit) > globalLimit.toString()) {
        warnings.push(`Per-provider concurrency limit for '${provider}' exceeds global limit`);
      }
    }

    return {
      status: warnings.length === 0 ? 'valid' : warnings.length > 0 ? 'warnings' : 'invalid',
      warnings,
      errors: [],
    };
  } catch (error) {
    logger.error('Configuration health check failed', error);

    return {
      status: 'invalid',
      warnings: [],
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

/**
 * Check discovery health (model listing)
 */
async function checkDiscoveryHealth(): Promise<DiscoveryHealth> {
  logger.debug('Checking discovery health');

  try {
    const providerNames = getAllProviders();

    if (providerNames.length === 0) {
      return {
        status: 'failed',
        providers: [],
        warnings: ['No providers available for discovery'],
      };
    }

    // Try to get health for each provider
    interface ProviderHealthResult {
      provider: string;
      status: 'success' | 'failed';
      modelCount?: number | undefined;
      error?: string | undefined;
    }

    const providerHealthResults = await Promise.allSettled(
      providerNames.map(async (provider): Promise<ProviderHealthResult> => {
        try {
          await getProviderHealth(provider);
          return {
            provider,
            status: 'success',
            modelCount: undefined,
          };
        } catch (error) {
          return {
            provider,
            status: 'failed',
            error: error instanceof Error ? error.message : String(error),
          };
        }
      })
    );

    // Check results - extract values from settled results
    const results = providerHealthResults.map((result): ProviderHealthResult => {
      if (result.status === 'fulfilled') {
        return result.value;
      }
      return {
        provider: 'unknown',
        status: 'failed',
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      };
    });

    const successfulProviders = results.filter((r) => r.status === 'success');
    const failedProviders = results.filter((r) => r.status === 'failed');

    const warnings: string[] = [];
    if (failedProviders.length > 0) {
      warnings.push(
        `${failedProviders.length} provider(s) failed health check: ${failedProviders.map((p) => p.provider).join(', ')}`
      );
    }

    // Determine overall discovery health
    let status: 'healthy' | 'degraded' | 'failed';
    if (failedProviders.length === providerNames.length) {
      status = 'failed';
    } else if (failedProviders.length > 0) {
      status = 'degraded';
    } else {
      status = 'healthy';
    }

    return {
      status,
      providers: results.map((r) => ({
        provider: r.provider,
        status: r.status,
        modelCount: r.modelCount,
        error: r.error,
      })),
      warnings,
    };
  } catch (error) {
    logger.error('Discovery health check failed', error);

    return {
      status: 'failed',
      providers: [],
      warnings: [error instanceof Error ? error.message : String(error)],
    };
  }
}

/**
 * Check execution health
 */
function checkExecutionHealth(): ExecutionHealth {
  logger.debug('Checking execution health');

  // TODO: Implement actual execution health monitoring
  // For now, return healthy status
  return {
    status: 'healthy',
    activeRequests: 0,
    concurrencyUtilization: 0.0,
    warnings: ['Execution health monitoring not yet fully implemented'],
  };
}

/**
 * Get provider health summaries
 */
async function getProviderHealthSummaries(): Promise<ProviderHealthSummary[]> {
  const providerNames = getAllProviders();

  const summaries: ProviderHealthSummary[] = await Promise.all(
    providerNames.map(async (provider) => {
      const health = await getProviderHealth(provider);

      return {
        provider,
        status: health.status,
        breakerState: CircuitBreakerState.CLOSED, // TODO: Get actual breaker state
        lastCheckAt: Date.now(),
        latencyMs: health.latencyMs,
        recentErrorRate: 0.0, // TODO: Calculate actual error rate
      };
    })
  );

  return summaries;
}

/**
 * Determine overall router status
 */
function determineOverallStatus(
  configHealth: ConfigurationHealth,
  discoveryHealth: DiscoveryHealth,
  executionHealth: ExecutionHealth
): RouterStatus {
  // If any component is invalid or failed, overall is unhealthy
  if (
    configHealth.status === 'invalid' ||
    discoveryHealth.status === 'failed' ||
    executionHealth.status === 'failed'
  ) {
    return RouterStatus.UNHEALTHY;
  }

  // If any component is degraded or has warnings, overall is degraded
  if (
    configHealth.status === 'warnings' ||
    discoveryHealth.status === 'degraded' ||
    executionHealth.status === 'degraded'
  ) {
    return RouterStatus.DEGRADED;
  }

  // Otherwise, overall is healthy
  return RouterStatus.HEALTHY;
}

/**
 * Clear health cache
 */
export function clearHealthCache(): void {
  cachedHealth = null;
  healthCacheTimestamp = 0;
  logger.debug('Health cache cleared');
}
