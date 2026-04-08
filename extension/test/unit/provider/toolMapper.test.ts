import * as assert from 'assert';
import * as vscode from 'vscode';
import { describe, it } from 'node:test';
import { ToolMapper, OpenAIToolDefinition, ClaudeToolDefinition } from '../../../src/provider/toolMapper';

// Mock VS Code API for testing
const mockVSCodeTools: vscode.LanguageModelChatTool[] = [
  {
    name: 'browser_navigate',
    description: 'Navigate browser to a URL',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to navigate to' },
      },
      required: ['url'],
    },
  },
  {
    name: 'file_read',
    description: 'Read a file from workspace',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path' },
      },
      required: ['path'],
    },
  },
];

describe('ToolMapper', () => {
  describe('toOpenAIFormat', () => {
    it('should convert VS Code tools to OpenAI format', () => {
      const result = ToolMapper.toOpenAIFormat(mockVSCodeTools);

      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0].type, 'function');
      assert.strictEqual(result[0].function.name, 'browser_navigate');
      assert.strictEqual(result[0].function.description, 'Navigate browser to a URL');
      assert.deepStrictEqual(result[0].function.parameters, {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to navigate to' },
        },
        required: ['url'],
      });
    });

    it('should handle tools without inputSchema', () => {
      const toolsWithoutSchema: vscode.LanguageModelChatTool[] = [
        {
          name: 'simple_tool',
          description: 'A simple tool',
        },
      ];

      const result = ToolMapper.toOpenAIFormat(toolsWithoutSchema);

      assert.strictEqual(result.length, 1);
      assert.deepStrictEqual(result[0].function.parameters, {
        type: 'object',
        properties: {},
      });
    });

    it('should handle empty tools array', () => {
      const result = ToolMapper.toOpenAIFormat([]);
      assert.strictEqual(result.length, 0);
    });
  });

  describe('toGLMFormat', () => {
    it('should convert to GLM format (same as OpenAI)', () => {
      const result = ToolMapper.toGLMFormat(mockVSCodeTools);
      const openAIResult = ToolMapper.toOpenAIFormat(mockVSCodeTools);

      assert.deepStrictEqual(result, openAIResult);
    });
  });

  describe('toClaudeFormat', () => {
    it('should convert VS Code tools to Claude format', () => {
      const result = ToolMapper.toClaudeFormat(mockVSCodeTools);

      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0].name, 'browser_navigate');
      assert.strictEqual(result[0].description, 'Navigate browser to a URL');
      // Claude uses input_schema instead of parameters
      assert.deepStrictEqual((result[0] as ClaudeToolDefinition).input_schema, {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to navigate to' },
        },
        required: ['url'],
      });
    });

    it('should handle tools without inputSchema', () => {
      const toolsWithoutSchema: vscode.LanguageModelChatTool[] = [
        {
          name: 'simple_tool',
          description: 'A simple tool',
        },
      ];

      const result = ToolMapper.toClaudeFormat(toolsWithoutSchema);

      assert.strictEqual(result.length, 1);
      assert.deepStrictEqual((result[0] as ClaudeToolDefinition).input_schema, {
        type: 'object',
        properties: {},
      });
    });
  });

  describe('toProviderFormat', () => {
    it('should route to OpenAI format for openai provider', () => {
      const result = ToolMapper.toProviderFormat('openai', mockVSCodeTools);
      const expected = ToolMapper.toOpenAIFormat(mockVSCodeTools);

      assert.deepStrictEqual(result, expected);
    });

    it('should route to GLM format for glm provider', () => {
      const result = ToolMapper.toProviderFormat('glm', mockVSCodeTools);
      const expected = ToolMapper.toGLMFormat(mockVSCodeTools);

      assert.deepStrictEqual(result, expected);
    });

    it('should route to Claude format for anthropic provider', () => {
      const result = ToolMapper.toProviderFormat('anthropic', mockVSCodeTools);
      const expected = ToolMapper.toClaudeFormat(mockVSCodeTools);

      assert.deepStrictEqual(result, expected);
    });

    it('should route to Claude format for claude provider', () => {
      const result = ToolMapper.toProviderFormat('claude', mockVSCodeTools);
      const expected = ToolMapper.toClaudeFormat(mockVSCodeTools);

      assert.deepStrictEqual(result, expected);
    });

    it('should default to OpenAI format for unknown provider', () => {
      const result = ToolMapper.toProviderFormat('unknown', mockVSCodeTools);
      const expected = ToolMapper.toOpenAIFormat(mockVSCodeTools);

      assert.deepStrictEqual(result, expected);
    });
  });

  describe('fromProviderToolCall', () => {
    it('should convert OpenAI tool call to VS Code format', () => {
      const openAIToolCall = {
        id: 'call_abc123',
        type: 'function',
        function: {
          name: 'browser_navigate',
          arguments: JSON.stringify({ url: 'https://example.com' }),
        },
      };

      const result = ToolMapper.fromProviderToolCall('openai', openAIToolCall);

      assert.strictEqual(result.callId, 'call_abc123');
      assert.strictEqual(result.name, 'browser_navigate');
      assert.deepStrictEqual(result.input, { url: 'https://example.com' });
    });

    it('should convert Claude tool call to VS Code format', () => {
      const claudeToolCall = {
        id: 'toolu_xyz789',
        name: 'file_read',
        input: { path: '/path/to/file.txt' },
      };

      const result = ToolMapper.fromProviderToolCall('anthropic', claudeToolCall);

      assert.strictEqual(result.callId, 'toolu_xyz789');
      assert.strictEqual(result.name, 'file_read');
      assert.deepStrictEqual(result.input, { path: '/path/to/file.txt' });
    });

    it('should handle invalid JSON in OpenAI arguments', () => {
      const openAIToolCall = {
        id: 'call_invalid',
        type: 'function',
        function: {
          name: 'test_tool',
          arguments: 'invalid json{{{',
        },
      };

      const result = ToolMapper.fromProviderToolCall('openai', openAIToolCall);

      assert.strictEqual(result.callId, 'call_invalid');
      assert.strictEqual(result.name, 'test_tool');
      // Should default to empty object on parse failure
      assert.deepStrictEqual(result.input, {});
    });

    it('should handle missing fields in OpenAI tool call', () => {
      const incompleteToolCall = {
        id: 'call_incomplete',
      };

      const result = ToolMapper.fromProviderToolCall('openai', incompleteToolCall);

      assert.strictEqual(result.callId, 'call_incomplete');
      assert.strictEqual(result.name, 'unknown');
      assert.deepStrictEqual(result.input, {});
    });

    it('should generate callId if missing', () => {
      const toolCallWithoutId = {
        function: {
          name: 'test_tool',
          arguments: '{}',
        },
      };

      const result = ToolMapper.fromProviderToolCall('openai', toolCallWithoutId);

      assert.ok(result.callId.startsWith('call_'));
    });
  });

  describe('getToolChoice', () => {
    it('should return "auto" for Auto mode', () => {
      const result = ToolMapper.getToolChoice(
        'openai',
        vscode.LanguageModelChatToolMode.Auto,
        mockVSCodeTools
      );

      assert.strictEqual(result, 'auto');
    });

    it('should return tool name for Required mode with single tool (Claude)', () => {
      const singleTool = [mockVSCodeTools[0]];
      const result = ToolMapper.getToolChoice(
        'anthropic',
        vscode.LanguageModelChatToolMode.Required,
        singleTool
      );

      assert.strictEqual(result, 'browser_navigate');
    });

    it('should return tool object for Required mode with single tool (OpenAI)', () => {
      const singleTool = [mockVSCodeTools[0]];
      const result = ToolMapper.getToolChoice(
        'openai',
        vscode.LanguageModelChatToolMode.Required,
        singleTool
      );

      assert.deepStrictEqual(result, {
        type: 'function',
        function: { name: 'browser_navigate' },
      });
    });

    it('should return "any" for Required mode with multiple tools (Claude)', () => {
      const result = ToolMapper.getToolChoice(
        'claude',
        vscode.LanguageModelChatToolMode.Required,
        mockVSCodeTools
      );

      assert.strictEqual(result, 'any');
    });

    it('should return "required" for Required mode with multiple tools (OpenAI)', () => {
      const result = ToolMapper.getToolChoice(
        'openai',
        vscode.LanguageModelChatToolMode.Required,
        mockVSCodeTools
      );

      assert.strictEqual(result, 'required');
    });

    it('should return undefined for empty tools', () => {
      const result = ToolMapper.getToolChoice(
        'openai',
        vscode.LanguageModelChatToolMode.Auto,
        []
      );

      assert.strictEqual(result, undefined);
    });

    it('should default to "auto" for unknown toolMode', () => {
      const result = ToolMapper.getToolChoice(
        'openai',
        999 as vscode.LanguageModelChatToolMode,
        mockVSCodeTools
      );

      assert.strictEqual(result, 'auto');
    });
  });
});
