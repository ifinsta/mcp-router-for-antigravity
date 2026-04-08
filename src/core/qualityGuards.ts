/**
 * Quality Guards for LLM response validation
 *
 * Catches non-JSON quality issues: broken code syntax, repetition,
 * non-answers, and insufficient length. These are separate from
 * structured output validation (structuredOutput.ts).
 */

import type {
  QualityGuardConfig,
  QualityGuardName,
  QualityCheckResult,
  NormalizedChatRequest,
} from './types.js';

// ============================================================================
// Internal guard result type
// ============================================================================

interface GuardResult {
  passed: boolean;
  reason: string;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_MIN_LENGTH = 20;

const ALL_GUARDS: ReadonlyArray<QualityGuardName> = [
  'syntax',
  'length',
  'repetition',
  'nonAnswer',
] as const;

/**
 * Refusal phrases checked only in the first 200 characters of a response.
 * Case-insensitive matching.
 */
const REFUSAL_PHRASES: ReadonlyArray<string> = [
  'i cannot',
  "i can't",
  "i'm unable",
  "i don't have",
  'as an ai',
  'as a language model',
  "i'm not able",
  'i apologize but i cannot',
];

// ============================================================================
// QualityGuardRunner
// ============================================================================

/**
 * Runs configurable quality guards on LLM response text.
 *
 * Guards are lightweight heuristics designed to be conservative:
 * better to miss a bad response than reject a good one.
 */
export class QualityGuardRunner {
  private readonly enabled: boolean;
  private readonly activeGuards: ReadonlySet<QualityGuardName>;
  private readonly minLength: number;

  constructor(config?: QualityGuardConfig) {
    this.enabled = config?.enabled ?? true;
    this.activeGuards = new Set(config?.guards ?? ALL_GUARDS);
    this.minLength = config?.minLength ?? DEFAULT_MIN_LENGTH;
  }

  /**
   * Run all enabled guards on the response text.
   */
  runGuards(responseText: string): QualityCheckResult {
    if (!this.enabled) {
      return { passed: true, failures: [], correctionHint: '', failedGuards: [] };
    }

    const failures: string[] = [];
    const failedGuards: string[] = [];

    const guardMap: ReadonlyArray<{ name: QualityGuardName; fn: (text: string) => GuardResult }> = [
      { name: 'syntax', fn: (t) => this.codeSyntaxGuard(t) },
      { name: 'length', fn: (t) => this.minLengthGuard(t) },
      { name: 'repetition', fn: (t) => this.repetitionGuard(t) },
      { name: 'nonAnswer', fn: (t) => this.nonAnswerGuard(t) },
    ];

    for (const guard of guardMap) {
      if (!this.activeGuards.has(guard.name)) {
        continue;
      }
      const result = guard.fn(responseText);
      if (!result.passed) {
        failures.push(result.reason);
        failedGuards.push(guard.name);
      }
    }

    const passed = failures.length === 0;
    const correctionHint = passed
      ? ''
      : `Your previous response had quality issues: ${failures.join('; ')}. Please provide a complete, direct answer.`;

    return { passed, failures, correctionHint, failedGuards };
  }

  // --------------------------------------------------------------------------
  // Individual guards
  // --------------------------------------------------------------------------

  /**
   * Check code blocks in markdown fences for obvious syntax issues:
   * - Unbalanced brackets: (), {}, []
   * - Unbalanced HTML/JSX tags
   * - Broken JSON in code fences
   *
   * Passes if no code fences are found (guard only applies to code).
   */
  private codeSyntaxGuard(text: string): GuardResult {
    const codeBlocks = extractCodeBlocks(text);

    if (codeBlocks.length === 0) {
      return { passed: true, reason: '' };
    }

    for (const block of codeBlocks) {
      // Check balanced brackets
      const bracketResult = checkBalancedBrackets(block);
      if (!bracketResult.passed) {
        return bracketResult;
      }

      // Check balanced HTML/JSX tags
      const tagResult = checkBalancedTags(block);
      if (!tagResult.passed) {
        return tagResult;
      }

      // Check for broken JSON (starts with { but doesn't parse)
      const jsonResult = checkBrokenJson(block);
      if (!jsonResult.passed) {
        return jsonResult;
      }
    }

    return { passed: true, reason: '' };
  }

  /**
   * Check if the response meets the minimum length requirement.
   */
  private minLengthGuard(text: string): GuardResult {
    const trimmedLength = text.trim().length;
    if (trimmedLength >= this.minLength) {
      return { passed: true, reason: '' };
    }
    return {
      passed: false,
      reason: `Response too short (${trimmedLength} chars, minimum ${this.minLength})`,
    };
  }

  /**
   * Detect repetitive output:
   * - More than 50% duplicate lines (multi-line only)
   * - Any 10+ word sequence appearing 3+ times
   */
  private repetitionGuard(text: string): GuardResult {
    const lines = text.split('\n').filter((line) => line.trim().length > 0);

    // Check duplicate line ratio (only for multi-line text)
    if (lines.length > 1) {
      const uniqueLines = new Set(lines);
      const uniqueRatio = uniqueLines.size / lines.length;
      if (uniqueRatio < 0.5) {
        const duplicatePercent = Math.round((1 - uniqueRatio) * 100);
        return {
          passed: false,
          reason: `Repetitive output detected: ${duplicatePercent}% duplicate lines`,
        };
      }
    }

    // Check repeated phrases (10+ word sequences appearing 3+ times)
    const phraseResult = checkRepeatedPhrases(text);
    if (!phraseResult.passed) {
      return phraseResult;
    }

    return { passed: true, reason: '' };
  }

