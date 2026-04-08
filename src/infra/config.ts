/**
 * Configuration loader and schema
 *
 * Provides typed configuration with validation
 */

import 'dotenv/config';
import { z } from 'zod';
import {
  createConfigurationError,
  createMissingSecretError,
  isRouterError,
} from '../core/errors.js';

// ============================================================================
// Configuration Schema
// ============================================================================

/**
 * Router configuration schema
 */
const RouterConfigSchema = z.object({
  defaultProvider: z.string().min(1),
  defaultModel: z.string().min(1),
  timeoutMs: z.number().int().positive(),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']),
  globalConcurrencyLimit: z.number().int().positive(),
  totalRequestBudgetMs: z.number().int().positive(),
});

/**
 * Policy configuration schema
 */
const PolicyConfigSchema = z.object({
  allowedProviders: z.array(z.string().min(1)),
  allowedModels: z.array(z.string().min(1)),
  maxInputChars: z.number().int().positive(),
  maxOutputTokens: z.number().int().positive(),
  maxCostUsdPerRequest: z.number().positive().optional(),
});

/**
 * Resilience configuration schema
 */
const ResilienceConfigSchema = z.object({
  maxAttemptsPerRequest: z.number().int().positive().default(3),
  retry: z.object({
    baseDelayMs: z.number().int().positive().default(1000),
    maxDelayMs: z.number().int().positive().default(10000),
    backoffMultiplier: z.number().positive().default(2),
    jitterFactor: z.number().min(0).max(1).default(0.2),
  }),
  circuitBreaker: z.object({
    failureThreshold: z.number().int().positive().default(5),
    cooldownMs: z.number().int().positive().default(30000),
    halfOpenSuccessCount: z.number().int().positive().default(2),
    failureRateWindowMs: z.number().int().positive().default(60000),
  }),
  providerConcurrency: z.record(z.number().int().positive()).default({}),
});

/**
 * OpenAI provider configuration schema
 */
const OpenAIConfigSchema = z.object({
  apiKey: z.string().min(1),
  baseUrl: z.string().url().optional(),
});

/**
 * GLM provider configuration schema
 */
const GLMConfigSchema = z.object({
  apiKey: z.string().min(1),
  baseUrl: z.string().url().optional(),
});

/**
 * Ollama provider configuration schema
 */
const OllamaConfigSchema = z.object({
  baseUrl: z.string().url().default('http://127.0.0.1:11434'),
});

/**
 * Chutes provider configuration schema (OpenAI-compatible)
 */
const ChutesConfigSchema = z.object({
  apiKey: z.string().min(1),
  baseUrl: z.string().url().optional(),
});

/**
 * Anthropic provider configuration schema
 */
const AnthropicConfigSchema = z.object({
  apiKey: z.string().min(1),
  baseUrl: z.string().url().optional(),
});

/**
 * Azure OpenAI provider configuration schema
 */
const AzureOpenAIConfigSchema = z.object({
  apiKey: z.string().min(1),
  resource: z.string().min(1),
  deployment: z.string().min(1),
  apiVersion: z.string().min(1).optional(),
  baseUrl: z.string().url().optional(),
});

/**
 * Providers configuration schema
 */
const ProvidersConfigSchema = z.object({
  openai: OpenAIConfigSchema.optional(),
  glm: GLMConfigSchema.optional(),
  ollama: OllamaConfigSchema.optional(),
  chutes: ChutesConfigSchema.optional(),
  anthropic: AnthropicConfigSchema.optional(),
  'azure-openai': AzureOpenAIConfigSchema.optional(),
});

/**
 * Server configuration schema
 */
const ServerConfigSchema = z.object({
  extensionApiPort: z.number().int().positive().default(3000),
});

/**
 * Complete application configuration schema
 */
const AppConfigSchema = z.object({
  router: RouterConfigSchema,
  policy: PolicyConfigSchema,
  resilience: ResilienceConfigSchema,
  providers: ProvidersConfigSchema,
  server: ServerConfigSchema.default({ extensionApiPort: 3000 }),
});

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Parsed and validated application configuration
 */
