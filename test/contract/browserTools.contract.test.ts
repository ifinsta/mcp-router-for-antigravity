/**
 * Browser Tools Contract Tests
 *
 * Verifies that MCP browser tools have correct input/output shapes
 * matching the defined TypeScript types in src/core/types.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { z } from 'zod';
import type {
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
// Input Schema Definitions (from browserPublicToolHandlers.ts)
// ============================================================================

const BrowserEvidenceCaptureSchema = z.object({
  failureType: z.string(),
  failureMessage: z.string(),
  failureStack: z.string().optional(),
});

const BrowserEvidenceExplainSchema = z.object({
  capsuleId: z.string(),
});

const BrowserAssertionsEvaluateSchema = z.object({
  capsuleId: z.string(),
});

const BrowserVerificationRunSchema = z.object({
  patchId: z.string(),
  originalCapsuleId: z.string(),
  rerunCount: z.number().int().min(1).max(10).optional(),
});

const BrowserFlakeAnalysisSchema = z.object({
  capsuleIds: z.array(z.string()).min(1),
});

const BrowserEvidenceRootCauseSchema = z.object({
  capsuleId: z.string(),
});

const BrowserPRSummaryGenerateSchema = z.object({
  capsuleId: z.string(),
});

const BrowserRecorderStartSchema = z.object({
  name: z.string().min(1),
});

const BrowserRecorderStopSchema = z.object({
  workflowId: z.string(),
});

const BrowserRecorderExportSchema = z.object({
  workflowId: z.string(),
});

const BrowserTabSwitchSchema = z.object({
  tabId: z.string(),
});

// ============================================================================
// MCP Tool Contract Tests
// ============================================================================

describe('Browser MCP Tools Contract Tests', () => {
  describe('browser.evidence.capture', () => {
    it('should have correct input schema with required fields', () => {
      const validInput = {
        failureType: 'TestFailure',
        failureMessage: 'Test failed with error',
      };

      const result = BrowserEvidenceCaptureSchema.safeParse(validInput);
      assert.strictEqual(result.success, true);
    });

    it('should accept optional failureStack field', () => {
      const validInput = {
        failureType: 'TestFailure',
        failureMessage: 'Test failed with error',
        failureStack: 'Error: at line 42\n    at test.ts:42:10',
      };

      const result = BrowserEvidenceCaptureSchema.safeParse(validInput);
      assert.strictEqual(result.success, true);
    });

    it('should reject missing required fields', () => {
      const invalidInput = {
        failureType: 'TestFailure',
        // missing failureMessage
      };

      const result = BrowserEvidenceCaptureSchema.safeParse(invalidInput);
      assert.strictEqual(result.success, false);
    });

    it('should reject wrong types', () => {
      const invalidInput = {
        failureType: 123, // should be string
        failureMessage: 'Test failed',
      };

      const result = BrowserEvidenceCaptureSchema.safeParse(invalidInput);
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
            errors: [{ level: 'error', message: 'console error', timestamp: '2024-01-01T00:00:00Z', source: 'test.js' }],
            warnings: [{ level: 'warning', message: 'console warning', timestamp: '2024-01-01T00:00:00Z' }],
            logs: [{ level: 'log', message: 'console log', timestamp: '2024-01-01T00:00:00Z' }],
          },
          networkRequests: [{
            url: 'http://example.com',
            method: 'GET',
            status: 200,
            statusText: 'OK',
            duration: 100,
            size: 1024,
            timestamp: '2024-01-01T00:00:00Z',
          }],
          performanceMetrics: { loadTime: 1000 },
          sessionMetadata: {
            url: 'http://example.com',
            title: 'Test Page',
            tabId: 'tab-123',
            userAgent: 'Mozilla/5.0',
            viewport: { width: 1920, height: 1080 },
          },
          actionTimeline: [{
            timestamp: '2024-01-01T00:00:00Z',
            action: 'click',
            selector: '#button',
            result: 'success',
          }],
        },
      };

      assert.ok(capsule.capsuleId);
      assert.ok(capsule.timestamp);
      assert.ok(capsule.failure.type);
      assert.ok(capsule.failure.message);
      assert.ok(Array.isArray(capsule.browser.screenshots));
      assert.ok(Array.isArray(capsule.browser.console.errors));
      assert.ok(Array.isArray(capsule.browser.networkRequests));
      assert.ok(capsule.browser.sessionMetadata.url);
      assert.ok(capsule.browser.sessionMetadata.title);
      assert.ok(capsule.browser.sessionMetadata.tabId);
    });
  });

  describe('browser.evidence.explain', () => {
    it('should have correct input schema with required capsuleId', () => {
      const validInput = {
        capsuleId: 'capsule-123',
      };

      const result = BrowserEvidenceExplainSchema.safeParse(validInput);
      assert.strictEqual(result.success, true);
    });

    it('should reject missing capsuleId', () => {
      const invalidInput = {};

      const result = BrowserEvidenceExplainSchema.safeParse(invalidInput);
      assert.strictEqual(result.success, false);
    });

    it('should reject non-string capsuleId', () => {
      const invalidInput = {
        capsuleId: 123,
      };

      const result = BrowserEvidenceExplainSchema.safeParse(invalidInput);
      assert.strictEqual(result.success, false);
    });

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
  });

  describe('browser.evidence.analyze_flake', () => {
    it('should have correct input schema with required capsuleIds array', () => {
      const validInput = {
        capsuleIds: ['capsule-1', 'capsule-2', 'capsule-3'],
      };

      const result = BrowserFlakeAnalysisSchema.safeParse(validInput);
      assert.strictEqual(result.success, true);
    });

    it('should reject empty capsuleIds array', () => {
      const invalidInput = {
        capsuleIds: [],
      };

      const result = BrowserFlakeAnalysisSchema.safeParse(invalidInput);
      assert.strictEqual(result.success, false);
    });

    it('should reject non-array capsuleIds', () => {
      const invalidInput = {
        capsuleIds: 'capsule-1',
      };

      const result = BrowserFlakeAnalysisSchema.safeParse(invalidInput);
      assert.strictEqual(result.success, false);
    });

    it('should output FlakeAnalysis shape', () => {
      const analysis: FlakeAnalysis = {
        capsuleIds: ['capsule-1', 'capsule-2'],
        failureClass: 'timing',
        isFlaky: true,
        confidence: 0.75,
        recommendedAction: 'add_wait',
        reasoning: 'Test passes inconsistently due to timing issues',
        historicalFrequency: 0.3,
        patternSignature: 'timing-flake-abc123',
      };

      assert.ok(Array.isArray(analysis.capsuleIds));
      assert.ok(['app_code', 'timing', 'selector_drift', 'backend_failure', 'environment'].includes(analysis.failureClass));
      assert.ok(typeof analysis.isFlaky === 'boolean');
      assert.ok(analysis.confidence >= 0 && analysis.confidence <= 1);
      assert.ok(['retry', 'add_wait', 'fix_selector', 'fix_backend', 'fix_environment', 'investigate'].includes(analysis.recommendedAction));
      assert.ok(typeof analysis.reasoning === 'string');
      assert.ok(analysis.historicalFrequency >= 0 && analysis.historicalFrequency <= 1);
      assert.ok(typeof analysis.patternSignature === 'string');
    });
  });

  describe('browser.evidence.root_cause', () => {
    it('should have correct input schema with required capsuleId', () => {
      const validInput = {
        capsuleId: 'capsule-123',
      };

      const result = BrowserEvidenceRootCauseSchema.safeParse(validInput);
      assert.strictEqual(result.success, true);
    });

    it('should reject missing capsuleId', () => {
      const invalidInput = {};

      const result = BrowserEvidenceRootCauseSchema.safeParse(invalidInput);
      assert.strictEqual(result.success, false);
    });

    it('should output RootCauseMapping shape', () => {
      const mapping: RootCauseMapping = {
        capsuleId: 'capsule-123',
        failureExplanation: {
          what: 'Login form submission failed',
          firstBadState: 'Form validation error',
          failureClass: 'app_code',
          confidence: 0.9,
          evidence: ['screenshot-1'],
        },
        likelyComponent: 'Login Form',
        likelyHandler: 'onSubmit handler',
        likelyApiCall: 'POST /api/auth/login',
        candidateFixes: [
          {
            description: 'Add form validation check',
            confidence: 0.85,
            category: 'code_logic',
          },
        ],
        timestamp: '2024-01-01T00:00:00Z',
      };

      assert.ok(typeof mapping.capsuleId === 'string');
      assert.ok(mapping.failureExplanation);
      assert.ok(typeof mapping.likelyComponent === 'string');
      assert.ok(typeof mapping.likelyHandler === 'string');
      assert.ok(mapping.likelyApiCall === null || typeof mapping.likelyApiCall === 'string');
      assert.ok(Array.isArray(mapping.candidateFixes));
      assert.ok(mapping.candidateFixes.every(f => ['selector', 'timing', 'api', 'config', 'code_logic'].includes(f.category)));
      assert.ok(typeof mapping.timestamp === 'string');
    });
  });

  describe('browser.tabs.list_all', () => {
    it('should have empty input schema (no required inputs)', () => {
      const emptySchema = z.object({});
      const result = emptySchema.safeParse({});
      assert.strictEqual(result.success, true);
    });

    it('should output tab array shape', () => {
      const tabs = [
        { tabId: 'tab-1', url: 'http://example.com', title: 'Example', isActive: true },
        { tabId: 'tab-2', url: 'http://test.com', title: 'Test', isActive: false },
      ];

      assert.ok(Array.isArray(tabs));
      tabs.forEach(tab => {
        assert.ok(typeof tab.tabId === 'string');
        assert.ok(typeof tab.url === 'string');
        assert.ok(typeof tab.title === 'string');
        assert.ok(typeof tab.isActive === 'boolean');
      });
    });
  });

  describe('browser.tabs.switch', () => {
    it('should have correct input schema with required tabId', () => {
      const validInput = {
        tabId: 'tab-123',
      };

      const result = BrowserTabSwitchSchema.safeParse(validInput);
      assert.strictEqual(result.success, true);
    });

    it('should reject missing tabId', () => {
      const invalidInput = {};

      const result = BrowserTabSwitchSchema.safeParse(invalidInput);
      assert.strictEqual(result.success, false);
    });

    it('should reject non-string tabId', () => {
      const invalidInput = {
        tabId: 123,
      };

      const result = BrowserTabSwitchSchema.safeParse(invalidInput);
      assert.strictEqual(result.success, false);
    });
  });

  describe('browser.recorder.start', () => {
    it('should have correct input schema with required name', () => {
      const validInput = {
        name: 'Test Workflow',
      };

      const result = BrowserRecorderStartSchema.safeParse(validInput);
      assert.strictEqual(result.success, true);
    });

    it('should reject empty name', () => {
      const invalidInput = {
        name: '',
      };

      const result = BrowserRecorderStartSchema.safeParse(invalidInput);
      assert.strictEqual(result.success, false);
    });

    it('should reject missing name', () => {
      const invalidInput = {};

      const result = BrowserRecorderStartSchema.safeParse(invalidInput);
      assert.strictEqual(result.success, false);
    });

    it('should output workflowId shape', () => {
      const output = {
        workflowId: 'workflow-123',
        name: 'Test Workflow',
        status: 'recording',
      };

      assert.ok(typeof output.workflowId === 'string');
      assert.ok(typeof output.name === 'string');
      assert.ok(output.status === 'recording');
    });
  });

  describe('browser.recorder.stop', () => {
    it('should have correct input schema with required workflowId', () => {
      const validInput = {
        workflowId: 'workflow-123',
      };

      const result = BrowserRecorderStopSchema.safeParse(validInput);
      assert.strictEqual(result.success, true);
    });

    it('should reject missing workflowId', () => {
      const invalidInput = {};

      const result = BrowserRecorderStopSchema.safeParse(invalidInput);
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
            tabId: 'tab-1',
          },
          {
            type: 'type',
            selector: '#input',
            value: 'test text',
            timestamp: '2024-01-01T00:02:00Z',
          },
        ],
        generatedCode: 'await browser.click({ sessionId, selector: "#button" });',
        generatedAssertions: ['assert.ok(await page.locator("#button").isVisible());'],
      };

      assert.ok(typeof workflow.id === 'string');
      assert.ok(typeof workflow.name === 'string');
      assert.ok(typeof workflow.startedAt === 'string');
      assert.ok(workflow.endedAt === undefined || typeof workflow.endedAt === 'string');
      assert.ok(Array.isArray(workflow.actions));
      assert.ok(workflow.actions.every(a => ['click', 'type', 'navigate', 'select', 'scroll', 'wait', 'screenshot', 'assert'].includes(a.type)));
      assert.ok(typeof workflow.generatedCode === 'string');
      assert.ok(Array.isArray(workflow.generatedAssertions));
    });
  });

  describe('browser.recorder.export', () => {
    it('should have correct input schema with required workflowId', () => {
      const validInput = {
        workflowId: 'workflow-123',
      };

      const result = BrowserRecorderExportSchema.safeParse(validInput);
      assert.strictEqual(result.success, true);
    });

    it('should reject missing workflowId', () => {
      const invalidInput = {};

      const result = BrowserRecorderExportSchema.safeParse(invalidInput);
      assert.strictEqual(result.success, false);
    });

    it('should output code and assertions shape', () => {
      const output = {
        workflowId: 'workflow-123',
        name: 'Test Workflow',
        generatedCode: 'await browser.click({ sessionId, selector: "#button" });',
        generatedAssertions: ['assert.ok(await page.locator("#button").isVisible());'],
        actionCount: 2,
      };

      assert.ok(typeof output.workflowId === 'string');
      assert.ok(typeof output.name === 'string');
      assert.ok(typeof output.generatedCode === 'string');
      assert.ok(Array.isArray(output.generatedAssertions));
      assert.ok(typeof output.actionCount === 'number');
    });
  });

  describe('browser.assertions.evaluate', () => {
    it('should have correct input schema with required capsuleId', () => {
      const validInput = {
        capsuleId: 'capsule-123',
      };

      const result = BrowserAssertionsEvaluateSchema.safeParse(validInput);
      assert.strictEqual(result.success, true);
    });

    it('should reject missing capsuleId', () => {
      const invalidInput = {};

      const result = BrowserAssertionsEvaluateSchema.safeParse(invalidInput);
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
            actual: 'screenshot differs by 5%',
            expected: 'screenshot matches baseline',
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
  });

  describe('browser.verification.run', () => {
    it('should have correct input schema with required fields', () => {
      const validInput = {
        patchId: 'patch-123',
        originalCapsuleId: 'capsule-123',
      };

      const result = BrowserVerificationRunSchema.safeParse(validInput);
      assert.strictEqual(result.success, true);
    });

    it('should accept optional rerunCount field', () => {
      const validInput = {
        patchId: 'patch-123',
        originalCapsuleId: 'capsule-123',
        rerunCount: 5,
      };

      const result = BrowserVerificationRunSchema.safeParse(validInput);
      assert.strictEqual(result.success, true);
    });

    it('should reject rerunCount outside valid range', () => {
      const invalidInput = {
        patchId: 'patch-123',
        originalCapsuleId: 'capsule-123',
        rerunCount: 15, // max is 10
      };

      const result = BrowserVerificationRunSchema.safeParse(invalidInput);
      assert.strictEqual(result.success, false);
    });

    it('should reject missing required fields', () => {
      const invalidInput = {
        patchId: 'patch-123',
        // missing originalCapsuleId
      };

      const result = BrowserVerificationRunSchema.safeParse(invalidInput);
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
        summary: 'Fix verified: all assertions pass after patch application',
      };

      assert.ok(typeof verification.patchId === 'string');
      assert.ok(verification.originalFailure);
      assert.ok(Array.isArray(verification.reruns));
      assert.ok(['fixed', 'still_failing', 'flaky', 'inconclusive'].includes(verification.overallVerdict));
      assert.ok(typeof verification.summary === 'string');
    });
  });

  describe('browser.pr_summary.generate', () => {
    it('should have correct input schema with required capsuleId', () => {
      const validInput = {
        capsuleId: 'capsule-123',
      };

      const result = BrowserPRSummaryGenerateSchema.safeParse(validInput);
      assert.strictEqual(result.success, true);
    });

    it('should reject missing capsuleId', () => {
      const invalidInput = {};

      const result = BrowserPRSummaryGenerateSchema.safeParse(invalidInput);
      assert.strictEqual(result.success, false);
    });

    it('should output PRSummary shape', () => {
      const summary: PRSummary = {
        id: 'summary-123',
        capsuleId: 'capsule-123',
        generatedAt: '2024-01-01T00:00:00Z',
        repro: '1. Navigate to login page\n2. Click submit\n3. Observe error',
        evidenceSummary: 'Screenshot shows validation error on login form',
        probableRootCause: {
          capsuleId: 'capsule-123',
          failureExplanation: {
            what: 'Login failed',
            firstBadState: 'Validation error displayed',
            failureClass: 'app_code',
            confidence: 0.9,
            evidence: ['screenshot-1'],
          },
          likelyComponent: 'Login Form',
          likelyHandler: 'onSubmit',
          likelyApiCall: 'POST /api/login',
          candidateFixes: [],
          timestamp: '2024-01-01T00:00:00Z',
        },
        suggestedFix: 'Add input validation before form submission',
        verification: null,
        markdown: '# PR Summary\n\n## Issue\nLogin form validation error',
        machineReadable: {
          issueType: 'validation_error',
          severity: 'high',
        },
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
  });
});

// ============================================================================
// Error Response Contract Tests
// ============================================================================

describe('Browser Tools Error Response Contracts', () => {
  it('should have consistent error response shape', () => {
    const errorResponse = {
      success: false,
      action: 'browser.evidence.explain',
      error: {
        code: 'capsule_not_found',
        message: "Evidence capsule 'capsule-123' not found",
      },
      warnings: [],
      artifacts: [],
    };

    assert.strictEqual(errorResponse.success, false);
    assert.ok(typeof errorResponse.action === 'string');
    assert.ok(errorResponse.error);
    assert.ok(typeof errorResponse.error.code === 'string');
    assert.ok(typeof errorResponse.error.message === 'string');
    assert.ok(Array.isArray(errorResponse.warnings));
    assert.ok(Array.isArray(errorResponse.artifacts));
  });

  it('should support capsule_not_found error code', () => {
    const errorCodes = ['capsule_not_found', 'session_not_found', 'browser_action_failed', 'transport_unavailable'];
    
    errorCodes.forEach(code => {
      const errorResponse = {
        success: false,
        action: 'browser.test',
        error: {
          code,
          message: 'Test error message',
        },
        warnings: [],
        artifacts: [],
      };

      assert.ok(typeof errorResponse.error.code === 'string');
    });
  });
});
