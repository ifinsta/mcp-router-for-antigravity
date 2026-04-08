import * as vscode from 'vscode';

/**
 * Per-provider configuration from VS Code settings
 */
export interface ProviderSettings {
  enabled: boolean;
  apiKey: string;
  baseUrl: string;
  defaultModel: string;
}

/**
 * All provider settings keyed by provider id
 */
export interface ProvidersConfig {
  glm: ProviderSettings;
  openai: ProviderSettings;
  anthropic: ProviderSettings;
  chutes: ProviderSettings;
}

/**
 * Extension configuration settings
 */
export interface ExtensionConfig {
  baseUrl: string;
  timeout: number;
  showOnlyHealthyModels: boolean;
  autoRefreshCatalog: boolean;
  logLevel: string;
  providers: ProvidersConfig;
}

const CONFIGURATION_SECTION = 'mcpRouter';

/**
 * Read a single provider's settings from VS Code configuration
 */
function readProviderSettings(
  config: vscode.WorkspaceConfiguration,
  provider: string,
  defaults: ProviderSettings,
): ProviderSettings {
  return {
    enabled: config.get<boolean>(`providers.${provider}.enabled`, defaults.enabled),
    apiKey: config.get<string>(`providers.${provider}.apiKey`, defaults.apiKey),
    baseUrl: config.get<string>(`providers.${provider}.baseUrl`, defaults.baseUrl),
    defaultModel: config.get<string>(`providers.${provider}.defaultModel`, defaults.defaultModel),
  };
}

/** Default provider settings */
const PROVIDER_DEFAULTS: Record<string, ProviderSettings> = {
  glm: {
    enabled: true,
    apiKey: '',
    baseUrl: 'https://api.z.ai/api/paas/v4',
    defaultModel: 'GLM-4.7',
  },
  openai: {
    enabled: true,
    apiKey: '',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
  },
  anthropic: {
    enabled: false,
    apiKey: '',
    baseUrl: 'https://api.anthropic.com',
    defaultModel: 'claude-sonnet-4-20250514',
  },
  chutes: {
    enabled: true,
    apiKey: '',
    baseUrl: 'https://llm.chutes.ai/v1',
    defaultModel: 'Qwen/Qwen2.5-72B-Instruct',
  },
};

/**
 * Get the current extension configuration from VS Code settings.
 * All settings are accessible in VS Code via @ext:ifinsta.antigravity-custom-models
 */
export function getExtensionConfig(): ExtensionConfig {
  const config = vscode.workspace.getConfiguration(CONFIGURATION_SECTION);

  return {
    baseUrl: config.get<string>('baseUrl', 'http://localhost:3000'),
    timeout: config.get<number>('timeout', 30000),
    showOnlyHealthyModels: config.get<boolean>('showOnlyHealthyModels', true),
    autoRefreshCatalog: config.get<boolean>('autoRefreshCatalog', true),
    logLevel: config.get<string>('logLevel', 'info'),
    providers: {
      glm: readProviderSettings(config, 'glm', PROVIDER_DEFAULTS['glm'] as ProviderSettings),
      openai: readProviderSettings(config, 'openai', PROVIDER_DEFAULTS['openai'] as ProviderSettings),
      anthropic: readProviderSettings(config, 'anthropic', PROVIDER_DEFAULTS['anthropic'] as ProviderSettings),
      chutes: readProviderSettings(config, 'chutes', PROVIDER_DEFAULTS['chutes'] as ProviderSettings),
    },
  };
}

/**
 * Get provider settings for a specific provider by id
 */
export function getProviderConfig(providerId: string): ProviderSettings | undefined {
  const config = getExtensionConfig();
  if (providerId === 'glm') return config.providers.glm;
  if (providerId === 'openai') return config.providers.openai;
  if (providerId === 'anthropic') return config.providers.anthropic;
  if (providerId === 'chutes') return config.providers.chutes;
  return undefined;
}

/**
 * Check whether a provider has an API key configured (via settings or secret storage)
 */
export function hasApiKeyInSettings(providerId: string): boolean {
  const providerConfig = getProviderConfig(providerId);
  return providerConfig !== undefined && providerConfig.apiKey.length > 0;
}

/**
 * Validate configuration values
 */
export function validateConfig(config: ExtensionConfig): string[] {
  const errors: string[] = [];

  // Validate baseUrl
  try {
    new URL(config.baseUrl);
  } catch {
    errors.push(`Invalid base URL: ${config.baseUrl}. Must be a valid URL.`);
  }

  // Validate timeout
  if (config.timeout < 1000) {
    errors.push('Timeout must be at least 1000ms (1 second)');
  }

  if (config.timeout > 300000) {
    errors.push('Timeout cannot exceed 300000ms (5 minutes)');
  }

  // Validate provider base URLs
  for (const [name, provider] of Object.entries(config.providers)) {
    if (provider.enabled && provider.baseUrl) {
      try {
        new URL(provider.baseUrl);
      } catch {
        errors.push(`Invalid base URL for ${name}: ${provider.baseUrl}`);
      }
    }
  }

  return errors;
}
