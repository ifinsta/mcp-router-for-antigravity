/**
 * Fix Verification
 *
 * Verifies that a fix has resolved the original failure by re-running
 * assertion evaluations and comparing results.
 *
 * Note: This implementation simulates reruns by re-evaluating existing evidence
 * capsules. Future integration with browser replay will enable actual workflow
 * reruns.
 */

import { getLogger } from '../infra/logger.js';
import { getEvidenceCapsuleCollector } from './evidenceCapsule.js';
import { getAssertionEvaluator } from './assertionModel.js';
import type {
  EvidenceCapsule,
  AssertionResult,
  VerificationRerun,
  VerificationResult,
  VerificationVerdict,
} from './types.js';

const logger = getLogger('fix-verification');

/**
 * Default number of reruns for verification
 */
const DEFAULT_RERUN_COUNT = 3;

/**
 * Fix Verifier
 *
 * Verifies that a fix has resolved an original failure by comparing
 * assertion results from multiple reruns against the original failure.
 */
export class FixVerifier {
  /**
   * Verify a fix by running multiple assertion evaluations
   *
   * @param patchId - Identifier for the patch being verified
   * @param originalCapsuleId - ID of the original evidence capsule
   * @param rerunCount - Number of reruns to perform (default: 3)
   * @returns Verification result with overall verdict
   */
  async verify(
    patchId: string,
    originalCapsuleId: string,
    rerunCount: number = DEFAULT_RERUN_COUNT
  ): Promise<VerificationResult> {
    logger.info('Starting fix verification', { patchId, originalCapsuleId, rerunCount });

    // Get the original capsule
    const collector = getEvidenceCapsuleCollector();
    const originalCapsule = collector.get(originalCapsuleId);

    if (!originalCapsule) {
      throw new Error(`Original capsule not found: ${originalCapsuleId}`);
    }

    // Evaluate original capsule to establish baseline
    const evaluator = getAssertionEvaluator();
    const originalAssertions = evaluator.evaluate(originalCapsule);

    logger.info('Original failure baseline established', {
      capsuleId: originalCapsuleId,
      totalChecks: originalAssertions.totalChecks,
      passed: originalAssertions.passed,
      failed: originalAssertions.failed,
    });

    // Run verification reruns
    // Note: In this implementation, we simulate reruns by re-evaluating the same capsule
    // Future integration with browser replay will enable actual workflow reruns
    const reruns: VerificationRerun[] = [];
    for (let i = 0; i < rerunCount; i++) {
      const rerun = await this.performRerun(i, originalCapsule, evaluator);
      reruns.push(rerun);
      logger.debug('Rerun completed', {
        runIndex: i,
        passed: rerun.assertions.passed,
        failed: rerun.assertions.failed,
      });
    }

    // Determine overall verdict
    const verdict = this.determineVerdict(originalAssertions, reruns);

    // Generate summary
    const summary = this.generateSummary(patchId, originalAssertions, reruns, verdict);

    const result: VerificationResult = {
      patchId,
      originalFailure: {
        capsuleId: originalCapsuleId,
        assertions: originalAssertions,
      },
      reruns,
      overallVerdict: verdict,
      summary,
    };

    logger.info('Fix verification completed', {
      patchId,
      verdict,
      rerunCount: reruns.length,
    });

    return result;
  }

  /**
   * Perform a single verification rerun
   *
   * Note: This implementation re-evaluates the same evidence capsule.
   * Future integration will capture fresh evidence via browser replay.
   */
  private async performRerun(
    runIndex: number,
    capsule: EvidenceCapsule,
    evaluator: ReturnType<typeof getAssertionEvaluator>
  ): Promise<VerificationRerun> {
    const timestamp = new Date().toISOString();

    // Re-evaluate the existing evidence capsule
    // In a future implementation, this would:
    // 1. Re-run the browser workflow
    // 2. Capture fresh evidence
    // 3. Evaluate assertions on the fresh evidence
    const assertions = evaluator.evaluate(capsule);

    return {
      runIndex,
      capsuleId: capsule.capsuleId,
      assertions,
      timestamp,
    };
  }

  /**
   * Determine the overall verdict based on rerun results
   */
  private determineVerdict(
    originalAssertions: AssertionResult,
    reruns: readonly VerificationRerun[]
  ): VerificationVerdict {
    if (reruns.length === 0) {
      return 'inconclusive';
    }

    // Check if all reruns passed (all assertions pass)
    const allRerunsPassed = reruns.every((rerun) => rerun.assertions.failed === 0);

    // Check if all reruns failed in the same way as original
    const originalFailedCount = originalAssertions.failed;
    const allRerunsFailedSameWay = reruns.every(
      (rerun) => rerun.assertions.failed === originalFailedCount && rerun.assertions.failed > 0
    );

    // Check if some reruns passed and some failed (flaky behavior)
    const passFailCounts = reruns.reduce(
      (acc, rerun) => {
        if (rerun.assertions.failed === 0) {
          acc.passes++;
        } else {
          acc.failures++;
        }
        return acc;
      },
      { passes: 0, failures: 0 }
    );

    const hasMixedResults = passFailCounts.passes > 0 && passFailCounts.failures > 0;

    // Determine verdict
    if (allRerunsPassed) {
      return 'fixed';
    } else if (hasMixedResults) {
      return 'flaky';
    } else if (allRerunsFailedSameWay) {
      return 'still_failing';
    } else {
      return 'inconclusive';
    }
  }

  /**
   * Generate a human-readable summary of the verification
   */
  private generateSummary(
    patchId: string,
    originalAssertions: AssertionResult,
    reruns: readonly VerificationRerun[],
    verdict: VerificationVerdict
  ): string {
    const parts: string[] = [];

    parts.push(`Patch '${patchId}' verification:`);
    parts.push(`- Original failure: ${originalAssertions.failed}/${originalAssertions.totalChecks} checks failed`);

    if (reruns.length > 0) {
      const passCount = reruns.filter((r) => r.assertions.failed === 0).length;
      const failCount = reruns.length - passCount;
      parts.push(`- Reruns: ${reruns.length} total (${passCount} passed, ${failCount} failed)`);
    }

    switch (verdict) {
      case 'fixed':
        parts.push('- Verdict: FIXED - All reruns passed, the issue appears resolved.');
        break;
      case 'still_failing':
        parts.push('- Verdict: STILL FAILING - All reruns failed consistently with the original issue.');
        break;
      case 'flaky':
        parts.push('- Verdict: FLAKY - Results varied across reruns. The issue may be intermittent.');
        break;
      case 'inconclusive':
        parts.push('- Verdict: INCONCLUSIVE - Unable to determine fix status from available data.');
        break;
    }

    return parts.join('\n');
  }
}

// Singleton instance
let verifier: FixVerifier | undefined;

/**
 * Get the singleton fix verifier
 */
export function getFixVerifier(): FixVerifier {
  if (!verifier) {
    verifier = new FixVerifier();
  }
  return verifier;
}
