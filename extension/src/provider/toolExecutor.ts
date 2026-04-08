import * as vscode from 'vscode';
import { getLogger } from '../infra/logger';
import { sanitizeErrorMessage } from '../infra/errors';

const logger = getLogger('tool-executor');

/**
 * Result of executing a tool call
 */
export interface ToolExecutionResult {
  callId: string;
  toolName: string;
  success: boolean;
  result?: vscode.LanguageModelToolResult;
  error?: string;
}

/**
 * Executes tool calls via VS Code's lm.invokeTool API
 */
export class ToolExecutor {
  /**
   * Execute a single tool call
   */
  async executeToolCall(
    toolCall: vscode.LanguageModelToolCallPart,
    token: vscode.CancellationToken
  ): Promise<ToolExecutionResult> {
    const { callId, name, input } = toolCall;

    logger.info(`Executing tool: ${name} (${callId})`, { input });

    try {
      // Check if tool exists in registry
      const availableTools = vscode.lm.tools;
      const tool = availableTools.find((t) => t.name === name);

      if (!tool) {
        const error = `Tool '${name}' not found in registry. Available tools: ${availableTools.map((t) => t.name).join(', ')}`;
        logger.error(error);
        return {
          callId,
          toolName: name,
          success: false,
          error,
        };
      }

      // Invoke the tool
      const result = await vscode.lm.invokeTool(
        name,
        {
          input: input,
          toolInvocationToken: undefined, // Not in chat participant context
        },
        token
      );

      logger.info(`Tool execution successful: ${name} (${callId})`, {
        resultParts: result.content.length,
      });

      return {
        callId,
        toolName: name,
        success: true,
        result,
      };
    } catch (error) {
      const errorMessage = sanitizeErrorMessage(error);
      logger.error(`Tool execution failed: ${name} (${callId})`, error);

      return {
        callId,
        toolName: name,
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Execute multiple tool calls (can be parallel)
   */
  async executeMultipleToolCalls(
    toolCalls: vscode.LanguageModelToolCallPart[],
    token: vscode.CancellationToken
  ): Promise<ToolExecutionResult[]> {
    logger.info(`Executing ${toolCalls.length} tool calls`);

    // Execute all tool calls in parallel
    const promises = toolCalls.map((toolCall) => this.executeToolCall(toolCall, token));
    const results = await Promise.all(promises);

    const successCount = results.filter((r) => r.success).length;
    const failureCount = results.filter((r) => !r.success).length;

    logger.info(`Tool execution complete: ${successCount} succeeded, ${failureCount} failed`);

    return results;
  }

  /**
   * Convert tool execution results to VS Code message format
   */
  static createToolResultMessages(
    results: ToolExecutionResult[]
  ): vscode.LanguageModelChatMessage[] {
    return results.map((result) => {
      if (result.success && result.result) {
        // Successful tool execution
        return new vscode.LanguageModelChatMessage(
          vscode.LanguageModelChatMessageRole.User,
          [
            new vscode.LanguageModelToolResultPart(result.callId, result.result.content),
          ]
        );
      } else {
        // Failed tool execution - return error as text
        return new vscode.LanguageModelChatMessage(
          vscode.LanguageModelChatMessageRole.User,
          [
            new vscode.LanguageModelTextPart(
              `Tool '${result.toolName}' failed: ${result.error ?? 'Unknown error'}`
            ),
          ]
        );
      }
    });
  }

  /**
   * Get summary of tool execution for logging
   */
  static getExecutionSummary(results: ToolExecutionResult[]): string {
    const total = results.length;
    const success = results.filter((r) => r.success).length;
    const failed = total - success;

    const toolNames = results.map((r) => r.toolName).join(', ');

    return `Tools executed: ${success}/${total} succeeded (${toolNames})`;
  }
}
