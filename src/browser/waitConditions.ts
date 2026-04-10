/**
 * Enhanced Wait Conditions and Retry Logic
 *
 * Provides robust element waiting strategies with configurable timeouts,
 * retries, and condition checking for reliable browser automation.
 */

import type { CDPClient } from './cdpClient.js';
import { getLogger } from '../infra/logger.js';

const logger = getLogger('wait-conditions');

// ============================================================================
// Types
// ============================================================================

/**
 * Wait condition types
 */
export type WaitConditionType =
  | 'element_visible'
  | 'element_present'
  | 'element_clickable'
  | 'element_text_contains'
  | 'element_attribute_contains'
  | 'url_contains'
  | 'url_equals'
  | 'title_contains'
  | 'title_equals'
  | 'javascript_condition'
  | 'network_idle'
  | 'custom';

/**
 * Wait condition configuration
 */
export interface WaitCondition {
  type: WaitConditionType;
  selector?: string;
  timeout?: number;
  pollingInterval?: number;
  retries?: number;
  value?: string;
  attribute?: string;
  condition?: string;
  customCheck?: () => Promise<boolean> | boolean;
}

/**
 * Element state
 */
export interface ElementState {
  visible: boolean;
  present: boolean;
  clickable: boolean;
  text?: string;
  attributes?: Record<string, string>;
  position?: { x: number; y: number };
  size?: { width: number; height: number };
}

/**
 * Wait result
 */
export interface WaitResult {
  success: boolean;
  matched: boolean;
  attempts: number;
  duration: number;
  error?: string;
  element?: ElementState;
}

// ============================================================================
// Wait Conditions Manager
// ============================================================================

/**
 * Wait Conditions Manager
 *
 * Manages element waiting strategies with retries and
 * comprehensive condition checking.
 */
export class WaitConditionsManager {
  private cdpClient: CDPClient | null = null;
  private defaultTimeout: number = 30000;
  private defaultPollingInterval: number = 100;
  private defaultRetries: number = 3;

  constructor(cdpClient: CDPClient | null = null) {
    this.cdpClient = cdpClient;
  }

  /**
   * Set CDP client
   */
  setCDPClient(client: CDPClient): void {
    this.cdpClient = client;
  }

  /**
   * Set default configuration
   */
  setDefaults(config: {
    timeout?: number;
    pollingInterval?: number;
    retries?: number;
  }): void {
    if (config.timeout !== undefined) {
      this.defaultTimeout = config.timeout;
    }
    if (config.pollingInterval !== undefined) {
      this.defaultPollingInterval = config.pollingInterval;
    }
    if (config.retries !== undefined) {
      this.defaultRetries = config.retries;
    }
  }

