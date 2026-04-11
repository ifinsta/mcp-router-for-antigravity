/**
 * Failure Classifier
 *
 * Rule-based classification of browser failures using evidence capsules.
 * Analyzes console errors, network requests, performance metrics, and action timeline
 * to determine the root cause classification of a failure.
 */

import { getLogger } from '../infra/logger.js';
import type {
  EvidenceCapsule,
  FailureClass,
  FailureExplanation,
  BrowserConsoleEntry,
  BrowserNetworkEntry,
  ActionTimelineEntry,
} from './types.js';

const logger = getLogger('failure-classifier');

/**
 * Patterns for classifying failures based on console error messages
 */
const BACKEND_FAILURE_PATTERNS = [
  /network\s*error/i,
  /fetch\s*(failed|error)/i,
  /xhr\s*(failed|error)/i,
  /xmlhttprequest\s*(failed|error)/i,
  /request\s*failed/i,
  /http\s*(error|failed)/i,
  /status\s*(code|)[:\s]*[45]\d{2}/i,
  /server\s*error/i,
  /bad\s*gateway/i,
  /service\s*unavailable/i,
  /gateway\s*timeout/i,
  /connection\s*refused/i,
  /econnrefused/i,
  /enotfound/i,
];

const TIMING_PATTERNS = [
  /timeout/i,
  /timed?\s*out/i,
  /execution\s*timed?\s*out/i,
  /script\s*timeout/i,
  /loading\s*timeout/i,
  /request\s*timeout/i,
];

const SELECTOR_DRIFT_PATTERNS = [
  /element\s*not\s*found/i,
  /no\s*such\s*element/i,
  /element\s*not\s*visible/i,
  /element\s*not\s*interactable/i,
  /stale\s*element/i,
  /selector\s*(not\s*found|failed|invalid)/i,
  /cannot\s*find\s*element/i,
  /unable\s*to\s*(locate|find)\s*element/i,
  /node\s*is\s*(detached|not\s*attached)/i,
];

const ENVIRONMENT_PATTERNS = [
  /cors/i,
  /cross-origin/i,
  /blocked\s*by\s*cors/i,
  /dns\s*(error|failed|resolution)/i,
  /enotfound/i,
  /certificate\s*(error|invalid|expired)/i,
  /ssl\s*(error|failed)/i,
  /tls\s*(error|failed)/i,
  /mixed\s*content/i,
  /content\s*security\s*policy/i,
  /csp\s*violation/i,
];

/**
 * Threshold for slow load time in milliseconds
 */
const SLOW_LOAD_THRESHOLD_MS = 5000;

/**
 * Failure Classifier
 *
 * Classifies browser failures using rule-based analysis of evidence capsules.
 */
export class FailureClassifier {
  /**
   * Classify a failure based on an evidence capsule
   */
  classify(capsule: EvidenceCapsule): FailureExplanation {
    logger.debug('Classifying failure', {
      capsuleId: capsule.capsuleId,
      failureType: capsule.failure.type,
    });

    const evidence: string[] = [];
    const scores: Map<FailureClass, number> = new Map([
      ['app_code', 0],
      ['timing', 0],
      ['selector_drift', 0],
      ['backend_failure', 0],
      ['environment', 0],
    ]);

    // Analyze console errors
    this.analyzeConsoleErrors(capsule.browser.console.errors, scores, evidence);

    // Analyze network requests
    this.analyzeNetworkRequests(capsule.browser.networkRequests, scores, evidence);

    // Analyze performance metrics
    this.analyzePerformanceMetrics(capsule.browser.performanceMetrics, scores, evidence);

    // Analyze action timeline
    this.analyzeActionTimeline(capsule.browser.actionTimeline, scores, evidence);

    // Include the failure message itself
    if (capsule.failure.message) {
      this.analyzeFailureMessage(capsule.failure.message, scores, evidence);
    }

    // Determine the winning class
    let maxScore = 0;
    let winningClass: FailureClass = 'app_code';

    for (const [failureClass, score] of scores) {
      if (score > maxScore) {
        maxScore = score;
        winningClass = failureClass;
      }
    }

    // Calculate confidence based on score distribution
    const totalScore = Array.from(scores.values()).reduce((a, b) => a + b, 0);
    let confidence = 0.5; // Default confidence

    if (totalScore > 0) {
      confidence = Math.min(0.95, maxScore / totalScore);
    }

    // If no strong signals, default to app_code with lower confidence
    if (maxScore === 0) {
      winningClass = 'app_code';
      confidence = 0.3;
      evidence.push('No specific failure patterns detected, defaulting to app_code classification');
    }

    const explanation: FailureExplanation = {
      what: this.buildWhatDescription(capsule, winningClass),
      firstBadState: this.buildFirstBadState(capsule, winningClass),
      failureClass: winningClass,
      confidence,
      evidence,
    };

    logger.info('Failure classified', {
      capsuleId: capsule.capsuleId,
      failureClass: winningClass,
      confidence,
      evidenceCount: evidence.length,
    });

    return explanation;
  }

