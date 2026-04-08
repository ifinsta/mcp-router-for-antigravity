/**
 * Concurrency Manager (Bulkheads)
 *
 * Manages concurrency limits and overload control
 * Prevents one unstable provider from consuming all execution capacity
 */

import { getLogger } from '../infra/logger.js';
import { createOverloadError, RouterError } from '../core/errors.js';
import { getMetricsCollector } from '../infra/metrics.js';

const logger = getLogger('concurrency');

export interface ConcurrencyConfig {
  globalLimit: number;
  providerLimits: Record<string, number>;
  queueSize: number;
}

interface ProviderSlot {
  active: number;
  queued: number;
  waiting: Array<() => void>;
}

export class ConcurrencyManager {
  private config: ConcurrencyConfig;
  private globalActive: number = 0;
  private globalQueued: number = 0;
  private globalWaiting: Array<() => void> = [];
  private providerSlots: Map<string, ProviderSlot> = new Map();

  constructor(config: ConcurrencyConfig) {
    this.config = config;
    logger.info('Concurrency manager initialized', {
      globalLimit: config.globalLimit,
      providerLimits: config.providerLimits,
      queueSize: config.queueSize,
    });
  }

  async acquire(provider: string): Promise<{ release: () => void }> {
    const providerSlot = this.getOrCreateProviderSlot(provider);

    if (!this.canProceed(provider, providerSlot)) {
      if (this.config.queueSize === 0) {
        getMetricsCollector().incrementOverloadRejectionCount();
        throw createOverloadError('concurrency', this.config.globalLimit);
      }

      if (this.globalQueued >= this.config.queueSize) {
        getMetricsCollector().incrementOverloadRejectionCount();
        throw createOverloadError('queue', this.config.queueSize);
      }

      await this.waitForSlot(provider, providerSlot);
    }

    this.incrementCounts(provider, providerSlot);

    getMetricsCollector().setActiveConcurrency(this.globalActive, provider, providerSlot.active);

    logger.debug('Slot acquired', {
      provider,
      globalActive: this.globalActive,
      providerActive: providerSlot.active,
    });

    return {
      release: () => this.release(provider, providerSlot),
    };
  }

  private getOrCreateProviderSlot(provider: string): ProviderSlot {
    let slot = this.providerSlots.get(provider);
    if (!slot) {
      slot = { active: 0, queued: 0, waiting: [] };
      this.providerSlots.set(provider, slot);
    }
    return slot;
  }

  private canProceed(provider: string, providerSlot: ProviderSlot): boolean {
    const providerLimit = this.config.providerLimits[provider] ?? this.config.globalLimit;

    return this.globalActive < this.config.globalLimit && providerSlot.active < providerLimit;
  }

  private async waitForSlot(provider: string, providerSlot: ProviderSlot): Promise<void> {
    return new Promise<void>((resolve) => {
      this.globalQueued++;
      providerSlot.queued++;
      this.globalWaiting.push(resolve);
      providerSlot.waiting.push(resolve);

      logger.debug('Queued for slot', {
        provider,
        globalQueued: this.globalQueued,
        providerQueued: providerSlot.queued,
      });
    });
  }

  private incrementCounts(provider: string, providerSlot: ProviderSlot): void {
    this.globalActive++;
    providerSlot.active++;

    if (this.globalQueued > 0) {
      this.globalQueued--;
    }
    if (providerSlot.queued > 0) {
      providerSlot.queued--;
    }
  }

  private release(provider: string, providerSlot: ProviderSlot): void {
    this.globalActive--;
    providerSlot.active--;

    getMetricsCollector().setActiveConcurrency(this.globalActive, provider, providerSlot.active);

    logger.debug('Slot released', {
      provider,
      globalActive: this.globalActive,
      providerActive: providerSlot.active,
    });

    if (this.globalWaiting.length > 0 && this.globalActive < this.config.globalLimit) {
      const next = this.globalWaiting.shift();
      if (next) {
        next();
      }
    }

    const providerLimit = this.config.providerLimits[provider] ?? this.config.globalLimit;
    if (providerSlot.waiting.length > 0 && providerSlot.active < providerLimit) {
      const next = providerSlot.waiting.shift();
      if (next) {
        next();
      }
    }
  }

  getStats(): {
    global: { active: number; queued: number; limit: number };
    providers: Record<string, { active: number; queued: number; limit: number }>;
  } {
    const providers: Record<string, { active: number; queued: number; limit: number }> = {};

    for (const [provider, slot] of this.providerSlots) {
      providers[provider] = {
        active: slot.active,
        queued: slot.queued,
        limit: this.config.providerLimits[provider] ?? this.config.globalLimit,
      };
    }

    return {
      global: {
        active: this.globalActive,
        queued: this.globalQueued,
        limit: this.config.globalLimit,
      },
      providers,
    };
  }

  getUtilization(): number {
    return this.globalActive / this.config.globalLimit;
  }

  isOverloaded(): boolean {
    return this.globalActive >= this.config.globalLimit;
  }
}