  /**
   * Wait for condition
   */
  async waitFor(condition: WaitCondition): Promise<WaitResult> {
    const startTime = Date.now();
    const timeout = condition.timeout ?? this.defaultTimeout;
    const pollingInterval = condition.pollingInterval ?? this.defaultPollingInterval;
    const retries = condition.retries ?? this.defaultRetries;
    let attempts = 0;

    logger.info('Starting wait condition', { type: condition.type, timeout, retries });

    for (let retry = 0; retry <= retries; retry++) {
      attempts++;

      try {
        const result = await this.checkCondition(condition);

        if (result.success) {
          const duration = Date.now() - startTime;
          logger.info('Wait condition satisfied', {
            type: condition.type,
            attempts,
            duration,
          });

          return {
            success: true,
            matched: result.matched,
            attempts,
            duration,
            ...(result.element !== undefined ? { element: result.element } : {}),
          };
        }
      } catch (error) {
        logger.warn('Wait condition check failed', {
          attempt: retry + 1,
          error: error instanceof Error ? error.message : String(error),
        });

        if (retry === retries) {
          const duration = Date.now() - startTime;
          return {
            success: false,
            matched: false,
            attempts,
            duration,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }

      // Wait before next attempt
      await this.delay(pollingInterval);
    }

    const duration = Date.now() - startTime;
    return {
      success: false,
      matched: false,
      attempts,
      duration,
      error: 'Wait condition timeout',
    };
  }

  /**
   * Wait for element to be visible
   */
  async waitForElementVisible(selector: string, options?: {
    timeout?: number;
    retries?: number;
  }): Promise<WaitResult> {
    const condition: WaitCondition = {
      type: 'element_visible',
      selector,
    };
    if (options?.timeout !== undefined) condition.timeout = options.timeout;
    if (options?.retries !== undefined) condition.retries = options.retries;
    return this.waitFor(condition);
  }

  /**
   * Wait for element to be present
   */
  async waitForElementPresent(selector: string, options?: {
    timeout?: number;
    retries?: number;
  }): Promise<WaitResult> {
    const condition: WaitCondition = {
      type: 'element_present',
      selector,
    };
    if (options?.timeout !== undefined) condition.timeout = options.timeout;
    if (options?.retries !== undefined) condition.retries = options.retries;
    return this.waitFor(condition);
  }

  /**
   * Wait for element to be clickable
   */
  async waitForElementClickable(selector: string, options?: {
    timeout?: number;
    retries?: number;
  }): Promise<WaitResult> {
    const condition: WaitCondition = {
      type: 'element_clickable',
      selector,
    };
    if (options?.timeout !== undefined) condition.timeout = options.timeout;
    if (options?.retries !== undefined) condition.retries = options.retries;
    return this.waitFor(condition);
  }

  /**
   * Wait for element text to contain value
   */
  async waitForElementTextContains(selector: string, text: string, options?: {
    timeout?: number;
    retries?: number;
  }): Promise<WaitResult> {
    const condition: WaitCondition = {
      type: 'element_text_contains',
      selector,
      value: text,
    };
    if (options?.timeout !== undefined) condition.timeout = options.timeout;
    if (options?.retries !== undefined) condition.retries = options.retries;
    return this.waitFor(condition);
  }

  /**
   * Wait for URL to contain value
   */
  async waitForUrlContains(value: string, options?: {
    timeout?: number;
    retries?: number;
  }): Promise<WaitResult> {
    const condition: WaitCondition = {
      type: 'url_contains',
      value,
    };
    if (options?.timeout !== undefined) condition.timeout = options.timeout;
    if (options?.retries !== undefined) condition.retries = options.retries;
    return this.waitFor(condition);
  }

  /**
   * Wait for URL to equal value
   */
  async waitForUrlEquals(value: string, options?: {
    timeout?: number;
    retries?: number;
  }): Promise<WaitResult> {
    const condition: WaitCondition = {
      type: 'url_equals',
      value,
    };
    if (options?.timeout !== undefined) condition.timeout = options.timeout;
    if (options?.retries !== undefined) condition.retries = options.retries;
    return this.waitFor(condition);
  }

  /**
   * Wait for network to be idle
   */
  async waitForNetworkIdle(options?: {
    timeout?: number;
    idleTime?: number;
    retries?: number;
  }): Promise<WaitResult> {
    const condition: WaitCondition = {
      type: 'network_idle',
    };
    if (options?.timeout !== undefined) condition.timeout = options.timeout;
    if (options?.retries !== undefined) condition.retries = options.retries;
    return this.waitFor(condition);
  }

  /**
   * Wait for custom condition
   */
  async waitForCustom(condition: () => Promise<boolean> | boolean, options?: {
    timeout?: number;
    retries?: number;
  }): Promise<WaitResult> {
    const waitCondition: WaitCondition = {
      type: 'custom',
      customCheck: condition,
    };
    if (options?.timeout !== undefined) waitCondition.timeout = options.timeout;
    if (options?.retries !== undefined) waitCondition.retries = options.retries;
    return this.waitFor(waitCondition);
  }

  /**
   * Retry operation with exponential backoff
   */
  async retryWithBackoff<T>(
    operation: () => Promise<T>,
    options?: {
      maxRetries?: number;
      initialDelay?: number;
      maxDelay?: number;
      backoffFactor?: number;
      shouldRetry?: (error: unknown) => boolean;
    }
  ): Promise<{ success: boolean; result?: T; error?: string }> {
    const maxRetries = options?.maxRetries ?? this.defaultRetries;
    const initialDelay = options?.initialDelay ?? 1000;
    const maxDelay = options?.maxDelay ?? 10000;
    const backoffFactor = options?.backoffFactor ?? 2;
    const shouldRetry = options?.shouldRetry ?? ((error: unknown) => true);

    let delay = initialDelay;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await operation();
        return { success: true, result };
      } catch (error) {
        const isRetryable = shouldRetry(error);

        if (!isRetryable || attempt === maxRetries) {
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }

        logger.warn('Operation failed, retrying with backoff', {
          attempt: attempt + 1,
          delay,
          error: error instanceof Error ? error.message : String(error),
        });

        await this.delay(delay);
        delay = Math.min(delay * backoffFactor, maxDelay);
      }
    }

    return {
      success: false,
      error: 'Max retries exceeded',
    };
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Check wait condition
   */
  private async checkCondition(condition: WaitCondition): Promise<{
    success: boolean;
    matched: boolean;
    element?: ElementState;
  }> {
    if (!this.cdpClient) {
      throw new Error('CDP client not set for wait conditions');
    }

    switch (condition.type) {
      case 'element_visible':
        return this.checkElementVisible(condition.selector!);
      case 'element_present':
        return this.checkElementPresent(condition.selector!);
      case 'element_clickable':
        return this.checkElementClickable(condition.selector!);
      case 'element_text_contains':
        return this.checkElementTextContains(condition.selector!, condition.value!);
      case 'element_attribute_contains':
        return this.checkElementAttributeContains(condition.selector!, condition.attribute!, condition.value!);
      case 'url_contains':
        return this.checkUrlContains(condition.value!);
      case 'url_equals':
        return this.checkUrlEquals(condition.value!);
      case 'title_contains':
        return this.checkTitleContains(condition.value!);
      case 'title_equals':
        return this.checkTitleEquals(condition.value!);
      case 'javascript_condition':
        return this.checkJavaScriptCondition(condition.condition!);
      case 'network_idle':
        return this.checkNetworkIdle();
      case 'custom':
        if (condition.customCheck) {
          const result = await condition.customCheck();
          return { success: result, matched: result };
        }
        return { success: false, matched: false };
      default:
        throw new Error(`Unknown wait condition type: ${condition.type}`);
    }
  }

  /**
   * Check if element is visible
   */
  private async checkElementVisible(selector: string): Promise<{
    success: boolean;
    matched: boolean;
    element?: ElementState;
  }> {
    const script = `
      (function() {
        const element = document.querySelector('${selector}');
        if (!element) return { visible: false, present: false };

        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);

        return {
          visible: style.visibility !== 'hidden' &&
                     style.display !== 'none' &&
                     style.opacity !== '0' &&
                     rect.width > 0 &&
                     rect.height > 0,
          present: true,
          position: { x: rect.left, y: rect.top },
          size: { width: rect.width, height: rect.height }
        };
      })()
    `;

    const result = await this.cdpClient!.executeScript(script, {
      returnByValue: true,
    }) as { visible: boolean; present: boolean; position?: { x: number; y: number }; size?: { width: number; height: number } };

    return {
      success: result.visible,
      matched: result.visible,
      element: {
        visible: result.visible,
        present: result.present,
        clickable: result.visible, // Visible implies clickable for now
        ...(result.position !== undefined ? { position: result.position } : {}),
        ...(result.size !== undefined ? { size: result.size } : {}),
      },
    };
  }

  /**
   * Check if element is present
   */
  private async checkElementPresent(selector: string): Promise<{
    success: boolean;
    matched: boolean;
    element?: ElementState;
  }> {
    const script = `
      (function() {
        const element = document.querySelector('${selector}');
        return element !== null;
      })()
    `;

    const present = await this.cdpClient!.executeScript(script, {
      returnByValue: true,
    }) as boolean;

    return {
      success: present,
      matched: present,
      element: {
        present,
        visible: false,
        clickable: false,
      },
    };
  }

  /**
   * Check if element is clickable
   */
  private async checkElementClickable(selector: string): Promise<{
    success: boolean;
    matched: boolean;
    element?: ElementState;
  }> {
    const script = `
      (function() {
        const element = document.querySelector('${selector}');
        if (!element) return { clickable: false };

        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);

        const isVisible = style.visibility !== 'hidden' &&
                        style.display !== 'none' &&
                        style.opacity !== '0' &&
                        rect.width > 0 &&
                        rect.height > 0;

        const isPointerEventsEnabled = style.pointerEvents !== 'none';
        const isNotDisabled = !element.disabled;
        const isClickableElement = ['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].includes(element.tagName) ||
                               element.getAttribute('onclick') !== null ||
                               element.getAttribute('role') === 'button';

        return {
          clickable: isVisible && isPointerEventsEnabled && isNotDisabled && isClickableElement,
          position: { x: rect.left, y: rect.top },
          size: { width: rect.width, height: rect.height }
        };
      })()
    `;

    const result = await this.cdpClient!.executeScript(script, {
      returnByValue: true,
    }) as { clickable: boolean; position?: { x: number; y: number }; size?: { width: number; height: number } };

    return {
      success: result.clickable,
      matched: result.clickable,
      element: {
        visible: false,
        present: true,
        clickable: result.clickable,
        ...(result.position !== undefined ? { position: result.position } : {}),
        ...(result.size !== undefined ? { size: result.size } : {}),
      },
    };
  }

  /**
   * Check if element text contains value
   */
  private async checkElementTextContains(selector: string, text: string): Promise<{
    success: boolean;
    matched: boolean;
  }> {
    const script = `
      (function() {
        const element = document.querySelector('${selector}');
        if (!element) return { success: false, text: '' };

        const elementText = element.textContent || element.innerText || '';
        return { success: elementText.includes('${text}'), text: elementText };
      })()
    `;

    const result = await this.cdpClient!.executeScript(script, {
      returnByValue: true,
    }) as { success: boolean; text: string };

    return {
      success: result.success,
      matched: result.success,
    };
  }

  /**
   * Check if element attribute contains value
   */
  private async checkElementAttributeContains(selector: string, attribute: string, value: string): Promise<{
    success: boolean;
    matched: boolean;
  }> {
    const script = `
      (function() {
        const element = document.querySelector('${selector}');
        if (!element) return { success: false, attributeValue: '' };

        const attributeValue = element.getAttribute('${attribute}') || '';
        return { success: attributeValue.includes('${value}'), attributeValue };
      })()
    `;

    const result = await this.cdpClient!.executeScript(script, {
      returnByValue: true,
    }) as { success: boolean; attributeValue: string };

    return {
      success: result.success,
      matched: result.success,
    };
  }

  /**
   * Check if URL contains value
   */
  private async checkUrlContains(value: string): Promise<{
    success: boolean;
    matched: boolean;
  }> {
    const script = `
      (function() {
        return window.location.href.includes('${value}');
      })()
    `;

    const result = await this.cdpClient!.executeScript(script, {
      returnByValue: true,
    }) as boolean;

    return {
      success: result,
      matched: result,
    };
  }

  /**
   * Check if URL equals value
   */
  private async checkUrlEquals(value: string): Promise<{
    success: boolean;
    matched: boolean;
  }> {
    const script = `
      (function() {
        return window.location.href === '${value}';
      })()
    `;

    const result = await this.cdpClient!.executeScript(script, {
      returnByValue: true,
    }) as boolean;

    return {
      success: result,
      matched: result,
    };
  }

  /**
   * Check if title contains value
   */
  private async checkTitleContains(value: string): Promise<{
    success: boolean;
    matched: boolean;
  }> {
    const script = `
      (function() {
        return document.title.includes('${value}');
      })()
    `;

    const result = await this.cdpClient!.executeScript(script, {
      returnByValue: true,
    }) as boolean;

    return {
      success: result,
      matched: result,
    };
  }

  /**
   * Check if title equals value
   */
  private async checkTitleEquals(value: string): Promise<{
    success: boolean;
    matched: boolean;
  }> {
    const script = `
      (function() {
        return document.title === '${value}';
      })()
    `;

    const result = await this.cdpClient!.executeScript(script, {
      returnByValue: true,
    }) as boolean;

    return {
      success: result,
      matched: result,
    };
  }

  /**
   * Check JavaScript condition
   */
  private async checkJavaScriptCondition(condition: string): Promise<{
    success: boolean;
    matched: boolean;
  }> {
    const script = `
      (function() {
        return ${condition};
      })()
    `;

    const result = await this.cdpClient!.executeScript(script, {
      returnByValue: true,
    }) as boolean;

    return {
      success: result,
      matched: result,
    };
  }

  /**
   * Check if network is idle
   */
  private async checkNetworkIdle(): Promise<{
    success: boolean;
    matched: boolean;
  }> {
    // Simplified network idle check
    // In production, would use actual network monitoring
    const script = `
      (function() {
        return performance.getEntriesByType('navigation').length > 0;
      })()
    `;

    const hasNavigation = await this.cdpClient!.executeScript(script, {
      returnByValue: true,
    }) as boolean;

    return {
      success: hasNavigation,
      matched: hasNavigation,
    };
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create wait conditions manager
 */
export function createWaitConditionsManager(cdpClient: CDPClient | null = null): WaitConditionsManager {
  return new WaitConditionsManager(cdpClient);
}