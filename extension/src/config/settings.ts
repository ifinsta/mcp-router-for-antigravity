import * as vscode from 'vscode';
import { CONFIGURATION_SECTION, LEGACY_CONFIGURATION_SECTION } from '../infra/identifiers';

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

export interface ModeModelSettings {
  code: string | null;
  plan: string | null;
  debug: string | null;
  orchestrator: string | null;
  ask: string | null;
}

export interface ModelSettings {
  defaultModel: string | null;
  smallModel: string | null;
  byMode: ModeModelSettings;
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
  routerPath: string | null;
  models: ModelSettings;
  providers: ProvidersConfig;
}

function isExplicitlyConfigured<T>(
  config: vscode.WorkspaceConfiguration,
  key: string,
): boolean {
  const inspected = config.inspect<T>(key);

  return (
    inspected?.workspaceFolderValue !== undefined ||
    inspected?.workspaceValue !== undefined ||
    inspected?.globalValue !== undefined
  );
}

function getConfigValue<T>(
  config: vscode.WorkspaceConfiguration,
  key: string,
  defaultValue: T,
): T {
  return config.get<T>(key, defaultValue);
}

function normalizeOptionalPath(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readNullableSetting(
  config: vscode.WorkspaceConfiguration,
  legacyConfig: vscode.WorkspaceConfiguration,
  key: string,
): string | null {
  return normalizeOptionalPath(
    getConfigValueWithLegacyFallback<string>(config, legacyConfig, key, ''),
  );
}

function getConfigValueWithLegacyFallback<T>(
  config: vscode.WorkspaceConfiguration,
  legacyConfig: vscode.WorkspaceConfiguration,
  key: string,
  defaultValue: T,
): T {
  if (isExplicitlyConfigured<T>(config, key)) {
    return getConfigValue(config, key, defaultValue);
  }

  if (isExplicitlyConfigured<T>(legacyConfig, key)) {
    return getConfigValue(legacyConfig, key, defaultValue);
  }

  return getConfigValue(config, key, defaultValue);
}

/**
 * Read a single provider's settings from VS Code configuration
 */
function readProviderSettings(
  config: vscode.WorkspaceConfiguration,
  legacyConfig: vscode.WorkspaceConfiguration,
  provider: string,
  defaults: ProviderSettings,
): ProviderSettings {
  return {
    enabled: getConfigValueWithLegacyFallback<boolean>(
      config,
      legacyConfig,
      `providers.${provider}.enabled`,
      defaults.enabled,
    ),
    apiKey: getConfigValueWithLegacyFallback<string>(
      config,
      legacyConfig,
      `providers.${provider}.apiKey`,
      defaults.apiKey,
    ),
    baseUrl: getConfigValueWithLegacyFallback<string>(
      config,
      legacyConfig,
      `providers.${provider}.baseUrl`,
      defaults.baseUrl,
    ),
    defaultModel: getConfigValueWithLegacyFallback<string>(
      config,
      legacyConfig,
      `providers.${provider}.defaultModel`,
      defaults.defaultModel,
    ),
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
 * All settings are accessible in VS Code via @ext:ifinsta.ifin-platform-integrations
 */
export function getExtensionConfig(): ExtensionConfig {
  const config = vscode.workspace.getConfiguration(CONFIGURATION_SECTION);
  const legacyConfig = vscode.workspace.getConfiguration(LEGACY_CONFIGURATION_SECTION);

  return {
    baseUrl: getConfigValueWithLegacyFallback<string>(config, legacyConfig, 'baseUrl', 'http://localhost:3000'),
    timeout: getConfigValueWithLegacyFallback<number>(config, legacyConfig, 'timeout', 30000),
    showOnlyHealthyModels: getConfigValueWithLegacyFallback<boolean>(
      config,
      legacyConfig,
      'showOnlyHealthyModels',
      true,
    ),
    autoRefreshCatalog: getConfigValueWithLegacyFallback<boolean>(
      config,
      legacyConfig,
      'autoRefreshCatalog',
      true,
    ),
    logLevel: getConfigValueWithLegacyFallback<string>(config, legacyConfig, 'logLevel', 'info'),
    routerPath: readNullableSetting(config, legacyConfig, 'routerPath'),
    models: {
      defaultModel: readNullableSetting(config, legacyConfig, 'models.defaultModel'),
      smallModel: readNullableSetting(config, legacyConfig, 'models.smallModel'),
      byMode: {
        code: readNullableSetting(config, legacyConfig, 'models.byMode.code'),
        plan: readNullableSetting(config, legacyConfig, 'models.byMode.plan'),
        debug: readNullableSetting(config, legacyConfig, 'models.byMode.debug'),
        orchestrator: readNullableSetting(config, legacyConfig, 'models.byMode.orchestrator'),
        ask: readNullableSetting(config, legacyConfig, 'models.byMode.ask'),
      },
    },
    providers: {
      glm: readProviderSettings(config, legacyConfig, 'glm', PROVIDER_DEFAULTS['glm'] as ProviderSettings),
      openai: readProviderSettings(config, legacyConfig, 'openai', PROVIDER_DEFAULTS['openai'] as ProviderSettings),
      anthropic: readProviderSettings(config, legacyConfig, 'anthropic', PROVIDER_DEFAULTS['anthropic'] as ProviderSettings),
      chutes: readProviderSettings(config, legacyConfig, 'chutes', PROVIDER_DEFAULTS['chutes'] as ProviderSettings),
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

  if (config.routerPath !== null && config.routerPath.length === 0) {
    errors.push('Router path cannot be empty when configured');
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
