/**
 * Unit tests for EvidenceCapsuleCollector
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  EvidenceCapsuleCollector,
  getEvidenceCapsuleCollector,
} from '../../../src/core/evidenceCapsule.js';
import { createCapsuleFailureInfo } from './fixtures.js';

describe('EvidenceCapsuleCollector', () => {
  let collector: EvidenceCapsuleCollector;

  beforeEach(() => {
    collector = new EvidenceCapsuleCollector();
  });

  describe('capture', () => {
    it('should create a capsule with valid ID and timestamp', async () => {
      const failure = createCapsuleFailureInfo({ type: 'test_error', message: 'Test error' });
      const capsule = await collector.capture(failure);

      assert.ok(capsule.capsuleId, 'Capsule should have an ID');
      assert.ok(capsule.capsuleId.length > 0, 'Capsule ID should not be empty');
      assert.ok(capsule.timestamp, 'Capsule should have a timestamp');
      assert.doesNotThrow(() => new Date(capsule.timestamp), 'Timestamp should be valid ISO string');
    });

    it('should store failure info in the capsule', async () => {
      const failure = createCapsuleFailureInfo({
        type: 'custom_error',
        message: 'Custom error message',
        stack: 'Error: Custom\n    at test.js:1:1',
      });
      const capsule = await collector.capture(failure);

      assert.strictEqual(capsule.failure.type, 'custom_error');
      assert.strictEqual(capsule.failure.message, 'Custom error message');
      assert.strictEqual(capsule.failure.stack, 'Error: Custom\n    at test.js:1:1');
    });

    it('should include browser evidence with default structure', async () => {
      const failure = createCapsuleFailureInfo();
      const capsule = await collector.capture(failure);

      assert.ok(capsule.browser, 'Capsule should have browser evidence');
      assert.ok(Array.isArray(capsule.browser.screenshots), 'Screenshots should be an array');
      assert.ok(capsule.browser.console, 'Console should be present');
      assert.ok(Array.isArray(capsule.browser.console.errors), 'Console errors should be an array');
      assert.ok(Array.isArray(capsule.browser.console.warnings), 'Console warnings should be an array');
      assert.ok(Array.isArray(capsule.browser.console.logs), 'Console logs should be an array');
      assert.ok(Array.isArray(capsule.browser.networkRequests), 'Network requests should be an array');
      assert.ok(typeof capsule.browser.performanceMetrics === 'object', 'Performance metrics should be an object');
      assert.ok(capsule.browser.sessionMetadata, 'Session metadata should be present');
      assert.ok(Array.isArray(capsule.browser.actionTimeline), 'Action timeline should be an array');
    });
  });

  describe('get', () => {
    it('should retrieve a stored capsule by ID', async () => {
      const failure = createCapsuleFailureInfo();
      const capsule = await collector.capture(failure);

      const retrieved = collector.get(capsule.capsuleId);

      assert.ok(retrieved, 'Should retrieve the capsule');
      assert.strictEqual(retrieved?.capsuleId, capsule.capsuleId);
      assert.strictEqual(retrieved?.failure.message, capsule.failure.message);
    });

    it('should return undefined for non-existent capsule ID', () => {
      const retrieved = collector.get('non-existent-id');
      assert.strictEqual(retrieved, undefined);
    });

    it('should return undefined for empty string ID', () => {
      const retrieved = collector.get('');
      assert.strictEqual(retrieved, undefined);
    });
  });

  describe('list', () => {
    it('should return empty array when no capsules exist', () => {
      const list = collector.list();
      assert.ok(Array.isArray(list));
      assert.strictEqual(list.length, 0);
    });

    it('should list all stored capsules with summary info', async () => {
      const failure1 = createCapsuleFailureInfo({ type: 'error_1' });
      const failure2 = createCapsuleFailureInfo({ type: 'error_2' });

      const capsule1 = await collector.capture(failure1);
      const capsule2 = await collector.capture(failure2);

      const list = collector.list();

      assert.strictEqual(list.length, 2);
      assert.ok(list.some((c) => c.capsuleId === capsule1.capsuleId && c.failureType === 'error_1'));
      assert.ok(list.some((c) => c.capsuleId === capsule2.capsuleId && c.failureType === 'error_2'));
    });

    it('should include timestamp and failureType in list items', async () => {
      const failure = createCapsuleFailureInfo({ type: 'test_type' });
      const capsule = await collector.capture(failure);

      const list = collector.list();

      assert.strictEqual(list.length, 1);
      assert.ok(list[0]?.capsuleId);
      assert.ok(list[0]?.timestamp);
      assert.strictEqual(list[0]?.failureType, 'test_type');
    });
  });

  describe('LRU eviction (max 50 capsules)', () => {
    it('should evict oldest capsule when exceeding max capacity', async () => {
      // Create 51 capsules to trigger eviction
      const capsules: string[] = [];
      for (let i = 0; i < 51; i++) {
        const failure = createCapsuleFailureInfo({ type: `error_${i}` });
        const capsule = await collector.capture(failure);
        capsules.push(capsule.capsuleId);
      }

      const list = collector.list();
      assert.strictEqual(list.length, 50, 'Should maintain max 50 capsules');

      // First capsule should be evicted
      const firstCapsule = collector.get(capsules[0]!);
      assert.strictEqual(firstCapsule, undefined, 'Oldest capsule should be evicted');

      // Most recent capsules should still exist
      const lastCapsule = collector.get(capsules[50]!);
      assert.ok(lastCapsule, 'Most recent capsule should exist');
    });

    it('should maintain exactly 50 capsules at capacity', async () => {
      // Create exactly 50 capsules
      for (let i = 0; i < 50; i++) {
        const failure = createCapsuleFailureInfo({ type: `error_${i}` });
        await collector.capture(failure);
      }

      const list = collector.list();
      assert.strictEqual(list.length, 50);
    });
  });

  describe('singleton', () => {
    it('getEvidenceCapsuleCollector should return same instance', () => {
      const instance1 = getEvidenceCapsuleCollector();
      const instance2 = getEvidenceCapsuleCollector();
      assert.strictEqual(instance1, instance2);
    });

    it('new instances should be independent', async () => {
      const collector1 = new EvidenceCapsuleCollector();
      const collector2 = new EvidenceCapsuleCollector();

      const failure = createCapsuleFailureInfo();
      const capsule = await collector1.capture(failure);

      // Capsule should exist in collector1 but not collector2
      assert.ok(collector1.get(capsule.capsuleId));
      assert.strictEqual(collector2.get(capsule.capsuleId), undefined);
    });
  });

  describe('edge cases', () => {
    it('should handle failure with empty message', async () => {
      const failure = createCapsuleFailureInfo({ message: '' });
      const capsule = await collector.capture(failure);

      assert.strictEqual(capsule.failure.message, '');
      assert.ok(collector.get(capsule.capsuleId));
    });

    it('should handle failure with very long message', async () => {
      const longMessage = 'x'.repeat(10000);
      const failure = createCapsuleFailureInfo({ message: longMessage });
      const capsule = await collector.capture(failure);

      assert.strictEqual(capsule.failure.message, longMessage);
    });

    it('should handle failure without stack trace', async () => {
      const failure = createCapsuleFailureInfo({ stack: undefined });
      const capsule = await collector.capture(failure);

      assert.strictEqual(capsule.failure.stack, undefined);
    });
  });
});
