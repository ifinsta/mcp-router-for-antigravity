import * as vscode from 'vscode';
import { RouterChatRequest } from '../client/routerClient';
import { RequestMappingError } from '../infra/errors';
import { getLogger } from '../infra/logger';
import { ToolMapper, ProviderToolDefinition } from './toolMapper';

const logger = getLogger('request-mapper');

/**
 * Parse model ID to extract provider and model name
 * Format: "provider:model-name" or just "model-name"
 */
export function parseModelId(modelId: string): { provider: string; model: string } {
  const parts = modelId.split(':');
  
  if (parts.length === 2) {
    const [provider, model] = parts;
    return { provider: provider ?? 'unknown', model: model ?? modelId };
  }
  
  // Default to openai if no provider specified
  return { provider: 'openai', model: modelId };
}

/**
 * Map VS Code language model chat messages to router request format
 */
export function mapToRouterRequest(
  model: vscode.LanguageModelChatInformation,
  messages: readonly vscode.LanguageModelChatRequestMessage[],
  options?: {
    tools?: readonly vscode.LanguageModelChatTool[];
    toolMode?: vscode.LanguageModelChatToolMode;
  }
): RouterChatRequest {
  try {
    const { provider, model: modelName } = parseModelId(model.id);

    const routerMessages = messages.map((msg, index) => {
      if (!msg) {
        throw new RequestMappingError(`Message at index ${index} is undefined`);
      }

      // Map role from VS Code enum to router string
      const role = mapRole(msg.role);

      // Extract text content from message
      const content = extractTextContent(msg.content as Array<vscode.LanguageModelInputPart>, index);

      return { role, content };
    });

    logger.debug(`Mapped ${messages.length} messages for model ${model.id}`);

    const request: RouterChatRequest = {
      model: modelName,
      provider,
      messages: routerMessages,
      stream: true, // Always stream for better UX
    };

    // Add tools if provided
    if (options?.tools && options.tools.length > 0) {
      const providerTools = ToolMapper.toProviderFormat(provider, options.tools);
      const toolChoice = ToolMapper.getToolChoice(
        provider,
        options.toolMode ?? vscode.LanguageModelChatToolMode.Auto,
        options.tools
      );

      request.tools = providerTools;
      
      if (toolChoice !== undefined) {
        request.tool_choice = toolChoice;
      }

      logger.info(`Including ${options.tools.length} tools in request for provider ${provider}`);
    }

    return request;
  } catch (error) {
    if (error instanceof RequestMappingError) {
      throw error;
    }
    
    throw new RequestMappingError('Failed to map messages to router format', error);
  }
}

/**
 * Map VS Code message role to router role string
 */
function mapRole(role: vscode.LanguageModelChatMessageRole): 'user' | 'assistant' | 'system' {
  switch (role) {
    case vscode.LanguageModelChatMessageRole.User:
      return 'user';
    case vscode.LanguageModelChatMessageRole.Assistant:
      return 'assistant';
    default:
      logger.warn(`Unknown message role: ${role}, defaulting to 'user'`);
      return 'user';
  }
}

/**
 * Extract text content from VS Code message content array
 */
function extractTextContent(
  content: Array<vscode.LanguageModelInputPart>,
  messageIndex: number
): string {
  const textParts: string[] = [];

  for (const part of content) {
    if (!part) {
      continue;
    }

    // Check if it's a text part
    if (part instanceof vscode.LanguageModelTextPart) {
      textParts.push(part.value);
    } else if (part instanceof vscode.LanguageModelToolResultPart) {
      // Include tool results as text
      const toolValue = (part as vscode.LanguageModelToolResultPart).content;
      textParts.push(JSON.stringify(toolValue));
    } else if (part instanceof vscode.LanguageModelToolCallPart) {
      // Include tool calls as text
      textParts.push(`[Tool Call: ${part.name}(${JSON.stringify(part.input)})]`);
    } else {
      logger.warn(`Unknown content part type at message ${messageIndex}:`, part);
    }
  }

  return textParts.join('\n');
}
