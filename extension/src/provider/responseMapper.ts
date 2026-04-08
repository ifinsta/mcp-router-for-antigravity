import * as vscode from 'vscode';
import { ResponseMappingError } from '../infra/errors';
import { getLogger } from '../infra/logger';

const logger = getLogger('response-mapper');

/**
 * Detect if a streaming response chunk contains tool calls
 */
export function hasToolCalls(chunk: any): boolean {
  // Check for OpenAI/GLM format
  if (chunk.choices?.[0]?.delta?.tool_calls) {
    return true;
  }
  
  // Check for Claude format
  if (chunk.content_block?.type === 'tool_use') {
    return true;
  }
  
  return false;
}

/**
 * Extract tool calls from response chunk
 */
export function extractToolCalls(chunk: any, provider: string): any[] {
  try {
    // OpenAI/GLM format
    if (chunk.choices?.[0]?.delta?.tool_calls) {
      return chunk.choices[0].delta.tool_calls;
    }
    
    // Claude format
    if (chunk.content_block?.type === 'tool_use') {
      return [chunk.content_block];
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
export function extractTextFromChunk(chunk: any): string | null {
  try {
    // OpenAI/GLM format
    if (chunk.choices?.[0]?.delta?.content) {
      return chunk.choices[0].delta.content;
    }
    
    // Claude format
    if (chunk.delta?.text) {
      return chunk.delta.text;
    }
    
    return null;
  } catch (error) {
    logger.warn('Failed to extract text from chunk', error);
    return null;
  }
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

    throw new ResponseMappingError('Failed to stream response to Antigravity', error);
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
