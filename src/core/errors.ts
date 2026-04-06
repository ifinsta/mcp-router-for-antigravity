/**
 * Error taxonomy and helper functions
 *
 * Provides typed error creation, classification, and sanitization
 */

import {
  ErrorCode,
  isRetryableError,
  createRouterError as baseCreateError,
  RouterError,
} from './types.js';

// Re-export types for convenience
export type { RouterError } from './types.js';
export { ErrorCode } from './types.js';

// ============================================================================
// Error Creation Helpers
// ============================================================================

/**
 * Create a validation error
 */
export function createValidationError(
  message: string,
  field?: string,
  value?: unknown
): RouterError {
  return baseCreateError(ErrorCode.VALIDATION_ERROR, message, {
    retryable: false,
    context: field !== undefined ? { field, value } : undefined,
  });
}

/**
 * Create a missing field error
 */
export function createMissingFieldError(field: string): RouterError {
  return baseCreateError(ErrorCode.MISSING_REQUIRED_FIELD, `Missing required field: ${field}`, {
    retryable: false,
    context: { field },
  });
}

/**
 * Create an invalid type error
 */
export function createInvalidTypeError(
  field: string,
  expectedType: string,
  actualType: string
): RouterError {
  return baseCreateError(
    ErrorCode.INVALID_TYPE,
    `Invalid type for field '${field}': expected ${expectedType}, got ${actualType}`,
    {
      retryable: false,
      context: { field, expectedType, actualType },
    }
  );
}

/**
 * Create an invalid range error
 */
export function createInvalidRangeError(
  field: string,
  actual: number,
  min?: number,
  max?: number
): RouterError {
  const range = min !== undefined && max !== undefined ? `[${min}, ${max}]` : `${min ?? 0}+`;
  return baseCreateError(
    ErrorCode.INVALID_RANGE,
    `Invalid value for field '${field}': expected range ${range}, got ${actual}`,
    {
      retryable: false,
      context: { field, min, max, actual },
    }
  );
}

/**
 * Create an invalid role error
 */
export function createInvalidRoleError(role: string): RouterError {
  return baseCreateError(
    ErrorCode.INVALID_ROLE,
    `Invalid message role: '${role}'. Valid roles are: system, user, assistant, tool`,
    {
      retryable: false,
      context: { role },
    }
  );
}

/**
 * Create an input too large error
 */
export function createInputTooLargeError(
  actualSize: number,
  maxSize: number,
  unit: string = 'characters'
): RouterError {
  return baseCreateError(
    ErrorCode.INPUT_TOO_LARGE,
    `Input size ${actualSize} exceeds maximum ${maxSize} ${unit}`,
    {
      retryable: false,
      context: { actualSize, maxSize, unit },
    }
  );
}

/**
 * Create a policy error
 */
export function createPolicyError(message: string, reason?: string): RouterError {
  const fullMessage = reason ? `${message}: ${reason}` : message;
  return baseCreateError(ErrorCode.POLICY_ERROR, fullMessage, {
    retryable: false,
  });
}

/**
 * Create a provider not allowed error
 */
export function createProviderNotAllowedError(provider: string): RouterError {
  return baseCreateError(ErrorCode.PROVIDER_NOT_ALLOWED, `Provider '${provider}' is not allowed`, {
    retryable: false,
    context: { provider },
  });
}

/**
 * Create a model not allowed error
 */
export function createModelNotAllowedError(model: string): RouterError {
  return baseCreateError(ErrorCode.MODEL_NOT_ALLOWED, `Model '${model}' is not allowed`, {
    retryable: false,
    context: { model },
  });
}

/**
 * Create a cost limit exceeded error
 */
export function createCostLimitExceededError(estimatedCost: number, maxCost: number): RouterError {
  return baseCreateError(
    ErrorCode.COST_LIMIT_EXCEEDED,
    `Estimated cost $${estimatedCost.toFixed(2)} exceeds maximum $${maxCost.toFixed(2)}`,
    {
      retryable: false,
      context: { estimatedCost, maxCost },
    }
  );
}

/**
 * Create a configuration error
 */
export function createConfigurationError(message: string): RouterError {
  return baseCreateError(ErrorCode.CONFIGURATION_ERROR, `Configuration error: ${message}`, {
    retryable: false,
  });
}

/**
 * Create a missing secret error
 */
export function createMissingSecretError(secretName: string): RouterError {
  return baseCreateError(ErrorCode.MISSING_SECRET, `Missing required secret: ${secretName}`, {
    retryable: false,
    context: { secretName },
  });
}

/**
 * Create an authentication error
 */
export function createAuthenticationError(provider: string, message: string): RouterError {
  return baseCreateError(
    ErrorCode.AUTHENTICATION_ERROR,
    `Authentication failed for ${provider}: ${message}`,
    {
      retryable: false,
      provider,
    }
  );
}

/**
 * Create a timeout error
 */
export function createTimeoutError(
  provider: string,
  operation: string,
  timeoutMs: number
): RouterError {
  return baseCreateError(
    ErrorCode.TIMEOUT_ERROR,
    `Operation '${operation}' for provider '${provider}' timed out after ${timeoutMs}ms`,
    {
      retryable: true,
      provider,
      context: { operation, timeoutMs },
    }
  );
}

/**
 * Create a network error
 */
export function createNetworkError(provider: string, message: string, cause?: Error): RouterError {
  return baseCreateError(ErrorCode.NETWORK_ERROR, `Network error for ${provider}: ${message}`, {
    retryable: true,
    provider,
    cause,
  });
}

/**
 * Create an overload error
 */
