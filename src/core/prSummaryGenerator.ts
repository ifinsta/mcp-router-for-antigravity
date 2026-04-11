/**
 * PR Summary Generator
 *
 * Generates comprehensive PR summaries for CI/CD workflow integration.
 * Combines evidence capsules, failure classification, root cause mapping,
 * and verification results into GitHub-ready markdown reports.
 */

import { randomUUID } from 'node:crypto';
import { getLogger } from '../infra/logger.js';
import { getEvidenceCapsuleCollector } from './evidenceCapsule.js';
import { getFailureClassifier } from './failureClassifier.js';
import { getRootCauseMapper } from './rootCauseMapper.js';
import type {
  EvidenceCapsule,
  VerificationResult,
  PRSummary,
  CandidateFix,
} from './types.js';

const logger = getLogger('pr-summary-generator');
const MAX_SUMMARIES = 100;

/**
 * PR Summary Generator
 *
 * Generates PR-ready summaries from evidence capsules for CI/CD integration.
 * Stores generated summaries with LRU eviction.
 */
export class PRSummaryGenerator {
  private summaries: Map<string, PRSummary> = new Map();

  /**
   * Generate a PR summary from an evidence capsule
   *
   * @param capsuleId - ID of the evidence capsule to summarize
   * @returns Generated PR summary
   * @throws Error if capsule not found
   */
  async generate(capsuleId: string): Promise<PRSummary> {
    logger.info('Generating PR summary', { capsuleId });

    // Get the capsule from collector
    const collector = getEvidenceCapsuleCollector();
    const capsule = collector.get(capsuleId);

    if (!capsule) {
      throw new Error(`Evidence capsule not found: ${capsuleId}`);
    }

    // Run failure classifier to get explanation
    const classifier = getFailureClassifier();
    const explanation = classifier.classify(capsule);

    // Run root cause mapper to get mapping
    const mapper = getRootCauseMapper();
    const rootCauseMapping = await mapper.map(capsuleId);

    // Generate reproduction steps from action timeline
    const repro = this.generateReproSteps(capsule);

    // Generate evidence summary
    const evidenceSummary = this.generateEvidenceSummary(capsule);

    // Generate suggested fix from top candidate fix
    const suggestedFix = this.generateSuggestedFix(rootCauseMapping.candidateFixes);

    // Try to get verification result if available
    const verification = this.tryGetVerification(capsuleId);

    // Build the summary object
    const id = randomUUID();
    const generatedAt = new Date().toISOString();

    // Create base summary without markdown and machineReadable
    const baseSummary: Omit<PRSummary, 'markdown' | 'machineReadable'> = {
      id,
      capsuleId,
      generatedAt,
      repro,
      evidenceSummary,
      probableRootCause: rootCauseMapping,
      suggestedFix,
      verification,
    };

    // Generate markdown report and machine-readable JSON
    const markdown = this.generateMarkdown(baseSummary as PRSummary);
    const machineReadable = this.generateMachineReadable(baseSummary as PRSummary);

    // Build final summary with all fields
    const summary: PRSummary = {
      ...baseSummary,
      markdown,
      machineReadable,
    };

    // Store with LRU eviction
    this.summaries.set(id, summary);
    if (this.summaries.size > MAX_SUMMARIES) {
      const oldestKey = this.summaries.keys().next().value;
      if (oldestKey !== undefined) {
        this.summaries.delete(oldestKey);
        logger.debug('Evicted oldest summary', { evictedSummaryId: oldestKey });
      }
    }

    logger.info('PR summary generated', {
      summaryId: id,
      capsuleId,
      failureClass: explanation.failureClass,
    });

    return summary;
  }

  /**
   * Get a generated summary by ID
   *
   * @param id - Summary ID
   * @returns The PR summary or undefined if not found
   */
  getSummary(id: string): PRSummary | undefined {
    return this.summaries.get(id);
  }

