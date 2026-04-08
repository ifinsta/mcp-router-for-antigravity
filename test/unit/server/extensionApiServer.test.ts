/**
 * Unit tests for Extension API Server
 *
 * Tests healthyOnly filtering and localhost guard functionality
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import type { Socket } from 'net';
import { createExtensionAPIServer } from '../../../src/server/extensionApiServer.js';
import { getProviderRegistry } from '../../../src/core/registry.js';
import type { ProviderAdapter, ModelInfo, ProviderHealthStatus } from '../../../src/core/types.js';

// Test port - use a random high port to avoid conflicts
const TEST_PORT = 0; // Let OS assign an available port

/**
 * Mock provider adapter for testing
 */
class MockProviderAdapter implements ProviderAdapter {
  name: string;
  capabilities = {
    chat: true,
    streaming: true,
    functionCalling: false,
    vision: false,
  };
  healthy: boolean;

  constructor(name: string, healthy: boolean) {
    this.name = name;
    this.healthy = healthy;
  }

  async chat(): Promise<{
    provider: string;
    model: string;
    outputText: string;
    finishReason: string;
  }> {
    return {
      provider: this.name,
      model: 'mock-model',
      outputText: 'Mock response',
      finishReason: 'stop',
    };
  }

  async *chatStream(): AsyncIterable<string> {
    yield 'Mock';
    yield ' response';
  }

  async listModels(): Promise<ModelInfo[]> {
    return [
      {
        id: `${this.name}-model-1`,
        name: `${this.name} Model 1`,
        provider: this.name,
        capabilities: this.capabilities,
        maxContextTokens: 4096,
      },
    ];
  }

  async healthCheck(): Promise<ProviderHealthStatus> {
    return {
      status: this.healthy ? 'healthy' : 'unhealthy',
      latencyMs: 100,
      timestamp: Date.now(),
    };
  }
}

describe('Extension API Server', () => {
  let server: http.Server;
  let serverAddress: string;
  let serverPort: number;
  const connections: Set<Socket> = new Set();

  beforeEach(async () => {
    // Clear provider registry
    const registry = getProviderRegistry();
    // Reset by accessing private field - this is test-only
    (registry as any).providers = new Map();
    (registry as any).initialized = false;

    // Register test providers
    registry.register(new MockProviderAdapter('healthy-provider', true));
    registry.register(new MockProviderAdapter('unhealthy-provider', false));
    registry.markInitialized();

    // Create and start server
    server = createExtensionAPIServer(TEST_PORT);

    // Track connections for cleanup
    server.on('connection', (conn: Socket) => {
      connections.add(conn);
      conn.on('close', () => connections.delete(conn));
    });

    await new Promise<void>((resolve, reject) => {
      server.listen(TEST_PORT, () => {
        const address = server.address();
        if (address && typeof address === 'object') {
          serverPort = address.port;
          serverAddress = `http://localhost:${serverPort}`;
          resolve();
        } else {
          reject(new Error('Failed to get server address'));
        }
      });
      server.on('error', reject);
    });
  });

  afterEach(async () => {
    // Destroy all connections first
    for (const conn of connections) {
      conn.destroy();
    }
    connections.clear();

    if (server) {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  });

  describe('GET /api/extension/models', () => {
    it('should return all models when healthyOnly is not specified', async () => {
      const response = await fetch(`${serverAddress}/api/extension/models`);

      assert.strictEqual(response.status, 200);
      const data = (await response.json()) as { models: Array<{ healthy: boolean; provider: string }> };
      assert.ok(data.models);
      assert.strictEqual(data.models.length, 2);

      // Should include both healthy and unhealthy models
      const healthyModel = data.models.find((m) => m.provider === 'healthy-provider');
      const unhealthyModel = data.models.find((m) => m.provider === 'unhealthy-provider');

      assert.ok(healthyModel);
      assert.ok(unhealthyModel);
      assert.strictEqual(healthyModel.healthy, true);
      assert.strictEqual(unhealthyModel.healthy, false);
    });

    it('should return only healthy models when healthyOnly=true', async () => {
      const response = await fetch(`${serverAddress}/api/extension/models?healthyOnly=true`);

      assert.strictEqual(response.status, 200);
      const data = (await response.json()) as { models: Array<{ healthy: boolean; provider: string }> };
      assert.ok(data.models);
      assert.strictEqual(data.models.length, 1);
      assert.strictEqual(data.models[0].provider, 'healthy-provider');
      assert.strictEqual(data.models[0].healthy, true);
    });

    it('should return all models when healthyOnly=false', async () => {
      const response = await fetch(`${serverAddress}/api/extension/models?healthyOnly=false`);

      assert.strictEqual(response.status, 200);
      const data = (await response.json()) as { models: Array<{ healthy: boolean }> };
      assert.ok(data.models);
      assert.strictEqual(data.models.length, 2);
    });

    it('should return all models when healthyOnly has invalid value', async () => {
      const response = await fetch(`${serverAddress}/api/extension/models?healthyOnly=invalid`);

      assert.strictEqual(response.status, 200);
      const data = (await response.json()) as { models: Array<{ healthy: boolean }> };
      assert.ok(data.models);
      assert.strictEqual(data.models.length, 2);
    });
  });

  describe('POST /api/extension/keys - localhost guard', () => {
    it('should accept requests from 127.0.0.1', async () => {
      // Local server requests inherently come from localhost
      const response = await fetch(`${serverAddress}/api/extension/keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'openai',
          apiKey: 'test-api-key',
        }),
      });

      // Should not be 403 Forbidden
      assert.notStrictEqual(response.status, 403);
    });

    it('should reject requests with missing provider or apiKey', async () => {
      const response = await fetch(`${serverAddress}/api/extension/keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'openai',
          // Missing apiKey
        }),
      });

      assert.strictEqual(response.status, 400);
      const data = (await response.json()) as { error: string; message: string };
      assert.strictEqual(data.error, 'Bad request');
      assert.ok(data.message.includes('Missing required fields'));
    });
  });

  describe('CORS headers', () => {
    it('should include CORS headers in responses', async () => {
      const response = await fetch(`${serverAddress}/api/extension/models`);

      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.headers.get('access-control-allow-origin'), '*');
      assert.strictEqual(response.headers.get('access-control-allow-methods'), 'GET, POST, OPTIONS');
    });

    it('should handle OPTIONS preflight requests', async () => {
      const response = await fetch(`${serverAddress}/api/extension/models`, {
        method: 'OPTIONS',
      });

      assert.strictEqual(response.status, 204);
    });
  });

  describe('404 handling', () => {
    it('should return 404 for unknown routes', async () => {
      const response = await fetch(`${serverAddress}/api/extension/unknown`);

      assert.strictEqual(response.status, 404);
      const data = (await response.json()) as { error: string };
      assert.strictEqual(data.error, 'Not found');
    });
  });
});
