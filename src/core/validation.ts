/**
 * Runtime validation schemas for external boundaries
 *
 * Provides validation for:
 * - MCP tool inputs
 * - Provider responses
 * - Configuration values
 *
 * All external data must pass through these validators
 */

import { z } from 'zod';
import {
  createValidationError,
  createInvalidTypeError,
  createInvalidRangeError,
  createInvalidRoleError,
  createInputTooLargeError,
  RouterError,
} from './errors.js';

// ============================================================================
// MCP Tool Input Validation
// ============================================================================

/**
 * Message role enum
 */
export const MessageRoleSchema = z.enum(['system', 'user', 'assistant', 'tool']);

/**
 * Message schema
 */
export const MessageSchema = z.object({
  role: MessageRoleSchema,
  content: z.string().min(1, 'Message content cannot be empty'),
  name: z.string().optional(),
});

/**
 * Chat request schema (from MCP tool input)
 */
export const ChatRequestSchema = z
  .object({
    provider: z.string().optional(),
    model: z.string().optional(),
    messages: z.array(MessageSchema).min(1, 'At least one message is required'),
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().int().positive().optional(),
    timeoutMs: z.number().int().positive().optional(),
    fallbackProvider: z.string().optional(),
    schema: z.record(z.unknown()).nullable().optional(),
  })
  .strict();

/**
 * List models request schema
 */
export const ListModelsRequestSchema = z
  .object({
    provider: z.string().optional(),
  })
  .strict();

// ============================================================================
// Validation Result Types
// ============================================================================

/**
 * Validation result with typed errors
 */
export interface ValidationResult<T = unknown> {
  /** Whether validation passed */
  valid: boolean;

  /** Validated and typed data */
  data: T | undefined;

  /** Validation errors */
  errors: RouterError[];
}

/**
 * Successful validation result
 */
export function validationSuccess<T>(data: T): ValidationResult<T> {
  return {
    valid: true,
    data,
    errors: [],
  };
}

/**
 * Failed validation result
 */
export function validationFailure<T = unknown>(errors: RouterError[]): ValidationResult<T> {
  return {
    valid: false,
    data: undefined,
    errors,
  };
}

// ============================================================================
// MCP Tool Input Validators
// ============================================================================

/**
 * Validate chat request from MCP tool input
 */
export function validateChatRequest(
  input: unknown
): ValidationResult<z.infer<typeof ChatRequestSchema>> {
  const errors: RouterError[] = [];

  try {
    const data = ChatRequestSchema.parse(input);

    // Additional validation beyond schema
    // Check total input size
    const totalChars = data.messages.reduce((sum, msg) => sum + msg.content.length, 0);
    const maxChars = parseInt(process.env['MAX_INPUT_CHARS'] || '120000', 10);

    if (totalChars > maxChars) {
      errors.push(createInputTooLargeError(totalChars, maxChars));
    }

    // Check temperature range
    if (data.temperature !== undefined) {
      if (data.temperature < 0 || data.temperature > 2) {
        errors.push(createInvalidRangeError('temperature', 0, 2, data.temperature));
      }
    }

    // Check maxTokens range
    if (data.maxTokens !== undefined) {
      const maxTokens = parseInt(process.env['MAX_OUTPUT_TOKENS'] || '4000', 10);
      if (data.maxTokens > maxTokens) {
        errors.push(createInvalidRangeError('maxTokens', 1, maxTokens, data.maxTokens));
      }
    }

    // Check timeout range
    if (data.timeoutMs !== undefined) {
      const maxTimeout = parseInt(process.env['ROUTER_TIMEOUT_MS'] || '45000', 10);
      if (data.timeoutMs > maxTimeout) {
        errors.push(createInvalidRangeError('timeoutMs', 1, maxTimeout, data.timeoutMs));
      }
    }

    if (errors.length > 0) {
      return validationFailure(errors);
    }

    return validationSuccess(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      for (const issue of error.errors) {
        const path = issue.path.join('.');

        if (issue.code === z.ZodIssueCode.invalid_type) {
          errors.push(createInvalidTypeError(path, issue.expected, issue.received));
        } else if (issue.code === z.ZodIssueCode.invalid_enum_value) {
          if (path.includes('role')) {
            errors.push(createInvalidRoleError(path.split('.')[1] || path));
          } else {
            errors.push(createValidationError(issue.message, path));
          }
        } else {
          errors.push(createValidationError(issue.message, path));
        }
      }
    } else {
      errors.push(createValidationError('Unknown validation error'));
    }

    return validationFailure(errors);
  }
}

/**
 * Validate list models request
 */
export function validateListModelsRequest(
  input: unknown
): ValidationResult<z.infer<typeof ListModelsRequestSchema>> {
  const errors: RouterError[] = [];

  try {
    const data = ListModelsRequestSchema.parse(input);
    return validationSuccess(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      for (const issue of error.errors) {
        const path = issue.path.join('.');
        errors.push(createValidationError(issue.message, path));
      }
    } else {
      errors.push(createValidationError('Unknown validation error'));
    }

    return validationFailure(errors);
  }
}

// ============================================================================
// Provider Response Validation
// ============================================================================

/**
 * Provider response schema (generic)
 */
