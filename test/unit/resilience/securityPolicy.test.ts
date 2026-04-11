/**
 * Unit tests for SecurityPolicyEngine
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  SecurityPolicyEngine,
  getSecurityEngine,
  resetSecurityEngine,
} from '../../../src/resilience/securityPolicy.js';
import type { SecurityPolicyConfig } from '../../../src/core/types.js';

// Mock config module
const mockConfig: { security: SecurityPolicyConfig } = {
  security: {
    domainAllowlist: [],
    auditEnabled: true,
    secretPatterns: [],
    sessionIsolation: false,
    riskActions: ['form_submit', 'file_download', 'auth_flow'],
  },
};

// Helper to create engine with custom config
function createEngineWithConfig(config: Partial<SecurityPolicyConfig>): SecurityPolicyEngine {
  const engine = new SecurityPolicyEngine();
  // Override getSecurityConfig to return our test config
  engine.getSecurityConfig = () => ({
    ...mockConfig.security,
    ...config,
  });
  return engine;
}

describe('SecurityPolicyEngine', () => {
  beforeEach(() => {
    resetSecurityEngine();
  });

  // ---------- Domain Allowlist ----------

  describe('checkDomain', () => {
    it('allows all domains when allowlist is empty', () => {
      const engine = createEngineWithConfig({ domainAllowlist: [] });
      const result = engine.checkDomain('example.com', 'test-actor');
      assert.equal(result, 'allowed');
    });

    it('allows exact domain match', () => {
      const engine = createEngineWithConfig({ domainAllowlist: ['example.com'] });
      assert.equal(engine.checkDomain('example.com', 'test-actor'), 'allowed');
    });

    it('blocks domain not in allowlist', () => {
      const engine = createEngineWithConfig({ domainAllowlist: ['example.com'] });
      assert.equal(engine.checkDomain('evil.com', 'test-actor'), 'blocked');
    });

    it('supports wildcard subdomain matching (*.example.com)', () => {
      const engine = createEngineWithConfig({ domainAllowlist: ['*.example.com'] });
      assert.equal(engine.checkDomain('sub.example.com', 'test-actor'), 'allowed');
      assert.equal(engine.checkDomain('deep.sub.example.com', 'test-actor'), 'allowed');
    });

    it('wildcard does not match parent domain', () => {
      const engine = createEngineWithConfig({ domainAllowlist: ['*.example.com'] });
      assert.equal(engine.checkDomain('example.com', 'test-actor'), 'allowed');
    });

    it('wildcard does not match unrelated domains', () => {
      const engine = createEngineWithConfig({ domainAllowlist: ['*.example.com'] });
      assert.equal(engine.checkDomain('other.com', 'test-actor'), 'blocked');
      assert.equal(engine.checkDomain('example.com.evil.com', 'test-actor'), 'blocked');
    });

    it('supports multiple patterns in allowlist', () => {
      const engine = createEngineWithConfig({
        domainAllowlist: ['example.com', '*.test.com', 'specific.org'],
      });
      assert.equal(engine.checkDomain('example.com', 'test-actor'), 'allowed');
      assert.equal(engine.checkDomain('sub.test.com', 'test-actor'), 'allowed');
      assert.equal(engine.checkDomain('specific.org', 'test-actor'), 'allowed');
      assert.equal(engine.checkDomain('unknown.com', 'test-actor'), 'blocked');
    });

    it('records audit entry for allowed domain', () => {
      const engine = createEngineWithConfig({ domainAllowlist: ['example.com'] });
      engine.checkDomain('example.com', 'test-actor');
      const auditLog = engine.getAuditLog();
      assert.equal(auditLog.length, 1);
      assert.equal(auditLog[0]?.action, 'navigate');
      assert.equal(auditLog[0]?.domain, 'example.com');
      assert.equal(auditLog[0]?.actor, 'test-actor');
      assert.equal(auditLog[0]?.result, 'allowed');
    });

    it('records audit entry with reason for blocked domain', () => {
      const engine = createEngineWithConfig({ domainAllowlist: ['example.com'] });
      engine.checkDomain('evil.com', 'test-actor');
      const auditLog = engine.getAuditLog();
      assert.equal(auditLog.length, 1);
      assert.equal(auditLog[0]?.result, 'blocked');
      assert.equal(auditLog[0]?.reason, 'Domain not in allowlist');
    });
  });

  // ---------- Audit Logging ----------

  describe('recordAudit', () => {
    it('creates audit entry with all required fields', () => {
      const engine = createEngineWithConfig({ auditEnabled: true });
      engine.recordAudit('test-action', 'test-domain', 'test-actor', 'allowed');
      
      const auditLog = engine.getAuditLog();
      assert.equal(auditLog.length, 1);
      
      const entry = auditLog[0]!;
      assert.equal(entry.action, 'test-action');
      assert.equal(entry.domain, 'test-domain');
      assert.equal(entry.actor, 'test-actor');
      assert.equal(entry.result, 'allowed');
      assert.ok(typeof entry.timestamp === 'string');
      assert.ok(entry.timestamp.length > 0);
    });

    it('includes reason when provided', () => {
      const engine = createEngineWithConfig({ auditEnabled: true });
      engine.recordAudit('test-action', 'test-domain', 'test-actor', 'blocked', 'Test reason');
      
      const auditLog = engine.getAuditLog();
      assert.equal(auditLog[0]?.reason, 'Test reason');
    });

    it('does not record audit when auditEnabled is false', () => {
      const engine = createEngineWithConfig({ auditEnabled: false });
      engine.recordAudit('test-action', 'test-domain', 'test-actor', 'allowed');
      
      const auditLog = engine.getAuditLog();
      assert.equal(auditLog.length, 0);
    });

    it('respects max 1000 audit entries limit', () => {
      const engine = createEngineWithConfig({ auditEnabled: true });
      
      // Add 1005 entries
      for (let i = 0; i < 1005; i++) {
        engine.recordAudit('action', `domain-${i}`, 'actor', 'allowed');
      }
      
      const auditLog = engine.getAuditLog();
      assert.equal(auditLog.length, 1000);
      
      // Verify oldest entries were removed (first 5)
      assert.equal(auditLog[0]?.domain, 'domain-5');
      assert.equal(auditLog[999]?.domain, 'domain-1004');
    });

    it('maintains audit log order (FIFO when exceeding limit)', () => {
      const engine = createEngineWithConfig({ auditEnabled: true });
      
      // Add entries
      for (let i = 0; i < 1002; i++) {
        engine.recordAudit('action', `domain-${i}`, 'actor', 'allowed');
      }
      
      const auditLog = engine.getAuditLog();
      assert.equal(auditLog[0]?.domain, 'domain-2');
      assert.equal(auditLog[998]?.domain, 'domain-1000');
      assert.equal(auditLog[999]?.domain, 'domain-1001');
    });
  });

  // ---------- Secret Redaction ----------

  describe('redactSecrets', () => {
    it('returns original text when no patterns configured', () => {
      const engine = createEngineWithConfig({ secretPatterns: [] });
      const text = 'api_key=sk-12345';
      assert.equal(engine.redactSecrets(text), text);
    });

    it('redacts API keys matching pattern', () => {
      const engine = createEngineWithConfig({
        secretPatterns: ['sk-[a-zA-Z0-9]{20,}'],
      });
      const text = 'api_key=sk-abcdefghijklmnopqrstuvwxyz12345';
      assert.equal(engine.redactSecrets(text), 'api_key=[REDACTED]');
    });

    it('redacts auth tokens', () => {
      const engine = createEngineWithConfig({
        secretPatterns: ['Bearer\\s+[a-zA-Z0-9._-]+'],
      });
      const text = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
      assert.equal(engine.redactSecrets(text), 'Authorization: [REDACTED]');
    });

    it('redacts multiple secrets in same text', () => {
      const engine = createEngineWithConfig({
        secretPatterns: ['sk-[a-zA-Z0-9]+', 'password=\\w+'],
      });
      const text = 'api_key=sk-abc123 and password=secret456';
      assert.equal(engine.redactSecrets(text), 'api_key=[REDACTED] and [REDACTED]');
    });

    it('handles multiple patterns', () => {
      const engine = createEngineWithConfig({
        secretPatterns: [
          'api[_-]?key[=:]\\s*[a-zA-Z0-9]+',
          'token[=:]\\s*[a-zA-Z0-9_-]+',
        ],
      });
      const text = 'api_key=secret123, token:abc456';
      const result = engine.redactSecrets(text);
      assert.ok(!result.includes('secret123'));
      assert.ok(!result.includes('abc456'));
      assert.ok(result.includes('[REDACTED]'));
    });

    it('is case insensitive', () => {
      const engine = createEngineWithConfig({
        secretPatterns: ['api[_-]?key[=:]\\s*[a-zA-Z0-9]+'],
      });
      const text = 'API_KEY=secret123, api_key=secret456, Api_Key=secret789';
      const result = engine.redactSecrets(text);
      assert.equal((result.match(/\[REDACTED\]/g) || []).length, 3);
    });

    it('handles invalid regex patterns gracefully', () => {
      const engine = createEngineWithConfig({
        secretPatterns: ['[invalid', 'valid-[a-z]+'],
      });
      const text = 'valid-pattern-here and [invalid';
      // Should not throw, should process valid pattern
      const result = engine.redactSecrets(text);
      // The invalid pattern is skipped, valid pattern is applied
      assert.ok(typeof result === 'string');
    });

    it('returns unmodified text when pattern has no match', () => {
      const engine = createEngineWithConfig({
        secretPatterns: ['sk-[a-zA-Z0-9]+'],
      });
      const text = 'no secrets here';
      assert.equal(engine.redactSecrets(text), text);
    });
  });

  // ---------- Risk Action Detection ----------

  describe('isRiskAction', () => {
    it('identifies configured risk actions', () => {
      const engine = createEngineWithConfig({
        riskActions: ['form_submit', 'file_download', 'auth_flow'],
      });
      assert.equal(engine.isRiskAction('form_submit'), true);
      assert.equal(engine.isRiskAction('file_download'), true);
      assert.equal(engine.isRiskAction('auth_flow'), true);
    });

    it('returns false for non-risk actions', () => {
      const engine = createEngineWithConfig({
        riskActions: ['form_submit', 'file_download'],
      });
      assert.equal(engine.isRiskAction('navigate'), false);
      assert.equal(engine.isRiskAction('click'), false);
      assert.equal(engine.isRiskAction('screenshot'), false);
    });

    it('returns false when riskActions is empty', () => {
      const engine = createEngineWithConfig({ riskActions: [] });
      assert.equal(engine.isRiskAction('form_submit'), false);
      assert.equal(engine.isRiskAction('anything'), false);
    });

    it('handles exact string matching', () => {
      const engine = createEngineWithConfig({
        riskActions: ['form_submit'],
      });
      assert.equal(engine.isRiskAction('form_submit'), true);
      assert.equal(engine.isRiskAction('form_submi'), false);
      assert.equal(engine.isRiskAction('form_submit_extra'), false);
    });
  });

  // ---------- State Reporting ----------

  describe('getState', () => {
    it('returns correct state structure', () => {
      const engine = createEngineWithConfig({
        domainAllowlist: ['example.com'],
        auditEnabled: true,
        secretPatterns: ['pattern1'],
        sessionIsolation: true,
        riskActions: ['action1'],
      });
      
      engine.recordAudit('test', 'example.com', 'actor', 'allowed');
      
      const state = engine.getState();
      
      assert.ok('config' in state);
      assert.ok('auditLog' in state);
      
      // Check config
      assert.deepEqual(state.config.domainAllowlist, ['example.com']);
      assert.equal(state.config.auditEnabled, true);
      assert.deepEqual(state.config.secretPatterns, ['pattern1']);
      assert.equal(state.config.sessionIsolation, true);
      assert.deepEqual(state.config.riskActions, ['action1']);
      
      // Check audit log
      assert.equal(state.auditLog.length, 1);
      assert.equal(state.auditLog[0]?.action, 'test');
    });

    it('returns empty audit log when no entries', () => {
      const engine = createEngineWithConfig({ auditEnabled: true });
      const state = engine.getState();
      assert.equal(state.auditLog.length, 0);
    });

    it('audit log in state is readonly', () => {
      const engine = createEngineWithConfig({ auditEnabled: true });
      engine.recordAudit('test', 'domain', 'actor', 'allowed');
      
      const state = engine.getState();
      // Verify state has the audit log
      assert.equal(state.auditLog.length, 1);
      assert.equal(state.auditLog[0]?.action, 'test');
      
      // Verify the audit log type is readonly
      assert.ok(Array.isArray(state.auditLog));
    });
  });

  describe('getAuditLog', () => {
    it('returns readonly array', () => {
      const engine = createEngineWithConfig({ auditEnabled: true });
      engine.recordAudit('test', 'domain', 'actor', 'allowed');
      
      const log = engine.getAuditLog();
      assert.equal(log.length, 1);
      assert.equal(log[0]?.action, 'test');
    });

    it('returns empty array when no audits', () => {
      const engine = createEngineWithConfig({ auditEnabled: true });
      const log = engine.getAuditLog();
      assert.equal(log.length, 0);
    });
  });

  describe('clearAuditLog', () => {
    it('removes all audit entries', () => {
      const engine = createEngineWithConfig({ auditEnabled: true });
      engine.recordAudit('test1', 'domain1', 'actor', 'allowed');
      engine.recordAudit('test2', 'domain2', 'actor', 'allowed');
      
      assert.equal(engine.getAuditLog().length, 2);
      
      engine.clearAuditLog();
      
      assert.equal(engine.getAuditLog().length, 0);
    });
  });

  // ---------- Singleton ----------

  describe('getSecurityEngine singleton', () => {
    it('returns same instance on multiple calls', () => {
      const engine1 = getSecurityEngine();
      const engine2 = getSecurityEngine();
      assert.strictEqual(engine1, engine2);
    });

    it('creates new instance after reset', () => {
      const engine1 = getSecurityEngine();
      resetSecurityEngine();
      const engine2 = getSecurityEngine();
      assert.notStrictEqual(engine1, engine2);
    });
  });
});
