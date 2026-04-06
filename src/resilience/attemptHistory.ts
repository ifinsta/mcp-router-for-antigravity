/**
 * Attempt History Recorder
 *
 * Records and tracks all attempts made during request processing
 */

import { getLogger } from '../infra/logger.js';
import {
  AttemptRecord,
  AttemptHistory,
  AttemptPhase,
  AttemptStatus,
  CircuitBreakerState,
} from '../core/types.js';

const logger = getLogger('attempt-history');

export class AttemptHistoryRecorder {
  private attempts: AttemptRecord[] = [];
  private startTime: number;

  constructor() {
    this.startTime = Date.now();
  }

  startAttempt(
    attemptNumber: number,
    provider: string,
    model: string,
    phase: AttemptPhase,
    breakerState?: CircuitBreakerState
  ): AttemptRecord {
    const attempt: AttemptRecord = {
      attemptNumber,
      provider,
      model,
      phase,
      startedAtMs: Date.now(),
      status: AttemptStatus.SUCCESS,
      breakerState,
      warnings: [],
    };

    this.attempts.push(attempt);

    logger.debug('Attempt started', {
      attemptNumber,
      provider,
      model,
      phase,
    });

    return attempt;
  }

  completeAttempt(
    attempt: AttemptRecord,
    status: AttemptStatus,
    errorCode?: string,
    retryable?: boolean
  ): void {
    attempt.endedAtMs = Date.now();
    attempt.status = status;
    attempt.errorCode = errorCode;
    attempt.retryable = retryable;

    logger.debug('Attempt completed', {
      attemptNumber: attempt.attemptNumber,
      provider: attempt.provider,
      status,
      errorCode,
      durationMs: attempt.endedAtMs - attempt.startedAtMs,
    });
  }

  addWarning(attempt: AttemptRecord, warning: string): void {
    if (!attempt.warnings) {
      attempt.warnings = [];
    }
    attempt.warnings.push(warning);
  }

  getHistory(): AttemptHistory {
    const successAttempts = this.attempts.filter((a) => a.status === AttemptStatus.SUCCESS);
    const failedAttempts = this.attempts.filter((a) => a.status === AttemptStatus.FAILED);
    const retryCount = this.attempts.filter((a) => a.phase === AttemptPhase.RETRY).length;
    const fallbackUsed = this.attempts.some((a) => a.phase === AttemptPhase.FALLBACK);

    return {
      attempts: this.attempts,
      finalStatus: successAttempts.length > 0 ? 'success' : 'failed',
      totalDurationMs: Date.now() - this.startTime,
      fallbackUsed,
      retryCount,
    };
  }

  getLastAttempt(): AttemptRecord | undefined {
    return this.attempts[this.attempts.length - 1];
  }

  getAttemptCount(): number {
    return this.attempts.length;
  }

  hasSuccessfulAttempt(): boolean {
    return this.attempts.some((a) => a.status === AttemptStatus.SUCCESS);
  }

  getFailedAttempts(): AttemptRecord[] {
    return this.attempts.filter((a) => a.status === AttemptStatus.FAILED);
  }

  getAttemptByNumber(attemptNumber: number): AttemptRecord | undefined {
    return this.attempts.find((a) => a.attemptNumber === attemptNumber);
  }
}
