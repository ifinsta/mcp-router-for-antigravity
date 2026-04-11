/**
 * Security Policy Engine
 *
 * Provides security containment features including:
 * - Domain allowlist checking
 * - Audit logging
 * - Secret redaction
 * - Risk action detection
 */

import { getConfig } from '../infra/config.js';
import { getLogger } from '../infra/logger.js';
import type {
  SecurityAuditEntry,
  SecurityCheckResult,
  SecurityPolicyConfig,
  SecurityPolicyState,
} from '../core/types.js';

const logger = getLogger('security-policy');

/** Maximum audit log entries to keep in memory */
const MAX_AUDIT_LOG_SIZE = 1000;

export class SecurityPolicyEngine {
  private auditLog: SecurityAuditEntry[] = [];

  /**
   * Check if a domain is allowed by the allowlist
   */
  checkDomain(domain: string, actor: string): SecurityCheckResult {
    const config = this.getSecurityConfig();

    // If allowlist is empty, allow everything (not configured)
    if (config.domainAllowlist.length === 0) {
      this.recordAudit('navigate', domain, actor, 'allowed');
      return 'allowed';
    }

    // Check against allowlist (support wildcards like *.example.com)
    const isAllowed = config.domainAllowlist.some((pattern) => {
      if (pattern.startsWith('*.')) {
        const suffix = pattern.slice(1); // .example.com
        return domain === pattern.slice(2) || domain.endsWith(suffix);
      }
      return domain === pattern;
    });

    const result: SecurityCheckResult = isAllowed ? 'allowed' : 'blocked';
    this.recordAudit(
      'navigate',
      domain,
      actor,
      result,
      isAllowed ? undefined : 'Domain not in allowlist'
    );

    if (!isAllowed) {
      logger.warn('Domain blocked by security policy', { domain, actor });
    }

    return result;
  }

  /**
   * Check if an action is considered high-risk
   */
  isRiskAction(action: string): boolean {
    const config = this.getSecurityConfig();
    return config.riskActions.includes(action);
  }

  /**
   * Record an action in the audit log
   */
  recordAudit(
    action: string,
    domain: string,
    actor: string,
    result: SecurityCheckResult,
    reason?: string
  ): void {
    const config = this.getSecurityConfig();
    if (!config.auditEnabled) return;

    const entry: SecurityAuditEntry = {
      timestamp: new Date().toISOString(),
      action,
      domain,
      actor,
      result,
      ...(reason !== undefined ? { reason } : {}),
    };

    this.auditLog.push(entry);

    // Trim to max size
    if (this.auditLog.length > MAX_AUDIT_LOG_SIZE) {
      this.auditLog = this.auditLog.slice(-MAX_AUDIT_LOG_SIZE);
    }

    logger.debug('Security audit entry', { action, domain, actor, result });
  }

  /**
   * Redact secrets from text using configured patterns
   */
  redactSecrets(text: string): string {
    const config = this.getSecurityConfig();
    if (config.secretPatterns.length === 0) return text;

    let redacted = text;
    for (const pattern of config.secretPatterns) {
      try {
        const regex = new RegExp(pattern, 'gi');
        redacted = redacted.replace(regex, '[REDACTED]');
      } catch {
        logger.warn('Invalid secret pattern', { pattern });
      }
    }
    return redacted;
  }

  /**
   * Get the audit log
   */
  getAuditLog(): readonly SecurityAuditEntry[] {
    return this.auditLog;
  }

  /**
   * Get current security policy state
   */
  getState(): SecurityPolicyState {
    return {
      config: this.getSecurityConfig(),
      auditLog: this.auditLog,
    };
  }

  /**
   * Get the security policy config
   */
  getSecurityConfig(): SecurityPolicyConfig {
    return getConfig().security;
  }

  /**
   * Clear audit log
   */
  clearAuditLog(): void {
    this.auditLog = [];
    logger.info('Audit log cleared');
  }
}

// Singleton
let securityEngine: SecurityPolicyEngine | undefined;

export function getSecurityEngine(): SecurityPolicyEngine {
  if (!securityEngine) {
    securityEngine = new SecurityPolicyEngine();
  }
  return securityEngine;
}

/**
 * Reset the security engine singleton (for testing)
 */
export function resetSecurityEngine(): void {
  securityEngine = undefined;
}
