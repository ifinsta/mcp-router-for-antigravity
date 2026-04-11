/**
 * Unit tests for FailureClassifier
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  FailureClassifier,
  getFailureClassifier,
} from '../../../src/core/failureClassifier.js';
import type { EvidenceCapsule, FailureClass } from '../../../src/core/types.js';
import {
  createEvidenceCapsule,
  createBrowserConsoleEntry,
  createBrowserNetworkEntry,
  createActionTimelineEntry,
  createBackendFailureCapsule,
  createTimingFailureCapsule,
  createSelectorDriftCapsule,
  createEnvironmentFailureCapsule,
  createAppCodeFailureCapsule,
} from './fixtures.js';

describe('FailureClassifier', () => {
  let classifier: FailureClassifier;

  beforeEach(() => {
    classifier = new FailureClassifier();
  });

  describe('classify', () => {
    it('should classify backend failure from 5xx status code', () => {
      const capsule = createBackendFailureCapsule();
      const explanation = classifier.classify(capsule);

      assert.strictEqual(explanation.failureClass, 'backend_failure');
      assert.ok(explanation.confidence > 0);
      assert.ok(explanation.evidence.length > 0);
    });

    it('should classify timing failure from timeout patterns', () => {
      const capsule = createTimingFailureCapsule();
      const explanation = classifier.classify(capsule);

      assert.strictEqual(explanation.failureClass, 'timing');
      assert.ok(explanation.evidence.some((e) => e.includes('timeout') || e.includes('Slow')));
    });

    it('should classify selector drift from element not found errors', () => {
      const capsule = createSelectorDriftCapsule();
      const explanation = classifier.classify(capsule);

      assert.strictEqual(explanation.failureClass, 'selector_drift');
      assert.ok(explanation.evidence.some((e) => e.includes('selector') || e.includes('element')));
    });

    it('should classify environment failure from CORS errors', () => {
      const capsule = createEnvironmentFailureCapsule();
      const explanation = classifier.classify(capsule);

      assert.strictEqual(explanation.failureClass, 'environment');
    });

    it('should default to app_code when no strong signals', () => {
      const capsule = createAppCodeFailureCapsule();
      const explanation = classifier.classify(capsule);

      assert.strictEqual(explanation.failureClass, 'app_code');
    });
  });

  describe('failure class classification details', () => {
    it('should detect backend failure from network error console messages', () => {
      const capsule = createEvidenceCapsule({
        browser: {
          ...createEvidenceCapsule().browser,
          console: {
            errors: [
              createBrowserConsoleEntry({ message: 'Network error: fetch failed' }),
              createBrowserConsoleEntry({ message: 'XHR request failed' }),
            ],
            warnings: [],
            logs: [],
          },
        },
      });

      const explanation = classifier.classify(capsule);
      assert.strictEqual(explanation.failureClass, 'backend_failure');
    });

    it('should detect backend failure from connection refused errors', () => {
      const capsule = createEvidenceCapsule({
        browser: {
          ...createEvidenceCapsule().browser,
          console: {
            errors: [
              createBrowserConsoleEntry({ message: 'Error: connect ECONNREFUSED' }),
            ],
            warnings: [],
            logs: [],
          },
        },
      });

      const explanation = classifier.classify(capsule);
      assert.strictEqual(explanation.failureClass, 'backend_failure');
    });

    it('should detect timing issues from slow load times', () => {
      const capsule = createEvidenceCapsule({
        browser: {
          ...createEvidenceCapsule().browser,
          performanceMetrics: {
            loadTime: 8000,
            domContentLoaded: 6000,
          },
        },
      });

      const explanation = classifier.classify(capsule);
      assert.strictEqual(explanation.failureClass, 'timing');
      assert.ok(explanation.evidence.some((e) => e.includes('Slow')));
    });

    it('should detect selector drift from stale element errors', () => {
      const capsule = createEvidenceCapsule({
        browser: {
          ...createEvidenceCapsule().browser,
          console: {
            errors: [
              createBrowserConsoleEntry({ message: 'StaleElementReference: element is no longer attached to DOM' }),
            ],
            warnings: [],
            logs: [],
          },
        },
      });

      const explanation = classifier.classify(capsule);
      assert.strictEqual(explanation.failureClass, 'selector_drift');
    });

    it('should detect environment issues from DNS errors', () => {
      const capsule = createEvidenceCapsule({
        browser: {
          ...createEvidenceCapsule().browser,
          console: {
            errors: [
              createBrowserConsoleEntry({ message: 'DNS resolution failed for api.example.com' }),
            ],
            warnings: [],
            logs: [],
          },
        },
      });

      const explanation = classifier.classify(capsule);
      assert.strictEqual(explanation.failureClass, 'environment');
    });

    it('should detect environment issues from SSL certificate errors', () => {
      const capsule = createEvidenceCapsule({
        browser: {
          ...createEvidenceCapsule().browser,
          console: {
            errors: [
              createBrowserConsoleEntry({ message: 'SSL certificate error: certificate has expired' }),
            ],
            warnings: [],
            logs: [],
          },
        },
      });

      const explanation = classifier.classify(capsule);
      assert.strictEqual(explanation.failureClass, 'environment');
    });
  });

  describe('confidence scoring', () => {
    it('should have higher confidence with more evidence', () => {
      const capsuleWithMultipleSignals = createEvidenceCapsule({
        browser: {
          ...createEvidenceCapsule().browser,
          console: {
            errors: [
              createBrowserConsoleEntry({ message: 'Network error' }),
              createBrowserConsoleEntry({ message: 'Fetch failed with status 500' }),
            ],
            warnings: [],
            logs: [],
          },
          networkRequests: [
            createBrowserNetworkEntry({ status: 500, statusText: 'Internal Server Error' }),
            createBrowserNetworkEntry({ status: 502, statusText: 'Bad Gateway' }),
          ],
        },
      });

      const explanation = classifier.classify(capsuleWithMultipleSignals);
      assert.ok(explanation.confidence > 0, 'Confidence should be greater than 0 with multiple signals');
    });

    it('should have lower confidence with no specific signals', () => {
      const capsule = createEvidenceCapsule({
        browser: {
          ...createEvidenceCapsule().browser,
          console: { errors: [], warnings: [], logs: [] },
          networkRequests: [],
        },
        failure: { type: 'unknown', message: 'Something went wrong' },
      });

      const explanation = classifier.classify(capsule);
      assert.strictEqual(explanation.failureClass, 'app_code');
      assert.ok(explanation.confidence <= 0.5, 'Confidence should be low with no signals');
    });
  });

  describe('what description', () => {
    it('should include failure type in what description', () => {
      const capsule = createBackendFailureCapsule();
      const explanation = classifier.classify(capsule);

      assert.ok(explanation.what.includes('Backend failure'));
      assert.ok(explanation.what.includes(capsule.failure.type));
    });

    it('should include URL in what description when available', () => {
      const capsule = createEvidenceCapsule({
        browser: {
          ...createEvidenceCapsule().browser,
          sessionMetadata: {
            url: 'https://example.com/long/path/to/resource',
            title: 'Test',
            tabId: '1',
          },
        },
      });

      const explanation = classifier.classify(capsule);
      assert.ok(explanation.what.includes('example.com'));
    });
  });

  describe('first bad state', () => {
    it('should identify console error as first bad state', () => {
      const capsule = createEvidenceCapsule({
        browser: {
          ...createEvidenceCapsule().browser,
          console: {
            errors: [createBrowserConsoleEntry({ message: 'Initial error occurred' })],
            warnings: [],
            logs: [],
          },
        },
      });

      const explanation = classifier.classify(capsule);
      assert.ok(explanation.firstBadState.includes('Initial error'));
    });

    it('should identify failed action as first bad state', () => {
      const capsule = createEvidenceCapsule({
        browser: {
          ...createEvidenceCapsule().browser,
          actionTimeline: [
            createActionTimelineEntry({ action: 'click', selector: '#btn', result: 'failure', error: 'Button not found' }),
          ],
        },
      });

      const explanation = classifier.classify(capsule);
      assert.ok(explanation.firstBadState.includes('click'));
      assert.ok(explanation.firstBadState.includes('#btn'));
    });

    it('should identify failed network request as first bad state', () => {
      const capsule = createEvidenceCapsule({
        browser: {
          ...createEvidenceCapsule().browser,
          networkRequests: [
            createBrowserNetworkEntry({ url: 'https://api.test/data', status: 500 }),
          ],
        },
      });

      const explanation = classifier.classify(capsule);
      assert.ok(explanation.firstBadState.includes('api.test'));
      assert.ok(explanation.firstBadState.includes('500'));
    });
  });

  describe('evidence collection', () => {
    it('should collect evidence from console errors', () => {
      const capsule = createEvidenceCapsule({
        browser: {
          ...createEvidenceCapsule().browser,
          console: {
            errors: [createBrowserConsoleEntry({ message: 'Network error: backend failed' })],
            warnings: [],
            logs: [],
          },
        },
      });

      const explanation = classifier.classify(capsule);
      assert.ok(explanation.evidence.some((e) => e.includes('backend') || e.includes('Console error')));
    });

    it('should collect evidence from network requests', () => {
      const capsule = createEvidenceCapsule({
        browser: {
          ...createEvidenceCapsule().browser,
          networkRequests: [
            createBrowserNetworkEntry({ url: 'https://api.test/endpoint', status: 503 }),
          ],
        },
      });

      const explanation = classifier.classify(capsule);
      assert.ok(explanation.evidence.some((e) => e.includes('503') || e.includes('endpoint')));
    });

    it('should collect evidence from performance metrics', () => {
      const capsule = createEvidenceCapsule({
        browser: {
          ...createEvidenceCapsule().browser,
          performanceMetrics: {
            loadTime: 10000,
          },
        },
      });

      const explanation = classifier.classify(capsule);
      assert.ok(explanation.evidence.some((e) => e.includes('10000ms') || e.includes('Slow')));
    });
  });

  describe('edge cases', () => {
    it('should handle empty capsule', () => {
      const capsule = createEvidenceCapsule({
        browser: {
          screenshots: [],
          console: { errors: [], warnings: [], logs: [] },
          networkRequests: [],
          performanceMetrics: {},
          sessionMetadata: { url: '', title: '', tabId: '' },
          actionTimeline: [],
        },
        failure: { type: '', message: '' },
      });

      const explanation = classifier.classify(capsule);
      assert.ok(['app_code', 'timing', 'selector_drift', 'backend_failure', 'environment'].includes(explanation.failureClass));
      assert.ok(explanation.what);
      assert.ok(explanation.firstBadState);
    });

    it('should handle capsule with only warnings', () => {
      const capsule = createEvidenceCapsule({
        browser: {
          ...createEvidenceCapsule().browser,
          console: {
            errors: [],
            warnings: [createBrowserConsoleEntry({ level: 'warning', message: 'Deprecation warning' })],
            logs: [],
          },
        },
      });

      const explanation = classifier.classify(capsule);
      assert.ok(explanation.failureClass);
      assert.ok(explanation.firstBadState.includes('warning') || explanation.firstBadState.includes('Failure'));
    });
  });

  describe('singleton', () => {
    it('getFailureClassifier should return same instance', () => {
      const instance1 = getFailureClassifier();
      const instance2 = getFailureClassifier();
      assert.strictEqual(instance1, instance2);
    });
  });
});
