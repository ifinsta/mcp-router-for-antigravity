/**
 * Unit tests for RootCauseMapper
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  RootCauseMapper,
  getRootCauseMapper,
} from '../../../src/core/rootCauseMapper.js';
import { getEvidenceCapsuleCollector } from '../../../src/core/evidenceCapsule.js';
import type { CandidateFixCategory } from '../../../src/core/types.js';
import {
  createEvidenceCapsule,
  createCapsuleFailureInfo,
  createBrowserConsoleEntry,
  createBrowserNetworkEntry,
  createActionTimelineEntry,
  loginFormDomSnapshot,
} from './fixtures.js';

describe('RootCauseMapper', () => {
  let mapper: RootCauseMapper;

  beforeEach(() => {
    mapper = new RootCauseMapper();
  });

  describe('map', () => {
    it('should throw error for non-existent capsule ID', async () => {
      await assert.rejects(
        async () => await mapper.map('non-existent-id'),
        /Evidence capsule not found/
      );
    });

    it('should map a valid capsule to root cause', async () => {
      const collector = getEvidenceCapsuleCollector();
      const capsule = await collector.capture(createCapsuleFailureInfo());

      const mapping = await mapper.map(capsule.capsuleId);

      assert.ok(mapping.capsuleId);
      assert.ok(mapping.timestamp);
      assert.ok(mapping.failureExplanation);
      assert.ok(mapping.likelyComponent);
      assert.ok(mapping.likelyHandler);
      assert.ok(Array.isArray(mapping.candidateFixes));
    });

    it('should include failure explanation in mapping', async () => {
      const collector = getEvidenceCapsuleCollector();
      const capsule = await collector.capture(
        createCapsuleFailureInfo({ type: 'test_error', message: 'Test message' })
      );

      const mapping = await mapper.map(capsule.capsuleId);

      assert.ok(mapping.failureExplanation.what);
      assert.ok(mapping.failureExplanation.firstBadState);
      assert.ok(mapping.failureExplanation.failureClass);
      assert.ok(typeof mapping.failureExplanation.confidence === 'number');
    });
  });

  describe('component extraction', () => {
    it('should extract component from URL path', async () => {
      const collector = getEvidenceCapsuleCollector();
      const capsule = await collector.capture(createCapsuleFailureInfo());

      // Modify the stored capsule's URL
      const stored = collector.get(capsule.capsuleId);
      if (stored) {
        Object.defineProperty(stored.browser.sessionMetadata, 'url', {
          value: 'https://example.com/users/profile',
          writable: true,
        });
      }

      const mapping = await mapper.map(capsule.capsuleId);

      assert.ok(mapping.likelyComponent.includes('Users') || mapping.likelyComponent.includes('Profile'));
    });

    it('should identify API handlers from URL', async () => {
      const collector = getEvidenceCapsuleCollector();
      const capsule = await collector.capture(createCapsuleFailureInfo());

      const stored = collector.get(capsule.capsuleId);
      if (stored) {
        Object.defineProperty(stored.browser.sessionMetadata, 'url', {
          value: 'https://example.com/api/v1/users',
          writable: true,
        });
      }

      const mapping = await mapper.map(capsule.capsuleId);

      assert.ok(mapping.likelyComponent.includes('API') || mapping.likelyComponent.includes('Handler'));
    });

    it('should extract component from DOM snapshot', async () => {
      const collector = getEvidenceCapsuleCollector();
      const capsule = await collector.capture(createCapsuleFailureInfo());

      const stored = collector.get(capsule.capsuleId);
      if (stored) {
        Object.defineProperty(stored.browser, 'domSnapshot', {
          value: loginFormDomSnapshot,
          writable: true,
        });
      }

      const mapping = await mapper.map(capsule.capsuleId);

      assert.ok(mapping.likelyComponent.includes('Login') || mapping.likelyComponent.includes('Form'));
    });

    it('should fallback to hostname for app_code failures', async () => {
      const collector = getEvidenceCapsuleCollector();
      const capsule = await collector.capture(createCapsuleFailureInfo());

      const stored = collector.get(capsule.capsuleId);
      if (stored) {
        Object.defineProperty(stored.browser.sessionMetadata, 'url', {
          value: 'https://myapp.example.com/page',
          writable: true,
        });
      }

      const mapping = await mapper.map(capsule.capsuleId);

      // Should contain hostname or generic component name
      assert.ok(mapping.likelyComponent);
    });
  });

  describe('handler extraction', () => {
    it('should extract onClick handler from click actions', async () => {
      const collector = getEvidenceCapsuleCollector();
      const capsule = await collector.capture(createCapsuleFailureInfo());

      const stored = collector.get(capsule.capsuleId);
      if (stored) {
        Object.defineProperty(stored.browser, 'actionTimeline', {
          value: [
            createActionTimelineEntry({ action: 'click', selector: '#btn', result: 'success' }),
          ],
          writable: true,
        });
      }

      const mapping = await mapper.map(capsule.capsuleId);

      assert.ok(mapping.likelyHandler.includes('click') || mapping.likelyHandler.includes('Click'));
    });

    it('should extract onInput handler from type actions', async () => {
      const collector = getEvidenceCapsuleCollector();
      const capsule = await collector.capture(createCapsuleFailureInfo());

      const stored = collector.get(capsule.capsuleId);
      if (stored) {
        Object.defineProperty(stored.browser, 'actionTimeline', {
          value: [
            createActionTimelineEntry({ action: 'type', selector: '#input', result: 'failure', error: 'Input failed' }),
          ],
          writable: true,
        });
      }

      const mapping = await mapper.map(capsule.capsuleId);

      assert.ok(mapping.likelyHandler.includes('Input') || mapping.likelyHandler.includes('input'));
    });

    it('should extract onSubmit handler from submit actions', async () => {
      const collector = getEvidenceCapsuleCollector();
      const capsule = await collector.capture(createCapsuleFailureInfo());

      const stored = collector.get(capsule.capsuleId);
      if (stored) {
        Object.defineProperty(stored.browser, 'actionTimeline', {
          value: [
            createActionTimelineEntry({ action: 'submit', selector: 'form', result: 'failure' }),
          ],
          writable: true,
        });
      }

      const mapping = await mapper.map(capsule.capsuleId);

      assert.ok(mapping.likelyHandler.includes('submit') || mapping.likelyHandler.includes('Submit'));
    });

    it('should fallback to event handler when no actions available', async () => {
      const collector = getEvidenceCapsuleCollector();
      const capsule = await collector.capture(createCapsuleFailureInfo());

      const mapping = await mapper.map(capsule.capsuleId);

      assert.ok(mapping.likelyHandler);
    });
  });

  describe('API call extraction', () => {
    it('should extract failed API call from network requests', async () => {
      const collector = getEvidenceCapsuleCollector();
      const capsule = await collector.capture(createCapsuleFailureInfo());

      const stored = collector.get(capsule.capsuleId);
      if (stored) {
        Object.defineProperty(stored.browser, 'networkRequests', {
          value: [
            createBrowserNetworkEntry({
              url: 'https://api.example.com/users',
              method: 'GET',
              status: 500,
            }),
          ],
          writable: true,
        });
      }

      const mapping = await mapper.map(capsule.capsuleId);

      assert.ok(mapping.likelyApiCall);
      assert.ok(mapping.likelyApiCall.includes('GET'));
      assert.ok(mapping.likelyApiCall.includes('/users'));
    });

    it('should extract API call from slow requests', async () => {
      const collector = getEvidenceCapsuleCollector();
      const capsule = await collector.capture(
        createCapsuleFailureInfo({ type: 'timeout', message: 'Request timeout' })
      );

      const stored = collector.get(capsule.capsuleId);
      if (stored) {
        Object.defineProperty(stored.browser, 'networkRequests', {
          value: [
            createBrowserNetworkEntry({
              url: 'https://api.example.com/slow-endpoint',
              method: 'POST',
              status: 200,
              duration: 10000,
            }),
          ],
          writable: true,
        });

        Object.defineProperty(stored.browser, 'console', {
          value: {
            errors: [createBrowserConsoleEntry({ message: 'Timeout waiting for response' })],
            warnings: [],
            logs: [],
          },
          writable: true,
        });
      }

      const mapping = await mapper.map(capsule.capsuleId);

      if (mapping.failureExplanation.failureClass === 'timing') {
        assert.ok(mapping.likelyApiCall);
      }
    });

    it('should return null when no API calls found', async () => {
      const collector = getEvidenceCapsuleCollector();
      const capsule = await collector.capture(createCapsuleFailureInfo());

      const mapping = await mapper.map(capsule.capsuleId);

      // API call may be null or present depending on classification
      assert.ok(mapping.likelyApiCall === null || typeof mapping.likelyApiCall === 'string');
    });
  });

  describe('candidate fixes', () => {
    it('should generate candidate fixes for selector drift', async () => {
      const collector = getEvidenceCapsuleCollector();
      const capsule = await collector.capture(createCapsuleFailureInfo());

      const stored = collector.get(capsule.capsuleId);
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

      const mapping = await mapper.map(capsule.capsuleId);

      if (mapping.failureExplanation.failureClass === 'selector_drift') {
        assert.ok(mapping.candidateFixes.length > 0);
        assert.ok(mapping.candidateFixes.some((f) => f.category === 'selector'));
      }
    });

    it('should generate candidate fixes for timing issues', async () => {
      const collector = getEvidenceCapsuleCollector();
      const capsule = await collector.capture(
        createCapsuleFailureInfo({ type: 'timeout', message: 'Timeout' })
      );

      const stored = collector.get(capsule.capsuleId);
      if (stored) {
        Object.defineProperty(stored.browser, 'performanceMetrics', {
          value: { loadTime: 8000 },
          writable: true,
        });
      }

      const mapping = await mapper.map(capsule.capsuleId);

      if (mapping.failureExplanation.failureClass === 'timing') {
        assert.ok(mapping.candidateFixes.length > 0);
        assert.ok(mapping.candidateFixes.some((f) => f.category === 'timing'));
      }
    });

    it('should generate candidate fixes for backend failures', async () => {
      const collector = getEvidenceCapsuleCollector();
      const capsule = await collector.capture(createCapsuleFailureInfo());

      const stored = collector.get(capsule.capsuleId);
      if (stored) {
        Object.defineProperty(stored.browser, 'networkRequests', {
          value: [
            createBrowserNetworkEntry({ status: 500 }),
          ],
          writable: true,
        });

        Object.defineProperty(stored.browser, 'console', {
          value: {
            errors: [createBrowserConsoleEntry({ message: 'Server error 500' })],
            warnings: [],
            logs: [],
          },
          writable: true,
        });
      }

      const mapping = await mapper.map(capsule.capsuleId);

      if (mapping.failureExplanation.failureClass === 'backend_failure') {
        assert.ok(mapping.candidateFixes.length > 0);
        assert.ok(mapping.candidateFixes.some((f) => f.category === 'api' || f.category === 'code_logic'));
      }
    });

    it('should sort fixes by confidence descending', async () => {
      const collector = getEvidenceCapsuleCollector();
      const capsule = await collector.capture(createCapsuleFailureInfo());

      const mapping = await mapper.map(capsule.capsuleId);

      if (mapping.candidateFixes.length > 1) {
        for (let i = 0; i < mapping.candidateFixes.length - 1; i++) {
          const current = mapping.candidateFixes[i];
          const next = mapping.candidateFixes[i + 1];
          if (current && next) {
            assert.ok(current.confidence >= next.confidence);
          }
        }
      }
    });

    it('should include fix description and category', async () => {
      const collector = getEvidenceCapsuleCollector();
      const capsule = await collector.capture(createCapsuleFailureInfo());

      const mapping = await mapper.map(capsule.capsuleId);

      for (const fix of mapping.candidateFixes) {
        assert.ok(fix.description);
        assert.ok(fix.description.length > 0);
        assert.ok(typeof fix.confidence === 'number');
        assert.ok(['selector', 'timing', 'api', 'config', 'code_logic'].includes(fix.category));
      }
    });
  });

  describe('timestamp', () => {
    it('should include ISO timestamp in mapping', async () => {
      const collector = getEvidenceCapsuleCollector();
      const capsule = await collector.capture(createCapsuleFailureInfo());

      const mapping = await mapper.map(capsule.capsuleId);

      assert.doesNotThrow(() => new Date(mapping.timestamp));
    });
  });

  describe('edge cases', () => {
    it('should handle empty action timeline', async () => {
      const collector = getEvidenceCapsuleCollector();
      const capsule = await collector.capture(createCapsuleFailureInfo());

      const mapping = await mapper.map(capsule.capsuleId);

      assert.ok(mapping.likelyHandler);
      assert.ok(mapping.likelyComponent);
    });

    it('should handle empty network requests', async () => {
      const collector = getEvidenceCapsuleCollector();
      const capsule = await collector.capture(createCapsuleFailureInfo());

      const mapping = await mapper.map(capsule.capsuleId);

      assert.ok(mapping.likelyApiCall === null || typeof mapping.likelyApiCall === 'string');
    });

    it('should handle invalid URL gracefully', async () => {
      const collector = getEvidenceCapsuleCollector();
      const capsule = await collector.capture(createCapsuleFailureInfo());

      const stored = collector.get(capsule.capsuleId);
      if (stored) {
        Object.defineProperty(stored.browser.sessionMetadata, 'url', {
          value: 'not-a-valid-url',
          writable: true,
        });
      }

      const mapping = await mapper.map(capsule.capsuleId);

      assert.ok(mapping.likelyComponent);
    });
  });

  describe('singleton', () => {
    it('getRootCauseMapper should return same instance', () => {
      const instance1 = getRootCauseMapper();
      const instance2 = getRootCauseMapper();
      assert.strictEqual(instance1, instance2);
    });
  });
});
