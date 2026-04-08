import * as assert from 'assert';
import * as vscode from 'vscode';
import { ToolExecutor, ToolExecutionResult } from '../../../src/provider/toolExecutor';
import { describe, it } from 'node:test';

// Note: These tests require mocking VS Code's lm API
// For now, we'll test the utility functions and structure

describe('ToolExecutor', () => {
  describe('createToolResultMessages', () => {
    it('should create user message for successful tool execution', () => {
      const results: ToolExecutionResult[] = [
        {
          callId: 'call_123',
          toolName: 'test_tool',
          success: true,
          result: {
            content: [new vscode.LanguageModelTextPart('Tool executed successfully')],
          },
        },
      ];

      const messages = ToolExecutor.createToolResultMessages(results);

      assert.strictEqual(messages.length, 1);
      // Message should be User role
      assert.strictEqual(messages[0].role, vscode.LanguageModelChatMessageRole.User);
    });

    it('should create user message for failed tool execution', () => {
      const results: ToolExecutionResult[] = [
        {
          callId: 'call_456',
          toolName: 'failing_tool',
          success: false,
          error: 'Tool execution failed',
        },
      ];

      const messages = ToolExecutor.createToolResultMessages(results);

      assert.strictEqual(messages.length, 1);
      assert.strictEqual(messages[0].role, vscode.LanguageModelChatMessageRole.User);
    });

    it('should handle multiple tool results', () => {
      const results: ToolExecutionResult[] = [
        {
          callId: 'call_1',
          toolName: 'tool_1',
          success: true,
          result: {
            content: [new vscode.LanguageModelTextPart('Result 1')],
          },
        },
        {
          callId: 'call_2',
          toolName: 'tool_2',
          success: false,
          error: 'Error 2',
        },
      ];

      const messages = ToolExecutor.createToolResultMessages(results);

      assert.strictEqual(messages.length, 2);
    });
  });

  describe('getExecutionSummary', () => {
    it('should generate summary for all successful tools', () => {
      const results: ToolExecutionResult[] = [
        {
          callId: 'call_1',
          toolName: 'tool_1',
          success: true,
        },
        {
          callId: 'call_2',
          toolName: 'tool_2',
          success: true,
        },
      ];

      const summary = ToolExecutor.getExecutionSummary(results);

      assert.ok(summary.includes('2/2 succeeded'));
      assert.ok(summary.includes('tool_1'));
      assert.ok(summary.includes('tool_2'));
    });

    it('should generate summary for mixed results', () => {
      const results: ToolExecutionResult[] = [
        {
          callId: 'call_1',
          toolName: 'tool_1',
          success: true,
        },
        {
          callId: 'call_2',
          toolName: 'tool_2',
          success: false,
          error: 'Failed',
        },
      ];

      const summary = ToolExecutor.getExecutionSummary(results);

      assert.ok(summary.includes('1/2 succeeded'));
    });

    it('should handle empty results', () => {
      const results: ToolExecutionResult[] = [];
      const summary = ToolExecutor.getExecutionSummary(results);

      assert.ok(summary.includes('0/0 succeeded'));
    });
  });
});
