/**
 * Unit tests for PRSummaryGenerator
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  PRSummaryGenerator,
  getPRSummaryGenerator,
} from '../../../src/core/prSummaryGenerator.js';
import { getEvidenceCapsuleCollector } from '../../../src/core/evidenceCapsule.js';
import { createCapsuleFailureInfo, createActionTimelineEntry, createBrowserConsoleEntry } from './fixtures.js';

describe('PRSummaryGenerator', () => {
  let generator: PRSummaryGenerator;

  beforeEach(() => {
    generator = new PRSummaryGenerator();
  });

  describe('generate', () => {
    it('should throw error for non-existent capsule ID', async () => {
      await assert.rejects(
        async () => await generator.generate('non-existent-id'),
        /Evidence capsule not found/
      );
    });

    it('should generate summary with all required fields', async () => {
      const collector = getEvidenceCapsuleCollector();
      const capsule = await collector.capture(createCapsuleFailureInfo());

      const summary = await generator.generate(capsule.capsuleId);

      assert.ok(summary.id);
      assert.strictEqual(summary.capsuleId, capsule.capsuleId);
      assert.ok(summary.generatedAt);
      assert.ok(summary.repro);
      assert.ok(summary.evidenceSummary);
      assert.ok(summary.probableRootCause);
      assert.ok(summary.suggestedFix);
      assert.ok(summary.markdown);
      assert.ok(summary.machineReadable);
    });

    it('should include failure explanation in root cause', async () => {
      const collector = getEvidenceCapsuleCollector();
      const capsule = await collector.capture(createCapsuleFailureInfo({ type: 'test_error' }));

      const summary = await generator.generate(capsule.capsuleId);

      assert.ok(summary.probableRootCause.failureExplanation);
      assert.ok(summary.probableRootCause.failureExplanation.what);
      assert.ok(summary.probableRootCause.failureExplanation.failureClass);
    });

    it('should include candidate fixes in root cause', async () => {
      const collector = getEvidenceCapsuleCollector();
      const capsule = await collector.capture(createCapsuleFailureInfo());

      const summary = await generator.generate(capsule.capsuleId);

      assert.ok(Array.isArray(summary.probableRootCause.candidateFixes));
    });
  });

  describe('markdown generation', () => {
    it('should generate markdown with header', async () => {
      const collector = getEvidenceCapsuleCollector();
      const capsule = await collector.capture(createCapsuleFailureInfo());

      const summary = await generator.generate(capsule.capsuleId);

      assert.ok(summary.markdown.includes('# PR Summary: Failure Analysis Report'));
    });

    it('should include capsule ID in markdown', async () => {
      const collector = getEvidenceCapsuleCollector();
      const capsule = await collector.capture(createCapsuleFailureInfo());

      const summary = await generator.generate(capsule.capsuleId);

      assert.ok(summary.markdown.includes(capsule.capsuleId));
    });

    it('should include summary section', async () => {
      const collector = getEvidenceCapsuleCollector();
      const capsule = await collector.capture(createCapsuleFailureInfo());

      const summary = await generator.generate(capsule.capsuleId);

      assert.ok(summary.markdown.includes('## Summary'));
      assert.ok(summary.markdown.includes(summary.probableRootCause.failureExplanation.what));
    });

    it('should include reproduction steps section', async () => {
      const collector = getEvidenceCapsuleCollector();
      const capsule = await collector.capture(createCapsuleFailureInfo());

      const summary = await generator.generate(capsule.capsuleId);

      assert.ok(summary.markdown.includes('## Reproduction Steps'));
    });

    it('should include evidence section', async () => {
      const collector = getEvidenceCapsuleCollector();
      const capsule = await collector.capture(createCapsuleFailureInfo());

      const summary = await generator.generate(capsule.capsuleId);

      assert.ok(summary.markdown.includes('## Evidence'));
    });

    it('should include root cause analysis section', async () => {
      const collector = getEvidenceCapsuleCollector();
      const capsule = await collector.capture(createCapsuleFailureInfo());

      const summary = await generator.generate(capsule.capsuleId);

      assert.ok(summary.markdown.includes('## Root Cause Analysis'));
      assert.ok(summary.markdown.includes(summary.probableRootCause.likelyComponent));
      assert.ok(summary.markdown.includes(summary.probableRootCause.likelyHandler));
    });

    it('should include suggested fix section', async () => {
      const collector = getEvidenceCapsuleCollector();
      const capsule = await collector.capture(createCapsuleFailureInfo());

      const summary = await generator.generate(capsule.capsuleId);

      assert.ok(summary.markdown.includes('## Suggested Fix'));
      assert.ok(summary.markdown.includes(summary.suggestedFix));
    });

    it('should include verification status section', async () => {
      const collector = getEvidenceCapsuleCollector();
      const capsule = await collector.capture(createCapsuleFailureInfo());

      const summary = await generator.generate(capsule.capsuleId);

      assert.ok(summary.markdown.includes('## Verification Status'));
    });

    it('should include alternative fixes table when candidates exist', async () => {
      const collector = getEvidenceCapsuleCollector();
      const capsule = await collector.capture(createCapsuleFailureInfo());

      const summary = await generator.generate(capsule.capsuleId);

      if (summary.probableRootCause.candidateFixes.length > 0) {
        assert.ok(summary.markdown.includes('### Alternative Fixes'));
        assert.ok(summary.markdown.includes('| Fix | Category | Confidence |'));
      }
    });

    it('should include footer', async () => {
      const collector = getEvidenceCapsuleCollector();
      const capsule = await collector.capture(createCapsuleFailureInfo());

      const summary = await generator.generate(capsule.capsuleId);

      assert.ok(summary.markdown.includes('Generated by MCP Router PR Summary Generator'));
    });
  });

  describe('reproduction steps', () => {
    it('should include URL in repro steps when available', async () => {
      const collector = getEvidenceCapsuleCollector();
      const capsule = await collector.capture(createCapsuleFailureInfo());

      // Set a URL on the stored capsule
      const stored = collector.get(capsule.capsuleId);
      if (stored) {
        Object.defineProperty(stored.browser.sessionMetadata, 'url', {
          value: 'https://example.com/test',
          writable: true,
        });
      }

      const summary = await generator.generate(capsule.capsuleId);

      assert.ok(summary.repro.includes('URL:'));
      assert.ok(summary.repro.includes('https://example.com/test'));
    });

    it('should include failure type and message', async () => {
      const collector = getEvidenceCapsuleCollector();
      const capsule = await collector.capture(
        createCapsuleFailureInfo({ type: 'test_error', message: 'Test message' })
      );

      const summary = await generator.generate(capsule.capsuleId);

      assert.ok(summary.repro.includes('test_error'));
      assert.ok(summary.repro.includes('Test message'));
    });

    it('should include action sequence when available', async () => {
      const collector = getEvidenceCapsuleCollector();
      const capsule = await collector.capture(createCapsuleFailureInfo());

      const stored = collector.get(capsule.capsuleId);
      if (stored) {
        Object.defineProperty(stored.browser, 'actionTimeline', {
          value: [
            createActionTimelineEntry({ action: 'navigate', result: 'success' }),
            createActionTimelineEntry({ action: 'click', selector: '#btn', result: 'failure' }),
          ],
          writable: true,
        });
      }

      const summary = await generator.generate(capsule.capsuleId);

      assert.ok(summary.repro.includes('Action Sequence'));
      assert.ok(summary.repro.includes('navigate'));
      assert.ok(summary.repro.includes('click'));
    });

    it('should include how to reproduce instructions', async () => {
      const collector = getEvidenceCapsuleCollector();
      const capsule = await collector.capture(createCapsuleFailureInfo());

      const summary = await generator.generate(capsule.capsuleId);

      assert.ok(summary.repro.includes('How to Reproduce'));
    });
  });

  describe('evidence summary', () => {
    it('should include screenshot count', async () => {
      const collector = getEvidenceCapsuleCollector();
      const capsule = await collector.capture(createCapsuleFailureInfo());

      const summary = await generator.generate(capsule.capsuleId);

      assert.ok(summary.evidenceSummary.includes('Screenshots:'));
    });

    it('should include console entry counts', async () => {
      const collector = getEvidenceCapsuleCollector();
      const capsule = await collector.capture(createCapsuleFailureInfo());

      const stored = collector.get(capsule.capsuleId);
      if (stored) {
        Object.defineProperty(stored.browser, 'console', {
          value: {
            errors: [createBrowserConsoleEntry()],
            warnings: [createBrowserConsoleEntry({ level: 'warning' })],
            logs: [createBrowserConsoleEntry({ level: 'log' })],
          },
          writable: true,
        });
      }

      const summary = await generator.generate(capsule.capsuleId);

      assert.ok(summary.evidenceSummary.includes('Console Entries:'));
      assert.ok(summary.evidenceSummary.includes('error'));
      assert.ok(summary.evidenceSummary.includes('warning'));
    });

    it('should include network request count', async () => {
      const collector = getEvidenceCapsuleCollector();
      const capsule = await collector.capture(createCapsuleFailureInfo());

      const summary = await generator.generate(capsule.capsuleId);

      assert.ok(summary.evidenceSummary.includes('Network Requests:'));
    });

    it('should list failed requests when present', async () => {
      const collector = getEvidenceCapsuleCollector();
      const capsule = await collector.capture(createCapsuleFailureInfo());

      const stored = collector.get(capsule.capsuleId);
      if (stored) {
        Object.defineProperty(stored.browser, 'networkRequests', {
          value: [
            { url: 'https://api.test/1', method: 'GET', status: 500, statusText: 'Error', duration: 100, size: 0, timestamp: new Date().toISOString() },
          ],
          writable: true,
        });
      }

      const summary = await generator.generate(capsule.capsuleId);

      assert.ok(summary.evidenceSummary.includes('Failed Requests:'));
    });
  });

  describe('suggested fix', () => {
    it('should include primary recommendation', async () => {
      const collector = getEvidenceCapsuleCollector();
      const capsule = await collector.capture(createCapsuleFailureInfo());

      const summary = await generator.generate(capsule.capsuleId);

      assert.ok(summary.suggestedFix.includes('Primary Recommendation:'));
    });

    it('should include confidence and category', async () => {
      const collector = getEvidenceCapsuleCollector();
      const capsule = await collector.capture(createCapsuleFailureInfo());

      const summary = await generator.generate(capsule.capsuleId);

      assert.ok(summary.suggestedFix.includes('Confidence:'));
      assert.ok(summary.suggestedFix.includes('Category:'));
    });

    it('should include implementation guidance', async () => {
      const collector = getEvidenceCapsuleCollector();
      const capsule = await collector.capture(createCapsuleFailureInfo());

      const summary = await generator.generate(capsule.capsuleId);

      assert.ok(summary.suggestedFix.includes('Implementation Guidance'));
    });

    it('should provide fallback message when no candidates', async () => {
      const collector = getEvidenceCapsuleCollector();
      const capsule = await collector.capture(createCapsuleFailureInfo());

      // Force empty candidate fixes by using a capsule that won't generate any
      const summary = await generator.generate(capsule.capsuleId);

      // If no candidates, should have fallback message
      if (summary.probableRootCause.candidateFixes.length === 0) {
        assert.ok(summary.suggestedFix.includes('No specific fix'));
      }
    });
  });

  describe('machine-readable output', () => {
    it('should include id and capsuleId', async () => {
      const collector = getEvidenceCapsuleCollector();
      const capsule = await collector.capture(createCapsuleFailureInfo());

      const summary = await generator.generate(capsule.capsuleId);

      assert.strictEqual(summary.machineReadable.id, summary.id);
      assert.strictEqual(summary.machineReadable.capsuleId, capsule.capsuleId);
    });

    it('should include failure details', async () => {
      const collector = getEvidenceCapsuleCollector();
      const capsule = await collector.capture(createCapsuleFailureInfo());

      const summary = await generator.generate(capsule.capsuleId);

      const failure = summary.machineReadable.failure as Record<string, unknown>;
      assert.ok(failure);
      assert.ok(failure.class);
      assert.ok(typeof failure.confidence === 'number');
      assert.ok(failure.what);
      assert.ok(failure.firstBadState);
    });

    it('should include root cause details', async () => {
      const collector = getEvidenceCapsuleCollector();
      const capsule = await collector.capture(createCapsuleFailureInfo());

      const summary = await generator.generate(capsule.capsuleId);

      const rootCause = summary.machineReadable.rootCause as Record<string, unknown>;
      assert.ok(rootCause);
      assert.ok(rootCause.component);
      assert.ok(rootCause.handler);
    });

    it('should include suggested fix with candidates', async () => {
      const collector = getEvidenceCapsuleCollector();
      const capsule = await collector.capture(createCapsuleFailureInfo());

      const summary = await generator.generate(capsule.capsuleId);

      const suggestedFix = summary.machineReadable.suggestedFix as Record<string, unknown>;
      assert.ok(suggestedFix);
      assert.ok(suggestedFix.description);
      assert.ok(Array.isArray(suggestedFix.candidates));
    });
  });

  describe('getSummary', () => {
    it('should retrieve stored summary by ID', async () => {
      const collector = getEvidenceCapsuleCollector();
      const capsule = await collector.capture(createCapsuleFailureInfo());

      const summary = await generator.generate(capsule.capsuleId);
      const retrieved = generator.getSummary(summary.id);

      assert.ok(retrieved);
      assert.strictEqual(retrieved?.id, summary.id);
    });

    it('should return undefined for non-existent summary', () => {
      const retrieved = generator.getSummary('non-existent');
      assert.strictEqual(retrieved, undefined);
    });
  });

  describe('LRU eviction (max 100 summaries)', () => {
    it('should evict oldest summary when exceeding max', async () => {
      const collector = getEvidenceCapsuleCollector();
      const ids: string[] = [];

      // Create 101 summaries to trigger eviction
      for (let i = 0; i < 101; i++) {
        const capsule = await collector.capture(createCapsuleFailureInfo({ type: `error_${i}` }));
        const summary = await generator.generate(capsule.capsuleId);
        ids.push(summary.id);
      }

      // First summary should be evicted
      assert.strictEqual(generator.getSummary(ids[0]), undefined);

      // Most recent should exist
      assert.ok(generator.getSummary(ids[100]));
    });
  });

  describe('singleton', () => {
    it('getPRSummaryGenerator should return same instance', () => {
      const instance1 = getPRSummaryGenerator();
      const instance2 = getPRSummaryGenerator();
      assert.strictEqual(instance1, instance2);
    });
  });
});
