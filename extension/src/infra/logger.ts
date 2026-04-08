import * as vscode from 'vscode';
import { getExtensionConfig } from '../config/settings';

/**
 * Log level enum for filtering
 */
enum LogLevel {
  Error = 0,
  Warn = 1,
  Info = 2,
  Debug = 3,
}

/**
 * Map string log level to our LogLevel enum
 */
function mapLogLevel(level: string): LogLevel {
  switch (level.toLowerCase()) {
    case 'error':
      return LogLevel.Error;
    case 'warn':
    case 'warning':
      return LogLevel.Warn;
    case 'info':
      return LogLevel.Info;
    case 'debug':
      return LogLevel.Debug;
    default:
      return LogLevel.Info;
  }
}

/**
 * Get the current configured log level
 */
function getConfiguredLogLevel(): LogLevel {
  try {
    const config = getExtensionConfig();
    return mapLogLevel(config.logLevel);
  } catch {
    return LogLevel.Info;
  }
}

/**
 * Extension logger using VS Code OutputChannel
 */
class ExtensionLogger {
  private outputChannel: vscode.LogOutputChannel;

  constructor(private module: string) {
    this.outputChannel = vscode.window.createOutputChannel('MCP Router', { log: true });
  }

  info(message: string, ...args: unknown[]): void {
    if (getConfiguredLogLevel() >= LogLevel.Info) {
      this.outputChannel.info(`[${this.module}] ${message}`, ...args);
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (getConfiguredLogLevel() >= LogLevel.Warn) {
      this.outputChannel.warn(`[${this.module}] ${message}`, ...args);
    }
  }

  error(message: string, ...args: unknown[]): void {
    if (getConfiguredLogLevel() >= LogLevel.Error) {
      this.outputChannel.error(`[${this.module}] ${message}`, ...args);
    }
  }

  debug(message: string, ...args: unknown[]): void {
    if (getConfiguredLogLevel() >= LogLevel.Debug) {
      this.outputChannel.debug(`[${this.module}] ${message}`, ...args);
    }
  }
}

const loggers = new Map<string, ExtensionLogger>();

/**
 * Get or create a logger for a specific module
 */
export function getLogger(module: string): ExtensionLogger {
  let logger = loggers.get(module);
  if (!logger) {
    logger = new ExtensionLogger(module);
    loggers.set(module, logger);
  }
  return logger;
}