  /**
   * Generate GitHub-ready markdown from a PR summary
   *
   * @param summary - The PR summary to format
   * @returns Markdown formatted string
   */
  generateMarkdown(summary: PRSummary): string {
    const lines: string[] = [];

    // Header
    lines.push('# PR Summary: Failure Analysis Report');
    lines.push('');
    lines.push(`**Generated:** ${summary.generatedAt}`);
    lines.push(`**Capsule ID:** ${summary.capsuleId}`);
    lines.push(`**Summary ID:** ${summary.id}`);
    lines.push('');

    // Summary section
    lines.push('## Summary');
    lines.push('');
    lines.push(summary.probableRootCause.failureExplanation.what);
    lines.push('');
    lines.push(`**Failure Class:** ${summary.probableRootCause.failureExplanation.failureClass}`);
    lines.push(`**Confidence:** ${(summary.probableRootCause.failureExplanation.confidence * 100).toFixed(1)}%`);
    lines.push('');

    // Reproduction Steps section
    lines.push('## Reproduction Steps');
    lines.push('');
    lines.push(summary.repro);
    lines.push('');

    // Evidence section
    lines.push('## Evidence');
    lines.push('');
    lines.push(summary.evidenceSummary);
    lines.push('');

    // First Bad State
    lines.push('### First Bad State');
    lines.push('');
    lines.push(summary.probableRootCause.failureExplanation.firstBadState);
    lines.push('');

    // Evidence References
    if (summary.probableRootCause.failureExplanation.evidence.length > 0) {
      lines.push('### Evidence References');
      lines.push('');
      for (const evidence of summary.probableRootCause.failureExplanation.evidence) {
        lines.push(`- ${evidence}`);
      }
      lines.push('');
    }

    // Root Cause section
    lines.push('## Root Cause Analysis');
    lines.push('');
    lines.push(`**Likely Component:** ${summary.probableRootCause.likelyComponent}`);
    lines.push(`**Likely Handler:** ${summary.probableRootCause.likelyHandler}`);
    if (summary.probableRootCause.likelyApiCall !== null && summary.probableRootCause.likelyApiCall !== '') {
      lines.push(`**Likely API Call:** ${summary.probableRootCause.likelyApiCall}`);
    }
    lines.push('');

    // Suggested Fix section
    lines.push('## Suggested Fix');
    lines.push('');
    lines.push(summary.suggestedFix);
    lines.push('');

    // Candidate Fixes
    if (summary.probableRootCause.candidateFixes.length > 0) {
      lines.push('### Alternative Fixes');
      lines.push('');
      lines.push('| Fix | Category | Confidence |');
      lines.push('|-----|----------|------------|');
      for (const fix of summary.probableRootCause.candidateFixes.slice(0, 5)) {
        lines.push(`| ${fix.description} | ${fix.category} | ${(fix.confidence * 100).toFixed(0)}% |`);
      }
      lines.push('');
    }

    // Verification Status section
    lines.push('## Verification Status');
    lines.push('');
    if (summary.verification) {
      lines.push(`**Verdict:** ${summary.verification.overallVerdict}`);
      lines.push('');
      lines.push('```');
      lines.push(summary.verification.summary);
      lines.push('```');
      lines.push('');
      lines.push(`**Reruns:** ${summary.verification.reruns.length}`);
    } else {
      lines.push('*No verification data available.*');
      lines.push('');
      lines.push('To verify a fix, run:');
      lines.push('```');
      lines.push(`browser.verification.run({`);
      lines.push(`  patchId: "your-patch-id",`);
      lines.push(`  originalCapsuleId: "${summary.capsuleId}"`);
      lines.push(`})`);
      lines.push('```');
    }
    lines.push('');

    // Footer
    lines.push('---');
    lines.push('*Generated by MCP Router PR Summary Generator*');

    return lines.join('\n');
  }

  /**
   * Generate reproduction steps from capsule's action timeline
   */
  private generateReproSteps(capsule: EvidenceCapsule): string {
    const lines: string[] = [];
    const timeline = capsule.browser.actionTimeline;

    // Add URL context
    const url = capsule.browser.sessionMetadata.url;
    const title = capsule.browser.sessionMetadata.title;

    if (url) {
      lines.push(`**URL:** ${url}`);
      if (title) {
        lines.push(`**Page Title:** ${title}`);
      }
      lines.push('');
    }

    // Add failure context
    lines.push(`**Failure Type:** ${capsule.failure.type}`);
    lines.push(`**Failure Message:** ${capsule.failure.message}`);
    lines.push('');

    // Add action timeline
    if (timeline.length > 0) {
      lines.push('### Action Sequence');
      lines.push('');

      for (let i = 0; i < timeline.length; i++) {
        const action = timeline[i];
        if (!action) continue;
        
        const stepNum = i + 1;
        const status = action.result === 'success' ? '✓' : '✗';

        let actionDesc = `${stepNum}. ${status} **${action.action}**`;
        if (action.selector !== undefined && action.selector !== '') {
          actionDesc += ` on \`${action.selector}\``;
        }
        if (action.value !== undefined && action.value !== '') {
          actionDesc += ` with value "${action.value}"`;
        }
        if (action.error !== undefined && action.error !== '') {
          actionDesc += ` - *Error: ${action.error}*`;
        }

        lines.push(actionDesc);
      }
      lines.push('');
    } else {
      lines.push('*No action timeline recorded.*');
      lines.push('');
    }

    // Add reproduction instructions
    lines.push('### How to Reproduce');
    lines.push('');
    lines.push('1. Navigate to the URL above');
    lines.push('2. Follow the action sequence shown above');
    lines.push('3. Observe the failure described');
    lines.push('');

    return lines.join('\n');
  }

