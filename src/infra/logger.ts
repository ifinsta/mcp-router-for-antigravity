/**
 * Structured logger with redaction and request tracing
 *
 * Provides consistent logging across the application with:
 * - Structured log format
 * - Secret redaction
 * - Request ID support
 * - Log levels and filtering
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Log event structure
 */
export interface LogEvent {
  /** Timestamp in ISO format */
  timestamp: string;

  /** Log level */
  level: LogLevel;

  /** Message */
  message: string;

  /** Request ID for tracing */
  requestId?: string;

  /** Component or module emitting log */
  component?: string;

  /** Additional context */
  context?: Record<string, unknown>;

  /** Error details (if applicable) */
  error?: {
    code: string;
    message: string;
    stack?: string;
  };
}

/**
 * Logger configuration
 */
export interface LoggerConfig {
  /** Minimum log level to emit */
  minLevel: LogLevel;

  /** Component name (defaults to file/module) */
  component: string | undefined;

  /** Whether to include stack traces in errors */
  includeStackTrace: boolean;

  /** Whether to use colors (if terminal) */
  useColors: boolean | undefined;
}

/**
 * Logger interface
 */
export interface Logger {
  /** Debug level logging */
  debug(message: string, context?: Record<string, unknown>): void;

  /** Info level logging */
  info(message: string, context?: Record<string, unknown>): void;

  /** Warning level logging */
  warn(message: string, context?: Record<string, unknown>): void;

  /** Error level logging */
  error(message: string, error?: Error | unknown, context?: Record<string, unknown>): void;

  /** Create a child logger with component */
  withComponent(component: string): Logger;
}

/**
 * Log level priorities (higher = more important)
 */
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Should emit log based on level
 */
function shouldEmit(minLevel: LogLevel, eventLevel: LogLevel): boolean {
  return LOG_LEVEL_PRIORITY[eventLevel] >= LOG_LEVEL_PRIORITY[minLevel];
}

/**
 * Redact sensitive information from string
 */
function redactSensitive(input: string): string {
  if (typeof input !== 'string') {
    return input;
  }

  // Redact API keys (sk- prefix, long alphanumeric strings)
  let redacted = input.replace(/sk-[A-Za-z0-9]{20,}/gi, 'sk-[REDACTED]');

  // Redact Bearer tokens
  redacted = redacted.replace(/Bearer\s+[A-Za-z0-9\-._~+/]+/gi, 'Bearer [REDACTED]');

  // Redact password fields
  redacted = redacted.replace(/password["\s:=]+[^\s"]+/gi, 'password="[REDACTED]"');

  // Redact API key fields
  redacted = redacted.replace(/api[_-]?key["\s:=]+[A-Za-z0-9\-._~+/]+/gi, 'api_key="[REDACTED]"');

  // Redact secret fields
  redacted = redacted.replace(/secret["\s:=]+[A-Za-z0-9\-._~+/]+/gi, 'secret="[REDACTED]"');

  // Redact token fields
  redacted = redacted.replace(/token["\s:=]+[A-Za-z0-9\-._~+/]+/gi, 'token="[REDACTED]"');

  // Redact auth headers
  redacted = redacted.replace(/authorization["\s:=]+[^\s"]+/gi, 'authorization="[REDACTED]"');

  return redacted;
}

/**
 * Redact sensitive information from object
 */
function redactObject(obj: unknown): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === 'string') {
    return redactSensitive(obj);
  }

  if (typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(redactObject);
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    // Check if key suggests sensitive data
    const sensitiveKeys = [
      'password',
      'secret',
      'token',
      'apikey',
      'api_key',
      'authorization',
      'credential',
      'auth',
    ];

    const isSensitive = sensitiveKeys.some((sensitive) => key.toLowerCase().includes(sensitive));

    if (isSensitive) {
      result[key] = '[REDACTED]';
    } else {
      result[key] = redactObject(value);
    }
  }

  return result;
}

/**
 * Format log event for output
 */
function formatLogEvent(event: LogEvent): string {
  const parts: string[] = [];

  // Timestamp
  parts.push(`[${event.timestamp}]`);

  // Level
  parts.push(`[${event.level.toUpperCase().padEnd(5)}]`);

  // Component
  if (event.component) {
    parts.push(`[${event.component}]`);
  }

  // Request ID
  if (event.requestId) {
    parts.push(`[${event.requestId}]`);
  }

  // Message
  parts.push(redactSensitive(event.message));

  // Context
  if (event.context && Object.keys(event.context).length > 0) {
    const redactedContext = JSON.stringify(redactObject(event.context));
    parts.push(` | ${redactedContext}`);
  }

  // Error
  if (event.error) {
    parts.push(` | ${event.error.code}: ${redactSensitive(event.error.message)}`);
    if (event.error.stack && event.error.stack.length > 0) {
      parts.push(`\n${event.error.stack}`);
    }
  }

  return parts.join(' ');
}

/**
 * Create a logger instance
 */
export function createLogger(config: LoggerConfig): Logger {
  const minLevel = config.minLevel;

  const log = (
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>,
    error?: Error | unknown
  ) => {
    if (!shouldEmit(minLevel, level)) {
      return;
    }

    const event: LogEvent = {
      timestamp: new Date().toISOString(),
      level,
      message,
      component: config.component !== undefined ? config.component : undefined,
      context:
        context !== undefined
          ? (redactObject(context) as Record<string, unknown> | undefined)
          : undefined,
    };

    if (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      event.error = {
        code: 'ERROR',
        message: err.message,
        stack: config.includeStackTrace && err.stack !== undefined ? err.stack : undefined,
      };
    }

    const formatted = formatLogEvent(event);

    switch (level) {
      case 'debug':
      case 'info':
        console.log(formatted);
        break;
      case 'warn':
        console.warn(formatted);
        break;
      case 'error':
        console.error(formatted);
        break;
    }
  };

  const logger: Logger = {
    debug: (message: string, context?: Record<string, unknown>) => {
      log('debug', message, context);
    },

    info: (message: string, context?: Record<string, unknown>) => {
      log('info', message, context);
    },

    warn: (message: string, context?: Record<string, unknown>) => {
      log('warn', message, context);
    },

    error: (message: string, error?: Error | unknown, context?: Record<string, unknown>) => {
      log('error', message, context, error);
    },

    withComponent: (component: string): Logger => {
      return createLogger({
        ...config,
        component: component,
      });
    },
  };

  return logger;
}

/**
 * Get a logger for a module
 */
export function getLogger(component: string): Logger {
  const minLevel: LogLevel = (process.env['ROUTER_LOG_LEVEL'] as LogLevel) || 'info';

  return createLogger({
    minLevel,
    component,
    includeStackTrace: minLevel === 'debug',
    useColors: undefined,
  });
}
