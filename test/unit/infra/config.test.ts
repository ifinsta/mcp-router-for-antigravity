import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { loadConfig, validateConfig } from '../../../src/infra/config.js';

const ENV_KEYS = [
  'ROUTER_DEFAULT_PROVIDER',
  'ROUTER_DEFAULT_MODEL',
  'ALLOWED_PROVIDERS',
  'ALLOWED_MODELS',
  'OPENAI_API_KEY',
  'GLM_API_KEY',
  'OLLAMA_BASE_URL',
  'CHUTES_API_KEY',
  'ANTHROPIC_API_KEY',
  'AZURE_OPENAI_API_KEY',
  'AZURE_OPENAI_RESOURCE',
  'AZURE_OPENAI_DEPLOYMENT',
  'ROUTER_MODE',
] as const;

type ManagedEnvKey = (typeof ENV_KEYS)[number];

describe('config degraded startup', () => {
  const originalEnv = new Map<ManagedEnvKey, string | undefined>();

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      originalEnv.set(key, process.env[key]);
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = originalEnv.get(key);
      if (typeof value === 'string') {
        process.env[key] = value;
      } else {
        delete process.env[key];
      }
    }
    originalEnv.clear();
  });

  it('loads a minimal default config when provider env is absent', () => {
    const config = loadConfig();

    assert.ok(config.mode.mode === 'agent' || config.mode.mode === 'router');
    assert.equal(config.router.defaultProvider, 'openai');
    assert.equal(config.router.defaultModel, 'gpt-4o');
    assert.deepEqual(config.policy.allowedProviders, ['openai']);
    assert.deepEqual(config.policy.allowedModels, []);
    assert.deepEqual(config.providers, {});
  });

  it('treats missing providers as warnings instead of fatal validation errors', () => {
    const config = loadConfig();
    const validation = validateConfig(config);

    assert.equal(validation.valid, true);
    assert.equal(validation.errors.length, 0);
    assert.ok(validation.warnings.includes('No providers configured. Set at least one provider API key.'));
    assert.ok(
      validation.warnings.includes(
        "Default provider 'openai' is not configured (missing API key)."
      )
    );
  });
});
