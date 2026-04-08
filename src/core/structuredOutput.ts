/**
 * Structured JSON Output with Schema Validation and Auto-Retry
 *
 * Provides JSON extraction from LLM responses, basic JSON Schema validation,
 * correction prompt building, and an auto-retry processor.
 */

import type {
  NormalizedChatRequest,
  NormalizedChatResponse,
  JsonValidationResult,
  StructuredOutputResponse,
} from './types.js';

// ============================================================================
// JSON Extraction
// ============================================================================

/**
 * Extract JSON from text that may contain markdown fences, surrounding text, etc.
 *
 * Handles:
 * - Raw JSON strings (starts with `{` or `[`)
 * - Markdown ```json fences
 * - Markdown ``` fences (no language tag)
 * - Text with embedded JSON blocks
 * - Multiple JSON blocks (returns the first valid one)
 *
 * @returns The extracted JSON string, or null if no valid JSON found
 */
export function extractJsonFromText(text: string): string | null {
  const trimmed = text.trim();

  // Case 1: Raw JSON — starts with { or [
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    if (tryParseJson(trimmed) !== undefined) {
      return trimmed;
    }
  }

  // Case 2: Markdown ```json ... ``` fences
  const jsonFencePattern = /```json\s*\n?([\s\S]*?)```/g;
  let match = jsonFencePattern.exec(text);
  while (match !== null) {
    const candidate = match[1]?.trim();
    if (candidate !== undefined && candidate.length > 0 && tryParseJson(candidate) !== undefined) {
      return candidate;
    }
    match = jsonFencePattern.exec(text);
  }

  // Case 3: Plain ``` ... ``` fences (no language tag)
  const plainFencePattern = /```\s*\n?([\s\S]*?)```/g;
  let plainMatch = plainFencePattern.exec(text);
  while (plainMatch !== null) {
    const candidate = plainMatch[1]?.trim();
    if (candidate !== undefined && candidate.length > 0 && tryParseJson(candidate) !== undefined) {
      return candidate;
    }
    plainMatch = plainFencePattern.exec(text);
  }

  // Case 4: Embedded JSON — find first { ... } or [ ... ] block
  // Pick whichever delimiter appears first in the text
  const braceIdx = trimmed.indexOf('{');
  const bracketIdx = trimmed.indexOf('[');

  if (braceIdx !== -1 && (bracketIdx === -1 || braceIdx <= bracketIdx)) {
    const braceResult = extractBalancedBlock(trimmed, '{', '}');
    if (braceResult !== null) return braceResult;
    // Fallback to bracket if brace didn't work
    const bracketResult = extractBalancedBlock(trimmed, '[', ']');
    if (bracketResult !== null) return bracketResult;
  } else if (bracketIdx !== -1) {
    const bracketResult = extractBalancedBlock(trimmed, '[', ']');
    if (bracketResult !== null) return bracketResult;
    // Fallback to brace if bracket didn't work
    const braceResult = extractBalancedBlock(trimmed, '{', '}');
    if (braceResult !== null) return braceResult;
  }

  return null;
}

/**
 * Try to parse a JSON string. Returns the parsed value or undefined on failure.
 */
function tryParseJson(text: string): unknown | undefined {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Extract a balanced block delimited by open/close chars, then validate as JSON.
 */
function extractBalancedBlock(
  text: string,
  openChar: string,
  closeChar: string,
): string | null {
  const startIdx = text.indexOf(openChar);
  if (startIdx === -1) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === '\\' && inString) {
      escaped = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (ch === openChar) {
      depth++;
    } else if (ch === closeChar) {
      depth--;
      if (depth === 0) {
        const candidate = text.slice(startIdx, i + 1);
        if (tryParseJson(candidate) !== undefined) {
          return candidate;
        }
        // If this block isn't valid JSON, keep searching
        return null;
      }
    }
  }

  return null;
}

// ============================================================================
// JSON Schema Validation (basic inline implementation)
// ============================================================================

/**
 * Validate extracted JSON output, optionally against a basic JSON Schema.
 *
 * Schema validation supports: `type`, `required`, `properties`, `items`.
 * This is intentionally minimal — no external schema library needed.
 */
export function validateJsonOutput(
  text: string,
  schema?: Record<string, unknown>,
): JsonValidationResult {
  const rawJson = extractJsonFromText(text);

  if (rawJson === null) {
    return {
      valid: false,
      parsed: null,
      rawJson: null,
      error: 'No valid JSON found in response',
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      valid: false,
      parsed: null,
      rawJson,
      error: `JSON parse error: ${msg}`,
    };
  }

  if (schema !== undefined) {
    const schemaError = validateAgainstSchema(parsed, schema);
    if (schemaError !== null) {
      return {
        valid: false,
        parsed,
        rawJson,
        error: schemaError,
      };
    }
  }

  return {
    valid: true,
    parsed,
    rawJson,
    error: null,
  };
}

/**
 * Validate a parsed value against a basic JSON Schema subset.
 * Returns an error string or null if valid.
 */
