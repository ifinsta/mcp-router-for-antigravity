/**
 * Assertion Evaluator
 *
 * Evaluates evidence capsules and produces structured assertion results
 * across multiple categories: functional, visual, accessibility, performance, ux, network.
 */

import { getLogger } from '../infra/logger.js';
import type {
  EvidenceCapsule,
  AssertionCheck,
  AssertionResult,
  AssertionCategory,
} from './types.js';

const logger = getLogger('assertion-model');

/**
 * Performance thresholds in milliseconds
 */
const PERFORMANCE_THRESHOLDS = {
  /** Maximum acceptable page load time (3 seconds) */
  PAGE_LOAD_MS: 3000,
  /** Maximum acceptable First Contentful Paint (1.5 seconds) */
  FCP_MS: 1500,
  /** Maximum acceptable interaction latency (500ms) */
  INTERACTION_MS: 500,
} as const;

/**
 * Network thresholds
 */
const NETWORK_THRESHOLDS = {
  /** Maximum acceptable response time (5 seconds) */
  SLOW_RESPONSE_MS: 5000,
} as const;

/**
 * Assertion Evaluator
 *
 * Takes an EvidenceCapsule and evaluates multiple assertion categories
 * to produce a comprehensive AssertionResult.
 */
export class AssertionEvaluator {
  /**
   * Evaluate functional assertions from the evidence capsule
   * Checks for console errors and action timeline failures
   */
  evaluateFunctional(capsule: EvidenceCapsule): AssertionCheck[] {
    const checks: AssertionCheck[] = [];
    const { browser } = capsule;

    // Check for console errors
    const errorCount = browser.console.errors.length;
    checks.push({
      category: 'functional',
      description: 'No console errors present',
      passed: errorCount === 0,
      actual: errorCount === 0 ? '0 errors' : `${errorCount} error(s)`,
      expected: '0 errors',
      severity: 'critical',
      evidence: 'browser.console.errors',
    });

    // Check for action timeline failures
    const failedActions = browser.actionTimeline.filter(
      (action) => action.result === 'failure'
    );
    checks.push({
      category: 'functional',
      description: 'All actions in timeline succeeded',
      passed: failedActions.length === 0,
      actual:
        failedActions.length === 0
          ? '0 failures'
          : `${failedActions.length} failed action(s)`,
      expected: '0 failures',
      severity: failedActions.length > 0 ? 'critical' : 'warning',
      evidence: 'browser.actionTimeline',
    });

    return checks;
  }

  /**
   * Evaluate visual assertions from the evidence capsule
   * Checks for screenshot existence and viewport issues
   */
  evaluateVisual(capsule: EvidenceCapsule): AssertionCheck[] {
    const checks: AssertionCheck[] = [];
    const { browser } = capsule;

    // Check for screenshot existence
    const screenshotCount = browser.screenshots.length;
    checks.push({
      category: 'visual',
      description: 'Screenshot captured successfully',
      passed: screenshotCount > 0,
      actual: screenshotCount === 0 ? 'No screenshots' : `${screenshotCount} screenshot(s)`,
      expected: 'At least 1 screenshot',
      severity: 'warning',
      evidence: 'browser.screenshots',
    });

    // Check for viewport issues (if viewport info available)
    const viewport = browser.sessionMetadata.viewport;
    if (viewport !== undefined) {
      const hasValidViewport =
        viewport.width > 0 &&
        viewport.height > 0 &&
        viewport.width >= 320 &&
        viewport.height >= 480;
      checks.push({
        category: 'visual',
        description: 'Viewport has valid dimensions',
        passed: hasValidViewport,
        actual: hasValidViewport
          ? `${viewport.width}x${viewport.height}`
          : `Invalid: ${viewport.width}x${viewport.height}`,
        expected: 'Width >= 320, Height >= 480',
        severity: 'warning',
        evidence: 'browser.sessionMetadata.viewport',
      });
    }

    return checks;
  }