  /**
   * Detect refusal/non-answer patterns in the first 200 characters.
   * Only flags when the response starts with a refusal, to avoid
   * false positives in longer responses that discuss AI.
   */
  private nonAnswerGuard(text: string): GuardResult {
    const prefix = text.slice(0, 200).toLowerCase();

    for (const phrase of REFUSAL_PHRASES) {
      if (prefix.includes(phrase)) {
        return {
          passed: false,
          reason: 'Response appears to be a refusal rather than an answer',
        };
      }
    }

    return { passed: true, reason: '' };
  }
}

// ============================================================================
// Static helper — build retry messages
// ============================================================================

/**
 * Appends a correction message to the original messages for retry.
 * Returns a new message array ready for a retry request.
 */
export function buildQualityRetryMessages(
  originalMessages: NormalizedChatRequest['messages'],
  checkResult: QualityCheckResult,
): NormalizedChatRequest['messages'] {
  return [
    ...originalMessages,
    {
      role: 'user' as const,
      content: checkResult.correctionHint,
    },
  ];
}

// ============================================================================
// Pure helper functions
// ============================================================================

/**
 * Extract code blocks from markdown triple-backtick fences.
 */
function extractCodeBlocks(text: string): string[] {
  const blocks: string[] = [];
  const regex = /```[\s\S]*?```/g;
  let match = regex.exec(text);
  while (match !== null) {
    // Strip the opening and closing ``` lines
    const raw = match[0];
    const firstNewline = raw.indexOf('\n');
    const lastBackticks = raw.lastIndexOf('```');
    if (firstNewline !== -1 && lastBackticks > firstNewline) {
      blocks.push(raw.slice(firstNewline + 1, lastBackticks));
    }
    match = regex.exec(text);
  }
  return blocks;
}

/**
 * Check that brackets (), {}, [] are balanced in a code block.
 */
function checkBalancedBrackets(code: string): GuardResult {
  const pairs: ReadonlyArray<{ open: string; close: string; name: string }> = [
    { open: '(', close: ')', name: "'('" },
    { open: '{', close: '}', name: "'{'" },
    { open: '[', close: ']', name: "'['" },
  ];

  for (const pair of pairs) {
    let openCount = 0;
    let closeCount = 0;
    for (const ch of code) {
      if (ch === pair.open) openCount++;
      if (ch === pair.close) closeCount++;
    }
    if (openCount !== closeCount) {
      return {
        passed: false,
        reason: `Unbalanced brackets: ${openCount} opening ${pair.name} vs ${closeCount} closing '${pair.close}'`,
      };
    }
  }

  return { passed: true, reason: '' };
}

/**
 * Simple HTML/JSX tag balance check.
 * Counts opening <tag> vs closing </tag> occurrences.
 * Self-closing tags (<br />) are ignored.
 */
function checkBalancedTags(code: string): GuardResult {
  // Match opening tags: <tag ...> (not self-closing, not closing)
  const openingTagRegex = /<([a-zA-Z][a-zA-Z0-9]*)\b[^>]*(?<!\/)>/g;
  // Match closing tags: </tag>
  const closingTagRegex = /<\/([a-zA-Z][a-zA-Z0-9]*)\s*>/g;

  const openCounts = new Map<string, number>();
  const closeCounts = new Map<string, number>();

  let openMatch = openingTagRegex.exec(code);
  while (openMatch !== null) {
    const tag = openMatch[1]!.toLowerCase();
    openCounts.set(tag, (openCounts.get(tag) ?? 0) + 1);
    openMatch = openingTagRegex.exec(code);
  }

  let closeMatch = closingTagRegex.exec(code);
  while (closeMatch !== null) {
    const tag = closeMatch[1]!.toLowerCase();
    closeCounts.set(tag, (closeCounts.get(tag) ?? 0) + 1);
    closeMatch = closingTagRegex.exec(code);
  }

  // Only check tags that appear as either opening or closing
  const allTags = new Set([...openCounts.keys(), ...closeCounts.keys()]);
  for (const tag of allTags) {
    const opens = openCounts.get(tag) ?? 0;
    const closes = closeCounts.get(tag) ?? 0;
    if (opens !== closes) {
      return {
        passed: false,
        reason: `Unbalanced HTML/JSX tags: ${opens} opening <${tag}> vs ${closes} closing </${tag}>`,
      };
    }
  }

  return { passed: true, reason: '' };
}

/**
 * Check if a code block looks like broken JSON
 * (starts with { but fails to parse).
 */
function checkBrokenJson(code: string): GuardResult {
  const trimmed = code.trim();
  if (!trimmed.startsWith('{')) {
    return { passed: true, reason: '' };
  }

  try {
    JSON.parse(trimmed);
    return { passed: true, reason: '' };
  } catch {
    return {
      passed: false,
      reason: 'Code fence contains broken JSON (starts with { but fails to parse)',
    };
  }
}

/**
 * Check for repeated phrases: any 10+ word sequence appearing 3+ times.
 */
function checkRepeatedPhrases(text: string): GuardResult {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const phraseLength = 10;

  if (words.length < phraseLength) {
    return { passed: true, reason: '' };
  }

  const phraseCounts = new Map<string, number>();
  for (let i = 0; i <= words.length - phraseLength; i++) {
    const phrase = words.slice(i, i + phraseLength).join(' ');
    phraseCounts.set(phrase, (phraseCounts.get(phrase) ?? 0) + 1);
  }

  for (const [, count] of phraseCounts) {
    if (count >= 3) {
      return {
        passed: false,
        reason: 'Repetitive output detected: repeated phrase sequence found 3+ times',
      };
    }
  }

  return { passed: true, reason: '' };
}