function validateAgainstSchema(
  value: unknown,
  schema: Record<string, unknown>,
): string | null {
  // Check "type"
  const schemaType = schema['type'];
  if (typeof schemaType === 'string') {
    const typeError = checkType(value, schemaType);
    if (typeError !== null) {
      return typeError;
    }
  }

  // Check "required" (only for objects)
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const required = schema['required'];
    if (Array.isArray(required)) {
      const obj = value as Record<string, unknown>;
      for (const field of required) {
        if (typeof field === 'string' && !(field in obj)) {
          return `Missing required field: "${field}"`;
        }
      }
    }

    // Check "properties"
    const properties = schema['properties'];
    if (typeof properties === 'object' && properties !== null) {
      const props = properties as Record<string, unknown>;
      const obj = value as Record<string, unknown>;
      for (const [key, propSchema] of Object.entries(props)) {
        if (key in obj) {
          const propValue = obj[key];
          if (typeof propSchema === 'object' && propSchema !== null) {
            const propError = validateAgainstSchema(
              propValue,
              propSchema as Record<string, unknown>,
            );
            if (propError !== null) {
              return `Property "${key}": ${propError}`;
            }
          }
        }
      }
    }
  }

  // Check "items" (only for arrays)
  if (Array.isArray(value)) {
    const items = schema['items'];
    if (typeof items === 'object' && items !== null) {
      const itemSchema = items as Record<string, unknown>;
      for (let i = 0; i < value.length; i++) {
        const itemError = validateAgainstSchema(value[i], itemSchema);
        if (itemError !== null) {
          return `Item [${i}]: ${itemError}`;
        }
      }
    }
  }

  return null;
}

/**
 * Check if a value matches a JSON Schema `type` keyword.
 */
function checkType(value: unknown, expectedType: string): string | null {
  const actualType = getJsonType(value);
  if (actualType !== expectedType) {
    return `Expected type "${expectedType}", got "${actualType}"`;
  }
  return null;
}

/**
 * Map a JS value to its JSON Schema type string.
 */
function getJsonType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value; // "string" | "number" | "boolean" | "object"
}

// ============================================================================
// Correction Prompt Builder
// ============================================================================

/**
 * Build a corrected message array that appends a correction prompt
 * instructing the LLM to fix its invalid JSON output.
 */
export function buildCorrectionPrompt(
  originalMessages: NormalizedChatRequest['messages'],
  parseError: string,
  schema?: Record<string, unknown>,
): NormalizedChatRequest['messages'] {
  let correctionText =
    `Your previous response was not valid JSON. Error: ${parseError}. ` +
    `Please respond with ONLY valid JSON, no markdown fences, no explanation text.`;

  if (schema !== undefined) {
    correctionText += ` The JSON must conform to this schema: ${JSON.stringify(schema)}`;
  }

  return [
    ...originalMessages,
    {
      role: 'user' as const,
      content: correctionText,
    },
  ];
}

// ============================================================================
// Structured Output Processor
// ============================================================================

/** Default maximum validation/retry attempts */
const DEFAULT_MAX_ATTEMPTS = 3;

/**
 * Processor that wraps a chat executor with JSON validation and auto-retry.
 *
 * Usage:
 *   const processor = new StructuredOutputProcessor(executeChat);
 *   const result = await processor.executeWithValidation(request);
 */
export class StructuredOutputProcessor {
  private readonly executeChat: (
    request: NormalizedChatRequest,
  ) => Promise<NormalizedChatResponse>;

  constructor(
    executeChat: (request: NormalizedChatRequest) => Promise<NormalizedChatResponse>,
  ) {
    this.executeChat = executeChat;
  }

  /**
   * Execute a chat request expecting JSON output, with auto-retry on validation failure.
   *
   * @param request - Chat request with responseFormat: 'json' and optional schema
   * @param maxAttempts - Maximum attempts (default 3)
   * @returns Enhanced response with structuredOutput and validationAttempts
   */
  async executeWithValidation(
    request: NormalizedChatRequest & {
      responseFormat: 'json';
      schema?: Record<string, unknown>;
    },
    maxAttempts: number = DEFAULT_MAX_ATTEMPTS,
  ): Promise<StructuredOutputResponse> {
    let currentMessages = request.messages;
    let lastResponse: NormalizedChatResponse | undefined;
    let lastValidation: JsonValidationResult | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const chatRequest: NormalizedChatRequest = {
        ...request,
        messages: currentMessages,
      };

      lastResponse = await this.executeChat(chatRequest);
      lastValidation = validateJsonOutput(lastResponse.outputText, request.schema);

      if (lastValidation.valid) {
        return {
          ...lastResponse,
          structuredOutput: lastValidation.parsed as
            | Record<string, unknown>
            | unknown[]
            | null,
          validationAttempts: attempt,
        };
      }

      // If not the last attempt, build correction prompt for retry
      if (attempt < maxAttempts) {
        currentMessages = buildCorrectionPrompt(
          currentMessages,
          lastValidation.error ?? 'Invalid JSON',
          request.schema,
        );
      }
    }

    // All attempts exhausted — return last response with failure info
    const warnings = [
      ...(lastResponse?.warnings ?? []),
      `Structured output validation failed after ${maxAttempts} attempts: ${lastValidation?.error ?? 'Unknown error'}`,
    ];

    return {
      ...(lastResponse as NormalizedChatResponse),
      warnings,
      structuredOutput: null,
      validationAttempts: maxAttempts,
    };
  }
}
