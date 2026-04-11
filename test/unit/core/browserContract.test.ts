import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BrowserType } from '../../../src/browser/browserManager.js';
import {
  browserSupportsFeature,
  getAllBrowserCapabilityReports,
  getBrowserCapabilityReport,
  browserSupportsCapability,
  getBrowserCapabilities,
  getSupportedBrowsers,
  BROWSER_CAPABILITY_MATRIX,
} from '../../../src/core/browserContract.js';

describe('browserContract', () => {
  it('returns capability reports for all supported browsers', () => {
    const reports = getAllBrowserCapabilityReports();

    assert.equal(reports.length, 4);
    assert.deepEqual(
      reports.map((report) => report.browser),
      [BrowserType.CHROME, BrowserType.EDGE, BrowserType.FIREFOX, BrowserType.SAFARI]
    );
  });

  it('marks Chrome as extension-augmented when the extension is connected', () => {
    const report = getBrowserCapabilityReport(BrowserType.CHROME, {
      hasCdp: true,
      extensionConnected: true,
    });

    assert.equal(report.capabilities.extension_augmented, true);
    assert.equal(report.capabilities.core_control, true);
    assert.equal(report.capabilities.tab_management, true);
  });

  it('marks Safari as limited in the capability matrix', () => {
    const report = getBrowserCapabilityReport(BrowserType.SAFARI);

    assert.equal(report.capabilities.core_control, false);
    assert.equal(report.capabilities.profiling, false);
  });

  it('reports unsupported features accurately for Firefox', () => {
    assert.equal(browserSupportsFeature(BrowserType.FIREFOX, 'core_control'), true);
    assert.equal(browserSupportsFeature(BrowserType.FIREFOX, 'network_control'), false);
    assert.equal(browserSupportsFeature(BrowserType.FIREFOX, 'profiling'), false);
  });
});

describe('BROWSER_CAPABILITY_MATRIX', () => {
  it('contains all supported browsers', () => {
    const browsers = BROWSER_CAPABILITY_MATRIX.map(e => e.browser);
    assert.deepEqual(browsers, ['chrome', 'edge', 'firefox', 'safari']);
  });

  it('Chrome has full support level', () => {
    const chrome = BROWSER_CAPABILITY_MATRIX.find(e => e.browser === 'chrome');
    assert.equal(chrome?.supportLevel, 'full');
    assert.equal(chrome?.displayName, 'Google Chrome');
  });

  it('Edge has full support level', () => {
    const edge = BROWSER_CAPABILITY_MATRIX.find(e => e.browser === 'edge');
    assert.equal(edge?.supportLevel, 'full');
    assert.equal(edge?.displayName, 'Microsoft Edge');
  });

  it('Firefox has core support level', () => {
    const firefox = BROWSER_CAPABILITY_MATRIX.find(e => e.browser === 'firefox');
    assert.equal(firefox?.supportLevel, 'core');
    assert.equal(firefox?.displayName, 'Mozilla Firefox');
  });

  it('Safari has limited support level', () => {
    const safari = BROWSER_CAPABILITY_MATRIX.find(e => e.browser === 'safari');
    assert.equal(safari?.supportLevel, 'limited');
    assert.equal(safari?.displayName, 'Apple Safari');
  });
});

