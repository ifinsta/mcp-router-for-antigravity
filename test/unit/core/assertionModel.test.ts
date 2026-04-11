/**
 * Unit tests for AssertionEvaluator
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  AssertionEvaluator,
  getAssertionEvaluator,
} from '../../../src/core/assertionModel.js';
import type { AssertionCategory, AssertionSeverity } from '../../../src/core/types.js';
import {
  createEvidenceCapsule,
  createBrowserConsoleEntry,
  createBrowserNetworkEntry,
  createActionTimelineEntry,
  createBrowserSessionMetadata,
  brokenImagesDomSnapshot,
  unlabeledInputsDomSnapshot,
  emptyButtonsDomSnapshot,
} from './fixtures.js';

describe('AssertionEvaluator', () => {
  let evaluator: AssertionEvaluator;

  beforeEach(() => {
    evaluator = new AssertionEvaluator();
  });

  describe('evaluateFunctional', () => {
    it('should pass when no console errors exist', () => {
      const capsule = createEvidenceCapsule({
        browser: {
          ...createEvidenceCapsule().browser,
          console: { errors: [], warnings: [], logs: [] },
        },
      });

      const checks = evaluator.evaluateFunctional(capsule);
      const errorCheck = checks.find((c) => c.description.includes('console errors'));

      assert.ok(errorCheck);
      assert.strictEqual(errorCheck?.passed, true);
      assert.strictEqual(errorCheck?.actual, '0 errors');
    });

    it('should fail when console errors exist', () => {
      const capsule = createEvidenceCapsule({
        browser: {
          ...createEvidenceCapsule().browser,
          console: {
            errors: [createBrowserConsoleEntry({ message: 'Error 1' }), createBrowserConsoleEntry({ message: 'Error 2' })],
            warnings: [],
            logs: [],
          },
        },
      });

      const checks = evaluator.evaluateFunctional(capsule);
      const errorCheck = checks.find((c) => c.description.includes('console errors'));

      assert.ok(errorCheck);
      assert.strictEqual(errorCheck?.passed, false);
      assert.strictEqual(errorCheck?.actual, '2 error(s)');
      assert.strictEqual(errorCheck?.severity, 'critical');
    });

    it('should pass when all actions succeed', () => {
      const capsule = createEvidenceCapsule({
        browser: {
          ...createEvidenceCapsule().browser,
          actionTimeline: [
            createActionTimelineEntry({ action: 'click', result: 'success' }),
            createActionTimelineEntry({ action: 'type', result: 'success' }),
          ],
        },
      });

      const checks = evaluator.evaluateFunctional(capsule);
      const actionCheck = checks.find((c) => c.description.includes('actions'));

      assert.ok(actionCheck);
      assert.strictEqual(actionCheck?.passed, true);
    });

    it('should fail when actions fail', () => {
      const capsule = createEvidenceCapsule({
        browser: {
          ...createEvidenceCapsule().browser,
          actionTimeline: [
            createActionTimelineEntry({ action: 'click', result: 'failure' }),
            createActionTimelineEntry({ action: 'type', result: 'success' }),
          ],
        },
      });

      const checks = evaluator.evaluateFunctional(capsule);
      const actionCheck = checks.find((c) => c.description.includes('actions'));

      assert.ok(actionCheck);
      assert.strictEqual(actionCheck?.passed, false);
      assert.strictEqual(actionCheck?.actual, '1 failed action(s)');
    });
  });

  describe('evaluateVisual', () => {
    it('should pass when screenshots exist', () => {
      const capsule = createEvidenceCapsule({
        browser: {
          ...createEvidenceCapsule().browser,
          screenshots: ['base64data1', 'base64data2'],
        },
      });

      const checks = evaluator.evaluateVisual(capsule);
      const screenshotCheck = checks.find((c) => c.description.includes('Screenshot'));

      assert.ok(screenshotCheck);
      assert.strictEqual(screenshotCheck?.passed, true);
      assert.strictEqual(screenshotCheck?.actual, '2 screenshot(s)');
    });

    it('should fail when no screenshots exist', () => {
      const capsule = createEvidenceCapsule({
        browser: {
          ...createEvidenceCapsule().browser,
          screenshots: [],
        },
      });

      const checks = evaluator.evaluateVisual(capsule);
      const screenshotCheck = checks.find((c) => c.description.includes('Screenshot'));

      assert.ok(screenshotCheck);
      assert.strictEqual(screenshotCheck?.passed, false);
      assert.strictEqual(screenshotCheck?.actual, 'No screenshots');
    });

    it('should check viewport validity', () => {
      const capsule = createEvidenceCapsule({
        browser: {
          ...createEvidenceCapsule().browser,
          sessionMetadata: createBrowserSessionMetadata({
            viewport: { width: 1920, height: 1080 },
          }),
        },
      });

      const checks = evaluator.evaluateVisual(capsule);
      const viewportCheck = checks.find((c) => c.description.includes('Viewport'));

      assert.ok(viewportCheck);
      assert.strictEqual(viewportCheck?.passed, true);
    });

    it('should fail for invalid viewport dimensions', () => {
      const capsule = createEvidenceCapsule({
        browser: {
          ...createEvidenceCapsule().browser,
          sessionMetadata: createBrowserSessionMetadata({
            viewport: { width: 100, height: 100 },
          }),
        },
      });

      const checks = evaluator.evaluateVisual(capsule);
      const viewportCheck = checks.find((c) => c.description.includes('Viewport'));

      assert.ok(viewportCheck);
      assert.strictEqual(viewportCheck?.passed, false);
    });
  });

  describe('evaluateAccessibility', () => {
    it('should fail when DOM snapshot is missing', () => {
      const capsule = createEvidenceCapsule();

      const checks = evaluator.evaluateAccessibility(capsule);

      assert.ok(checks.length > 0);
      assert.strictEqual(checks[0]?.passed, false);
      assert.ok(checks[0]?.description.includes('DOM snapshot'));
    });

    it('should pass when all images have alt text', () => {
      const capsule = createEvidenceCapsule({
        browser: {
          ...createEvidenceCapsule().browser,
          domSnapshot: '<img src="a.jpg" alt="Description"><img src="b.jpg" alt="Another">',
        },
      });

      const checks = evaluator.evaluateAccessibility(capsule);
      const imgCheck = checks.find((c) => c.description.includes('alt'));

      assert.ok(imgCheck);
      assert.strictEqual(imgCheck?.passed, true);
    });

    it('should fail when images lack alt text', () => {
      const capsule = createEvidenceCapsule({
        browser: {
          ...createEvidenceCapsule().browser,
          domSnapshot: brokenImagesDomSnapshot,
        },
      });

      const checks = evaluator.evaluateAccessibility(capsule);
      const imgCheck = checks.find((c) => c.description.includes('alt'));

      assert.ok(imgCheck);
      assert.strictEqual(imgCheck?.passed, false);
      assert.ok(imgCheck?.actual.includes('1'));
    });

    it('should check form inputs have labels', () => {
      const capsule = createEvidenceCapsule({
        browser: {
          ...createEvidenceCapsule().browser,
          domSnapshot: unlabeledInputsDomSnapshot,
        },
      });

      const checks = evaluator.evaluateAccessibility(capsule);
      const inputCheck = checks.find((c) => c.description.includes('inputs'));

      assert.ok(inputCheck);
      assert.strictEqual(inputCheck?.passed, false);
    });

    it('should pass for inputs with aria-label', () => {
      const capsule = createEvidenceCapsule({
        browser: {
          ...createEvidenceCapsule().browser,
          domSnapshot: '<input type="text" aria-label="Username">',
        },
      });

      const checks = evaluator.evaluateAccessibility(capsule);
      const inputCheck = checks.find((c) => c.description.includes('inputs'));

      assert.ok(inputCheck);
      assert.strictEqual(inputCheck?.passed, true);
    });

    it('should check buttons have accessible text', () => {
      const capsule = createEvidenceCapsule({
        browser: {
          ...createEvidenceCapsule().browser,
          domSnapshot: '<div><button>Click Me</button><button></button><button aria-label="Close">×</button></div>',
        },
      });

      const checks = evaluator.evaluateAccessibility(capsule);
      const buttonCheck = checks.find((c) => c.description.toLowerCase().includes('button'));

      assert.ok(buttonCheck, `Expected to find button check, got checks: ${JSON.stringify(checks.map(c => c.description))}`);
      assert.strictEqual(buttonCheck?.passed, false);
      assert.ok(buttonCheck?.actual.includes('1'));
    });
  });

  describe('evaluatePerformance', () => {
    it('should check page load time', () => {
      const capsule = createEvidenceCapsule({
        browser: {
          ...createEvidenceCapsule().browser,
          performanceMetrics: {
            loadEventEnd: 2000,
          },
        },
      });

      const checks = evaluator.evaluatePerformance(capsule);
      const loadCheck = checks.find((c) => c.description.includes('load time'));

      assert.ok(loadCheck);
      assert.strictEqual(loadCheck?.passed, true);
      assert.strictEqual(loadCheck?.actual, '2000ms');
    });

    it('should fail for slow page load', () => {
      const capsule = createEvidenceCapsule({
        browser: {
          ...createEvidenceCapsule().browser,
          performanceMetrics: {
            loadEventEnd: 5000,
          },
        },
      });

      const checks = evaluator.evaluatePerformance(capsule);
      const loadCheck = checks.find((c) => c.description.includes('load time'));

      assert.ok(loadCheck);
      assert.strictEqual(loadCheck?.passed, false);
    });

    it('should check First Contentful Paint', () => {
      const capsule = createEvidenceCapsule({
        browser: {
          ...createEvidenceCapsule().browser,
          performanceMetrics: {
            firstContentfulPaint: 1000,
          },
        },
      });

      const checks = evaluator.evaluatePerformance(capsule);
      const fcpCheck = checks.find((c) => c.description.includes('Contentful Paint'));

      assert.ok(fcpCheck);
      assert.strictEqual(fcpCheck?.passed, true);
    });

    it('should check DOM Content Loaded', () => {
      const capsule = createEvidenceCapsule({
        browser: {
          ...createEvidenceCapsule().browser,
          performanceMetrics: {
            domContentLoaded: 1500,
          },
        },
      });

      const checks = evaluator.evaluatePerformance(capsule);
      const dclCheck = checks.find((c) => c.description.includes('DOM Content Loaded'));

      assert.ok(dclCheck);
      assert.strictEqual(dclCheck?.passed, true);
    });

    it('should report missing metrics when none available', () => {
      const capsule = createEvidenceCapsule({
        browser: {
          ...createEvidenceCapsule().browser,
          performanceMetrics: {},
        },
      });

      const checks = evaluator.evaluatePerformance(capsule);

      assert.ok(checks.length > 0);
      assert.strictEqual(checks[0]?.passed, false);
      assert.ok(checks[0]?.description.includes('metrics'));
    });
  });

  describe('evaluateUx', () => {
    it('should pass when no console warnings exist', () => {
      const capsule = createEvidenceCapsule({
        browser: {
          ...createEvidenceCapsule().browser,
          console: { errors: [], warnings: [], logs: [] },
        },
      });

      const checks = evaluator.evaluateUx(capsule);
      const warningCheck = checks.find((c) => c.description.includes('warnings'));

      assert.ok(warningCheck);
      assert.strictEqual(warningCheck?.passed, true);
    });

    it('should fail when console warnings exist', () => {
      const capsule = createEvidenceCapsule({
        browser: {
          ...createEvidenceCapsule().browser,
          console: {
            errors: [],
            warnings: [createBrowserConsoleEntry({ level: 'warning', message: 'Warning' })],
            logs: [],
          },
        },
      });

      const checks = evaluator.evaluateUx(capsule);
      const warningCheck = checks.find((c) => c.description.includes('warnings'));

      assert.ok(warningCheck);
      assert.strictEqual(warningCheck?.passed, false);
      assert.strictEqual(warningCheck?.actual, '1 warning(s)');
    });

    it('should check viewport size for good UX', () => {
      const capsule = createEvidenceCapsule({
        browser: {
          ...createEvidenceCapsule().browser,
          sessionMetadata: createBrowserSessionMetadata({
            viewport: { width: 1920, height: 1080 },
          }),
        },
      });

      const checks = evaluator.evaluateUx(capsule);
      const viewportCheck = checks.find((c) => c.description.includes('Viewport size'));

      assert.ok(viewportCheck);
      assert.strictEqual(viewportCheck?.passed, true);
    });

    it('should flag small viewports', () => {
      const capsule = createEvidenceCapsule({
        browser: {
          ...createEvidenceCapsule().browser,
          sessionMetadata: createBrowserSessionMetadata({
            viewport: { width: 320, height: 480 },
          }),
        },
      });

      const checks = evaluator.evaluateUx(capsule);
      const viewportCheck = checks.find((c) => c.description.includes('Viewport size'));

      assert.ok(viewportCheck);
      assert.strictEqual(viewportCheck?.passed, false);
    });
  });

  describe('evaluateNetwork', () => {
    it('should pass when all requests succeed', () => {
      const capsule = createEvidenceCapsule({
        browser: {
          ...createEvidenceCapsule().browser,
          networkRequests: [
            createBrowserNetworkEntry({ status: 200 }),
            createBrowserNetworkEntry({ status: 201 }),
          ],
        },
      });

      const checks = evaluator.evaluateNetwork(capsule);
      const requestCheck = checks.find((c) => c.description.includes('network requests'));

      assert.ok(requestCheck);
      assert.strictEqual(requestCheck?.passed, true);
    });

    it('should fail when requests fail', () => {
      const capsule = createEvidenceCapsule({
        browser: {
          ...createEvidenceCapsule().browser,
          networkRequests: [
            createBrowserNetworkEntry({ status: 200 }),
            createBrowserNetworkEntry({ status: 500 }),
            createBrowserNetworkEntry({ status: 404 }),
          ],
        },
      });

      const checks = evaluator.evaluateNetwork(capsule);
      const requestCheck = checks.find((c) => c.description.includes('network requests'));

      assert.ok(requestCheck);
      assert.strictEqual(requestCheck?.passed, false);
      assert.strictEqual(requestCheck?.actual, '2 failed request(s)');
      assert.strictEqual(requestCheck?.severity, 'critical');
    });

    it('should detect slow responses', () => {
      const capsule = createEvidenceCapsule({
        browser: {
          ...createEvidenceCapsule().browser,
          networkRequests: [
            createBrowserNetworkEntry({ status: 200, duration: 6000 }),
          ],
        },
      });

      const checks = evaluator.evaluateNetwork(capsule);
      const slowCheck = checks.find((c) => c.description.includes('slow'));

      assert.ok(slowCheck);
      assert.strictEqual(slowCheck?.passed, false);
    });

    it('should detect mixed content on HTTPS pages', () => {
      const capsule = createEvidenceCapsule({
        browser: {
          ...createEvidenceCapsule().browser,
          sessionMetadata: createBrowserSessionMetadata({
            url: 'https://secure.example.com/page',
          }),
          networkRequests: [
            createBrowserNetworkEntry({ url: 'http://insecure.example.com/resource.js', status: 200 }),
          ],
        },
      });

      const checks = evaluator.evaluateNetwork(capsule);
      const mixedCheck = checks.find((c) => c.description.includes('mixed content'));

      assert.ok(mixedCheck);
      assert.strictEqual(mixedCheck?.passed, false);
    });

    it('should report missing network requests', () => {
      const capsule = createEvidenceCapsule({
        browser: {
          ...createEvidenceCapsule().browser,
          networkRequests: [],
        },
      });

      const checks = evaluator.evaluateNetwork(capsule);
      const missingCheck = checks.find((c) => c.description.includes('captured'));

      assert.ok(missingCheck);
      assert.strictEqual(missingCheck?.passed, false);
    });
  });

  describe('evaluate (all categories)', () => {
    it('should evaluate all categories and return aggregate result', () => {
      const capsule = createEvidenceCapsule();

      const result = evaluator.evaluate(capsule);

      assert.ok(result.capsuleId);
      assert.ok(result.timestamp);
      assert.ok(result.totalChecks > 0);
      assert.ok(result.passed >= 0);
      assert.ok(result.failed >= 0);
      assert.strictEqual(result.passed + result.failed, result.totalChecks);
      assert.ok(result.assertions.length > 0);
    });

    it('should include all categories in assertions', () => {
      const capsule = createEvidenceCapsule();

      const result = evaluator.evaluate(capsule);

      const categories: AssertionCategory[] = ['functional', 'visual', 'accessibility', 'performance', 'ux', 'network'];
      for (const category of categories) {
        assert.ok(
          result.assertions.some((a) => a.category === category),
          `Should have assertions for category: ${category}`
        );
      }
    });

    it('should track passed and failed counts correctly', () => {
      const capsule = createEvidenceCapsule({
        browser: {
          ...createEvidenceCapsule().browser,
          console: {
            errors: [createBrowserConsoleEntry()],
            warnings: [],
            logs: [],
          },
        },
      });

      const result = evaluator.evaluate(capsule);

      assert.ok(result.failed > 0);
      assert.ok(result.passed >= 0);
      assert.strictEqual(result.passed + result.failed, result.totalChecks);
    });
  });

  describe('assertion check structure', () => {
    it('should include all required fields in checks', () => {
      const capsule = createEvidenceCapsule();

      const result = evaluator.evaluate(capsule);

      for (const check of result.assertions) {
        assert.ok(check.category);
        assert.ok(check.description);
        assert.strictEqual(typeof check.passed, 'boolean');
        assert.ok(check.severity);
        assert.ok(['critical', 'warning', 'info'].includes(check.severity));
      }
    });

    it('should include actual and expected values for failed checks', () => {
      const capsule = createEvidenceCapsule({
        browser: {
          ...createEvidenceCapsule().browser,
          console: {
            errors: [createBrowserConsoleEntry()],
            warnings: [],
            logs: [],
          },
        },
      });

      const result = evaluator.evaluate(capsule);
      const failedCheck = result.assertions.find((a) => !a.passed);

      if (failedCheck) {
        assert.ok(failedCheck.actual);
        assert.ok(failedCheck.expected);
      }
    });
  });

  describe('singleton', () => {
    it('getAssertionEvaluator should return same instance', () => {
      const instance1 = getAssertionEvaluator();
      const instance2 = getAssertionEvaluator();
      assert.strictEqual(instance1, instance2);
    });
  });
});
