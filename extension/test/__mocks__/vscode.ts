/**
 * Minimal vscode API mock for unit testing outside VS Code.
 *
 * Only the surface area actually exercised by the extension source
 * files and their tests is implemented here.
 */

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export enum LanguageModelChatMessageRole {
  User = 1,
  Assistant = 2,
  System = 3,
}

export enum LanguageModelChatToolMode {
  Auto = 1,
  Required = 2,
}

// ---------------------------------------------------------------------------
// Classes – Language Model primitives
// ---------------------------------------------------------------------------

export class LanguageModelTextPart {
  readonly value: string;
  constructor(value: string) {
    this.value = value;
  }
}

export class LanguageModelToolResultPart {
  readonly callId: string;
  readonly content: unknown[];
  constructor(callId: string, content: unknown[]) {
    this.callId = callId;
    this.content = content;
  }
}

export class LanguageModelToolCallPart {
  readonly callId: string;
  readonly name: string;
  readonly input: unknown;
  constructor(callId: string, name: string, input: unknown) {
    this.callId = callId;
    this.name = name;
    this.input = input;
  }
}

export class LanguageModelChatMessage {
  readonly role: LanguageModelChatMessageRole;
  readonly content: unknown[];
  constructor(role: LanguageModelChatMessageRole, content: unknown[]) {
    this.role = role;
    this.content = content;
  }
}

// ---------------------------------------------------------------------------
// Utility classes
// ---------------------------------------------------------------------------

export class EventEmitter {
  event = () => ({ dispose: () => {} });
  fire(): void {}
  dispose(): void {}
}

// ---------------------------------------------------------------------------
// Namespace-level singletons
// ---------------------------------------------------------------------------

/** vscode.lm */
export const lm = {
  tools: [] as unknown[],
  invokeTool: async (): Promise<{ content: unknown[] }> => ({ content: [] }),
};

/** vscode.window – only the subset used by the extension */
export const window = {
  createOutputChannel: (_name: string, _options?: unknown) => ({
    info: (..._args: unknown[]): void => {},
    warn: (..._args: unknown[]): void => {},
    error: (..._args: unknown[]): void => {},
    debug: (..._args: unknown[]): void => {},
    appendLine: (): void => {},
    append: (): void => {},
    clear: (): void => {},
    show: (): void => {},
    hide: (): void => {},
    dispose: (): void => {},
  }),
  showInformationMessage: async (): Promise<undefined> => undefined,
  showErrorMessage: async (): Promise<undefined> => undefined,
  showWarningMessage: async (): Promise<undefined> => undefined,
};

/** vscode.workspace */
export const workspace = {
  getConfiguration: (_section?: string) => ({
    get: <T>(_key: string, defaultValue?: T): T | undefined => defaultValue,
    has: (): boolean => false,
    inspect: (): undefined => undefined,
    update: async (): Promise<void> => {},
  }),
};

/** vscode.commands */
export const commands = {
  registerCommand: (): { dispose: () => void } => ({ dispose: () => {} }),
  executeCommand: async (): Promise<undefined> => undefined,
};

/** vscode.Uri */
export const Uri = {
  parse: (value: string) => ({
    toString: () => value,
    scheme: 'https',
    path: value,
  }),
  file: (path: string) => ({
    toString: () => `file://${path}`,
    scheme: 'file',
    path,
  }),
};