describe('browserSupportsCapability', () => {
  it('Chrome supports all capabilities', () => {
    assert.equal(browserSupportsCapability('chrome', 'navigate'), true);
    assert.equal(browserSupportsCapability('chrome', 'click'), true);
    assert.equal(browserSupportsCapability('chrome', 'fill'), true);
    assert.equal(browserSupportsCapability('chrome', 'screenshot'), true);
    assert.equal(browserSupportsCapability('chrome', 'pdf'), true);
    assert.equal(browserSupportsCapability('chrome', 'cdp-access'), true);
    assert.equal(browserSupportsCapability('chrome', 'device-emulation'), true);
    assert.equal(browserSupportsCapability('chrome', 'network-throttling'), true);
    assert.equal(browserSupportsCapability('chrome', 'multi-tab'), true);
    assert.equal(browserSupportsCapability('chrome', 'cookie-management'), true);
    assert.equal(browserSupportsCapability('chrome', 'console-capture'), true);
    assert.equal(browserSupportsCapability('chrome', 'network-capture'), true);
    assert.equal(browserSupportsCapability('chrome', 'performance-metrics'), true);
  });

  it('Edge supports all capabilities like Chrome', () => {
    assert.equal(browserSupportsCapability('edge', 'navigate'), true);
    assert.equal(browserSupportsCapability('edge', 'click'), true);
    assert.equal(browserSupportsCapability('edge', 'screenshot'), true);
    assert.equal(browserSupportsCapability('edge', 'cdp-access'), true);
    assert.equal(browserSupportsCapability('edge', 'device-emulation'), true);
    assert.equal(browserSupportsCapability('edge', 'multi-tab'), true);
  });

  it('Firefox has limited support - core capabilities only', () => {
    // Core capabilities
    assert.equal(browserSupportsCapability('firefox', 'navigate'), true);
    assert.equal(browserSupportsCapability('firefox', 'click'), true);
    assert.equal(browserSupportsCapability('firefox', 'fill'), true);
    assert.equal(browserSupportsCapability('firefox', 'select'), true);
    assert.equal(browserSupportsCapability('firefox', 'screenshot'), true);
    assert.equal(browserSupportsCapability('firefox', 'dom-query'), true);
    assert.equal(browserSupportsCapability('firefox', 'multi-tab'), true);
    assert.equal(browserSupportsCapability('firefox', 'cookie-management'), true);
    assert.equal(browserSupportsCapability('firefox', 'wait-conditions'), true);
    assert.equal(browserSupportsCapability('firefox', 'dialog-handling'), true);

    // Not supported
    assert.equal(browserSupportsCapability('firefox', 'cdp-access'), false);
    assert.equal(browserSupportsCapability('firefox', 'device-emulation'), false);
    assert.equal(browserSupportsCapability('firefox', 'network-throttling'), false);
    assert.equal(browserSupportsCapability('firefox', 'a11y-snapshot'), false);
    assert.equal(browserSupportsCapability('firefox', 'console-capture'), false);
    assert.equal(browserSupportsCapability('firefox', 'network-capture'), false);
    assert.equal(browserSupportsCapability('firefox', 'performance-metrics'), false);
    assert.equal(browserSupportsCapability('firefox', 'pdf'), false);
  });

  it('Safari has most limited support', () => {
    // Limited capabilities
    assert.equal(browserSupportsCapability('safari', 'navigate'), true);
    assert.equal(browserSupportsCapability('safari', 'click'), true);
    assert.equal(browserSupportsCapability('safari', 'fill'), true);
    assert.equal(browserSupportsCapability('safari', 'select'), true);
    assert.equal(browserSupportsCapability('safari', 'screenshot'), true);
    assert.equal(browserSupportsCapability('safari', 'dom-query'), true);
    assert.equal(browserSupportsCapability('safari', 'wait-conditions'), true);

    // Not supported
    assert.equal(browserSupportsCapability('safari', 'multi-tab'), false);
    assert.equal(browserSupportsCapability('safari', 'cookie-management'), false);
    assert.equal(browserSupportsCapability('safari', 'cdp-access'), false);
    assert.equal(browserSupportsCapability('safari', 'device-emulation'), false);
    assert.equal(browserSupportsCapability('safari', 'console-capture'), false);
    assert.equal(browserSupportsCapability('safari', 'network-capture'), false);
    assert.equal(browserSupportsCapability('safari', 'performance-metrics'), false);
    assert.equal(browserSupportsCapability('safari', 'a11y-snapshot'), false);
    assert.equal(browserSupportsCapability('safari', 'pdf'), false);
  });

  it('returns false for unknown browser', () => {
    assert.equal(browserSupportsCapability('unknown' as 'chrome', 'navigate'), false);
    assert.equal(browserSupportsCapability('opera' as 'chrome', 'click'), false);
  });

  it('returns false for unknown capability', () => {
    assert.equal(browserSupportsCapability('chrome', 'unknown-capability'), false);
    assert.equal(browserSupportsCapability('firefox', 'time-travel'), false);
  });
});

describe('getBrowserCapabilities', () => {
  it('returns correct capability entry for Chrome', () => {
    const caps = getBrowserCapabilities('chrome');
    assert.ok(caps);
    assert.equal(caps?.browser, 'chrome');
    assert.equal(caps?.supportLevel, 'full');
    assert.ok(caps?.capabilities.includes('navigate'));
    assert.ok(caps?.capabilities.includes('cdp-access'));
    assert.equal(caps?.limitations.length, 0);
  });

  it('returns correct capability entry for Firefox', () => {
    const caps = getBrowserCapabilities('firefox');
    assert.ok(caps);
    assert.equal(caps?.browser, 'firefox');
    assert.equal(caps?.supportLevel, 'core');
    assert.ok(caps?.capabilities.includes('navigate'));
    assert.ok(!caps?.capabilities.includes('cdp-access'));
    assert.ok(caps!.limitations.length > 0);
  });

  it('returns correct capability entry for Safari', () => {
    const caps = getBrowserCapabilities('safari');
    assert.ok(caps);
    assert.equal(caps?.browser, 'safari');
    assert.equal(caps?.supportLevel, 'limited');
    assert.ok(caps!.limitations.length > 0);
  });

  it('returns undefined for unknown browser', () => {
    const caps = getBrowserCapabilities('unknown' as 'chrome');
    assert.equal(caps, undefined);
  });
});

describe('getSupportedBrowsers', () => {
  it('returns all supported browser identifiers', () => {
    const browsers = getSupportedBrowsers();
    assert.deepEqual(browsers, ['chrome', 'edge', 'firefox', 'safari']);
  });

  it('returns readonly array', () => {
    const browsers = getSupportedBrowsers();
    assert.ok(Array.isArray(browsers));
    assert.equal(browsers.length, 4);
  });
});
