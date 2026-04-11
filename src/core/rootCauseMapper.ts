/**
 * Root Cause Mapper
 *
 * Maps evidence capsules to actionable root cause insights.
 * Uses heuristic analysis to identify likely components, handlers, API calls,
 * and generate candidate fixes based on failure classification.
 */

import { getLogger } from '../infra/logger.js';
import { getEvidenceCapsuleCollector } from './evidenceCapsule.js';
import { getFailureClassifier } from './failureClassifier.js';
import type {
  EvidenceCapsule,
  FailureExplanation,
  FailureClass,
  RootCauseMapping,
  CandidateFix,
  CandidateFixCategory,
  BrowserNetworkEntry,
  ActionTimelineEntry,
} from './types.js';

const logger = getLogger('root-cause-mapper');

/**
 * Root Cause Mapper
 *
 * Analyzes evidence capsules to produce actionable root cause mappings
 * with component identification, handler inference, and fix suggestions.
 */
export class RootCauseMapper {
  /**
   * Map an evidence capsule to a root cause mapping with actionable insights
   */
  async map(capsuleId: string): Promise<RootCauseMapping> {
    logger.debug('Mapping root cause', { capsuleId });

    // Get the capsule from the collector
    const collector = getEvidenceCapsuleCollector();
    const capsule = collector.get(capsuleId);

    if (!capsule) {
      throw new Error(`Evidence capsule not found: ${capsuleId}`);
    }

    // Run the failure classifier to get structured explanation
    const classifier = getFailureClassifier();
    const failureExplanation = classifier.classify(capsule);

    // Extract component from URL path and DOM snapshot
    const likelyComponent = this.extractLikelyComponent(capsule, failureExplanation);

    // Extract handler from action timeline
    const likelyHandler = this.extractLikelyHandler(capsule, failureExplanation);

    // Extract API call from network entries
    const likelyApiCall = this.extractLikelyApiCall(capsule, failureExplanation);

    // Generate candidate fixes based on failure class
    const candidateFixes = this.generateCandidateFixes(
      capsule,
      failureExplanation,
      likelyComponent,
      likelyApiCall
    );

    const mapping: RootCauseMapping = {
      capsuleId,
      failureExplanation,
      likelyComponent,
      likelyHandler,
      likelyApiCall,
      candidateFixes,
      timestamp: new Date().toISOString(),
    };

    logger.info('Root cause mapped', {
      capsuleId,
      failureClass: failureExplanation.failureClass,
      component: likelyComponent,
      handler: likelyHandler,
      apiCall: likelyApiCall,
      fixCount: candidateFixes.length,
    });

    return mapping;
  }

  /**
   * Extract the likely UI component from URL path and DOM snapshot
   */
  private extractLikelyComponent(
    capsule: EvidenceCapsule,
    explanation: FailureExplanation
  ): string {
    const url = capsule.browser.sessionMetadata.url;
    const domSnapshot = capsule.browser.domSnapshot;

    // Try to extract component from URL path
    let componentFromUrl = this.extractComponentFromUrl(url);

    // Try to extract from DOM if available
    let componentFromDom: string | null = null;
    if (domSnapshot) {
      componentFromDom = this.extractComponentFromDom(domSnapshot);
    }

    // Use DOM-derived component if available, otherwise URL-derived
    if (componentFromDom) {
      return componentFromDom;
    }

    if (componentFromUrl) {
      return componentFromUrl;
    }

    // Fallback based on failure class
    return this.getComponentFromFailureClass(explanation.failureClass, capsule);
  }

  /**
   * Extract component name from URL path
   */
  private extractComponentFromUrl(url: string): string | null {
    if (!url) return null;

    try {
      const parsed = new URL(url);
      const pathParts = parsed.pathname.split('/').filter(Boolean);

      if (pathParts.length === 0) {
        return 'Home Page';
      }

      // Convert path segments to component name
      // e.g., /users/profile -> "Users Profile Page"
      // e.g., /api/auth/login -> "API Handler /auth/login"
      if (pathParts[0] === 'api' && pathParts.length > 1) {
        const apiPath = '/' + pathParts.slice(1).join('/');
        return `API Handler ${apiPath}`;
      }

      // Capitalize and format path segments
      const componentName = pathParts
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1).replace(/-/g, ' '))
        .join(' ');

