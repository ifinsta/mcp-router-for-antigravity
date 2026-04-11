import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  deriveRouterStatusDetail,
  humanizeConnectionError,
  parseHealthResponseBody,
} from '../../../src/infra/connectionManager';

describe('RouterConnectionManager helpers', () => {
  it('parses JSON health payloads', () => {
    const parsed = parseHealthResponseBody('{"version":"1.1.0","providers":[]}');

    assert.strictEqual(parsed.kind, 'json');
    if (parsed.kind === 'json') {
      assert.strictEqual(parsed.payload['version'], '1.1.0');
    }
  });

  it('treats plain text healthy responses as legacy reachability signals', () => {
    const parsed = parseHealthResponseBody('healthy');

    assert.deepStrictEqual(parsed, {
      kind: 'legacy_text',
      message: 'Router is reachable, but the health endpoint returned legacy plain text.',
    });
  });

  it('rephrases raw JSON parse errors for the status UI', () => {
    const message = humanizeConnectionError('Unexpected token h, "healthy" is not valid JSON');

    assert.strictEqual(
      message,
      'Health endpoint returned plain text instead of JSON. Check ifinPlatform.baseUrl or update the router.',
    );
  });

  it('surfaces a dedicated detail when the router is reachable without providers', () => {
    const detail = deriveRouterStatusDetail(
      {
        warnings: ['No providers configured', 'No providers available for discovery'],
      },
      []
    );

    assert.strictEqual(detail, 'Router reachable, but no providers are configured in the router yet.');
  });

  it('falls back to the first router warning for other degraded states', () => {
    const detail = deriveRouterStatusDetail(
      {
        warnings: ['Default provider \'openai\' is not configured'],
      },
      []
    );

    assert.strictEqual(detail, 'Default provider \'openai\' is not configured');
  });
});