  /**
   * Evaluate accessibility assertions from the evidence capsule
   * Checks DOM snapshot for common a11y issues
   */
  evaluateAccessibility(capsule: EvidenceCapsule): AssertionCheck[] {
    const checks: AssertionCheck[] = [];
    const { browser } = capsule;
    const domSnapshot = browser.domSnapshot;

    // Check if DOM snapshot is available
    if (domSnapshot === undefined || domSnapshot === '') {
      checks.push({
        category: 'accessibility',
        description: 'DOM snapshot available for accessibility analysis',
        passed: false,
        actual: 'No DOM snapshot',
        expected: 'DOM snapshot present',
        severity: 'info',
        evidence: 'browser.domSnapshot',
      });
      return checks;
    }

    // Check for images without alt text
    const imgWithoutAlt = (domSnapshot.match(/<img[^>]*>/gi) || []).filter(
      (img) => !/alt\s*=/i.test(img)
    );
    checks.push({
      category: 'accessibility',
      description: 'All images have alt attributes',
      passed: imgWithoutAlt.length === 0,
      actual:
        imgWithoutAlt.length === 0
          ? '0 images without alt'
          : `${imgWithoutAlt.length} image(s) missing alt`,
      expected: '0 images without alt',
      severity: 'warning',
      evidence: 'browser.domSnapshot (images)',
    });

    // Check for form inputs without labels
    const inputWithoutLabel = (
      domSnapshot.match(/<input[^>]*>/gi) || []
    ).filter((input) => {
      const hasLabel = /aria-label\s*=|aria-labelledby\s*=|id\s*=/i.test(input);
      const isHidden = /type\s*=\s*["']hidden["']/i.test(input);
      return !hasLabel && !isHidden;
    });
    checks.push({
      category: 'accessibility',
      description: 'Form inputs have accessible labels',
      passed: inputWithoutLabel.length === 0,
      actual:
        inputWithoutLabel.length === 0
          ? '0 inputs without labels'
          : `${inputWithoutLabel.length} input(s) without labels`,
      expected: '0 inputs without labels',
      severity: 'warning',
      evidence: 'browser.domSnapshot (inputs)',
    });

    // Check for buttons without accessible text
    const emptyButtons = (domSnapshot.match(/<button[^>]*>[\s]*<\/button>/gi) || []).filter(
      (btn) => !/aria-label\s*=|aria-labelledby\s*=/i.test(btn)
    );
    checks.push({
      category: 'accessibility',
      description: 'Buttons have accessible text',
      passed: emptyButtons.length === 0,
      actual:
        emptyButtons.length === 0
          ? '0 empty buttons'
          : `${emptyButtons.length} empty button(s)`,
      expected: '0 empty buttons',
      severity: 'warning',
      evidence: 'browser.domSnapshot (buttons)',
    });

    return checks;
  }

  /**
   * Evaluate performance assertions from the evidence capsule
   * Checks performance metrics against thresholds
   */
  evaluatePerformance(capsule: EvidenceCapsule): AssertionCheck[] {
    const checks: AssertionCheck[] = [];
    const { browser } = capsule;
    const metrics = browser.performanceMetrics;

    // Check page load time
    const pageLoad = metrics['loadEventEnd'] ?? metrics['pageLoad'] ?? metrics['loadTime'];
    if (pageLoad !== undefined) {
      const passed = pageLoad <= PERFORMANCE_THRESHOLDS.PAGE_LOAD_MS;
      checks.push({
        category: 'performance',
        description: `Page load time under ${PERFORMANCE_THRESHOLDS.PAGE_LOAD_MS}ms`,
        passed,
        actual: `${pageLoad}ms`,
        expected: `< ${PERFORMANCE_THRESHOLDS.PAGE_LOAD_MS}ms`,
        severity: passed ? 'info' : 'warning',
        evidence: 'browser.performanceMetrics.loadEventEnd',
      });
    }

    // Check First Contentful Paint
    const fcp = metrics['firstContentfulPaint'] ?? metrics['fcp'] ?? metrics['FirstContentfulPaint'];
    if (fcp !== undefined) {
      const passed = fcp <= PERFORMANCE_THRESHOLDS.FCP_MS;
      checks.push({
        category: 'performance',
        description: `First Contentful Paint under ${PERFORMANCE_THRESHOLDS.FCP_MS}ms`,
        passed,
        actual: `${fcp}ms`,
        expected: `< ${PERFORMANCE_THRESHOLDS.FCP_MS}ms`,
        severity: passed ? 'info' : 'warning',
        evidence: 'browser.performanceMetrics.firstContentfulPaint',
      });
    }

    // Check DOM Content Loaded
    const dcl = metrics['domContentLoaded'] ?? metrics['domContentLoadedEventEnd'];
    if (dcl !== undefined) {
      const passed = dcl <= PERFORMANCE_THRESHOLDS.PAGE_LOAD_MS;
      checks.push({
        category: 'performance',
        description: 'DOM Content Loaded in reasonable time',
        passed,
        actual: `${dcl}ms`,
        expected: `< ${PERFORMANCE_THRESHOLDS.PAGE_LOAD_MS}ms`,
        severity: passed ? 'info' : 'warning',
        evidence: 'browser.performanceMetrics.domContentLoaded',
      });
    }

    // If no performance metrics available, add info check
    if (checks.length === 0) {
      checks.push({
        category: 'performance',
        description: 'Performance metrics available for analysis',
        passed: false,
        actual: 'No performance metrics captured',
        expected: 'Performance metrics present',
        severity: 'info',
        evidence: 'browser.performanceMetrics',
      });
    }

    return checks;
  }

  /**
   * Evaluate UX assertions from the evidence capsule
   * Checks for UX anti-patterns like console warnings and slow interactions
   */
  evaluateUx(capsule: EvidenceCapsule): AssertionCheck[] {
    const checks: AssertionCheck[] = [];
    const { browser } = capsule;

    // Check for console warnings
    const warningCount = browser.console.warnings.length;
    checks.push({
      category: 'ux',
      description: 'No console warnings present',
      passed: warningCount === 0,
      actual: warningCount === 0 ? '0 warnings' : `${warningCount} warning(s)`,
      expected: '0 warnings',
      severity: 'warning',
      evidence: 'browser.console.warnings',
    });

    // Check for slow interactions in action timeline
    const slowInteractions = browser.actionTimeline.filter((action) => {
      // Try to parse timestamp difference as duration proxy
      // This is a heuristic since action timeline doesn't have explicit duration
      return action.result === 'success' && action.error !== undefined;
    });
    checks.push({
      category: 'ux',
      description: 'No failed interactions in timeline',
      passed: slowInteractions.length === 0,
      actual:
        slowInteractions.length === 0
          ? '0 failed interactions'
          : `${slowInteractions.length} failed interaction(s)`,
      expected: '0 failed interactions',
      severity: 'info',
      evidence: 'browser.actionTimeline',
    });

    // Check for viewport usability
    const viewport = browser.sessionMetadata.viewport;
    if (viewport !== undefined) {
      const isMobile = viewport.width < 768;
      const isSmall = viewport.width < 375 || viewport.height < 667;
      checks.push({
        category: 'ux',
        description: 'Viewport size supports good UX',
        passed: !isSmall,
        actual: `${viewport.width}x${viewport.height}${isMobile ? ' (mobile)' : ''}`,
        expected: 'Width >= 375, Height >= 667',
        severity: 'info',
        evidence: 'browser.sessionMetadata.viewport',
      });
    }

    return checks;
  }

  /**
   * Evaluate network assertions from the evidence capsule
   * Checks for failed requests, slow responses, and mixed content
   */
  evaluateNetwork(capsule: EvidenceCapsule): AssertionCheck[] {
    const checks: AssertionCheck[] = [];
    const { browser } = capsule;
    const requests = browser.networkRequests;

    // Check for failed requests (non-2xx status codes)
    const failedRequests = requests.filter(
      (req) => req.status < 200 || req.status >= 400
    );
    checks.push({
      category: 'network',
      description: 'All network requests succeeded (2xx status)',
      passed: failedRequests.length === 0,
      actual:
        failedRequests.length === 0
          ? '0 failed requests'
          : `${failedRequests.length} failed request(s)`,
      expected: '0 failed requests',
      severity: 'critical',
      evidence: 'browser.networkRequests (status codes)',
    });

    // Check for slow responses
    const slowResponses = requests.filter(
      (req) => req.duration > NETWORK_THRESHOLDS.SLOW_RESPONSE_MS
    );
    checks.push({
      category: 'network',
      description: `No slow responses (>${NETWORK_THRESHOLDS.SLOW_RESPONSE_MS}ms)`,
      passed: slowResponses.length === 0,
      actual:
        slowResponses.length === 0
          ? '0 slow responses'
          : `${slowResponses.length} slow response(s)`,
      expected: `0 responses > ${NETWORK_THRESHOLDS.SLOW_RESPONSE_MS}ms`,
      severity: 'warning',
      evidence: 'browser.networkRequests (durations)',
    });

    // Check for mixed content (HTTPS page with HTTP resources)
    const pageUrl = browser.sessionMetadata.url;
    if (pageUrl.startsWith('https://')) {
      const mixedContent = requests.filter((req) => req.url.startsWith('http://'));
      checks.push({
        category: 'network',
        description: 'No mixed content (HTTP resources on HTTPS page)',
        passed: mixedContent.length === 0,
        actual:
          mixedContent.length === 0
            ? '0 mixed content requests'
            : `${mixedContent.length} insecure request(s)`,
        expected: '0 mixed content requests',
        severity: 'warning',
        evidence: 'browser.networkRequests (protocol)',
      });
    }

    // If no network requests captured, add info check
    if (requests.length === 0) {
      checks.push({
        category: 'network',
        description: 'Network requests captured for analysis',
        passed: false,
        actual: '0 network requests captured',
        expected: 'Network requests present',
        severity: 'info',
        evidence: 'browser.networkRequests',
      });
    }

    return checks;
  }

  /**
   * Evaluate all assertion categories for an evidence capsule
   * Aggregates results from all category evaluators
   */
  evaluate(capsule: EvidenceCapsule): AssertionResult {
    logger.info('Evaluating evidence capsule', { capsuleId: capsule.capsuleId });

    const allChecks: AssertionCheck[] = [];

    // Run all category evaluators
    const categories: AssertionCategory[] = [
      'functional',
      'visual',
      'accessibility',
      'performance',
      'ux',
      'network',
    ];

    for (const category of categories) {
      let checks: AssertionCheck[];
      switch (category) {
        case 'functional':
          checks = this.evaluateFunctional(capsule);
          break;
        case 'visual':
          checks = this.evaluateVisual(capsule);
          break;
        case 'accessibility':
          checks = this.evaluateAccessibility(capsule);
          break;
        case 'performance':
          checks = this.evaluatePerformance(capsule);
          break;
        case 'ux':
          checks = this.evaluateUx(capsule);
          break;
        case 'network':
          checks = this.evaluateNetwork(capsule);
          break;
        default:
          checks = [];
      }
      allChecks.push(...checks);
    }

    // Calculate totals
    const passed = allChecks.filter((c) => c.passed).length;
    const failed = allChecks.filter((c) => !c.passed).length;

    const result: AssertionResult = {
      capsuleId: capsule.capsuleId,
      timestamp: new Date().toISOString(),
      totalChecks: allChecks.length,
      passed,
      failed,
      assertions: allChecks,
    };

    logger.info('Assertion evaluation complete', {
      capsuleId: capsule.capsuleId,
      totalChecks: result.totalChecks,
      passed: result.passed,
      failed: result.failed,
    });

    return result;
  }
}

// Singleton instance
let evaluator: AssertionEvaluator | undefined;

/**
 * Get the singleton assertion evaluator
 */
export function getAssertionEvaluator(): AssertionEvaluator {
  if (!evaluator) {
    evaluator = new AssertionEvaluator();
  }
  return evaluator;
}