export function createOverloadError(type: 'concurrency' | 'queue', limit: number): RouterError {
  return baseCreateError(
    ErrorCode.OVERLOAD_ERROR,
    `Router overloaded: ${type} limit ${limit} exceeded`,
    {
      retryable: false,
      context: { type, limit },
    }
  );
}

/**
 * Create an upstream error
 */
export function createUpstreamError(provider: string, message: string, cause?: Error): RouterError {
  return baseCreateError(ErrorCode.UPSTREAM_ERROR, `Upstream error from ${provider}: ${message}`, {
    retryable: true,
    provider,
    cause,
  });
}

/**
 * Create a rate limited error
 */
export function createRateLimitedError(provider: string): RouterError {
  return baseCreateError(ErrorCode.RATE_LIMITED, `Rate limited by provider '${provider}'`, {
    retryable: true,
    provider,
  });
}

/**
 * Create an unsupported capability error
 */
export function createUnsupportedCapabilityError(
  provider: string,
  capability: string
): RouterError {
  return baseCreateError(
    ErrorCode.UNSUPPORTED_CAPABILITY,
    `Provider '${provider}' does not support capability '${capability}'`,
    {
      retryable: false,
      provider,
      context: { capability },
    }
  );
}

/**
 * Create a provider not found error
 */
export function createProviderNotFoundError(provider: string): RouterError {
  return baseCreateError(ErrorCode.PROVIDER_NOT_FOUND, `Provider '${provider}' not found`, {
    retryable: false,
    context: { provider },
  });
}

/**
 * Create a provider unavailable error
 */
export function createProviderUnavailableError(provider: string, reason?: string): RouterError {
  const message = reason
    ? `Provider '${provider}' is unavailable: ${reason}`
    : `Provider '${provider}' is unavailable`;

  return baseCreateError(ErrorCode.PROVIDER_UNAVAILABLE, message, {
    retryable: true,
    provider,
  });
}

/**
 * Create a cancelled error
 */
export function createCancelledError(reason?: string): RouterError {
  return baseCreateError(ErrorCode.CANCELLED, reason || 'Request was cancelled', {
    retryable: false,
  });
}

/**
 * Create an unknown error
 */
export function createUnknownError(
  message: string,
  cause?: Error,
  context?: Record<string, unknown>
): RouterError {
  return baseCreateError(ErrorCode.UNKNOWN_ERROR, message, {
    retryable: false,
    cause,
    context,
  });
}

// ============================================================================
// Error Classification Helpers
// ============================================================================

/**
 * Check if an error is a RouterError
 */
export function isRouterError(error: unknown): error is RouterError {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    'message' in error &&
    typeof error.message === 'string'
  );
}

/**
 * Check if an error should trigger a retry
 */
export function shouldRetry(error: RouterError): boolean {
  // If error explicitly sets retryable, use that
  if (error.retryable !== undefined) {
    return error.retryable;
  }

  // Otherwise check if error code is retryable
  return isRetryableError(error.code);
}

/**
 * Check if an error should trigger a circuit breaker
 */
export function shouldTriggerBreaker(error: RouterError): boolean {
  const breakerTriggeringCodes = [
    ErrorCode.TIMEOUT_ERROR,
    ErrorCode.NETWORK_ERROR,
    ErrorCode.UPSTREAM_ERROR,
    ErrorCode.RATE_LIMITED,
    ErrorCode.PROVIDER_UNAVAILABLE,
  ];

  return breakerTriggeringCodes.includes(error.code);
}

/**
 * Get a user-safe error message
 */
export function getUserSafeErrorMessage(error: RouterError): string {
  // Return the original message, which should already be sanitized
  return error.message;
}

/**
 * Get an internal debugging message with context
 */
export function getDebugErrorMessage(error: RouterError): string {
  let message = `[${error.code}] ${error.message}`;

  if (error.provider) {
    message += ` (provider: ${error.provider})`;
  }

  if (error.model) {
    message += ` (model: ${error.model})`;
  }

  if (error.cause) {
    message += ` (cause: ${error.cause.message})`;
  }

  if (error.context && Object.keys(error.context).length > 0) {
    message += ` (context: ${JSON.stringify(error.context)})`;
  }

  return message;
}

// ============================================================================
// Error Sanitization
// ============================================================================

/**
 * Sanitize an upstream error by removing sensitive information
 */
export function sanitizeUpstreamError(error: Error | string): string {
  const message = typeof error === 'string' ? error : error.message;

  // Remove potential secrets (API keys, tokens, etc.)
  const sanitized = message
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+/gi, 'Bearer [REDACTED]')
    .replace(/sk-[A-Za-z0-9]{20,}/gi, 'sk-[REDACTED]')
    .replace(/api[_-]?key["\s:=]+[A-Za-z0-9\-._~+/]+/gi, 'api_key=[REDACTED]')
    .replace(/token["\s:=]+[A-Za-z0-9\-._~+/]+/gi, 'token=[REDACTED]')
    .replace(/password["\s:=]+[^\s"]+/gi, 'password=[REDACTED]');

  return sanitized;
}

/**
 * Create an error from an upstream error
 */
export function createFromUpstreamError(
  provider: string,
  upstreamError: Error | string,
  defaultCode: ErrorCode = ErrorCode.UPSTREAM_ERROR
): RouterError {
  const sanitizedMessage = sanitizeUpstreamError(upstreamError);
  const error = typeof upstreamError === 'string' ? new Error(upstreamError) : upstreamError;

  return baseCreateError(defaultCode, sanitizedMessage, {
    retryable: isRetryableError(defaultCode),
    provider,
    cause: error,
  });
}
