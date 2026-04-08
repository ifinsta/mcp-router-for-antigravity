/**
 * Typed error classes for extension error handling
 */

export class ExtensionError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'ExtensionError';
  }
}

export class RouterConnectionError extends ExtensionError {
  constructor(message: string, cause?: unknown) {
    super(message, 'ROUTER_CONNECTION_ERROR', cause);
    this.name = 'RouterConnectionError';
  }
}

export class RouterResponseError extends ExtensionError {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly responseBody?: string,
    cause?: unknown
  ) {
    super(message, 'ROUTER_RESPONSE_ERROR', cause);
    this.name = 'RouterResponseError';
  }
}

export class ModelCatalogError extends ExtensionError {
  constructor(message: string, cause?: unknown) {
    super(message, 'MODEL_CATALOG_ERROR', cause);
    this.name = 'ModelCatalogError';
  }
}

export class RequestMappingError extends ExtensionError {
  constructor(message: string, cause?: unknown) {
    super(message, 'REQUEST_MAPPING_ERROR', cause);
    this.name = 'RequestMappingError';
  }
}

export class ResponseMappingError extends ExtensionError {
  constructor(message: string, cause?: unknown) {
    super(message, 'RESPONSE_MAPPING_ERROR', cause);
    this.name = 'ResponseMappingError';
  }
}

/**
 * Type guard for checking if an error is an ExtensionError
 */
export function isExtensionError(error: unknown): error is ExtensionError {
  return error instanceof ExtensionError;
}

/**
 * Sanitize error message for display (remove sensitive information)
 */
export function sanitizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    // Remove potential secrets from error messages
    return error.message
      .replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]')
      .replace(/api[_-]?key[=:]\s*[^\s&]+/gi, 'api_key=[REDACTED]')
      .replace(/token[=:]\s*[^\s&]+/gi, 'token=[REDACTED]');
  }
  return String(error);
}