export interface AppConfig {
  router: {
    defaultProvider: string;
    defaultModel: string;
    timeoutMs: number;
    logLevel: 'debug' | 'info' | 'warn' | 'error';
    globalConcurrencyLimit: number;
    totalRequestBudgetMs: number;
  };
  policy: {
    allowedProviders: string[];
    allowedModels: string[];
    maxInputChars: number;
    maxOutputTokens: number;
    maxCostUsdPerRequest?: number | undefined;
  };
  resilience: {
    maxAttemptsPerRequest: number;
    retry: {
      baseDelayMs: number;
      maxDelayMs: number;
      backoffMultiplier: number;
      jitterFactor: number;
    };
    circuitBreaker: {
      failureThreshold: number;
      cooldownMs: number;
      halfOpenSuccessCount: number;
      failureRateWindowMs: number;
    };
    providerConcurrency: Record<string, number>;
  };
  providers: {
    openai?: {
      apiKey: string;
      baseUrl?: string | undefined;
    } | undefined;
    glm?: {
      apiKey: string;
      baseUrl?: string | undefined;
    } | undefined;
    ollama?: {
      baseUrl: string;
    } | undefined;
    chutes?: {
      apiKey: string;
      baseUrl?: string | undefined;
    } | undefined;
    anthropic?: {
      apiKey: string;
      baseUrl?: string | undefined;
    } | undefined;
    'azure-openai'?: {
      apiKey: string;
      resource: string;
      deployment: string;
      apiVersion?: string | undefined;
      baseUrl?: string | undefined;
    } | undefined;
  };
  server: {
    extensionApiPort: number;
  };
}

/**
 * Configuration validation result
 */
export interface ConfigValidationResult {
  valid: boolean;
  config: AppConfig | undefined;
  errors: string[];
  warnings: string[];
}

// ============================================================================
// Configuration Loading
// ============================================================================

/**
 * Load environment variable with default
 */
function getEnv(name: string, defaultValue?: string): string {
  const value = process.env[name];
  if (value === undefined && defaultValue === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value ?? defaultValue!;
}

/**
 * Check if environment variable is set
 */
function hasEnv(name: string): boolean {
  return process.env[name] !== undefined;
}

/**
 * Load integer environment variable
 */
function getIntEnv(name: string, defaultValue?: number): number {
  const value = process.env[name];
  if (value === undefined) {
    if (defaultValue === undefined) {
      throw new Error(`Missing required environment variable: ${name}`);
    }
    return defaultValue;
  }

  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    throw new Error(`Invalid integer value for ${name}: ${value}`);
  }

  return parsed;
}

/**
 * Load comma-separated array
 */
