/**
 * Flake Analyzer
 *
 * Analyzes evidence capsules to detect flaky test/failure patterns.
 * Maintains historical pattern tracking to identify intermittent failures
 * and provide actionable recommendations.
 */

import { createHash } from 'node:crypto';
import { getLogger } from '../infra/logger.js';
import { getEvidenceCapsuleCollector } from './evidenceCapsule.js';
import { getFailureClassifier } from './failureClassifier.js';
import type {
  EvidenceCapsule,
  FailureClass,
  FailureExplanation,
  FlakeAnalysis,
  FlakeRecommendation,
} from './types.js';

const logger = getLogger('flake-analyzer');
const MAX_PATTERN_HISTORY = 200;

/**
 * Pattern history entry for tracking flaky behavior
 */
interface PatternHistoryEntry {
  /** Pattern signature */
  signature: string;
  /** Timestamp of occurrence */
  timestamp: number;
  /** Whether it was classified as flaky */
  wasFlaky: boolean;
  /** Failure class associated with this pattern */
  failureClass: FailureClass;
}

/**
 * Flake Analyzer
 *
 * Analyzes multiple evidence capsules to detect flaky test patterns.
 * Uses historical pattern tracking to improve flake detection accuracy.
 */
export class FlakeAnalyzer {
  private patternHistory: PatternHistoryEntry[] = [];

  /**
   * Analyze multiple evidence capsules for flaky behavior
   */
  async analyze(capsuleIds: string[]): Promise<FlakeAnalysis> {
    logger.debug('Starting flake analysis', { capsuleCount: capsuleIds.length, capsuleIds });

    const collector = getEvidenceCapsuleCollector();
    const classifier = getFailureClassifier();

    // Retrieve all capsules
    const capsules: EvidenceCapsule[] = [];
    const missingCapsules: string[] = [];

    for (const id of capsuleIds) {
      const capsule = collector.get(id);
      if (capsule) {
        capsules.push(capsule);
      } else {
        missingCapsules.push(id);
      }
    }

    if (missingCapsules.length > 0) {
      logger.warn('Some capsules not found during flake analysis', { missingCapsules });
    }

    // Need at least one capsule to analyze
    if (capsules.length === 0) {
      return this.createEmptyAnalysis(capsuleIds);
    }

    // Classify each capsule
    const explanations: FailureExplanation[] = capsules.map((c) => classifier.classify(c));

    // Analyze for flakiness
    const failureClasses = explanations.map((e) => e.failureClass);
    const uniqueClasses = new Set(failureClasses);

    // Determine if flaky based on pattern analysis
    const isFlaky = this.detectFlakiness(capsules, explanations, failureClasses);
    const primaryClass = this.determinePrimaryClass(failureClasses);
    const patternSignature = this.generatePatternSignature(primaryClass, capsules);
    const historicalFrequency = this.calculateHistoricalFrequency(patternSignature);
    const recommendedAction = this.determineRecommendedAction(primaryClass, isFlaky, explanations);
    const confidence = this.calculateConfidence(explanations, isFlaky, historicalFrequency);
    const reasoning = this.generateReasoning(capsules, explanations, isFlaky, primaryClass);

    // Record this pattern for historical tracking
    this.recordPattern(patternSignature, isFlaky, primaryClass);

    const analysis: FlakeAnalysis = {
      capsuleIds,
      failureClass: primaryClass,
      isFlaky,
      confidence,
      recommendedAction,
      reasoning,
      historicalFrequency,
      patternSignature,
    };

    logger.info('Flake analysis completed', {
      capsuleCount: capsules.length,
      isFlaky,
      failureClass: primaryClass,
      confidence,
      recommendedAction,
      patternSignature,
    });

    return analysis;
  }

  /**
   * Record a pattern for historical tracking
   */
  recordPattern(signature: string, wasFlaky: boolean, failureClass: FailureClass): void {
    const entry: PatternHistoryEntry = {
      signature,
      timestamp: Date.now(),
      wasFlaky,
      failureClass,
    };

    this.patternHistory.push(entry);

    // Enforce max history size with LRU eviction
    if (this.patternHistory.length > MAX_PATTERN_HISTORY) {
      this.patternHistory.shift();
      logger.debug('Pattern history trimmed to max size', { maxSize: MAX_PATTERN_HISTORY });
    }

    logger.debug('Pattern recorded', { signature, wasFlaky, historySize: this.patternHistory.length });
  }

