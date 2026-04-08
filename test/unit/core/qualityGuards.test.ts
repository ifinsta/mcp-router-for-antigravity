/**
 * Tests for quality guards — response quality heuristics
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { QualityGuardRunner, buildQualityRetryMessages } from '../../../src/core/qualityGuards.js';

// ============================================================================
// codeSyntaxGuard
// ============================================================================

describe('codeSyntaxGuard', () => {
  const runner = new QualityGuardRunner({ guards: ['syntax'] });

  it('passes for balanced code in fences', () => {
    const text = [
      'Here is some code:',
      '```js',
      'function foo() { return { a: 1 }; }',
      '```',
    ].join('\n');
    const result = runner.runGuards(text);
    assert.equal(result.passed, true);
    assert.equal(result.failures.length, 0);
  });

  it('fails for unbalanced brackets in code fences', () => {
    const text = [
      '```js',
      'function foo() { return { a: 1 };',
      '```',
    ].join('\n');
    const result = runner.runGuards(text);
    assert.equal(result.passed, false);
    assert.ok(result.failures[0]?.includes('Unbalanced brackets'));
    assert.deepEqual(result.failedGuards, ['syntax']);
  });

  it('fails for unbalanced JSX tags in code fences', () => {
    const text = [
      '```jsx',
      '<div><span></div>',
      '```',
    ].join('\n');
    const result = runner.runGuards(text);
    assert.equal(result.passed, false);
    assert.ok(result.failures[0]?.includes('Unbalanced HTML/JSX tags'));
  });

  it('passes when no code fences present', () => {
    const text = 'This is a plain text response with no code at all.';
    const result = runner.runGuards(text);
    assert.equal(result.passed, true);
  });

  it('fails for broken JSON in code fence', () => {
    const text = [
      '```json',
      '{ "name": "test", "value": undefined }',
      '```',
    ].join('\n');
    const result = runner.runGuards(text);
    assert.equal(result.passed, false);
    assert.ok(result.failures[0]?.includes('broken JSON'));
  });

  it('passes for valid JSON in code fence', () => {
    const text = [
      '```json',
      '{ "name": "test", "value": 42 }',
      '```',
    ].join('\n');
    const result = runner.runGuards(text);
    assert.equal(result.passed, true);
  });
});

// ============================================================================
// minLengthGuard
// ============================================================================

describe('minLengthGuard', () => {
  it('passes for text >= default minLength', () => {
    const runner = new QualityGuardRunner({ guards: ['length'] });
    const result = runner.runGuards('This is a long enough response to pass the guard.');
    assert.equal(result.passed, true);
  });

  it('fails for text < default minLength', () => {
    const runner = new QualityGuardRunner({ guards: ['length'] });
    const result = runner.runGuards('Short.');
    assert.equal(result.passed, false);
    assert.ok(result.failures[0]?.includes('Response too short'));
    assert.deepEqual(result.failedGuards, ['length']);
  });

  it('handles whitespace-only text', () => {
    const runner = new QualityGuardRunner({ guards: ['length'] });
    const result = runner.runGuards('   \n\n   ');
    assert.equal(result.passed, false);
    assert.ok(result.failures[0]?.includes('Response too short'));
  });

  it('respects custom minLength config', () => {
    const runner = new QualityGuardRunner({ guards: ['length'], minLength: 5 });
    const result = runner.runGuards('Hello');
    assert.equal(result.passed, true);
  });

  it('fails with custom minLength when too short', () => {
    const runner = new QualityGuardRunner({ guards: ['length'], minLength: 50 });
    const result = runner.runGuards('This is not long enough.');
    assert.equal(result.passed, false);
  });
});

// ============================================================================
// repetitionGuard
// ============================================================================

describe('repetitionGuard', () => {
  const runner = new QualityGuardRunner({ guards: ['repetition'] });

  it('passes for unique content', () => {
    const text = [
      'First line of unique content.',
      'Second line with different text.',
      'Third line about something else.',
      'Fourth line wrapping up.',
    ].join('\n');
    const result = runner.runGuards(text);
    assert.equal(result.passed, true);
  });

  it('fails for >50% duplicate lines', () => {
    const repeated = 'This is a repeated line.';
    const lines = [repeated, repeated, repeated, repeated, 'One unique line.'];
    const result = runner.runGuards(lines.join('\n'));
    assert.equal(result.passed, false);
    assert.ok(result.failures[0]?.includes('duplicate lines'));
    assert.deepEqual(result.failedGuards, ['repetition']);
  });

  it('fails for repeated phrase sequences', () => {
    // 10-word phrase repeated 3+ times
    const phrase = 'the quick brown fox jumped over the lazy red dog';
    const text = `${phrase} ${phrase} ${phrase} and some extra text at the end to fill it out.`;
    const result = runner.runGuards(text);
    assert.equal(result.passed, false);
    assert.ok(result.failures[0]?.includes('repeated phrase'));
  });

  it('handles single-line response (pass)', () => {
    const result = runner.runGuards('Just a single line of text.');
    assert.equal(result.passed, true);
  });
});

// ============================================================================
// nonAnswerGuard
// ============================================================================

describe('nonAnswerGuard', () => {
  const runner = new QualityGuardRunner({ guards: ['nonAnswer'] });

  it('passes for direct answers', () => {
    const result = runner.runGuards(
      'The answer to your question is 42. Here is a detailed explanation of why.'
    );
    assert.equal(result.passed, true);
  });

  it('fails for "I cannot help with that"', () => {
    const result = runner.runGuards('I cannot help with that request.');
    assert.equal(result.passed, false);
    assert.ok(result.failures[0]?.includes('refusal'));
    assert.deepEqual(result.failedGuards, ['nonAnswer']);
  });

  it('fails for "As an AI language model"', () => {
    const result = runner.runGuards(
      'As an AI language model, I am not able to provide that information.'
    );
    assert.equal(result.passed, false);
  });

  it("fails for \"I can't\" variant", () => {
    const result = runner.runGuards("I can't provide that information right now.");
    assert.equal(result.passed, false);
  });

  it('passes when refusal phrase is after char 200 (discussing AI)', () => {
    const padding = 'A'.repeat(201);
    const text = `${padding} As an AI language model, this is just a discussion about AI systems.`;
    const result = runner.runGuards(text);
    assert.equal(result.passed, true);
  });
});

// ============================================================================
// Integration: runGuards
// ============================================================================

describe('runGuards integration', () => {
  it('returns all failures combined', () => {
    // Short + refusal = both guards fail
    const runner = new QualityGuardRunner({ guards: ['length', 'nonAnswer'] });
    const result = runner.runGuards("I can't.");
    assert.equal(result.passed, false);
    assert.equal(result.failures.length, 2);
    assert.deepEqual(result.failedGuards, ['length', 'nonAnswer']);
    assert.ok(result.correctionHint.includes('quality issues'));
  });

  it('passes when all guards pass', () => {
    const runner = new QualityGuardRunner();
    const text = 'Here is a comprehensive answer that is long enough and provides real value to the user.';
    const result = runner.runGuards(text);
    assert.equal(result.passed, true);
    assert.equal(result.failures.length, 0);
    assert.equal(result.correctionHint, '');
    assert.equal(result.failedGuards.length, 0);
  });

  it('only enabled guards run (disable specific guards)', () => {
    // Only length guard enabled, so refusal should not be caught
    const runner = new QualityGuardRunner({ guards: ['length'] });
    const text = "I cannot help with that, but here is some padding to make it long enough for the length guard.";
    const result = runner.runGuards(text);
    assert.equal(result.passed, true);
  });

  it('returns pass when enabled is false', () => {
    const runner = new QualityGuardRunner({ enabled: false });
    const result = runner.runGuards('');
    assert.equal(result.passed, true);
    assert.equal(result.failures.length, 0);
  });
});

// ============================================================================
// buildQualityRetryMessages
// ============================================================================

describe('buildQualityRetryMessages', () => {
  it('appends correction hint to original messages', () => {
    const original: Array<{ role: 'user' | 'assistant'; content: string }> = [
      { role: 'user', content: 'Write a function' },
    ];
    const checkResult = {
      passed: false,
      failures: ['Response too short (5 chars, minimum 20)'],
      correctionHint: 'Your previous response had quality issues: Response too short (5 chars, minimum 20). Please provide a complete, direct answer.',
      failedGuards: ['length'],
    };
    const result = buildQualityRetryMessages(original, checkResult);

    assert.equal(result.length, 2);
    assert.equal(result[0]?.role, 'user');
    assert.equal(result[0]?.content, 'Write a function');
    assert.equal(result[1]?.role, 'user');
    assert.ok(result[1]?.content.includes('quality issues'));
  });

  it('preserves all original messages', () => {
    const original: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
      { role: 'user', content: 'Write code' },
    ];
    const checkResult = {
      passed: false,
      failures: ['too short'],
      correctionHint: 'Fix it.',
      failedGuards: ['length'],
    };
    const result = buildQualityRetryMessages(original, checkResult);
    assert.equal(result.length, 5);
    assert.equal(result[4]?.content, 'Fix it.');
  });
});
