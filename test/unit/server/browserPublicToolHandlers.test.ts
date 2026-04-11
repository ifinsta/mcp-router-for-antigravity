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
      'browser.scroll',
      'browser.wait_for',
      'browser.console',
      'browser.tabs.list',
      'browser.tabs.create',
      'browser.tabs.activate',
      'browser.tabs.close',
      'browser.tabs.list_all',
      'browser.tabs.switch',
      'browser.network.set_conditions',
      'browser.network.reset',
      'browser.metrics',
      'browser.web_vitals',
      'browser.audit.design',
      'browser.profile.start',
      'browser.profile.stop',
      'browser.evidence.capture',
      'browser.evidence.explain',
      'browser.assertions.evaluate',
      'browser.verification.run',
      'browser.evidence.analyze_flake',
      'browser.evidence.root_cause',
      'browser.recorder.start',
      'browser.recorder.stop',
      'browser.recorder.export',
      'browser.pr_summary.generate',
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

  it('fails closed for Chrome session open when extension augmentation is unavailable by default', async () => {
    let closedSessionId: string | null = null;

    stubMethod('launchBrowser', async () => 'session-cdp-only');
    stubMethod('getSessionTransportInfo', () => ({
      browserType: BrowserType.CHROME,
      extensionId: 'cdp-only',
      extensionConnected: false,
      hasCdp: true,
      remoteDebuggingPort: 9222,
      targetId: 'target-cdp',
    }));
    stubMethod('closeSession', async (sessionId: string) => {
      closedSessionId = sessionId;
    });

    const handler = getHandler('browser.session.open');
    const result = await handler({
      browserType: 'chrome',
      headless: true,
    }) as { isError?: boolean; content: Array<{ text: string }> };
    const payload = JSON.parse(result.content[0]!.text);

    assert.equal(result.isError, true);
    assert.equal(payload.success, false);
    assert.equal(payload.error.code, 'transport_unavailable');
    assert.match(payload.error.message, /requires the browser extension/i);
    assert.equal(closedSessionId, 'session-cdp-only');
  });

  it('allows degraded Chrome session open when requireExtension is false', async () => {
    stubMethod('launchBrowser', async () => 'session-cdp-only');
    stubMethod('getSessionTransportInfo', () => ({
      browserType: BrowserType.CHROME,
      extensionId: 'cdp-only',
      extensionConnected: false,
      hasCdp: true,
      remoteDebuggingPort: 9222,
      targetId: 'target-cdp',
    }));

    const handler = getHandler('browser.session.open');
    const result = await handler({
      browserType: 'chrome',
      headless: true,
      requireExtension: false,
    }) as { content: Array<{ text: string }> };
    const payload = JSON.parse(result.content[0]!.text);

    assert.equal(payload.success, true);
    assert.equal(payload.warnings[0].code, 'extension_unavailable');
    assert.equal(payload.data.transport.extensionConnected, false);
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

  it('returns scroll results for a core-control session', async () => {
    stubMethod('getSessionTransportInfo', () => ({
      browserType: BrowserType.CHROME,
      extensionId: 'ext-1',
      extensionConnected: true,
      hasCdp: true,
      remoteDebuggingPort: 9222,
      targetId: 'target-1',
    }));
    stubMethod('scroll', async () => ({
      direction: 'down',
      amount: 600,
      scrolled: true,
      beforeY: 0,
      afterY: 600,
    }));

    const handler = getHandler('browser.scroll');
    const result = await handler({
      sessionId: 'chrome-session',
      direction: 'down',
      amount: 600,
      behavior: 'smooth',
      block: 'center',
    }) as { content: Array<{ text: string }> };
    const payload = JSON.parse(result.content[0]!.text);

    assert.equal(payload.success, true);
    assert.equal(payload.action, 'browser.scroll');
    assert.equal(payload.data.afterY, 600);
  });

  it('returns console entries for an extension-backed Chrome session', async () => {
    stubMethod('getSessionTransportInfo', () => ({
      browserType: BrowserType.CHROME,
      extensionId: 'ext-1',
      extensionConnected: true,
      hasCdp: true,
      remoteDebuggingPort: 9222,
      targetId: 'target-1',
    }));
    stubMethod('getConsoleLogs', async () => ({
      entries: [
        { level: 'warning', message: 'console warning', timestamp: '2026-04-11T10:00:00.000Z' },
      ],
    }));

    const handler = getHandler('browser.console');
    const result = await handler({
      sessionId: 'chrome-session',
    }) as { content: Array<{ text: string }> };
    const payload = JSON.parse(result.content[0]!.text);

    assert.equal(payload.success, true);
    assert.equal(payload.action, 'browser.console');
    assert.equal(payload.data.entries.length, 1);
    assert.equal(payload.data.entries[0].level, 'warning');
  });

  it('returns console entries for a CDP-capable Edge session', async () => {
    stubMethod('getSessionTransportInfo', () => ({
      browserType: BrowserType.EDGE,
      extensionConnected: false,
      hasCdp: true,
      remoteDebuggingPort: 9333,
      targetId: 'edge-target',
    }));
    stubMethod('getConsoleLogs', async () => ({
      entries: [
        { level: 'error', message: 'edge console error', timestamp: '2026-04-11T10:05:00.000Z' },
      ],
    }));

    const handler = getHandler('browser.console');
    const result = await handler({
      sessionId: 'edge-session',
    }) as { content: Array<{ text: string }> };
    const payload = JSON.parse(result.content[0]!.text);

    assert.equal(payload.success, true);
    assert.equal(payload.data.entries.length, 1);
    assert.equal(payload.data.entries[0].level, 'error');
  });

  it('fails browser.console when no console transport is available', async () => {
    stubMethod('getSessionTransportInfo', () => ({
      browserType: BrowserType.SAFARI,
      extensionConnected: false,
      hasCdp: false,
      remoteDebuggingPort: 0,
    }));

    const handler = getHandler('browser.console');
    const result = await handler({
      sessionId: 'safari-session',
    }) as { isError?: boolean; content: Array<{ text: string }> };
    const payload = JSON.parse(result.content[0]!.text);

    assert.equal(result.isError, true);
    assert.equal(payload.success, false);
    assert.equal(payload.error.code, 'transport_unavailable');
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
