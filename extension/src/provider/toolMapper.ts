import * as vscode from 'vscode';
import { getLogger } from '../infra/logger';

const logger = getLogger('tool-mapper');

/**
 * OpenAI tool definition format
 */
export interface OpenAIToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: object;
  };
}

/**
 * GLM tool definition format (OpenAI-compatible)
 */
export interface GLMToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: object;
  };
}

/**
 * Claude tool definition format
 */
export interface ClaudeToolDefinition {
  name: string;
  description: string;
  input_schema: object;
}

/**
 * Union type for all provider tool formats
 */
export type ProviderToolDefinition = OpenAIToolDefinition | GLMToolDefinition | ClaudeToolDefinition;

/**
 * Maps VS Code LanguageModelChatTool to provider-specific formats
 */
export class ToolMapper {
  /**
   * Convert VS Code tools to OpenAI format
   */
  static toOpenAIFormat(tools: readonly vscode.LanguageModelChatTool[]): OpenAIToolDefinition[] {
    return tools.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema ?? {
          type: 'object',
          properties: {},
        },
      },
    }));
  }

  /**
   * Convert VS Code tools to GLM format (OpenAI-compatible)
   */
  static toGLMFormat(tools: readonly vscode.LanguageModelChatTool[]): GLMToolDefinition[] {
    // GLM uses same format as OpenAI
    return this.toOpenAIFormat(tools);
  }

  /**
   * Convert VS Code tools to Claude format
   */
  static toClaudeFormat(tools: readonly vscode.LanguageModelChatTool[]): ClaudeToolDefinition[] {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema ?? {
        type: 'object',
        properties: {},
      },
    }));
  }

  /**
   * Convert VS Code tools to provider format based on provider name
   */
  static toProviderFormat(
    provider: string,
    tools: readonly vscode.LanguageModelChatTool[]
  ): ProviderToolDefinition[] {
    switch (provider.toLowerCase()) {
      case 'openai':
        return this.toOpenAIFormat(tools);
      case 'glm':
        return this.toGLMFormat(tools);
      case 'anthropic':
      case 'claude':
        return this.toClaudeFormat(tools);
      default:
        logger.warn(`Unknown provider '${provider}', defaulting to OpenAI format`);
        return this.toOpenAIFormat(tools);
    }
  }

  /**
   * Convert provider tool call response to VS Code format
   */
  static fromProviderToolCall(
    provider: string,
    toolCall: any
  ): vscode.LanguageModelToolCallPart {
    switch (provider.toLowerCase()) {
      case 'openai':
      case 'glm':
        return this.fromOpenAIToolCall(toolCall);
      case 'anthropic':
      case 'claude':
        return this.fromClaudeToolCall(toolCall);
      default:
        logger.warn(`Unknown provider '${provider}', defaulting to OpenAI format`);
        return this.fromOpenAIToolCall(toolCall);
    }
  }

  /**
   * Convert OpenAI tool call to VS Code format
   */
  private static fromOpenAIToolCall(toolCall: any): vscode.LanguageModelToolCallPart {
    // OpenAI format: { id: "call_abc", type: "function", function: { name: "...", arguments: "..." } }
    const callId = toolCall.id ?? `call_${Date.now()}`;
    const name = toolCall.function?.name ?? 'unknown';
    const input = this.safeParseJSON(toolCall.function?.arguments ?? '{}');

    logger.debug(`Converted OpenAI tool call: ${name} (${callId})`);

    return new vscode.LanguageModelToolCallPart(callId, name, input);
  }

  /**
   * Convert Claude tool call to VS Code format
   */
  private static fromClaudeToolCall(toolCall: any): vscode.LanguageModelToolCallPart {
    // Claude format: { id: "toolu_abc", name: "...", input: {...} }
    const callId = toolCall.id ?? `call_${Date.now()}`;
    const name = toolCall.name ?? 'unknown';
    const input = toolCall.input ?? {};

    logger.debug(`Converted Claude tool call: ${name} (${callId})`);

    return new vscode.LanguageModelToolCallPart(callId, name, input);
  }

  /**
   * Safely parse JSON string, return empty object on failure
   */
  private static safeParseJSON(jsonString: string): any {
    try {
      return JSON.parse(jsonString);
    } catch (error) {
      logger.warn(`Failed to parse tool call arguments: ${jsonString}`, error);
      return {};
    }
  }

  /**
   * Get tool choice parameter for provider based on toolMode
   */
  static getToolChoice(
    provider: string,
    toolMode: vscode.LanguageModelChatToolMode,
    tools: readonly vscode.LanguageModelChatTool[]
  ): string | object | undefined {
    if (tools.length === 0) {
      return undefined;
    }

    switch (toolMode) {
      case vscode.LanguageModelChatToolMode.Auto:
        return 'auto';
      case vscode.LanguageModelChatToolMode.Required: {
        // Some providers require specific tool name when mode is "required"
        const firstTool = tools[0];
        if (!firstTool) {
          return 'auto';
        }
        
        if (tools.length === 1) {
          return provider.toLowerCase() === 'anthropic' || provider.toLowerCase() === 'claude'
            ? firstTool.name
            : { type: 'function', function: { name: firstTool.name } };
        }
        // Multiple tools with required mode
        return provider.toLowerCase() === 'anthropic' || provider.toLowerCase() === 'claude'
          ? 'any'
          : 'required';
      }
      default:
        return 'auto';
    }
  }
}