  /**
   * Analyze console errors for classification signals
   */
  private analyzeConsoleErrors(
    errors: readonly BrowserConsoleEntry[],
    scores: Map<FailureClass, number>,
    evidence: string[]
  ): void {
    for (const entry of errors) {
      const message = entry.message.toLowerCase();

      // Check for backend failure patterns
      for (const pattern of BACKEND_FAILURE_PATTERNS) {
        if (pattern.test(entry.message)) {
          scores.set('backend_failure', (scores.get('backend_failure') ?? 0) + 1);
          evidence.push(`Console error indicates backend failure: "${this.truncateMessage(entry.message)}"`);
          break;
        }
      }

      // Check for timing patterns
      for (const pattern of TIMING_PATTERNS) {
        if (pattern.test(entry.message)) {
          scores.set('timing', (scores.get('timing') ?? 0) + 1);
          evidence.push(`Console error indicates timing issue: "${this.truncateMessage(entry.message)}"`);
          break;
        }
      }

      // Check for environment patterns
      for (const pattern of ENVIRONMENT_PATTERNS) {
        if (pattern.test(entry.message)) {
          scores.set('environment', (scores.get('environment') ?? 0) + 1);
          evidence.push(`Console error indicates environment issue: "${this.truncateMessage(entry.message)}"`);
          break;
        }
      }

      // Check for selector drift patterns (element not found)
      for (const pattern of SELECTOR_DRIFT_PATTERNS) {
        if (pattern.test(entry.message)) {
          scores.set('selector_drift', (scores.get('selector_drift') ?? 0) + 1);
          evidence.push(`Console error indicates selector drift: "${this.truncateMessage(entry.message)}"`);
          break;
        }
      }
    }
  }

  /**
   * Analyze network requests for classification signals
   */
  private analyzeNetworkRequests(
    requests: readonly BrowserNetworkEntry[],
    scores: Map<FailureClass, number>,
    evidence: string[]
  ): void {
    for (const request of requests) {
      // Check for 5xx status codes (backend failure)
      if (request.status >= 500 && request.status < 600) {
        scores.set('backend_failure', (scores.get('backend_failure') ?? 0) + 2);
        evidence.push(
          `Network request returned ${request.status} ${request.statusText} for ${this.truncateUrl(request.url)}`
        );
      }

      // Check for CORS errors (status 0 with no status text usually indicates CORS)
      if (request.status === 0 && request.statusText === '') {
        scores.set('environment', (scores.get('environment') ?? 0) + 2);
        evidence.push(`Network request blocked (likely CORS) for ${this.truncateUrl(request.url)}`);
      }

      // Check for DNS errors (status 0 with specific patterns)
      if (request.status === 0 && request.statusText.toLowerCase().includes('dns')) {
        scores.set('environment', (scores.get('environment') ?? 0) + 2);
        evidence.push(`DNS resolution failed for ${this.truncateUrl(request.url)}`);
      }
    }
  }

  /**
   * Analyze performance metrics for timing issues
   */
  private analyzePerformanceMetrics(
    metrics: Record<string, number>,
    scores: Map<FailureClass, number>,
    evidence: string[]
  ): void {
    // Check for slow load times
    const loadTimeMetrics = ['loadTime', 'domContentLoaded', 'pageLoadTime', 'loadEventEnd', 'domComplete'];

    for (const metricName of loadTimeMetrics) {
      const value = metrics[metricName];
      if (typeof value === 'number' && value > SLOW_LOAD_THRESHOLD_MS) {
        scores.set('timing', (scores.get('timing') ?? 0) + 1);
        evidence.push(`Slow ${metricName}: ${value}ms (threshold: ${SLOW_LOAD_THRESHOLD_MS}ms)`);
      }
    }

    // Check for long task times
    const longTaskValue = metrics['longTaskCount'];
    if (typeof longTaskValue === 'number' && longTaskValue > 5) {
      scores.set('timing', (scores.get('timing') ?? 0) + 0.5);
      evidence.push(`High long task count: ${longTaskValue}`);
    }
  }

