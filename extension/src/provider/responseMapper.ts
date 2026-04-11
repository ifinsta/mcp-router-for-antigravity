import * as vscode from 'vscode';
import { RouterStreamChunk } from '../client/routerClient';
import { ResponseMappingError } from '../infra/errors';
import { getLogger } from '../infra/logger';

const logger = getLogger('response-mapper');

/**
 * Legacy provider chunk format (backward compat for old router versions)
 * @deprecated Use RouterStreamChunk instead
 */
interface LegacyProviderChunk {
  choices?: Array<{
    delta?: {
      content?: string;
      tool_calls?: Array<{
        id?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
  }>;
  content_block?: {
    type?: string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
  };
  delta?: {
    text?: string;
  };
}

/**
 * Detect if a streaming response chunk contains tool calls
 * Handles both new typed chunks and legacy provider formats
 */
export function hasToolCalls(chunk: RouterStreamChunk | LegacyProviderChunk): boolean {
  // New typed format
  if (isTypedChunk(chunk)) {
    return chunk.type === 'tool_call';
  }

  // Legacy OpenAI/GLM format
  if (chunk.choices?.[0]?.delta?.tool_calls) {
    return true;
  }
  
  // Legacy Claude format
  if (chunk.content_block?.type === 'tool_use') {
    return true;
  }
  
  return false;
}

/**
 * Extract tool calls from response chunk
 * Returns normalized tool call data
 */
export function extractToolCalls(
  chunk: RouterStreamChunk | LegacyProviderChunk,
  _provider: string
): Array<{ id: string; name: string; arguments: string }> {
  try {
    // New typed format
    if (isTypedChunk(chunk) && chunk.type === 'tool_call') {
      return [{
        id: chunk.toolCallId ?? 'unknown',
        name: chunk.toolCallName ?? 'unknown',
        arguments: chunk.toolCallArgs ?? '{}',
      }];
    }

    // Cast to legacy for remaining checks
    const legacy = chunk as LegacyProviderChunk;

    // Legacy OpenAI/GLM format
    if (legacy.choices?.[0]?.delta?.tool_calls) {
      return legacy.choices[0].delta.tool_calls
        .filter((tc) => tc.id)
        .map((tc) => ({
          id: tc.id!,
          name: tc.function?.name ?? 'unknown',
          arguments: tc.function?.arguments ?? '{}',
        }));
    }
    
    // Legacy Claude format
    if (legacy.content_block?.type === 'tool_use') {
      return [{
        id: legacy.content_block.id ?? 'unknown',
        name: legacy.content_block.name ?? 'unknown',
        arguments: JSON.stringify(legacy.content_block.input ?? {}),
      }];
    }
    
    return [];
  } catch (error) {
    logger.warn('Failed to extract tool calls from chunk', error);
    return [];
  }
}

/**
 * Extract text content from response chunk
 */
export function extractTextFromChunk(chunk: RouterStreamChunk | LegacyProviderChunk): string | null {
  try {
    // New typed format
    if (isTypedChunk(chunk) && chunk.type === 'text') {
      return chunk.content ?? null;
    }

    // Cast to legacy for remaining checks
    const legacy = chunk as LegacyProviderChunk;

    // Legacy OpenAI/GLM format
    if (legacy.choices?.[0]?.delta?.content) {
      return legacy.choices[0].delta.content;
    }
    
    // Legacy Claude format
    if (legacy.delta?.text) {
      return legacy.delta.text;
    }
    
    return null;
  } catch (error) {
    logger.warn('Failed to extract text from chunk', error);
    return null;
  }
}

/**
 * Type guard: check if chunk is in new typed format
 */
function isTypedChunk(chunk: RouterStreamChunk | LegacyProviderChunk): chunk is RouterStreamChunk {
  return 'type' in chunk && typeof (chunk as RouterStreamChunk).type === 'string';
}

/**
 * Stream router response chunks to VS Code progress callback
 */
export async function streamRouterResponse(
  textStream: AsyncIterable<string>,
  progress: vscode.Progress<vscode.LanguageModelResponsePart>,
  token: vscode.CancellationToken
): Promise<void> {
  try {
    let chunkIndex = 0;

    for await (const text of textStream) {
      // Check if cancellation was requested
      if (token.isCancellationRequested) {
        logger.info('Streaming cancelled by token');
        return;
      }

      if (text) {
        progress.report(new vscode.LanguageModelTextPart(text));
        chunkIndex++;
      }
    }

    logger.debug(`Streamed ${chunkIndex} chunks successfully`);
  } catch (error) {
    if (error instanceof ResponseMappingError) {
      throw error;
    }

    throw new ResponseMappingError('Failed to stream response to the editor client', error);
  }
}

/**
 * Map a complete (non-streamed) router response to VS Code format
 */
export function mapCompleteResponse(
  content: string,
  model: string
): vscode.LanguageModelTextPart {
  try {
    if (!content) {
      logger.warn('Received empty response content');
    }

    return new vscode.LanguageModelTextPart(content);
  } catch (error) {
    throw new ResponseMappingError('Failed to map router response', error);
  }
}