  /**
   * Detect if failures indicate flaky behavior
   */
  private detectFlakiness(
    capsules: EvidenceCapsule[],
    explanations: FailureExplanation[],
    failureClasses: FailureClass[]
  ): boolean {
    // If we have multiple capsules with different failure classes, it's likely flaky
    const uniqueClasses = new Set(failureClasses);
    if (uniqueClasses.size > 1) {
      logger.debug('Multiple failure classes detected, indicating flakiness', {
        classes: Array.from(uniqueClasses),
      });
      return true;
    }

    // Check for intermittent pass/fail patterns in action timeline
    const hasIntermittentActions = capsules.some((capsule) =>
      this.hasIntermittentActionPattern(capsule)
    );
    if (hasIntermittentActions) {
      logger.debug('Intermittent action patterns detected');
      return true;
    }

    // Check for timing-related failures in the explanations
    const timingFailures = explanations.filter((e) => e.failureClass === 'timing');
    if (timingFailures.length > 0 && timingFailures.length < explanations.length) {
      // Mixed timing and non-timing failures suggest flakiness
      logger.debug('Mixed timing and non-timing failures detected');
      return true;
    }

    // Check for selector drift with intermittent success
    const selectorDriftFailures = explanations.filter((e) => e.failureClass === 'selector_drift');
    if (selectorDriftFailures.length > 0) {
      // Selector drift is inherently flaky
      logger.debug('Selector drift detected, marking as flaky');
      return true;
    }

    // Check for low confidence classifications - indicates unclear root cause
    const avgConfidence =
      explanations.reduce((sum, e) => sum + e.confidence, 0) / explanations.length;
    if (avgConfidence < 0.5 && explanations.length > 1) {
      logger.debug('Low average confidence suggests flakiness', { avgConfidence });
      return true;
    }

    return false;
  }

  /**
   * Check if action timeline shows intermittent success/failure pattern
   */
  private hasIntermittentActionPattern(capsule: EvidenceCapsule): boolean {
    const timeline = capsule.browser.actionTimeline;
    if (timeline.length < 2) {
      return false;
    }

    // Look for alternating success/failure patterns
    let transitions = 0;
    for (let i = 1; i < timeline.length; i++) {
      if (timeline[i - 1]?.result !== timeline[i]?.result) {
        transitions++;
      }
    }

    // If more than 30% of actions show transitions, consider it intermittent
    const transitionRate = transitions / (timeline.length - 1);
    return transitionRate > 0.3;
  }

  /**
   * Determine the primary failure class from a list
   */
  private determinePrimaryClass(failureClasses: FailureClass[]): FailureClass {
    if (failureClasses.length === 0) {
      return 'app_code';
    }

    // Count occurrences of each class
    const counts = new Map<FailureClass, number>();
    for (const fc of failureClasses) {
      counts.set(fc, (counts.get(fc) ?? 0) + 1);
    }

    // Find the most common class
    let maxCount = 0;
    let primaryClass: FailureClass = failureClasses[0] ?? 'app_code';

    for (const [fc, count] of counts) {
      if (count > maxCount) {
        maxCount = count;
        primaryClass = fc;
      }
    }

    return primaryClass;
  }

  /**
   * Generate a pattern signature for historical tracking
   */
  private generatePatternSignature(
    failureClass: FailureClass,
    capsules: EvidenceCapsule[]
  ): string {
    // Create a signature based on failure class and common evidence patterns
    const evidenceKeys: string[] = [];

    for (const capsule of capsules) {
      // Include URL domain for context
      try {
        const url = capsule.browser.sessionMetadata.url;
        if (url) {
          const parsed = new URL(url);
          evidenceKeys.push(parsed.hostname);
        }
      } catch {
        // Ignore invalid URLs
      }

      // Include failure type
      evidenceKeys.push(capsule.failure.type);

      // Include error patterns from console
      const errorPatterns = capsule.browser.console.errors
        .slice(0, 3)
        .map((e) => e.message.substring(0, 50));
      evidenceKeys.push(...errorPatterns);
    }

    const signatureInput = `${failureClass}:${evidenceKeys.join('|')}`;
    return createHash('sha256').update(signatureInput).digest('hex').substring(0, 16);
  }

  /**
   * Calculate historical frequency for a pattern signature
   */
  private calculateHistoricalFrequency(signature: string): number {
    const matchingPatterns = this.patternHistory.filter((p) => p.signature === signature);

    if (matchingPatterns.length === 0) {
      return 0;
    }

    // Calculate frequency based on recent occurrences
    const recentWindow = 24 * 60 * 60 * 1000; // 24 hours
    const now = Date.now();
    const recentMatches = matchingPatterns.filter((p) => now - p.timestamp < recentWindow);

    // Normalize to a 0-1 scale based on max expected occurrences
    const maxExpectedOccurrences = 10;
    return Math.min(1, recentMatches.length / maxExpectedOccurrences);
  }