function getArrayEnv(name: string, defaultValue?: string[]): string[] {
  const value = process.env[name];
  if (value === undefined) {
    if (defaultValue === undefined) {
      throw new Error(`Missing required environment variable: ${name}`);
    }
    return defaultValue;
  }

  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/**
 * Load configuration from environment variables
 */
export function loadConfig(): AppConfig {
  const rawConfig = {
    router: {
      defaultProvider: getEnv('ROUTER_DEFAULT_PROVIDER'),
      defaultModel: getEnv('ROUTER_DEFAULT_MODEL'),
      timeoutMs: getIntEnv('ROUTER_TIMEOUT_MS', 45000),
      logLevel: getEnv('ROUTER_LOG_LEVEL', 'info') as 'debug' | 'info' | 'warn' | 'error',
      globalConcurrencyLimit: getIntEnv('GLOBAL_CONCURRENCY_LIMIT', 20),
      totalRequestBudgetMs: getIntEnv('TOTAL_REQUEST_BUDGET_MS', 60000),
    },
    policy: {
      allowedProviders: getArrayEnv('ALLOWED_PROVIDERS'),
      allowedModels: getArrayEnv('ALLOWED_MODELS'),
      maxInputChars: getIntEnv('MAX_INPUT_CHARS', 120000),
      maxOutputTokens: getIntEnv('MAX_OUTPUT_TOKENS', 4000),
      maxCostUsdPerRequest: hasEnv('MAX_COST_USD_PER_REQUEST')
        ? parseFloat(process.env['MAX_COST_USD_PER_REQUEST']!)
        : undefined,
    },
    resilience: {
      maxAttemptsPerRequest: getIntEnv('MAX_ATTEMPTS_PER_REQUEST', 3),
      retry: {
        baseDelayMs: getIntEnv('RETRY_BASE_DELAY_MS', 1000),
        maxDelayMs: getIntEnv('RETRY_MAX_DELAY_MS', 10000),
        backoffMultiplier: parseFloat(getEnv('RETRY_BACKOFF_MULTIPLIER', '2')),
        jitterFactor: parseFloat(getEnv('RETRY_JITTER_FACTOR', '0.2')),
      },
      circuitBreaker: {
        failureThreshold: getIntEnv('CIRCUIT_BREAKER_FAILURE_THRESHOLD', 5),
        cooldownMs: getIntEnv('CIRCUIT_BREAKER_COOLDOWN_MS', 30000),
        halfOpenSuccessCount: getIntEnv('CIRCUIT_BREAKER_HALF_OPEN_COUNT', 2),
        failureRateWindowMs: getIntEnv('CIRCUIT_BREAKER_FAILURE_WINDOW_MS', 60000),
      },
      providerConcurrency: {} as Record<string, number>,
    },
    providers: {} as AppConfig['providers'],
  };

  // Load provider configurations
  const openaiKey = process.env['OPENAI_API_KEY'];
  if (openaiKey) {
    rawConfig.providers.openai = {
      apiKey: openaiKey,
      baseUrl: process.env['OPENAI_BASE_URL'],
    };
  }

  const glmKey = process.env['GLM_API_KEY'];
  if (glmKey) {
    rawConfig.providers.glm = {
      apiKey: glmKey,
      baseUrl: process.env['GLM_BASE_URL'],
    };
  }

  const ollamaBaseUrl = process.env['OLLAMA_BASE_URL'];
  if (ollamaBaseUrl) {
    rawConfig.providers.ollama = {
      baseUrl: ollamaBaseUrl,
    };
  }

  const chutesKey = process.env['CHUTES_API_KEY'];
  if (chutesKey) {
    rawConfig.providers.chutes = {
      apiKey: chutesKey,
      baseUrl: process.env['CHUTES_BASE_URL'],
    };
  }

  const anthropicKey = process.env['ANTHROPIC_API_KEY'];
  if (anthropicKey) {
    rawConfig.providers.anthropic = {
      apiKey: anthropicKey,
      baseUrl: process.env['ANTHROPIC_BASE_URL'],
    };
  }

  const azureOpenaiKey = process.env['AZURE_OPENAI_API_KEY'];
  const azureOpenaiResource = process.env['AZURE_OPENAI_RESOURCE'];
  const azureOpenaiDeployment = process.env['AZURE_OPENAI_DEPLOYMENT'];
  if (azureOpenaiKey && azureOpenaiResource && azureOpenaiDeployment) {
    rawConfig.providers['azure-openai'] = {
      apiKey: azureOpenaiKey,
      resource: azureOpenaiResource,
      deployment: azureOpenaiDeployment,
      apiVersion: process.env['AZURE_OPENAI_API_VERSION'],
      baseUrl: process.env['AZURE_OPENAI_BASE_URL'],
    };
  }

  // Load per-provider concurrency limits
  for (const provider of rawConfig.policy.allowedProviders) {
    const limitEnv = `MAX_CONCURRENCY_${provider.toUpperCase()}`;
    const limit = process.env[limitEnv];
    if (limit) {
      rawConfig.resilience.providerConcurrency[provider] = parseInt(limit, 10);
    }
  }

  return AppConfigSchema.parse(rawConfig);
}

/**
 * Validate configuration
 */
export function validateConfig(config: unknown): ConfigValidationResult {
  const result: ConfigValidationResult = {
    valid: true,
    config: undefined,
    errors: [],
    warnings: [],
  };

  try {
    result.config = AppConfigSchema.parse(config);
  } catch (error) {
    if (error instanceof z.ZodError) {
      result.valid = false;
      result.errors = error.errors.map((e) => {
        const path = e.path.join('.');
        return `${path}: ${e.message}`;
      });
    } else {
      result.valid = false;
      result.errors = ['Unknown validation error'];
    }
  }

  // Additional validation checks
  if (result.config) {
    // Check that at least one provider is configured
    const providers = Object.keys(result.config.providers);
    if (providers.length === 0) {
      result.errors.push('No providers configured. Set at least one provider API key.');
    }

    // Check that default provider is allowed
    if (!result.config.policy.allowedProviders.includes(result.config.router.defaultProvider)) {
      result.errors.push(
        `Default provider '${result.config.router.defaultProvider}' is not in allowed providers list.`
      );
    }

    // Check that default provider is configured
    if (!providers.includes(result.config.router.defaultProvider)) {
      result.errors.push(
        `Default provider '${result.config.router.defaultProvider}' is not configured (missing API key).`
      );
    }

    // Check concurrency limits
    const providerConcurrency =
      result.config.resilience.providerConcurrency[result.config.router.defaultProvider];
    if (providerConcurrency !== undefined) {
      if (providerConcurrency > result.config.router.globalConcurrencyLimit) {
        result.warnings.push(
          `Per-provider concurrency limit for '${result.config.router.defaultProvider}' (${providerConcurrency}) exceeds global limit (${result.config.router.globalConcurrencyLimit}).`
        );
      }
    }

    result.valid = result.errors.length === 0;
  }

  return result;
}

/**
 * Load and validate configuration
 */
export function loadAndValidateConfig(): AppConfig {
  try {
    const config = loadConfig();
    const validation = validateConfig(config);

    if (!validation.valid) {
      throw createConfigurationError(
        `Configuration validation failed:\n${validation.errors.join('\n')}`
      );
    }

    if (validation.warnings.length > 0) {
      // Log warnings but continue
      for (const warning of validation.warnings) {
        console.error(`[Config Warning] ${warning}`);
      }
    }

    return validation.config!;
  } catch (error) {
    if (isRouterError(error)) {
      throw error;
    }
    throw createConfigurationError(`Failed to load configuration: ${error}`);
  }
}

/**
 * Get secret from environment
 */
export function getSecret(secretName: string): string {
  const value = process.env[secretName];
  if (!value || value.trim().length === 0) {
    throw createMissingSecretError(secretName);
  }
  return value;
}

/**
 * Loaded configuration instance
 * This is loaded lazily on first access
 */
let _loadedConfig: AppConfig | null = null;

/**
 * Get the loaded configuration
 */
export function getConfig(): AppConfig {
  if (!_loadedConfig) {
    _loadedConfig = loadAndValidateConfig();
  }
  return _loadedConfig;
}

/**
 * Initialize configuration explicitly
 */
export function initializeConfig(): AppConfig {
  _loadedConfig = loadAndValidateConfig();
  return _loadedConfig;
}

/**
 * For backward compatibility: AppConfig as a runtime value
 * This will be loaded lazily when first accessed
 */
export const AppConfigRuntime: AppConfig = new Proxy({} as AppConfig, {
  get(_target, prop: keyof AppConfig) {
    return getConfig()[prop];
  },
});

// ============================================================================
// Runtime API Key Updates
// ============================================================================

/**
 * Update a provider's API key at runtime
 * This allows the extension to push API keys to the router without restart
 * 
 * @param provider - Provider name (e.g., 'openai', 'glm')
 * @param apiKey - The API key to set
 * @throws Error if provider is not supported
 */
export function updateProviderApiKey(provider: string, apiKey: string): void {
  if (!apiKey || apiKey.trim().length === 0) {
    throw createConfigurationError(`API key cannot be empty for provider: ${provider}`);
  }

  // Supported providers that can have API keys updated
  const supportedProviders = ['openai', 'glm', 'anthropic', 'chutes', 'azure-openai'];
  
  if (!supportedProviders.includes(provider)) {
    throw createConfigurationError(
      `Unsupported provider for runtime key update: ${provider}. Supported: ${supportedProviders.join(', ')}`
    );
  }

  // Update the environment variable (for new config loads)
  const envVarName = `${provider.toUpperCase()}_API_KEY`;
  process.env[envVarName] = apiKey.trim();

  // If config is already loaded, update it
  if (_loadedConfig) {
    const providerKey = provider as keyof AppConfig['providers'];
    
    // Update or create the provider config
    const currentProviders = _loadedConfig.providers;
    const existingConfig = currentProviders[providerKey];
    
    if (existingConfig && 'apiKey' in existingConfig) {
      // Update existing provider config - use typed approach
      const updated = { ...existingConfig, apiKey: apiKey.trim() };
      (currentProviders[providerKey] as typeof updated) = updated;
    } else {
      // Create new provider config
      const newConfig: { apiKey: string } = {
        apiKey: apiKey.trim(),
      };
      // Use a typed mutable reference to update the providers object
      const mutableProviders = currentProviders as Record<string, { apiKey: string }>;
      mutableProviders[providerKey] = newConfig;
    }

    console.error(`[Config] API key updated for provider: ${provider}`);
  }

  console.error(`[Config] API key stored for provider: ${provider} (env: ${envVarName})`);
}

/**
 * Remove a provider's API key at runtime
 * 
 * @param provider - Provider name
 */
export function removeProviderApiKey(provider: string): void {
  const envVarName = `${provider.toUpperCase()}_API_KEY`;
  
  // Remove from environment
  delete process.env[envVarName];

  // If config is loaded, remove from it
  if (_loadedConfig) {
    const providerKey = provider as keyof AppConfig['providers'];
    // Use a typed mutable reference to remove the provider
    const mutableProviders = _loadedConfig.providers as Record<string, unknown>;
    delete mutableProviders[providerKey];
    
    console.error(`[Config] API key removed for provider: ${provider}`);
  }
}