  /**
   * Generate evidence summary from capsule data
   */
  private generateEvidenceSummary(capsule: EvidenceCapsule): string {
    const lines: string[] = [];
    const browser = capsule.browser;

    // Screenshots
    lines.push(`- **Screenshots:** ${browser.screenshots.length} captured`);

    // Console logs
    const totalConsole = browser.console.errors.length + browser.console.warnings.length + browser.console.logs.length;
    lines.push(`- **Console Entries:** ${totalConsole} total (${browser.console.errors.length} errors, ${browser.console.warnings.length} warnings, ${browser.console.logs.length} logs)`);

    // Network requests
    lines.push(`- **Network Requests:** ${browser.networkRequests.length} captured`);

    // Failed requests
    const failedRequests = browser.networkRequests.filter(r => r.status >= 400 || r.status === 0);
    if (failedRequests.length > 0) {
      lines.push(`  - **Failed Requests:** ${failedRequests.length}`);
      for (const req of failedRequests.slice(0, 3)) {
        lines.push(`    - ${req.method} ${req.url} → ${req.status} ${req.statusText}`);
      }
      if (failedRequests.length > 3) {
        lines.push(`    - ... and ${failedRequests.length - 3} more`);
      }
    }

    // Performance metrics
    const metricCount = Object.keys(browser.performanceMetrics).length;
    if (metricCount > 0) {
      lines.push(`- **Performance Metrics:** ${metricCount} collected`);
    }

    // Session metadata
    if (browser.sessionMetadata.userAgent) {
      lines.push(`- **User Agent:** ${browser.sessionMetadata.userAgent}`);
    }
    if (browser.sessionMetadata.viewport) {
      lines.push(`- **Viewport:** ${browser.sessionMetadata.viewport.width}x${browser.sessionMetadata.viewport.height}`);
    }

    return lines.join('\n');
  }

  /**
   * Generate suggested fix description from candidate fixes
   */
  private generateSuggestedFix(candidates: readonly CandidateFix[]): string {
    if (candidates.length === 0) {
      return 'No specific fix suggestions available. Review the failure details and evidence to determine the appropriate fix.';
    }

    const topFix = candidates[0];
    if (!topFix) {
      return 'No specific fix suggestions available. Review the failure details and evidence to determine the appropriate fix.';
    }

    const lines: string[] = [];

    lines.push(`**Primary Recommendation:** ${topFix.description}`);
    lines.push('');
    lines.push(`*Confidence: ${(topFix.confidence * 100).toFixed(0)}% | Category: ${topFix.category}*`);
    lines.push('');

    // Add implementation guidance based on category
    lines.push('### Implementation Guidance');
    lines.push('');

    switch (topFix.category) {
      case 'selector':
        lines.push('- Update the selector to match the current DOM structure');
        lines.push('- Consider using data-testid attributes for stability');
        lines.push('- Add fallback selectors for resilience');
        break;
      case 'timing':
        lines.push('- Add explicit wait conditions before interactions');
        lines.push('- Increase timeout thresholds for slow operations');
        lines.push('- Consider using retry logic with exponential backoff');
        break;
      case 'api':
        lines.push('- Verify API endpoint availability and parameters');
        lines.push('- Add error handling for network failures');
        lines.push('- Implement graceful degradation for API unavailability');
        break;
      case 'config':
        lines.push('- Review configuration settings');
        lines.push('- Verify environment variables and secrets');
        lines.push('- Check CORS and security policies');
        break;
      case 'code_logic':
        lines.push('- Review the component logic for edge cases');
        lines.push('- Add null/undefined checks where appropriate');
        lines.push('- Implement error boundaries for resilience');
        break;
    }

    return lines.join('\n');
  }

  /**
   * Try to get verification result for a capsule
   */
  private tryGetVerification(_capsuleId: string): VerificationResult | null {
    // Note: We don't have a direct way to look up verifications by capsule ID
    // This would require storing verifications or querying by patch ID
    // For now, return null - future enhancement could track verifications
    return null;
  }

  /**
   * Generate machine-readable JSON export
   */
  private generateMachineReadable(summary: PRSummary): Record<string, unknown> {
    return {
      id: summary.id,
      capsuleId: summary.capsuleId,
      generatedAt: summary.generatedAt,
      failure: {
        class: summary.probableRootCause.failureExplanation.failureClass,
        confidence: summary.probableRootCause.failureExplanation.confidence,
        what: summary.probableRootCause.failureExplanation.what,
        firstBadState: summary.probableRootCause.failureExplanation.firstBadState,
      },
      rootCause: {
        component: summary.probableRootCause.likelyComponent,
        handler: summary.probableRootCause.likelyHandler,
        apiCall: summary.probableRootCause.likelyApiCall,
      },
      suggestedFix: {
        description: summary.suggestedFix,
        candidates: summary.probableRootCause.candidateFixes.map(f => ({
          description: f.description,
          category: f.category,
          confidence: f.confidence,
        })),
      },
      verification: summary.verification ? {
        verdict: summary.verification.overallVerdict,
        rerunCount: summary.verification.reruns.length,
      } : null,
    };
  }
}

// Singleton instance
let generator: PRSummaryGenerator | undefined;

/**
 * Get the singleton PR summary generator
 */
export function getPRSummaryGenerator(): PRSummaryGenerator {
  if (!generator) {
    generator = new PRSummaryGenerator();
  }
  return generator;
}