  /**
   * Determine the recommended action based on failure analysis
   */
  private determineRecommendedAction(
    failureClass: FailureClass,
    isFlaky: boolean,
    explanations: FailureExplanation[]
  ): FlakeRecommendation {
    // Direct mapping for specific failure classes
    switch (failureClass) {
      case 'timing':
        return 'add_wait';

      case 'selector_drift':
        return 'fix_selector';

      case 'backend_failure':
        return 'fix_backend';

      case 'environment':
        return 'fix_environment';

      case 'app_code':
        // If flaky with app_code, might need investigation
        if (isFlaky) {
          return 'investigate';
        }
        return 'retry';

      default:
        // Exhaustive check
        const _exhaustive: never = failureClass;
        return _exhaustive;
    }
  }

  /**
   * Calculate confidence score for the flake analysis
   */
  private calculateConfidence(
    explanations: FailureExplanation[],
    isFlaky: boolean,
    historicalFrequency: number
  ): number {
    if (explanations.length === 0) {
      return 0;
    }

    // Base confidence on explanation confidences
    const avgExplanationConfidence =
      explanations.reduce((sum, e) => sum + e.confidence, 0) / explanations.length;

    // Adjust based on historical frequency - higher frequency increases confidence
    const historicalBoost = historicalFrequency * 0.1;

    // Adjust based on number of samples
    const sampleCount = explanations.length;
    const sampleConfidence = Math.min(1, sampleCount / 5);

    // Combine factors
    let confidence = avgExplanationConfidence * 0.6 + sampleConfidence * 0.3 + historicalBoost;

    // Reduce confidence if flaky (inherently less certain)
    if (isFlaky) {
      confidence *= 0.9;
    }

    return Math.min(1, Math.max(0, confidence));
  }

  /**
   * Generate human-readable reasoning for the analysis
   */
  private generateReasoning(
    capsules: EvidenceCapsule[],
    explanations: FailureExplanation[],
    isFlaky: boolean,
    primaryClass: FailureClass
  ): string {
    const parts: string[] = [];

    // Summarize capsule count
    parts.push(`Analyzed ${capsules.length} evidence capsule(s).`);

    // Summarize failure classes
    const classCounts = new Map<FailureClass, number>();
    for (const e of explanations) {
      classCounts.set(e.failureClass, (classCounts.get(e.failureClass) ?? 0) + 1);
    }

    const classSummary = Array.from(classCounts.entries())
      .map(([fc, count]) => `${fc}(${count})`)
      .join(', ');
    parts.push(`Failure class distribution: ${classSummary}.`);

    // Flakiness determination
    if (isFlaky) {
      if (classCounts.size > 1) {
        parts.push('Determined as flaky due to inconsistent failure classifications across runs.');
      } else if (primaryClass === 'timing') {
        parts.push('Determined as flaky due to timing-related failure patterns.');
      } else if (primaryClass === 'selector_drift') {
        parts.push('Determined as flaky due to selector drift indicating unstable page structure.');
      } else {
        parts.push('Determined as flaky based on intermittent failure patterns.');
      }
    } else {
      parts.push(`Consistent failure pattern identified: ${primaryClass}.`);
    }

    // Primary class explanation
    const classReasons: Record<FailureClass, string> = {
      timing: 'Failures are related to timing issues - operations timing out or racing conditions.',
      selector_drift: 'Failures are related to selector changes - page structure is unstable.',
      backend_failure: 'Failures are related to backend issues - server errors or network problems.',
      environment: 'Failures are related to environment issues - CORS, DNS, or certificate problems.',
      app_code: 'Failures are related to application code - likely a real bug.',
    };

    parts.push(classReasons[primaryClass]);

    return parts.join(' ');
  }

  /**
   * Create an empty analysis for cases with no valid capsules
   */
  private createEmptyAnalysis(capsuleIds: string[]): FlakeAnalysis {
    return {
      capsuleIds,
      failureClass: 'app_code',
      isFlaky: false,
      confidence: 0,
      recommendedAction: 'investigate',
      reasoning: 'No valid evidence capsules provided for analysis.',
      historicalFrequency: 0,
      patternSignature: '',
    };
  }

  /**
   * Get the current pattern history size
   */
  getHistorySize(): number {
    return this.patternHistory.length;
  }

  /**
   * Clear the pattern history
   */
  clearHistory(): void {
    this.patternHistory = [];
    logger.info('Pattern history cleared');
  }
}

// Singleton instance
let analyzer: FlakeAnalyzer | undefined;

/**
 * Get the singleton flake analyzer
 */
export function getFlakeAnalyzer(): FlakeAnalyzer {
  if (!analyzer) {
    analyzer = new FlakeAnalyzer();
  }
  return analyzer;
}