      return `${componentName} Page`;
    } catch {
      return null;
    }
  }

  /**
   * Extract component name from DOM snapshot
   */
  private extractComponentFromDom(domSnapshot: string): string | null {
    // Look for form elements, page sections, and semantic elements
    const formMatch = domSnapshot.match(/<form[^>]*(?:aria-label|name|id)=["']([^"']+)["']/i);
    if (formMatch && formMatch[1]) {
      return `${this.formatIdentifier(formMatch[1])} Form`;
    }

    // Look for main sections
    const sectionMatch = domSnapshot.match(/<(?:section|main|article)[^>]*(?:aria-label|id)=["']([^"']+)["']/i);
    if (sectionMatch && sectionMatch[1]) {
      return this.formatIdentifier(sectionMatch[1]);
    }

    // Look for specific UI patterns
    if (/type=["']password["']/i.test(domSnapshot)) {
      if (/type=["']text["']|type=["']email["']/i.test(domSnapshot)) {
        return 'Login Form';
      }
      return 'Password Form';
    }

    if (/<button[^>]*type=["']submit["']/i.test(domSnapshot)) {
      const buttonText = domSnapshot.match(/<button[^>]*>([^<]{1,30})<\/button>/i);
      if (buttonText && buttonText[1]) {
        return `${buttonText[1].trim()} Form`;
      }
    }

    return null;
  }

  /**
   * Format an identifier string to a readable component name
   */
  private formatIdentifier(id: string): string {
    return id
      .replace(/[-_]/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .split(' ')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  /**
   * Get component name from failure class as fallback
   */
  private getComponentFromFailureClass(
    failureClass: FailureClass,
    capsule: EvidenceCapsule
  ): string {
    const url = capsule.browser.sessionMetadata.url;

    switch (failureClass) {
      case 'backend_failure':
        return 'API Layer';
      case 'environment':
        return 'Network/Environment';
      case 'selector_drift':
        return 'Dynamic UI Component';
      case 'timing':
        return 'Async Operation';
      case 'app_code':
      default:
        if (url) {
          try {
            const parsed = new URL(url);
            return parsed.hostname;
          } catch {
            return 'Application';
          }
        }
        return 'Application';
    }
  }

  /**
   * Extract the likely handler from action timeline
   */
  private extractLikelyHandler(
    capsule: EvidenceCapsule,
    explanation: FailureExplanation
  ): string {
    const timeline = capsule.browser.actionTimeline;

    // Find the last action before failure
    const failedActions = timeline.filter((a) => a.result === 'failure');
    if (failedActions.length > 0) {
      const lastFailed = failedActions[failedActions.length - 1]!;
      return this.handlerFromAction(lastFailed);
    }

    // Find the last user action
    const lastAction = timeline[timeline.length - 1];
    if (lastAction) {
      return this.handlerFromAction(lastAction);
    }

    // Fallback based on failure class
    return this.getHandlerFromFailureClass(explanation.failureClass, capsule);
  }

  /**
   * Generate handler description from an action timeline entry
   */
  private handlerFromAction(action: ActionTimelineEntry): string {
    const actionLower = action.action.toLowerCase();

    // Map action types to handler names
    if (actionLower.includes('click') || actionLower.includes('tap')) {
      return 'onClick handler';
    }
    if (actionLower.includes('type') || actionLower.includes('input') || actionLower.includes('fill')) {
      return 'onInput handler';
    }
    if (actionLower.includes('submit')) {
      return 'onSubmit handler';
    }
    if (actionLower.includes('hover')) {
      return 'onHover handler';
    }
    if (actionLower.includes('scroll')) {
      return 'onScroll handler';
    }
    if (actionLower.includes('navigate') || actionLower.includes('goto')) {
      return 'navigation handler';
    }
    if (actionLower.includes('wait')) {
      return 'async wait callback';
    }
    if (actionLower.includes('fetch') || actionLower.includes('request')) {
      return 'fetch callback';
    }

    // Generic handler based on action name
    const actionName = action.action.split(' ')[0] ?? action.action;
    return `${actionName} handler`;
  }

  /**
   * Get handler from failure class as fallback
   */
  private getHandlerFromFailureClass(
    failureClass: FailureClass,
    capsule: EvidenceCapsule
  ): string {
    // Check console errors for clues
    const consoleErrors = capsule.browser.console.errors;
    if (consoleErrors.length > 0) {
      const firstError = consoleErrors[0]!.message;
      if (/fetch|xhr|request/i.test(firstError)) {
        return 'fetch callback';
      }
      if (/click/i.test(firstError)) {
        return 'onClick handler';
      }
      if (/timeout/i.test(firstError)) {
        return 'async timeout handler';
      }
    }

    switch (failureClass) {
      case 'backend_failure':
        return 'API response handler';
      case 'environment':
        return 'network initialization';
      case 'selector_drift':
        return 'DOM mutation handler';
      case 'timing':
        return 'async operation callback';
      case 'app_code':
      default:
        return 'event handler';
    }
  }

  /**
   * Extract the likely API call from network entries
   */
  private extractLikelyApiCall(
    capsule: EvidenceCapsule,
    explanation: FailureExplanation
  ): string | null {
    const requests = capsule.browser.networkRequests;

    // Find failed or slow requests
    const failedRequests = requests.filter(
      (r) => r.status >= 400 || r.status === 0
    );

    if (failedRequests.length > 0) {
      const first = failedRequests[0]!;
      return this.formatApiCall(first);
    }

    // For backend failures, look for 5xx errors specifically
    if (explanation.failureClass === 'backend_failure') {
      const serverErrors = requests.filter((r) => r.status >= 500 && r.status < 600);
      if (serverErrors.length > 0) {
        return this.formatApiCall(serverErrors[0]!);
      }
    }

    // Look for slow requests (timing issues)
    if (explanation.failureClass === 'timing') {
      const slowRequests = requests.filter((r) => r.duration > 5000);
      if (slowRequests.length > 0) {
        return this.formatApiCall(slowRequests[0]!);
      }
    }

    // Look for API-like URLs in any request
    const apiRequests = requests.filter((r) =>
      /\/api\/|\/v\d+\/|graphql|rest/i.test(r.url)
    );
    if (apiRequests.length > 0) {
      return this.formatApiCall(apiRequests[0]!);
    }

    return null;
  }

  /**
   * Format an API call from a network entry
   */
  private formatApiCall(request: BrowserNetworkEntry): string {
    try {
      const url = new URL(request.url);
      const path = url.pathname + url.search;
      return `${request.method} ${path}`;
    } catch {
      return `${request.method} ${request.url}`;
    }
  }

  /**
   * Generate candidate fixes based on failure class and context
   */
  private generateCandidateFixes(
    capsule: EvidenceCapsule,
    explanation: FailureExplanation,
    component: string,
    apiCall: string | null
  ): readonly CandidateFix[] {
    const fixes: CandidateFix[] = [];

    switch (explanation.failureClass) {
      case 'selector_drift':
        fixes.push(...this.getSelectorDriftFixes(capsule, component));
        break;
      case 'timing':
        fixes.push(...this.getTimingFixes(capsule, component));
        break;
      case 'backend_failure':
        fixes.push(...this.getBackendFailureFixes(capsule, apiCall));
        break;
      case 'environment':
        fixes.push(...this.getEnvironmentFixes(capsule));
        break;
      case 'app_code':
      default:
        fixes.push(...this.getAppCodeFixes(capsule, component));
        break;
    }

    // Sort by confidence descending
    return fixes.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Get fixes for selector drift issues
   */
  private getSelectorDriftFixes(
    capsule: EvidenceCapsule,
    component: string
  ): CandidateFix[] {
    const fixes: CandidateFix[] = [];

    // Get selector from action timeline
    const failedActions = capsule.browser.actionTimeline.filter((a) => a.result === 'failure');
    const selector = failedActions.length > 0 ? failedActions[0]!.selector : null;

    fixes.push({
      description: `Update selector for ${component} - the page structure may have changed`,
      confidence: 0.85,
      category: 'selector',
    });

    fixes.push({
      description: 'Add explicit wait-for-element before interacting with dynamic content',
      confidence: 0.75,
      category: 'timing',
    });

    fixes.push({
      description: 'Use more resilient selector strategy (data-testid, aria-label, or text content)',
      confidence: 0.70,
      category: 'selector',
    });

    if (selector) {
      fixes.push({
        description: `Review selector "${selector}" - verify it matches the current page structure`,
        confidence: 0.65,
        category: 'selector',
      });
    }

    return fixes;
  }

  /**
   * Get fixes for timing issues
   */
  private getTimingFixes(
    capsule: EvidenceCapsule,
    component: string
  ): CandidateFix[] {
    const fixes: CandidateFix[] = [];

    fixes.push({
      description: `Add explicit wait for ${component} to become visible/interactive`,
      confidence: 0.80,
      category: 'timing',
    });

    fixes.push({
      description: 'Increase timeout threshold for slow-loading operations',
      confidence: 0.75,
      category: 'timing',
    });

    // Check performance metrics for slow resources
    const perfMetrics = capsule.browser.performanceMetrics;
    const slowMetrics = Object.entries(perfMetrics)
      .filter(([, value]) => typeof value === 'number' && value > 3000);

    if (slowMetrics.length > 0) {
      fixes.push({
        description: 'Optimize slow-loading resources detected in performance metrics',
        confidence: 0.70,
        category: 'api',
      });
    }

    fixes.push({
      description: 'Add retry logic with exponential backoff for transient timing issues',
      confidence: 0.65,
      category: 'code_logic',
    });

    return fixes;
  }

  /**
   * Get fixes for backend failure issues
   */
  private getBackendFailureFixes(
    capsule: EvidenceCapsule,
    apiCall: string | null
  ): CandidateFix[] {
    const fixes: CandidateFix[] = [];

    if (apiCall) {
      fixes.push({
        description: `Check API endpoint ${apiCall} for availability and correct parameters`,
        confidence: 0.85,
        category: 'api',
      });
    }

    fixes.push({
      description: 'Add retry logic for transient backend failures',
      confidence: 0.75,
      category: 'code_logic',
    });

    fixes.push({
      description: 'Implement graceful degradation when backend is unavailable',
      confidence: 0.70,
      category: 'code_logic',
    });

    // Check for specific error codes
    const serverErrors = capsule.browser.networkRequests.filter(
      (r) => r.status >= 500 && r.status < 600
    );
    if (serverErrors.length > 0) {
      fixes.push({
        description: 'Investigate server-side error - the backend is returning 5xx errors',
        confidence: 0.80,
        category: 'api',
      });
    }

    const authErrors = capsule.browser.networkRequests.filter(
      (r) => r.status === 401 || r.status === 403
    );
    if (authErrors.length > 0) {
      fixes.push({
        description: 'Verify authentication credentials and session validity',
        confidence: 0.80,
        category: 'config',
      });
    }

    return fixes;
  }

  /**
   * Get fixes for environment issues
   */
  private getEnvironmentFixes(capsule: EvidenceCapsule): CandidateFix[] {
    const fixes: CandidateFix[] = [];

    // Check console errors for CORS
    const corsErrors = capsule.browser.console.errors.filter(
      (e) => /cors|cross-origin/i.test(e.message)
    );
    if (corsErrors.length > 0) {
      fixes.push({
        description: 'Configure CORS headers on the server to allow cross-origin requests',
        confidence: 0.85,
        category: 'config',
      });
    }

    // Check for DNS errors
    const dnsErrors = capsule.browser.console.errors.filter(
      (e) => /dns|enotfound|resolution/i.test(e.message)
    );
    if (dnsErrors.length > 0) {
      fixes.push({
        description: 'Verify DNS configuration and network connectivity',
        confidence: 0.85,
        category: 'config',
      });
    }

    // Check for SSL/TLS errors
    const sslErrors = capsule.browser.console.errors.filter(
      (e) => /ssl|tls|certificate/i.test(e.message)
    );
    if (sslErrors.length > 0) {
      fixes.push({
        description: 'Check SSL certificate validity and configuration',
        confidence: 0.85,
        category: 'config',
      });
    }

    // General environment fixes if no specific issues found
    if (fixes.length === 0) {
      fixes.push({
        description: 'Verify network connectivity and DNS resolution',
        confidence: 0.75,
        category: 'config',
      });

      fixes.push({
        description: 'Check CORS configuration if making cross-origin requests',
        confidence: 0.70,
        category: 'config',
      });
    }

    return fixes;
  }

  /**
   * Get fixes for application code issues
   */
  private getAppCodeFixes(
    capsule: EvidenceCapsule,
    component: string
  ): CandidateFix[] {
    const fixes: CandidateFix[] = [];

    // Check console errors for JavaScript errors
    const jsErrors = capsule.browser.console.errors.filter(
      (e) => /error|exception|undefined|null|typeerror/i.test(e.message)
    );

    if (jsErrors.length > 0) {
      fixes.push({
        description: `Review console errors in ${component} - JavaScript exception detected`,
        confidence: 0.80,
        category: 'code_logic',
      });
    }

    fixes.push({
      description: `Review component logic for ${component} - check for null/undefined handling`,
      confidence: 0.70,
      category: 'code_logic',
    });

    fixes.push({
      description: 'Add error boundaries and exception handling around risky operations',
      confidence: 0.65,
      category: 'code_logic',
    });

    // Check for warnings that might indicate issues
    if (capsule.browser.console.warnings.length > 0) {
      fixes.push({
        description: 'Review console warnings - they may indicate impending failures',
        confidence: 0.55,
        category: 'code_logic',
      });
    }

    return fixes;
  }
}

// Singleton instance
let mapper: RootCauseMapper | undefined;

/**
 * Get the singleton root cause mapper
 */
export function getRootCauseMapper(): RootCauseMapper {
  if (!mapper) {
    mapper = new RootCauseMapper();
  }
  return mapper;
}
