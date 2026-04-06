/**
 * Request Budget Manager
 *
 * Manages total request budget across all retry and fallback attempts
 * Ensures sufficient budget remains for recovery paths
 */

import { getLogger } from '../infra/logger.js';

const logger = getLogger('request-budget');

export interface RequestBudget {
  startTime: number;
  totalBudgetMs: number;
  remainingMs: number;
  usedMs: number;
  endTime: number;
}

export interface RequestBudgetConfig {
  totalBudgetMs: number;
  minRemainingMs: number;
}

export class RequestBudgetManager {
  private config: RequestBudgetConfig;
  private currentBudget: RequestBudget | null = null;

  constructor(config: RequestBudgetConfig) {
    this.config = config;
  }

  createBudget(startTime: number): RequestBudget {
    const budget: RequestBudget = {
      startTime,
      totalBudgetMs: this.config.totalBudgetMs,
      remainingMs: this.config.totalBudgetMs,
      usedMs: 0,
      endTime: startTime + this.config.totalBudgetMs,
    };
    this.currentBudget = budget;
    return budget;
  }

  calculateAttemptBudget(attemptNumber: number, maxAttempts: number): number {
    const budgetPerAttempt = this.config.totalBudgetMs / maxAttempts;

    if (attemptNumber === maxAttempts) {
      return Math.floor(this.config.totalBudgetMs * 0.6);
    }

    return Math.floor(budgetPerAttempt * 1.5);
  }

  hasSufficientBudget(budget: RequestBudget, maxAttempts: number): boolean {
    const elapsed = Date.now() - budget.startTime;
    const remainingMs = Math.max(0, budget.totalBudgetMs - elapsed);
    const minBudgetMs = this.config.minRemainingMs;

    if (remainingMs < minBudgetMs) {
      logger.warn('Insufficient budget remaining for next attempt', {
        elapsed,
        remainingMs,
        minBudgetMs,
      });
      return false;
    }

    return true;
  }

  recordAttemptUsage(budget: RequestBudget, attemptMs: number): void {
    budget.usedMs += attemptMs;
    budget.remainingMs = Math.max(0, budget.totalBudgetMs - budget.usedMs);
    logger.debug('Budget usage recorded', {
      usedMs: attemptMs,
      totalUsedMs: budget.usedMs,
      remainingMs: budget.remainingMs,
    });
  }

  getRemainingMs(budget: RequestBudget): number {
    const elapsed = Date.now() - budget.startTime;
    return Math.max(0, budget.totalBudgetMs - elapsed);
  }

  isBudgetExhausted(budget: RequestBudget): boolean {
    return this.getRemainingMs(budget) <= 0;
  }

  getMinRemainingMs(): number {
    return this.config.minRemainingMs;
  }
}
