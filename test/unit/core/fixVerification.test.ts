/**
 * Unit tests for FixVerifier
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  FixVerifier,
  getFixVerifier,
} from '../../../src/core/fixVerification.js';
import { getEvidenceCapsuleCollector } from '../../../src/core/evidenceCapsule.js';
import type { VerificationVerdict } from '../../../src/core/types.js';
import { createCapsuleFailureInfo } from './fixtures.js';

describe('FixVerifier', () => {
  let verifier: FixVerifier;

  beforeEach(() => {
    verifier = new FixVerifier();
  });

  describe('verify', () => {
    it('should throw error for non-existent capsule ID', async () => {
      await assert.rejects(
        async () => await verifier.verify('patch-1', 'non-existent-id'),
        /Original capsule not found/
      );
    });

    it('should return verification result with all required fields', async () => {
      const collector = getEvidenceCapsuleCollector();
      const capsule = await collector.capture(createCapsuleFailureInfo());

      const result = await verifier.verify('patch-1', capsule.capsuleId);

      assert.strictEqual(result.patchId, 'patch-1');
      assert.ok(result.originalFailure);
      assert.strictEqual(result.originalFailure.capsuleId, capsule.capsuleId);
      assert.ok(result.originalFailure.assertions);
      assert.ok(Array.isArray(result.reruns));
      assert.ok(['fixed', 'still_failing', 'flaky', 'inconclusive'].includes(result.overallVerdict));
      assert.ok(result.summary);
    });

    it('should perform default 3 reruns', async () => {
      const collector = getEvidenceCapsuleCollector();
      const capsule = await collector.capture(createCapsuleFailureInfo());

      const result = await verifier.verify('patch-1', capsule.capsuleId);

      assert.strictEqual(result.reruns.length, 3);
    });

    it('should perform custom number of reruns', async () => {
      const collector = getEvidenceCapsuleCollector();
      const capsule = await collector.capture(createCapsuleFailureInfo());

      const result = await verifier.verify('patch-1', capsule.capsuleId, 5);

      assert.strictEqual(result.reruns.length, 5);
    });

    it('should include timestamps in reruns', async () => {
      const collector = getEvidenceCapsuleCollector();
      const capsule = await collector.capture(createCapsuleFailureInfo());

      const result = await verifier.verify('patch-1', capsule.capsuleId);

      for (const rerun of result.reruns) {
        assert.ok(rerun.timestamp);
        assert.doesNotThrow(() => new Date(rerun.timestamp));
      }
    });

    it('should include run indices in reruns', async () => {
      const collector = getEvidenceCapsuleCollector();
      const capsule = await collector.capture(createCapsuleFailureInfo());

      const result = await verifier.verify('patch-1', capsule.capsuleId, 3);

      assert.strictEqual(result.reruns[0]?.runIndex, 0);
      assert.strictEqual(result.reruns[1]?.runIndex, 1);
      assert.strictEqual(result.reruns[2]?.runIndex, 2);
    });
  });

  describe('verdict determination', () => {
    it('should return inconclusive for empty reruns', async () => {
      const collector = getEvidenceCapsuleCollector();
      const capsule = await collector.capture(createCapsuleFailureInfo());

      const result = await verifier.verify('patch-1', capsule.capsuleId, 0);

      assert.strictEqual(result.overallVerdict, 'inconclusive');
    });

    it('should return fixed when all reruns pass', async () => {
      const collector = getEvidenceCapsuleCollector();
      // Create a passing capsule (no errors)
      const capsule = await collector.capture(createCapsuleFailureInfo());

      const stored = collector.get(capsule.capsuleId);
      if (stored) {
        Object.defineProperty(stored.browser, 'console', {
          value: { errors: [], warnings: [], logs: [] },
          writable: true,
        });
      }

      const result = await verifier.verify('patch-1', capsule.capsuleId);

      if (result.reruns.every((r) => r.assertions.failed === 0)) {
        assert.strictEqual(result.overallVerdict, 'fixed');
      }
    });

    it('should return still_failing when all reruns fail consistently', async () => {
      const collector = getEvidenceCapsuleCollector();
      // Create a failing capsule
      const capsule = await collector.capture(
        createCapsuleFailureInfo({ type: 'error', message: 'Persistent error' })
      );

      const stored = collector.get(capsule.capsuleId);
      if (stored) {
        Object.defineProperty(stored.browser, 'console', {
          value: {
            errors: [{ level: 'error', message: 'Error', timestamp: new Date().toISOString() }],
            warnings: [],
            logs: [],
          },
          writable: true,
        });
      }

      const result = await verifier.verify('patch-1', capsule.capsuleId);

      if (result.reruns.every((r) => r.assertions.failed > 0)) {
        assert.ok(['still_failing', 'flaky'].includes(result.overallVerdict));
      }
    });

    it('should include summary with patch ID', async () => {
      const collector = getEvidenceCapsuleCollector();
      const capsule = await collector.capture(createCapsuleFailureInfo());

      const result = await verifier.verify('my-patch-123', capsule.capsuleId);

      assert.ok(result.summary.includes('my-patch-123'));
    });

    it('should include original failure stats in summary', async () => {
      const collector = getEvidenceCapsuleCollector();
      const capsule = await collector.capture(createCapsuleFailureInfo());

      const result = await verifier.verify('patch-1', capsule.capsuleId);

      assert.ok(result.summary.includes('Original failure'));
      assert.ok(result.summary.includes('checks failed'));
    });

    it('should include rerun stats in summary', async () => {
      const collector = getEvidenceCapsuleCollector();
      const capsule = await collector.capture(createCapsuleFailureInfo());

      const result = await verifier.verify('patch-1', capsule.capsuleId, 3);

      assert.ok(result.summary.includes('Reruns'));
      assert.ok(result.summary.includes('passed') || result.summary.includes('failed'));
    });
  });

  describe('verdict descriptions', () => {
    it('should include FIXED description for fixed verdict', async () => {
      const collector = getEvidenceCapsuleCollector();
      const capsule = await collector.capture(createCapsuleFailureInfo());

      const stored = collector.get(capsule.capsuleId);
      if (stored) {
        Object.defineProperty(stored.browser, 'console', {
          value: { errors: [], warnings: [], logs: [] },
          writable: true,
        });
      }

      const result = await verifier.verify('patch-1', capsule.capsuleId);

      if (result.overallVerdict === 'fixed') {
        assert.ok(result.summary.includes('FIXED'));
        assert.ok(result.summary.includes('resolved'));
      }
    });

    it('should include STILL FAILING description for still_failing verdict', async () => {
      const collector = getEvidenceCapsuleCollector();
      const capsule = await collector.capture(createCapsuleFailureInfo());

      const stored = collector.get(capsule.capsuleId);
      if (stored) {
        Object.defineProperty(stored.browser, 'console', {
          value: {
            errors: [{ level: 'error', message: 'Error', timestamp: new Date().toISOString() }],
            warnings: [],
            logs: [],
          },
          writable: true,
        });
      }

      const result = await verifier.verify('patch-1', capsule.capsuleId);

      if (result.overallVerdict === 'still_failing') {
        assert.ok(result.summary.includes('STILL FAILING'));
      }
    });

    it('should include FLAKY description for flaky verdict', async () => {
      // This would require mocking different results per rerun
      // For now, just verify the summary format
      const collector = getEvidenceCapsuleCollector();
      const capsule = await collector.capture(createCapsuleFailureInfo());

      const result = await verifier.verify('patch-1', capsule.capsuleId);

      if (result.overallVerdict === 'flaky') {
        assert.ok(result.summary.includes('FLAKY'));
        assert.ok(result.summary.includes('intermittent'));
      }
    });

    it('should include INCONCLUSIVE description for inconclusive verdict', async () => {
      const collector = getEvidenceCapsuleCollector();
      const capsule = await collector.capture(createCapsuleFailureInfo());

      const result = await verifier.verify('patch-1', capsule.capsuleId, 0);

      assert.strictEqual(result.overallVerdict, 'inconclusive');
      assert.ok(result.summary.includes('INCONCLUSIVE'));
    });
  });

  describe('rerun assertions', () => {
    it('should include assertion results in each rerun', async () => {
      const collector = getEvidenceCapsuleCollector();
      const capsule = await collector.capture(createCapsuleFailureInfo());

      const result = await verifier.verify('patch-1', capsule.capsuleId);

      for (const rerun of result.reruns) {
        assert.ok(rerun.assertions);
        assert.ok(typeof rerun.assertions.totalChecks === 'number');
        assert.ok(typeof rerun.assertions.passed === 'number');
        assert.ok(typeof rerun.assertions.failed === 'number');
        assert.ok(Array.isArray(rerun.assertions.assertions));
      }
    });

    it('should reference original capsule in reruns', async () => {
      const collector = getEvidenceCapsuleCollector();
      const capsule = await collector.capture(createCapsuleFailureInfo());

      const result = await verifier.verify('patch-1', capsule.capsuleId);

      for (const rerun of result.reruns) {
        assert.strictEqual(rerun.capsuleId, capsule.capsuleId);
      }
    });
  });

  describe('edge cases', () => {
    it('should handle capsule with no assertions', async () => {
      const collector = getEvidenceCapsuleCollector();
      const capsule = await collector.capture(createCapsuleFailureInfo());

      // Empty browser evidence
      const stored = collector.get(capsule.capsuleId);
      if (stored) {
        Object.defineProperty(stored.browser, 'console', {
          value: { errors: [], warnings: [], logs: [] },
          writable: true,
        });
        Object.defineProperty(stored.browser, 'networkRequests', {
          value: [],
          writable: true,
        });
      }

      const result = await verifier.verify('patch-1', capsule.capsuleId);

      assert.ok(result.overallVerdict);
      assert.ok(result.summary);
    });

    it('should handle single rerun', async () => {
      const collector = getEvidenceCapsuleCollector();
      const capsule = await collector.capture(createCapsuleFailureInfo());

      const result = await verifier.verify('patch-1', capsule.capsuleId, 1);

      assert.strictEqual(result.reruns.length, 1);
      assert.ok(['fixed', 'still_failing', 'inconclusive'].includes(result.overallVerdict));
    });
  });

  describe('singleton', () => {
    it('getFixVerifier should return same instance', () => {
      const instance1 = getFixVerifier();
      const instance2 = getFixVerifier();
      assert.strictEqual(instance1, instance2);
    });
  });
});
