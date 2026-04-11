/**
 * Test fixtures and helpers for core module tests
 */

import type {
  EvidenceCapsule,
  CapsuleFailureInfo,
  BrowserEvidence,
  BrowserConsoleEntry,
  BrowserNetworkEntry,
  BrowserSessionMetadata,
  ActionTimelineEntry,
  FailureClass,
  FailureExplanation,
  RecordedAction,
  RecordedActionType,
} from '../../../src/core/types.js';

// ============================================================================
// Browser Evidence Fixtures
// ============================================================================

export function createBrowserSessionMetadata(
  overrides?: Partial<BrowserSessionMetadata>
): BrowserSessionMetadata {
  return {
    url: 'https://example.com/test-page',
    title: 'Test Page',
    tabId: 'tab-123',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.0',
    viewport: { width: 1920, height: 1080 },
    ...overrides,
  };
}

export function createBrowserConsoleEntry(
  overrides?: Partial<BrowserConsoleEntry>
): BrowserConsoleEntry {
  return {
    level: 'error',
    message: 'Test error message',
    timestamp: new Date().toISOString(),
    source: 'test.js',
    ...overrides,
  };
}

export function createBrowserNetworkEntry(
  overrides?: Partial<BrowserNetworkEntry>
): BrowserNetworkEntry {
  return {
    url: 'https://example.com/api/data',
    method: 'GET',
    status: 200,
    statusText: 'OK',
    duration: 150,
    size: 1024,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

export function createActionTimelineEntry(
  overrides?: Partial<ActionTimelineEntry>
): ActionTimelineEntry {
  return {
    timestamp: new Date().toISOString(),
    action: 'click',
    selector: '#submit-button',
    result: 'success',
    ...overrides,
  };
}

export function createBrowserEvidence(overrides?: Partial<BrowserEvidence>): BrowserEvidence {
  return {
    screenshots: [],
    console: {
      errors: [],
      warnings: [],
      logs: [],
    },
    networkRequests: [],
    performanceMetrics: {},
    sessionMetadata: createBrowserSessionMetadata(),
    actionTimeline: [],
    ...overrides,
  };
}

// ============================================================================
// Evidence Capsule Fixtures
// ============================================================================

export function createCapsuleFailureInfo(overrides?: Partial<CapsuleFailureInfo>): CapsuleFailureInfo {
  return {
    type: 'test_failure',
    message: 'Test failed',
    stack: 'Error: Test failed\n    at test.js:1:1',
    ...overrides,
  };
}

export function createEvidenceCapsule(overrides?: Partial<EvidenceCapsule>): EvidenceCapsule {
  const timestamp = new Date().toISOString();
  return {
    capsuleId: `capsule-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    timestamp,
    failure: createCapsuleFailureInfo(),
    browser: createBrowserEvidence(),
    ...overrides,
  };
}

// ============================================================================
// Pre-built Test Scenarios
// ============================================================================

export function createBackendFailureCapsule(): EvidenceCapsule {
  return createEvidenceCapsule({
    failure: createCapsuleFailureInfo({
      type: 'api_error',
      message: 'Request failed with status 500',
    }),
    browser: createBrowserEvidence({
      console: {
        errors: [
          createBrowserConsoleEntry({
            level: 'error',
            message: 'Fetch failed: HTTP 500 Internal Server Error',
          }),
        ],
        warnings: [],
        logs: [],
      },
      networkRequests: [
        createBrowserNetworkEntry({
          url: 'https://api.example.com/data',
          method: 'GET',
          status: 500,
          statusText: 'Internal Server Error',
        }),
      ],
    }),
  });
}

export function createTimingFailureCapsule(): EvidenceCapsule {
  return createEvidenceCapsule({
    failure: createCapsuleFailureInfo({
      type: 'timeout',
      message: 'Element not found within timeout',
    }),
    browser: createBrowserEvidence({
      console: {
        errors: [
          createBrowserConsoleEntry({
            level: 'error',
            message: 'TimeoutError: Waiting for selector ".slow-element" timed out',
          }),
        ],
        warnings: [],
        logs: [],
      },
      performanceMetrics: {
        loadTime: 8000,
        domContentLoaded: 6000,
      },
    }),
  });
}

export function createSelectorDriftCapsule(): EvidenceCapsule {
  return createEvidenceCapsule({
    failure: createCapsuleFailureInfo({
      type: 'element_not_found',
      message: 'Element not found: #old-button-id',
    }),
    browser: createBrowserEvidence({
      console: {
        errors: [
          createBrowserConsoleEntry({
            level: 'error',
            message: 'Error: No element found for selector: #old-button-id',
          }),
        ],
        warnings: [],
        logs: [],
      },
      actionTimeline: [
        createActionTimelineEntry({
          action: 'click',
          selector: '#old-button-id',
          result: 'failure',
          error: 'Element not found',
        }),
      ],
    }),
  });
}

export function createEnvironmentFailureCapsule(): EvidenceCapsule {
  return createEvidenceCapsule({
    failure: createCapsuleFailureInfo({
      type: 'cors_error',
      message: 'CORS policy blocked request',
    }),
    browser: createBrowserEvidence({
      console: {
        errors: [
          createBrowserConsoleEntry({
            level: 'error',
            message: 'Access to fetch blocked by CORS policy',
          }),
        ],
        warnings: [],
        logs: [],
      },
      networkRequests: [
        createBrowserNetworkEntry({
          url: 'https://other-domain.com/api',
          method: 'GET',
          status: 0,
          statusText: '',
        }),
      ],
    }),
  });
}

export function createAppCodeFailureCapsule(): EvidenceCapsule {
  return createEvidenceCapsule({
    failure: createCapsuleFailureInfo({
      type: 'javascript_error',
      message: 'Cannot read property of undefined',
    }),
    browser: createBrowserEvidence({
      console: {
        errors: [
          createBrowserConsoleEntry({
            level: 'error',
            message: 'TypeError: Cannot read property "foo" of undefined',
          }),
        ],
        warnings: [],
        logs: [],
      },
    }),
  });
}

// ============================================================================
// Failure Explanation Fixtures
// ============================================================================

export function createFailureExplanation(
  failureClass: FailureClass = 'app_code',
  overrides?: Partial<FailureExplanation>
): FailureExplanation {
  const classDescriptions: Record<FailureClass, string> = {
    app_code: 'Application code failure',
    timing: 'Timing-related failure',
    selector_drift: 'Selector drift detected',
    backend_failure: 'Backend failure detected',
    environment: 'Environment issue detected',
  };

  return {
    what: classDescriptions[failureClass],
    firstBadState: 'Console error detected',
    failureClass,
    confidence: 0.8,
    evidence: ['Test evidence'],
    ...overrides,
  };
}

// ============================================================================
// Workflow Recorder Fixtures
// ============================================================================

export function createRecordedAction(
  type: RecordedActionType = 'click',
  overrides?: Partial<RecordedAction>
): RecordedAction {
  return {
    type,
    selector: '#test-element',
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

// ============================================================================
// DOM Snapshot Fixtures
// ============================================================================

export const loginFormDomSnapshot = `
<form aria-label="Login Form" id="login-form">
  <input type="email" id="email" aria-label="Email" />
  <input type="password" id="password" aria-label="Password" />
  <button type="submit">Sign In</button>
</form>
`;

export const brokenImagesDomSnapshot = `
<div>
  <img src="image1.jpg" alt="Description 1" />
  <img src="image2.jpg" />
  <img src="image3.jpg" alt="Description 3" />
</div>
`;

export const unlabeledInputsDomSnapshot = `
<form>
  <input type="text" id="username" />
  <input type="email" />
  <input type="hidden" name="token" value="abc" />
</form>
`;

export const emptyButtonsDomSnapshot = `
<div>
  <button>Click Me</button>
  <button></button>
  <button aria-label="Close">×</button>
</div>
`;