  /**
   * Analyze action timeline for selector issues
   */
  private analyzeActionTimeline(
    timeline: readonly ActionTimelineEntry[],
    scores: Map<FailureClass, number>,
    evidence: string[]
  ): void {
    for (const entry of timeline) {
      if (entry.result === 'failure') {
        const errorMessage = entry.error?.toLowerCase() ?? '';

        // Check for element not found or selector failures
        for (const pattern of SELECTOR_DRIFT_PATTERNS) {
          if (pattern.test(errorMessage)) {
            scores.set('selector_drift', (scores.get('selector_drift') ?? 0) + 2);
            evidence.push(
              `Action failed with selector drift: ${entry.action}${entry.selector ? ` on "${entry.selector}"` : ''} - ${this.truncateMessage(errorMessage)}`
            );
            break;
          }
        }

        // Check for timing issues in actions
        for (const pattern of TIMING_PATTERNS) {
          if (pattern.test(errorMessage)) {
            scores.set('timing', (scores.get('timing') ?? 0) + 1);
            evidence.push(`Action failed with timing issue: ${entry.action}`);
            break;
          }
        }
      }
    }
  }

  /**
   * Analyze the failure message itself
   */
  private analyzeFailureMessage(
    message: string,
    scores: Map<FailureClass, number>,
    evidence: string[]
  ): void {
    // Check all pattern categories against the failure message
    for (const pattern of BACKEND_FAILURE_PATTERNS) {
      if (pattern.test(message)) {
        scores.set('backend_failure', (scores.get('backend_failure') ?? 0) + 0.5);
        break;
      }
    }

    for (const pattern of TIMING_PATTERNS) {
      if (pattern.test(message)) {
        scores.set('timing', (scores.get('timing') ?? 0) + 0.5);
        break;
      }
    }

    for (const pattern of SELECTOR_DRIFT_PATTERNS) {
      if (pattern.test(message)) {
        scores.set('selector_drift', (scores.get('selector_drift') ?? 0) + 0.5);
        break;
      }
    }

    for (const pattern of ENVIRONMENT_PATTERNS) {
      if (pattern.test(message)) {
        scores.set('environment', (scores.get('environment') ?? 0) + 0.5);
        break;
      }
    }
  }

  /**
   * Build the "what" description for the failure explanation
   */
  private buildWhatDescription(capsule: EvidenceCapsule, failureClass: FailureClass): string {
    const failureType = capsule.failure.type;
    const url = capsule.browser.sessionMetadata.url;

    const classDescriptions: Record<FailureClass, string> = {
      app_code: `Application code failure (${failureType})`,
      timing: `Timing-related failure (${failureType}) - operation exceeded expected duration`,
      selector_drift: `Selector drift detected (${failureType}) - page structure changed unexpectedly`,
      backend_failure: `Backend failure (${failureType}) - server or network error detected`,
      environment: `Environment issue (${failureType}) - CORS, DNS, or certificate problem`,
    };

    let description = classDescriptions[failureClass];
    if (url) {
      description += ` at ${this.truncateUrl(url)}`;
    }

    return description;
  }

  /**
   * Build the "first bad state" description for the failure explanation
   */
  private buildFirstBadState(capsule: EvidenceCapsule, failureClass: FailureClass): string {
    // Try to find the first observable bad state from the evidence

    // Check console errors first
    const consoleErrors = capsule.browser.console.errors;
    if (consoleErrors.length > 0) {
      return `Console error: "${this.truncateMessage(consoleErrors[0]!.message)}"`;
    }

    // Check action timeline for first failure
    const failedActions = capsule.browser.actionTimeline.filter((a) => a.result === 'failure');
    if (failedActions.length > 0) {
      const first = failedActions[0]!;
      return `Action "${first.action}" failed${first.selector ? ` on selector "${first.selector}"` : ''}${first.error ? `: ${this.truncateMessage(first.error)}` : ''}`;
    }

    // Check network requests for errors
    const failedRequests = capsule.browser.networkRequests.filter(
      (r) => r.status >= 400 || r.status === 0
    );
    if (failedRequests.length > 0) {
      const first = failedRequests[0]!;
      return `Network request to ${this.truncateUrl(first.url)} returned ${first.status || 'blocked'}`;
    }

    // Check warnings
    const warnings = capsule.browser.console.warnings;
    if (warnings.length > 0) {
      return `Console warning: "${this.truncateMessage(warnings[0]!.message)}"`;
    }

    // Fall back to failure message
    return `Failure: "${this.truncateMessage(capsule.failure.message)}"`;
  }

  /**
   * Truncate a message for readability in evidence
   */
  private truncateMessage(message: string, maxLength: number = 100): string {
    if (message.length <= maxLength) {
      return message;
    }
    return `${message.substring(0, maxLength - 3)}...`;
  }

  /**
   * Truncate a URL for readability in evidence
   */
  private truncateUrl(url: string, maxLength: number = 80): string {
    if (url.length <= maxLength) {
      return url;
    }
    return `${url.substring(0, maxLength - 3)}...`;
  }
}

// Singleton instance
let classifier: FailureClassifier | undefined;

/**
 * Get the singleton failure classifier
 */
export function getFailureClassifier(): FailureClassifier {
  if (!classifier) {
    classifier = new FailureClassifier();
  }
  return classifier;
}
