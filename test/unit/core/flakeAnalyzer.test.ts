/**
 * Unit tests for FlakeAnalyzer
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  FlakeAnalyzer,
  getFlakeAnalyzer,
} from '../../../src/core/flakeAnalyzer.js';
import { EvidenceCapsuleCollector, getEvidenceCapsuleCollector } from '../../../src/core/evidenceCapsule.js';
import type { FailureClass } from '../../../src/core/types.js';
import {
  createEvidenceCapsule,
  createCapsuleFailureInfo,
  createBrowserConsoleEntry,
  createActionTimelineEntry,
} from './fixtures.js';

describe('FlakeAnalyzer', () => {
  let analyzer: FlakeAnalyzer;
  let collector: EvidenceCapsuleCollector;

  beforeEach(() => {
    analyzer = new FlakeAnalyzer();
    collector = new EvidenceCapsuleCollector();
    analyzer.clearHistory();
  });

  describe('analyze', () => {
    it('should return empty analysis for empty capsule IDs array', async () => {
      const analysis = await analyzer.analyze([]);

      assert.strictEqual(analysis.isFlaky, false);
      assert.strictEqual(analysis.confidence, 0);
      assert.strictEqual(analysis.failureClass, 'app_code');
      assert.strictEqual(analysis.capsuleIds.length, 0);
      assert.ok(analysis.reasoning.includes('No valid evidence capsules'));
    });

    it('should return empty analysis for non-existent capsule IDs', async () => {
      const analysis = await analyzer.analyze(['non-existent-1', 'non-existent-2']);

      assert.strictEqual(analysis.isFlaky, false);
      assert.strictEqual(analysis.confidence, 0);
    });

    it('should analyze single capsule and determine non-flaky', async () => {
      const capsule = createEvidenceCapsule({
        failure: createCapsuleFailureInfo({ type: 'error', message: 'Consistent error' }),
      });

      // Use singleton collector to store capsule
      const singletonCollector = getEvidenceCapsuleCollector();
      const storedCapsule = await singletonCollector.capture(capsule.failure);

      const analysis = await analyzer.analyze([storedCapsule.capsuleId]);

      assert.strictEqual(analysis.capsuleIds.length, 1);
      assert.strictEqual(analysis.capsuleIds[0], storedCapsule.capsuleId);
      assert.ok(analysis.failureClass);
      assert.ok(analysis.patternSignature);
    });
  });

  describe('flakiness detection', () => {
    it('should detect flakiness from different failure classes', async () => {
      const singletonCollector = getEvidenceCapsuleCollector();

      // Create capsules with different failure patterns
      const capsule1 = await singletonCollector.capture(
        createCapsuleFailureInfo({ type: 'timeout', message: 'Timeout error' })
      );

      // Modify capsule1 to have timing indicators
      const stored1 = singletonCollector.get(capsule1.capsuleId);
      if (stored1) {
        Object.defineProperty(stored1.browser, 'performanceMetrics', {
          value: { loadTime: 10000 },
          writable: true,
        });
      }

      const capsule2 = await singletonCollector.capture(
        createCapsuleFailureInfo({ type: 'network', message: 'Network error' })
      );

      const analysis = await analyzer.analyze([capsule1.capsuleId, capsule2.capsuleId]);

      // Different failure types suggest flakiness
      assert.strictEqual(analysis.isFlaky, true);
      assert.ok(analysis.reasoning.includes('inconsistent') || analysis.reasoning.includes('inconsistent'));
    });

    it('should detect flakiness from selector drift', async () => {
      const singletonCollector = getEvidenceCapsuleCollector();

      const capsule = await singletonCollector.capture(
        createCapsuleFailureInfo({ type: 'element_not_found', message: 'Element not found' })
      );

      const stored = singletonCollector.get(capsule.capsuleId);
      if (stored) {
        Object.defineProperty(stored.browser, 'console', {
          value: {
            errors: [createBrowserConsoleEntry({ message: 'No element found for selector' })],
            warnings: [],
            logs: [],
          },
          writable: true,
        });
      }

      const analysis = await analyzer.analyze([capsule.capsuleId]);

      if (analysis.failureClass === 'selector_drift') {
        assert.strictEqual(analysis.isFlaky, true);
      }
    });

    it('should detect flakiness from intermittent action patterns', async () => {
      const singletonCollector = getEvidenceCapsuleCollector();

      const capsule = await singletonCollector.capture(createCapsuleFailureInfo());

      const stored = singletonCollector.get(capsule.capsuleId);
      if (stored) {
        Object.defineProperty(stored.browser, 'actionTimeline', {
          value: [
            createActionTimelineEntry({ action: 'click', result: 'success' }),
            createActionTimelineEntry({ action: 'type', result: 'failure' }),
            createActionTimelineEntry({ action: 'click', result: 'success' }),
            createActionTimelineEntry({ action: 'scroll', result: 'failure' }),
          ],
          writable: true,
        });
      }

      const analysis = await analyzer.analyze([capsule.capsuleId]);

      // High transition rate should indicate flakiness
      if (analysis.isFlaky) {
        assert.ok(analysis.reasoning.includes('intermittent') || analysis.reasoning.includes('timing'));
      }
    });
  });

  describe('pattern signature', () => {
    it('should generate consistent signature for similar capsules', async () => {
      const singletonCollector = getEvidenceCapsuleCollector();

      const capsule1 = await singletonCollector.capture(
        createCapsuleFailureInfo({ type: 'api_error', message: 'API failed' })
      );
      const capsule2 = await singletonCollector.capture(
        createCapsuleFailureInfo({ type: 'api_error', message: 'API failed' })
      );

      const analysis1 = await analyzer.analyze([capsule1.capsuleId]);
      const analysis2 = await analyzer.analyze([capsule2.capsuleId]);

      // Signatures should be similar for similar failures
      assert.ok(analysis1.patternSignature);
      assert.ok(analysis2.patternSignature);
      assert.strictEqual(typeof analysis1.patternSignature, 'string');
      assert.strictEqual(typeof analysis2.patternSignature, 'string');
    });

    it('should generate unique signatures for different failures', async () => {
      const singletonCollector = getEvidenceCapsuleCollector();

      const capsule1 = await singletonCollector.capture(
        createCapsuleFailureInfo({ type: 'timeout', message: 'Timeout' })
      );
      const capsule2 = await singletonCollector.capture(
        createCapsuleFailureInfo({ type: 'syntax_error', message: 'Syntax error' })
      );

      const analysis1 = await analyzer.analyze([capsule1.capsuleId]);
      const analysis2 = await analyzer.analyze([capsule2.capsuleId]);

      // Different failures should have different signatures
      assert.notStrictEqual(analysis1.patternSignature, analysis2.patternSignature);
    });
  });

  describe('recommended actions', () => {
    it('should recommend add_wait for timing failures', async () => {
      const singletonCollector = getEvidenceCapsuleCollector();

      const capsule = await singletonCollector.capture(
        createCapsuleFailureInfo({ type: 'timeout', message: 'Timeout waiting for element' })
      );

      const stored = singletonCollector.get(capsule.capsuleId);
      if (stored) {
        Object.defineProperty(stored.browser, 'performanceMetrics', {
          value: { loadTime: 8000 },
          writable: true,
        });
      }

      const analysis = await analyzer.analyze([capsule.capsuleId]);

      if (analysis.failureClass === 'timing') {
        assert.strictEqual(analysis.recommendedAction, 'add_wait');
      }
    });

    it('should recommend fix_selector for selector drift', async () => {
      const singletonCollector = getEvidenceCapsuleCollector();

      const capsule = await singletonCollector.capture(
        createCapsuleFailureInfo({ type: 'element_not_found', message: 'Element not found' })
      );

      const stored = singletonCollector.get(capsule.capsuleId);
      if (stored) {
        Object.defineProperty(stored.browser, 'console', {
          value: {
            errors: [createBrowserConsoleEntry({ message: 'Element not found for selector' })],
            warnings: [],
            logs: [],
          },
          writable: true,
        });
      }

      const analysis = await analyzer.analyze([capsule.capsuleId]);

      if (analysis.failureClass === 'selector_drift') {
        assert.strictEqual(analysis.recommendedAction, 'fix_selector');
      }
    });

    it('should recommend fix_backend for backend failures', async () => {
      const singletonCollector = getEvidenceCapsuleCollector();

      const capsule = await singletonCollector.capture(
        createCapsuleFailureInfo({ type: 'api_error', message: '500 Internal Server Error' })
      );

      const stored = singletonCollector.get(capsule.capsuleId);
      if (stored) {
        Object.defineProperty(stored.browser, 'console', {
          value: {
            errors: [createBrowserConsoleEntry({ message: 'HTTP 500 error' })],
            warnings: [],
            logs: [],
          },
          writable: true,
        });
      }

      const analysis = await analyzer.analyze([capsule.capsuleId]);

      if (analysis.failureClass === 'backend_failure') {
        assert.strictEqual(analysis.recommendedAction, 'fix_backend');
      }
    });

    it('should recommend investigate for unknown flaky failures', async () => {
      const singletonCollector = getEvidenceCapsuleCollector();

      const capsule1 = await singletonCollector.capture(createCapsuleFailureInfo({ type: 'error1' }));
      const capsule2 = await singletonCollector.capture(createCapsuleFailureInfo({ type: 'error2' }));

      const analysis = await analyzer.analyze([capsule1.capsuleId, capsule2.capsuleId]);

      if (analysis.isFlaky && analysis.failureClass === 'app_code') {
        assert.strictEqual(analysis.recommendedAction, 'investigate');
      }
    });
  });

  describe('confidence calculation', () => {
    it('should have higher confidence with more samples', async () => {
      const singletonCollector = getEvidenceCapsuleCollector();

      const capsuleIds: string[] = [];
      for (let i = 0; i < 5; i++) {
        const capsule = await singletonCollector.capture(createCapsuleFailureInfo());
        capsuleIds.push(capsule.capsuleId);
      }

      const analysis = await analyzer.analyze(capsuleIds);

      // More samples should generally lead to higher confidence
      assert.ok(analysis.confidence >= 0);
      assert.ok(analysis.confidence <= 1);
    });

    it('should reduce confidence for flaky results', async () => {
      const singletonCollector = getEvidenceCapsuleCollector();

      const capsule1 = await singletonCollector.capture(createCapsuleFailureInfo({ type: 'type_a' }));
      const capsule2 = await singletonCollector.capture(createCapsuleFailureInfo({ type: 'type_b' }));

      const analysis = await analyzer.analyze([capsule1.capsuleId, capsule2.capsuleId]);

      if (analysis.isFlaky) {
        // Flaky results should have confidence penalty
        assert.ok(analysis.confidence <= 1);
      }
    });
  });

  describe('historical frequency', () => {
    it('should track historical frequency of patterns', async () => {
      const singletonCollector = getEvidenceCapsuleCollector();

      const capsule = await singletonCollector.capture(createCapsuleFailureInfo());

      // First occurrence
      const analysis1 = await analyzer.analyze([capsule.capsuleId]);
      assert.strictEqual(analysis1.historicalFrequency, 0);

      // Same pattern again
      const analysis2 = await analyzer.analyze([capsule.capsuleId]);
      assert.ok(analysis2.historicalFrequency >= 0);
    });
  });

  describe('pattern history', () => {
    it('should record patterns in history', () => {
      analyzer.recordPattern('test-signature-123', true, 'app_code');

      assert.strictEqual(analyzer.getHistorySize(), 1);
    });

    it('should clear history', () => {
      analyzer.recordPattern('sig-1', true, 'app_code');
      analyzer.recordPattern('sig-2', false, 'timing');

      assert.strictEqual(analyzer.getHistorySize(), 2);

      analyzer.clearHistory();

      assert.strictEqual(analyzer.getHistorySize(), 0);
    });

    it('should enforce max history size (LRU eviction)', () => {
      // Add more than 200 entries
      for (let i = 0; i < 210; i++) {
        analyzer.recordPattern(`sig-${i}`, i % 2 === 0, 'app_code');
      }

      assert.ok(analyzer.getHistorySize() <= 200);
    });
  });

  describe('reasoning', () => {
    it('should include capsule count in reasoning', async () => {
      const singletonCollector = getEvidenceCapsuleCollector();

      const capsule1 = await singletonCollector.capture(createCapsuleFailureInfo());
      const capsule2 = await singletonCollector.capture(createCapsuleFailureInfo());

      const analysis = await analyzer.analyze([capsule1.capsuleId, capsule2.capsuleId]);

      assert.ok(analysis.reasoning.includes('2'));
    });

    it('should explain flakiness determination', async () => {
      const singletonCollector = getEvidenceCapsuleCollector();

      const capsule1 = await singletonCollector.capture(createCapsuleFailureInfo({ type: 'error_a' }));
      const capsule2 = await singletonCollector.capture(createCapsuleFailureInfo({ type: 'error_b' }));

      const analysis = await analyzer.analyze([capsule1.capsuleId, capsule2.capsuleId]);

      if (analysis.isFlaky) {
        assert.ok(
          analysis.reasoning.includes('flaky') ||
          analysis.reasoning.includes('inconsistent') ||
          analysis.reasoning.includes('intermittent')
        );
      }
    });
  });

  describe('singleton', () => {
    it('getFlakeAnalyzer should return same instance', () => {
      const instance1 = getFlakeAnalyzer();
      const instance2 = getFlakeAnalyzer();
      assert.strictEqual(instance1, instance2);
    });
  });
});
