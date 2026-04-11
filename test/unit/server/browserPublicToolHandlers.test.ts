import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BrowserType, getBrowserManager } from '../../../src/browser/browserManager.js';
import { registerBrowserPublicTools } from '../../../src/server/browserPublicToolHandlers.js';

interface MockTool {
  name: string;
  handler: (args: unknown) => Promise<unknown>;
}

class MockMcpServer {
  public registeredTools: MockTool[] = [];

  registerTool(
    name: string,
    _schema: unknown,
    handler: (args: unknown) => Promise<unknown>
  ): void {
    this.registeredTools.push({ name, handler });
  }
}

type BrowserManagerInstance = ReturnType<typeof getBrowserManager>;

describe('browserPublicToolHandlers', () => {
  let mockServer: MockMcpServer;
  let manager: BrowserManagerInstance;
  const restores: Array<() => void> = [];

  beforeEach(() => {
    mockServer = new MockMcpServer();
    registerBrowserPublicTools(mockServer as unknown as Parameters<typeof registerBrowserPublicTools>[0]);
    manager = getBrowserManager();
  });

  afterEach(() => {
    while (restores.length > 0) {
      const restore = restores.pop();
      restore?.();
    }
  });

  function stubMethod<K extends keyof BrowserManagerInstance>(
    key: K,
    implementation: BrowserManagerInstance[K]
  ): void {
    const original = manager[key];
    manager[key] = implementation;
    restores.push(() => {
      manager[key] = original;
    });
  }

  function getHandler(name: string): (args: unknown) => Promise<unknown> {
    const tool = mockServer.registeredTools.find((entry) => entry.name === name);
    assert.ok(tool, `Expected tool '${name}' to be registered`);
    return tool.handler;
  }

  it('registers the full browser.* public tool surface', () => {
    const names = mockServer.registeredTools.map((tool) => tool.name);
    assert.deepEqual(names, [
      'browser.capabilities',
      'browser.session.open',
      'browser.session.close',
      'browser.session.list',
      'browser.navigate',
      'browser.screenshot',
      'browser.evaluate',
      'browser.click',
      'browser.type',
      'browser.fill_form',
      'browser.hover',
      'browser.wait_for',
      'browser.tabs.list',
      'browser.tabs.create',
      'browser.tabs.activate',
      'browser.tabs.close',
      'browser.network.set_conditions',
      'browser.network.reset',
      'browser.metrics',
      'browser.web_vitals',
      'browser.audit.design',
      'browser.profile.start',
      'browser.profile.stop',
    ]);
  });

  it('returns the capability matrix without requiring a session', async () => {
    const handler = getHandler('browser.capabilities');
    const result = await handler({}) as { content: Array<{ text: string }> };
    const payload = JSON.parse(result.content[0]!.text);

    assert.equal(payload.success, true);
    assert.equal(payload.action, 'browser.capabilities');
    assert.equal(payload.data.browsers.length, 4);
  });

  it('returns a structured session-open result with capability data', async () => {
    stubMethod('launchBrowser', async () => 'session-1');
    stubMethod('getSessionTransportInfo', () => ({
      browserType: BrowserType.CHROME,
      extensionId: 'ext-1',
      extensionConnected: true,
      hasCdp: true,
      remoteDebuggingPort: 9222,
      targetId: 'target-1',
    }));
    stubMethod('navigate', async () => ({
      success: true,
      url: 'https://example.com',
      loadTime: 123,
    }));

    const handler = getHandler('browser.session.open');
    const result = await handler({
      browserType: 'chrome',
      headless: true,
      url: 'https://example.com',
    }) as { content: Array<{ text: string }> };
    const payload = JSON.parse(result.content[0]!.text);

    assert.equal(payload.success, true);
    assert.equal(payload.sessionId, 'session-1');
    assert.equal(payload.data.capabilityReport.browser, 'chrome');
    assert.equal(payload.data.navigation.url, 'https://example.com');
  });

  it('returns an unsupported-feature error for Safari navigation-adjacent control gaps', async () => {
    stubMethod('getSessionTransportInfo', () => ({
      browserType: BrowserType.SAFARI,
      extensionConnected: false,
      hasCdp: false,
      remoteDebuggingPort: 0,
    }));

    const handler = getHandler('browser.click');
    const result = await handler({
      sessionId: 'safari-session',
      selector: '#submit',
    }) as { isError?: boolean; content: Array<{ text: string }> };
    const payload = JSON.parse(result.content[0]!.text);

    assert.equal(result.isError, true);
    assert.equal(payload.success, false);
    assert.equal(payload.error.code, 'unsupported_browser_feature');
  });

  it('returns a structured validation-style failure for unknown network presets', async () => {
    const handler = getHandler('browser.network.set_conditions');
    const result = await handler({
      sessionId: 'edge-session',
      preset: 'warp-speed',
    }) as { isError?: boolean; content: Array<{ text: string }> };
    const payload = JSON.parse(result.content[0]!.text);

    assert.equal(result.isError, true);
    assert.equal(payload.success, false);
    assert.equal(payload.error.code, 'browser_action_failed');
    assert.match(payload.error.message, /Unknown network preset/);
  });

  it('lists sessions with transport and capability data', async () => {
    stubMethod('getActiveSessions', () => [
      {
        sessionId: 'edge-session',
        browserType: BrowserType.EDGE,
        config: { type: BrowserType.EDGE, headless: true },
        instance: {} as never,
        pages: new Map(),
        isActive: true,
        createdAt: 1,
        lastActivity: 2,
        extensionId: 'edge-only',
      },
    ]);
    stubMethod('getSessionTransportInfo', () => ({
      browserType: BrowserType.EDGE,
      extensionId: 'edge-only',
      extensionConnected: false,
      hasCdp: true,
      remoteDebuggingPort: 9333,
      targetId: 'edge-target',
    }));

    const handler = getHandler('browser.session.list');
    const result = await handler({ activeOnly: true }) as { content: Array<{ text: string }> };
    const payload = JSON.parse(result.content[0]!.text);

    assert.equal(payload.success, true);
    assert.equal(payload.data.sessions.length, 1);
    assert.equal(payload.data.sessions[0].transport.hasCdp, true);
    assert.equal(payload.data.sessions[0].capabilityReport.browser, 'edge');
  });
});
