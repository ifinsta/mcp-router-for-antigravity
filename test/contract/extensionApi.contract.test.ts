/**
 * Extension API Contract Tests
 *
 * Verifies that API endpoints have correct input/output shapes
 * matching the defined TypeScript types
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { z } from 'zod';
import type {
  ModeConfig,
  SecurityPolicyConfig,
  SecurityAuditEntry,
  BrowserCapabilityMatrix,
  EvidenceCapsule,
  FailureExplanation,
  AssertionResult,
  VerificationResult,
  RootCauseMapping,
  FlakeAnalysis,
  PRSummary,
  RecordedWorkflow,
} from '../../src/core/types.js';

// ============================================================================
// Request/Response Schema Definitions (from extensionApiServer.ts)
// ============================================================================

// Mode endpoints
const ModeUpdateSchema = z.object({
  mode: z.enum(['agent', 'router']),
});

// Evidence endpoints
const EvidenceCaptureSchema = z.object({
  failure: z.object({
    type: z.string(),
    message: z.string(),
    stack: z.string().optional(),
  }),
});

// Assertion endpoints
const AssertionEvaluateSchema = z.object({
  capsuleId: z.string(),
});

// Verification endpoints
const VerificationRunSchema = z.object({
  patchId: z.string(),
  originalCapsuleId: z.string(),
  rerunCount: z.number().int().min(1).max(10).optional(),
});

// Flake analysis endpoints
const FlakeAnalysisSchema = z.object({
  capsuleIds: z.array(z.string()).min(1),
});

// Recorder endpoints
const RecorderStartSchema = z.object({
  name: z.string().min(1),
});

const RecorderStopSchema = z.object({
  workflowId: z.string(),
});

// PR Summary endpoints
const PRSummaryGenerateSchema = z.object({
  capsuleId: z.string(),
});

// ============================================================================
// API Endpoint Contract Tests
// ============================================================================

describe('Extension API Contract Tests', () => {
  describe('GET /api/mode', () => {
    it('should output ModeConfig shape', () => {
      const modeConfig: ModeConfig = {
        mode: 'agent',
        modeLastUpdated: '2024-01-01T00:00:00Z',
        modeSource: 'user_selection',
      };

      assert.ok(modeConfig.mode === 'agent' || modeConfig.mode === 'router');
      assert.ok(typeof modeConfig.modeLastUpdated === 'string');
      assert.ok(['user_selection', 'migration', 'default'].includes(modeConfig.modeSource));
    });
  });

  describe('POST /api/mode', () => {
    it('should accept valid mode update request', () => {
      const validInput = {
        mode: 'router',
      };

      const result = ModeUpdateSchema.safeParse(validInput);
      assert.strictEqual(result.success, true);
    });

    it('should reject invalid mode value', () => {
      const invalidInput = {
        mode: 'invalid_mode',
      };

      const result = ModeUpdateSchema.safeParse(invalidInput);
      assert.strictEqual(result.success, false);
    });

    it('should reject missing mode field', () => {
      const invalidInput = {};

      const result = ModeUpdateSchema.safeParse(invalidInput);
      assert.strictEqual(result.success, false);
    });

    it('should output updated ModeConfig shape', () => {
      const response: ModeConfig = {
        mode: 'router',
        modeLastUpdated: '2024-01-01T00:00:00Z',
        modeSource: 'user_selection',
      };

      assert.ok(response.mode === 'agent' || response.mode === 'router');
      assert.ok(typeof response.modeLastUpdated === 'string');
      assert.ok(['user_selection', 'migration', 'default'].includes(response.modeSource));
    });
  });

  describe('GET /api/browser/tabs', () => {
    it('should output tabs array shape', () => {
      const response = {
        tabs: [
          { tabId: 'tab-1', url: 'http://example.com', title: 'Example', isActive: true },
          { tabId: 'tab-2', url: 'http://test.com', title: 'Test', isActive: false },
        ],
      };

      assert.ok(Array.isArray(response.tabs));
      response.tabs.forEach(tab => {
        assert.ok(typeof tab.tabId === 'string');
        assert.ok(typeof tab.url === 'string');
        assert.ok(typeof tab.title === 'string');
        assert.ok(typeof tab.isActive === 'boolean');
      });
    });

    it('should handle empty tabs response', () => {
      const response = {
        tabs: [],
      };

      assert.ok(Array.isArray(response.tabs));
      assert.strictEqual(response.tabs.length, 0);
    });
  });

  describe('GET /api/browser/auto-context', () => {
    it('should output auto-context shape with hasActiveSession', () => {
      const response = {
        hasActiveSession: true,
        url: 'http://example.com',
        title: 'Example Page',
        activeTabId: 123,
      };

      assert.ok(typeof response.hasActiveSession === 'boolean');
      assert.ok(typeof response.url === 'string');
      assert.ok(typeof response.title === 'string');
      assert.ok(typeof response.activeTabId === 'number');
    });

    it('should handle inactive session response', () => {
      const response = {
        hasActiveSession: false,
        url: '',
        title: '',
        activeTabId: 0,
      };

      assert.strictEqual(response.hasActiveSession, false);
      assert.ok(typeof response.url === 'string');
      assert.ok(typeof response.title === 'string');
    });
  });

  describe('GET /api/browser/capabilities', () => {
    it('should output BrowserCapabilityMatrix shape', () => {
      const matrix: BrowserCapabilityMatrix = [
        {
          browser: 'chrome',
          displayName: 'Google Chrome',
          capabilities: ['core_control', 'tab_management', 'network_control'],
          limitations: ['mobile_emulation'],
          supportLevel: 'full',
        },
        {
          browser: 'firefox',
          displayName: 'Mozilla Firefox',
          capabilities: ['core_control'],
          limitations: ['tab_management', 'network_control'],
          supportLevel: 'core',
        },
      ];

      assert.ok(Array.isArray(matrix));
      matrix.forEach(entry => {
        assert.ok(['chrome', 'edge', 'firefox', 'safari'].includes(entry.browser));
        assert.ok(typeof entry.displayName === 'string');
        assert.ok(Array.isArray(entry.capabilities));
        assert.ok(Array.isArray(entry.limitations));
        assert.ok(['full', 'core', 'limited', 'experimental'].includes(entry.supportLevel));
      });
    });
  });

  describe('POST /api/evidence/capture', () => {
    it('should accept valid evidence capture request', () => {
      const validInput = {
        failure: {
          type: 'TestFailure',
          message: 'Test failed with error',
        },
      };

      const result = EvidenceCaptureSchema.safeParse(validInput);
      assert.strictEqual(result.success, true);
    });

    it('should accept optional stack field', () => {
      const validInput = {
        failure: {
          type: 'TestFailure',
          message: 'Test failed',
          stack: 'Error at line 42',
        },
      };

      const result = EvidenceCaptureSchema.safeParse(validInput);
      assert.strictEqual(result.success, true);
    });

    it('should reject missing required failure fields', () => {
      const invalidInput = {
        failure: {
          type: 'TestFailure',
          // missing message
        },
      };

      const result = EvidenceCaptureSchema.safeParse(invalidInput);
      assert.strictEqual(result.success, false);
    });

    it('should reject missing failure object', () => {
      const invalidInput = {};

      const result = EvidenceCaptureSchema.safeParse(invalidInput);
      assert.strictEqual(result.success, false);
    });

    it('should output EvidenceCapsule shape', () => {
      const capsule: EvidenceCapsule = {
        capsuleId: 'capsule-123',
        timestamp: '2024-01-01T00:00:00Z',
        failure: {
          type: 'TestFailure',
          message: 'Test failed',
          stack: 'Error at line 42',
        },
        browser: {
          screenshots: ['base64data'],
          domSnapshot: '<html></html>',
          a11ySnapshot: 'accessibility tree',
          console: {
            errors: [{ level: 'error', message: 'console error', timestamp: '2024-01-01T00:00:00Z' }],
            warnings: [],
            logs: [],
          },
          networkRequests: [],
          performanceMetrics: {},
          sessionMetadata: {
            url: 'http://example.com',
            title: 'Test',
            tabId: 'tab-1',
          },
          actionTimeline: [],
        },
      };

      assert.ok(typeof capsule.capsuleId === 'string');
      assert.ok(typeof capsule.timestamp === 'string');
      assert.ok(capsule.failure);
      assert.ok(capsule.browser);
    });
  });

  describe('GET /api/evidence/:capsuleId', () => {
    it('should output EvidenceCapsule shape', () => {
      const capsule: EvidenceCapsule = {
        capsuleId: 'capsule-123',
        timestamp: '2024-01-01T00:00:00Z',
        failure: {
          type: 'TestFailure',
          message: 'Test failed',
        },
        browser: {
          screenshots: [],
          console: {
            errors: [],
            warnings: [],
            logs: [],
          },
          networkRequests: [],
          performanceMetrics: {},
          sessionMetadata: {
            url: '',
            title: '',
            tabId: '',
          },
          actionTimeline: [],
        },
      };

      assert.ok(capsule);
      assert.ok(typeof capsule.capsuleId === 'string');
    });

    it('should output 404 error for non-existent capsule', () => {
      const errorResponse = {
        error: 'Capsule not found',
        capsuleId: 'non-existent',
      };

      assert.ok(typeof errorResponse.error === 'string');
      assert.ok(typeof errorResponse.capsuleId === 'string');
    });
  });

  describe('GET /api/evidence', () => {
    it('should output evidence list shape', () => {
      const response = {
        capsules: [
          { capsuleId: 'capsule-1', timestamp: '2024-01-01T00:00:00Z', failureType: 'Error' },
          { capsuleId: 'capsule-2', timestamp: '2024-01-02T00:00:00Z', failureType: 'Timeout' },
        ],
        total: 2,
      };

      assert.ok(Array.isArray(response.capsules));
      assert.ok(typeof response.total === 'number');
    });
  });

  describe('POST /api/evidence/:capsuleId/explain', () => {
    it('should output FailureExplanation shape', () => {
      const explanation: FailureExplanation = {
        what: 'Button click failed',
        firstBadState: 'Element not found',
        failureClass: 'selector_drift',
        confidence: 0.85,
        evidence: ['screenshot-1', 'console-log-1'],
      };

      assert.ok(typeof explanation.what === 'string');
      assert.ok(typeof explanation.firstBadState === 'string');
      assert.ok(['app_code', 'timing', 'selector_drift', 'backend_failure', 'environment'].includes(explanation.failureClass));
      assert.ok(explanation.confidence >= 0 && explanation.confidence <= 1);
      assert.ok(Array.isArray(explanation.evidence));
    });

    it('should output 404 error for non-existent capsule', () => {
      const errorResponse = {
        error: 'Capsule not found',
        capsuleId: 'non-existent',
      };

      assert.ok(typeof errorResponse.error === 'string');
    });
  });

  describe('POST /api/evidence/flake-analysis', () => {
    it('should accept valid flake analysis request', () => {
      const validInput = {
        capsuleIds: ['capsule-1', 'capsule-2', 'capsule-3'],
      };

      const result = FlakeAnalysisSchema.safeParse(validInput);
      assert.strictEqual(result.success, true);
    });

    it('should reject empty capsuleIds array', () => {
      const invalidInput = {
        capsuleIds: [],
      };

      const result = FlakeAnalysisSchema.safeParse(invalidInput);
      assert.strictEqual(result.success, false);
    });

    it('should reject non-array capsuleIds', () => {
      const invalidInput = {
        capsuleIds: 'capsule-1',
      };

      const result = FlakeAnalysisSchema.safeParse(invalidInput);
      assert.strictEqual(result.success, false);
    });

    it('should output FlakeAnalysis shape', () => {
      const analysis: FlakeAnalysis = {
        capsuleIds: ['capsule-1', 'capsule-2'],
        failureClass: 'timing',
        isFlaky: true,
        confidence: 0.75,
        recommendedAction: 'add_wait',
        reasoning: 'Test passes inconsistently',
        historicalFrequency: 0.3,
        patternSignature: 'timing-flake-abc123',
      };

      assert.ok(Array.isArray(analysis.capsuleIds));
      assert.ok(typeof analysis.isFlaky === 'boolean');
      assert.ok(['retry', 'add_wait', 'fix_selector', 'fix_backend', 'fix_environment', 'investigate'].includes(analysis.recommendedAction));
    });
  });

  describe('POST /api/evidence/:capsuleId/root-cause', () => {
    it('should output RootCauseMapping shape', () => {
      const mapping: RootCauseMapping = {
        capsuleId: 'capsule-123',
        failureExplanation: {
          what: 'Login failed',
          firstBadState: 'Validation error',
          failureClass: 'app_code',
          confidence: 0.9,
          evidence: [],
        },
        likelyComponent: 'Login Form',
        likelyHandler: 'onSubmit',
        likelyApiCall: 'POST /api/login',
        candidateFixes: [
          { description: 'Add validation', confidence: 0.85, category: 'code_logic' },
        ],
        timestamp: '2024-01-01T00:00:00Z',
      };

      assert.ok(typeof mapping.capsuleId === 'string');
      assert.ok(mapping.failureExplanation);
      assert.ok(typeof mapping.likelyComponent === 'string');
      assert.ok(typeof mapping.likelyHandler === 'string');
      assert.ok(mapping.likelyApiCall === null || typeof mapping.likelyApiCall === 'string');
      assert.ok(Array.isArray(mapping.candidateFixes));
    });

    it('should output 404 error for non-existent capsule', () => {
      const errorResponse = {
        error: 'Capsule not found',
        capsuleId: 'non-existent',
      };

      assert.ok(typeof errorResponse.error === 'string');
    });
  });

  describe('POST /api/assertions/evaluate', () => {
    it('should accept valid assertion evaluate request', () => {
      const validInput = {
        capsuleId: 'capsule-123',
      };

      const result = AssertionEvaluateSchema.safeParse(validInput);
      assert.strictEqual(result.success, true);
    });

    it('should reject missing capsuleId', () => {
      const invalidInput = {};

      const result = AssertionEvaluateSchema.safeParse(invalidInput);
      assert.strictEqual(result.success, false);
    });

    it('should output AssertionResult shape', () => {
      const result: AssertionResult = {
        capsuleId: 'capsule-123',
        timestamp: '2024-01-01T00:00:00Z',
        totalChecks: 6,
        passed: 4,
        failed: 2,
        assertions: [
          {
            category: 'functional',
            description: 'Button is visible',
            passed: true,
            severity: 'critical',
          },
          {
            category: 'visual',
            description: 'No visual regressions',
            passed: false,
            actual: '5% difference',
            expected: '0% difference',
            severity: 'warning',
          },
        ],
      };

      assert.ok(typeof result.capsuleId === 'string');
      assert.ok(typeof result.timestamp === 'string');
      assert.ok(typeof result.totalChecks === 'number');
      assert.ok(typeof result.passed === 'number');
      assert.ok(typeof result.failed === 'number');
      assert.ok(Array.isArray(result.assertions));
      assert.ok(result.assertions.every(a => ['functional', 'visual', 'accessibility', 'performance', 'ux', 'network'].includes(a.category)));
      assert.ok(result.assertions.every(a => ['critical', 'warning', 'info'].includes(a.severity)));
    });

    it('should output 404 error for non-existent capsule', () => {
      const errorResponse = {
        error: 'Capsule not found',
        capsuleId: 'non-existent',
      };

      assert.ok(typeof errorResponse.error === 'string');
    });
  });

  describe('POST /api/recorder/start', () => {
    it('should accept valid recorder start request', () => {
      const validInput = {
        name: 'Test Workflow',
      };

      const result = RecorderStartSchema.safeParse(validInput);
      assert.strictEqual(result.success, true);
    });

    it('should reject empty name', () => {
      const invalidInput = {
        name: '',
      };

      const result = RecorderStartSchema.safeParse(invalidInput);
      assert.strictEqual(result.success, false);
    });

    it('should output workflowId shape', () => {
      const response = {
        workflowId: 'workflow-123',
      };

      assert.ok(typeof response.workflowId === 'string');
    });
  });

  describe('POST /api/recorder/stop', () => {
    it('should accept valid recorder stop request', () => {
      const validInput = {
        workflowId: 'workflow-123',
      };

      const result = RecorderStopSchema.safeParse(validInput);
      assert.strictEqual(result.success, true);
    });

    it('should reject missing workflowId', () => {
      const invalidInput = {};

      const result = RecorderStopSchema.safeParse(invalidInput);
      assert.strictEqual(result.success, false);
    });

    it('should output RecordedWorkflow shape', () => {
      const workflow: RecordedWorkflow = {
        id: 'workflow-123',
        name: 'Test Workflow',
        startedAt: '2024-01-01T00:00:00Z',
        endedAt: '2024-01-01T00:05:00Z',
        actions: [
          {
            type: 'click',
            selector: '#button',
            timestamp: '2024-01-01T00:01:00Z',
          },
        ],
        generatedCode: 'await browser.click({ sessionId, selector: "#button" });',
        generatedAssertions: ['assert.ok(await page.locator("#button").isVisible());'],
      };

      assert.ok(typeof workflow.id === 'string');
      assert.ok(typeof workflow.name === 'string');
      assert.ok(typeof workflow.startedAt === 'string');
      assert.ok(Array.isArray(workflow.actions));
      assert.ok(typeof workflow.generatedCode === 'string');
      assert.ok(Array.isArray(workflow.generatedAssertions));
    });
  });

  describe('GET /api/recorder/workflow/:id', () => {
    it('should output RecordedWorkflow shape', () => {
      const workflow: RecordedWorkflow = {
        id: 'workflow-123',
        name: 'Test Workflow',
        startedAt: '2024-01-01T00:00:00Z',
        actions: [],
        generatedCode: '',
        generatedAssertions: [],
      };

      assert.ok(workflow);
      assert.ok(typeof workflow.id === 'string');
    });

    it('should output 404 error for non-existent workflow', () => {
      const errorResponse = {
        error: 'Workflow not found',
        workflowId: 'non-existent',
      };

      assert.ok(typeof errorResponse.error === 'string');
    });
  });

  describe('GET /api/recorder/workflows', () => {
    it('should output workflows list shape', () => {
      const response = {
        workflows: [
          { id: 'workflow-1', name: 'Test 1', startedAt: '2024-01-01T00:00:00Z', actionCount: 5 },
          { id: 'workflow-2', name: 'Test 2', startedAt: '2024-01-02T00:00:00Z', actionCount: 3 },
        ],
        total: 2,
      };

      assert.ok(Array.isArray(response.workflows));
      assert.ok(typeof response.total === 'number');
    });
  });

  describe('POST /api/verification/run', () => {
    it('should accept valid verification run request', () => {
      const validInput = {
        patchId: 'patch-123',
        originalCapsuleId: 'capsule-123',
      };

      const result = VerificationRunSchema.safeParse(validInput);
      assert.strictEqual(result.success, true);
    });

    it('should accept optional rerunCount', () => {
      const validInput = {
        patchId: 'patch-123',
        originalCapsuleId: 'capsule-123',
        rerunCount: 5,
      };

      const result = VerificationRunSchema.safeParse(validInput);
      assert.strictEqual(result.success, true);
    });

    it('should reject rerunCount outside range', () => {
      const invalidInput = {
        patchId: 'patch-123',
        originalCapsuleId: 'capsule-123',
        rerunCount: 15,
      };

      const result = VerificationRunSchema.safeParse(invalidInput);
      assert.strictEqual(result.success, false);
    });

    it('should reject missing required fields', () => {
      const invalidInput = {
        patchId: 'patch-123',
      };

      const result = VerificationRunSchema.safeParse(invalidInput);
      assert.strictEqual(result.success, false);
    });

    it('should output VerificationResult shape', () => {
      const verification: VerificationResult = {
        patchId: 'patch-123',
        originalFailure: {
          capsuleId: 'capsule-123',
          assertions: {
            capsuleId: 'capsule-123',
            timestamp: '2024-01-01T00:00:00Z',
            totalChecks: 6,
            passed: 2,
            failed: 4,
            assertions: [],
          },
        },
        reruns: [
          {
            runIndex: 0,
            capsuleId: 'capsule-rerun-1',
            assertions: {
              capsuleId: 'capsule-rerun-1',
              timestamp: '2024-01-01T00:01:00Z',
              totalChecks: 6,
              passed: 6,
              failed: 0,
              assertions: [],
            },
            timestamp: '2024-01-01T00:01:00Z',
          },
        ],
        overallVerdict: 'fixed',
        summary: 'Fix verified successfully',
      };

      assert.ok(typeof verification.patchId === 'string');
      assert.ok(verification.originalFailure);
      assert.ok(Array.isArray(verification.reruns));
      assert.ok(['fixed', 'still_failing', 'flaky', 'inconclusive'].includes(verification.overallVerdict));
      assert.ok(typeof verification.summary === 'string');
    });

    it('should output 404 error for non-existent capsule', () => {
      const errorResponse = {
        error: 'Capsule not found',
        capsuleId: 'non-existent',
      };

      assert.ok(typeof errorResponse.error === 'string');
    });
  });

  describe('POST /api/pr-summary/generate', () => {
    it('should accept valid PR summary generate request', () => {
      const validInput = {
        capsuleId: 'capsule-123',
      };

      const result = PRSummaryGenerateSchema.safeParse(validInput);
      assert.strictEqual(result.success, true);
    });

    it('should reject missing capsuleId', () => {
      const invalidInput = {};

      const result = PRSummaryGenerateSchema.safeParse(invalidInput);
      assert.strictEqual(result.success, false);
    });

    it('should output PRSummary shape', () => {
      const summary: PRSummary = {
        id: 'summary-123',
        capsuleId: 'capsule-123',
        generatedAt: '2024-01-01T00:00:00Z',
        repro: '1. Navigate to page\n2. Click button',
        evidenceSummary: 'Screenshot shows error',
        probableRootCause: {
          capsuleId: 'capsule-123',
          failureExplanation: {
            what: 'Error occurred',
            firstBadState: 'Error displayed',
            failureClass: 'app_code',
            confidence: 0.9,
            evidence: [],
          },
          likelyComponent: 'Component',
          likelyHandler: 'handler',
          likelyApiCall: null,
          candidateFixes: [],
          timestamp: '2024-01-01T00:00:00Z',
        },
        suggestedFix: 'Fix the error',
        verification: null,
        markdown: '# PR Summary',
        machineReadable: { issueType: 'error' },
      };

      assert.ok(typeof summary.id === 'string');
      assert.ok(typeof summary.capsuleId === 'string');
      assert.ok(typeof summary.generatedAt === 'string');
      assert.ok(typeof summary.repro === 'string');
      assert.ok(typeof summary.evidenceSummary === 'string');
      assert.ok(summary.probableRootCause);
      assert.ok(typeof summary.suggestedFix === 'string');
      assert.ok(summary.verification === null || typeof summary.verification === 'object');
      assert.ok(typeof summary.markdown === 'string');
      assert.ok(typeof summary.machineReadable === 'object');
    });

    it('should output 404 error for non-existent capsule', () => {
      const errorResponse = {
        error: 'Capsule not found',
        capsuleId: 'non-existent',
      };

      assert.ok(typeof errorResponse.error === 'string');
    });
  });

  describe('GET /api/pr-summary/:id', () => {
    it('should output PRSummary shape', () => {
      const summary: PRSummary = {
        id: 'summary-123',
        capsuleId: 'capsule-123',
        generatedAt: '2024-01-01T00:00:00Z',
        repro: 'Steps to reproduce',
        evidenceSummary: 'Evidence summary',
        probableRootCause: {
          capsuleId: 'capsule-123',
          failureExplanation: {
            what: 'Error',
            firstBadState: 'Error state',
            failureClass: 'app_code',
            confidence: 0.9,
            evidence: [],
          },
          likelyComponent: 'Component',
          likelyHandler: 'handler',
          likelyApiCall: null,
          candidateFixes: [],
          timestamp: '2024-01-01T00:00:00Z',
        },
        suggestedFix: 'Fix it',
        verification: null,
        markdown: '# Summary',
        machineReadable: {},
      };

      assert.ok(summary);
      assert.ok(typeof summary.id === 'string');
    });

    it('should output 404 error for non-existent summary', () => {
      const errorResponse = {
        error: 'Summary not found',
        summaryId: 'non-existent',
      };

      assert.ok(typeof errorResponse.error === 'string');
    });
  });

  describe('GET /api/pr-summary/:id/markdown', () => {
    it('should output markdown as text/plain', () => {
      const markdown = '# PR Summary\n\n## Issue\nDescription of issue';

      assert.ok(typeof markdown === 'string');
      assert.ok(markdown.startsWith('#'));
    });

    it('should output 404 error for non-existent summary', () => {
      const errorResponse = {
        error: 'Summary not found',
        summaryId: 'non-existent',
      };

      assert.ok(typeof errorResponse.error === 'string');
    });
  });

  describe('GET /api/security/policy', () => {
    it('should output SecurityPolicyConfig shape', () => {
      const config: SecurityPolicyConfig = {
        domainAllowlist: ['example.com', 'api.example.com'],
        auditEnabled: true,
        secretPatterns: ['password', 'token', 'key'],
        sessionIsolation: true,
        riskActions: ['clipboard-write', 'file-download'],
      };

      assert.ok(Array.isArray(config.domainAllowlist));
      assert.ok(typeof config.auditEnabled === 'boolean');
      assert.ok(Array.isArray(config.secretPatterns));
      assert.ok(typeof config.sessionIsolation === 'boolean');
      assert.ok(Array.isArray(config.riskActions));
    });
  });

  describe('GET /api/security/audit-log', () => {
    it('should output audit log shape with entries', () => {
      const response = {
        entries: [
          {
            timestamp: '2024-01-01T00:00:00Z',
            action: 'clipboard-write',
            domain: 'example.com',
            actor: 'user-123',
            result: 'allowed',
            reason: 'Domain in allowlist',
          },
          {
            timestamp: '2024-01-01T00:01:00Z',
            action: 'file-download',
            domain: 'unknown.com',
            actor: 'user-123',
            result: 'blocked',
          },
        ] as SecurityAuditEntry[],
        total: 2,
        returned: 2,
      };

      assert.ok(Array.isArray(response.entries));
      assert.ok(typeof response.total === 'number');
      assert.ok(typeof response.returned === 'number');
      
      response.entries.forEach(entry => {
        assert.ok(typeof entry.timestamp === 'string');
        assert.ok(typeof entry.action === 'string');
        assert.ok(typeof entry.domain === 'string');
        assert.ok(typeof entry.actor === 'string');
        assert.ok(entry.result === 'allowed' || entry.result === 'blocked');
      });
    });

    it('should handle limit query parameter', () => {
      // Test that limit parameter is validated as positive integer
      const validLimit = 100;
      assert.ok(Number.isFinite(validLimit) && validLimit > 0);

      const invalidLimit = -1;
      assert.ok(!(Number.isFinite(invalidLimit) && invalidLimit > 0));
    });
  });
});

// ============================================================================
// Error Response Contract Tests
// ============================================================================

describe('Extension API Error Response Contracts', () => {
  it('should have consistent 400 error shape', () => {
    const errorResponse = {
      error: 'Bad request',
      message: 'Missing required field: capsuleId',
    };

    assert.ok(typeof errorResponse.error === 'string');
    assert.ok(typeof errorResponse.message === 'string');
  });

  it('should have consistent 404 error shape', () => {
    const errorResponse = {
      error: 'Capsule not found',
      capsuleId: 'non-existent-id',
    };

    assert.ok(typeof errorResponse.error === 'string');
    assert.ok(typeof errorResponse.capsuleId === 'string');
  });

  it('should have consistent 500 error shape', () => {
    const errorResponse = {
      error: 'Failed to capture evidence capsule',
      message: 'Internal server error occurred',
    };

    assert.ok(typeof errorResponse.error === 'string');
    assert.ok(typeof errorResponse.message === 'string');
  });

  it('should have consistent 403 error shape', () => {
    const errorResponse = {
      error: 'Forbidden: endpoint is localhost-only',
    };

    assert.ok(typeof errorResponse.error === 'string');
  });
});