export const ProviderResponseSchema = z.object({
  success: z.boolean(),
  data: z.unknown().optional(),
  error: z.string().optional(),
  provider: z.string(),
  model: z.string(),
  latencyMs: z.number().nonnegative(),
});

/**
 * Validated provider response structure
 */
export interface ValidatedProviderResponse {
  /** Whether response indicates success */
  success: boolean;

  /** Response data (if successful) */
  data:
    | {
        outputText: string;
        finishReason: string;
        usage?: {
          inputTokens?: number;
          outputTokens?: number;
          totalTokens?: number;
        };
      }
    | undefined;

  /** Error message (if failed) */
  error: string | undefined;

  /** Provider identifier */
  provider: string;

  /** Model identifier */
  model: string;

  /** Request latency */
  latencyMs: number;
}

/**
 * Validate provider response
 */
export function validateProviderResponse(
  response: unknown
): ValidationResult<ValidatedProviderResponse> {
  const errors: RouterError[] = [];

  try {
    const raw = ProviderResponseSchema.parse(response);

    if (!raw.success) {
      // This is a failed response, which is valid structure
      return validationSuccess({
        success: false,
        data: undefined,
        error: raw.error || 'Provider returned failure',
        provider: raw.provider,
        model: raw.model,
        latencyMs: raw.latencyMs,
      });
    }

    // Validate successful response data
    if (!raw.data || typeof raw.data !== 'object') {
      errors.push(createValidationError('Provider response is missing data field', 'data'));
      return validationFailure(errors);
    }

    const data = raw.data as Record<string, unknown>;

    // Validate output text
    if (typeof data['outputText'] !== 'string' || data['outputText'].trim().length === 0) {
      errors.push(
        createValidationError('Provider response is missing or empty outputText', 'outputText')
      );
    }

    // Validate finish reason
    if (typeof data['finishReason'] !== 'string' || data['finishReason'].trim().length === 0) {
      errors.push(
        createValidationError('Provider response is missing or empty finishReason', 'finishReason')
      );
    }

    if (errors.length > 0) {
      return validationFailure(errors);
    }

    return validationSuccess({
      success: true,
      data: {
        outputText: data['outputText'] as string,
        finishReason: data['finishReason'] as string,
        usage: data['usage'] as
          | {
              inputTokens?: number;
              outputTokens?: number;
              totalTokens?: number;
            }
          | undefined,
      },
      error: undefined,
      provider: raw.provider,
      model: raw.model,
      latencyMs: raw.latencyMs,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      for (const issue of error.errors) {
        const path = issue.path.join('.');
        errors.push(createValidationError(issue.message, path));
      }
    } else {
      errors.push(createValidationError('Unknown validation error'));
    }

    return validationFailure(errors);
  }
}

/**
 * Validate model info from provider
 */
export const ModelInfoSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  provider: z.string().min(1),
  capabilities: z.object({
    chat: z.boolean(),
    structured: z.boolean(),
    embeddings: z.boolean(),
    streaming: z.boolean(),
    vision: z.boolean(),
  }),
  maxContextTokens: z.number().int().positive().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
});

/**
 * Validate model info array
 */
export function validateModelInfo(
  models: unknown
): ValidationResult<z.infer<typeof ModelInfoSchema>[]> {
  const errors: RouterError[] = [];

  try {
    const data = z.array(ModelInfoSchema).parse(models);
    return validationSuccess(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      for (const issue of error.errors) {
        const path = issue.path.join('.');
        errors.push(createValidationError(issue.message, path));
      }
    } else {
      errors.push(createValidationError('Unknown validation error'));
    }

    return validationFailure(errors);
  }
}

// ============================================================================
// Policy Validation
// ============================================================================

/**
 * Validate provider against policy
 */
export function validateProviderAgainstPolicy(provider: string): ValidationResult {
  const errors: RouterError[] = [];
  const allowedProviders = process.env['ALLOWED_PROVIDERS']?.split(',').map((p) => p.trim()) || [];

  if (!allowedProviders.includes(provider)) {
    errors.push(
      createValidationError(`Provider '${provider}' is not in allowed providers list`, 'provider')
    );
  }

  if (errors.length > 0) {
    return validationFailure(errors);
  }

  return validationSuccess(undefined);
}

/**
 * Validate model against policy
 */
export function validateModelAgainstPolicy(model: string): ValidationResult {
  const errors: RouterError[] = [];
  const allowedModels = process.env['ALLOWED_MODELS']?.split(',').map((m) => m.trim()) || [];

  if (!allowedModels.includes(model)) {
    errors.push(createValidationError(`Model '${model}' is not in allowed models list`, 'model'));
  }

  if (errors.length > 0) {
    return validationFailure(errors);
  }

  return validationSuccess(undefined);
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Throw validation errors if validation failed
 */
export function throwIfInvalid<T>(
  result: ValidationResult<T>
): asserts result is ValidationResult<T> & { valid: true } {
  if (!result.valid) {
    if (result.errors.length === 1) {
      throw result.errors[0];
    }
    // Combine multiple errors
    const messages = result.errors.map((e) => e.message).join('; ');
    throw createValidationError(`Multiple validation errors: ${messages}`);
  }
}

/**
 * Get validated data or throw
 */
export function getValidatedData<T>(result: ValidationResult<T>): T {
  throwIfInvalid(result);
  return result.data!;
}
