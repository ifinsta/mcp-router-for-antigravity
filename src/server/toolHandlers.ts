/**
 * MCP Tool Handlers
 *
 * Implements tool handlers for llm.chat, llm.list_models, and router.health
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getLogger } from '../infra/logger.js';
import {
  NormalizedChatRequest,
  ListModelsRequest,
  NormalizedChatResponse,
  ListModelsResponse,
  HealthResponse,
} from '../core/types.js';
import {
  validateChatRequest,
  validateListModelsRequest,
  throwIfInvalid,
} from '../core/validation.js';
import {
  normalizeChatRequest,
  normalizeListModelsRequest,
  aggregateModelListings,
  normalizeChatResponse,
} from '../core/normalizer.js';
import { getRouter } from '../core/router.js';
import { isRouterError } from '../core/errors.js';

const logger = getLogger('tool-handlers');

/**
 * Generate a unique request ID
 */
function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

// Input schemas for tools
const ChatInputSchema = z.object({
  provider: z.string().optional(),
  model: z.string().optional(),
  messages: z.array(
    z.object({
      role: z.enum(['system', 'user', 'assistant']),
      content: z.string(),
      name: z.string().optional(),
    })
  ),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
  timeoutMs: z.number().int().positive().optional(),
  fallbackProvider: z.string().optional(),
  schema: z.record(z.unknown()).optional(),
});

const ListModelsInputSchema = z.object({
  provider: z.string().optional(),
});

const HealthInputSchema = z.object({});

/**
 * Register llm.chat tool
 */
export function registerLlmChatTool(server: McpServer): void {
  server.registerTool(
    'llm.chat',
    {
      title: 'LLM Chat',
      description: 'Execute a chat completion request through the MCP router',
      inputSchema: ChatInputSchema,
    },
    async (args) => {
      const requestId = generateRequestId();
      logger.info('llm.chat tool called', { requestId, args });

      try {
        const normalizedRequest = normalizeChatRequest(args);

        if (isRouterError(normalizedRequest)) {
          throw normalizedRequest;
        }

        const router = getRouter();
        const response = await router.executeChat(normalizedRequest);

        logger.info('llm.chat tool completed', {
          requestId,
          provider: response.provider,
          model: response.model,
          latencyMs: response.latencyMs,
          warningsCount: response.warnings.length,
          fallbackUsed: response.fallbackUsed,
        });

        const output: Record<string, unknown> = {
          outputText: response.outputText,
          provider: response.provider,
          model: response.model,
          finishReason: response.finishReason,
          latencyMs: response.latencyMs,
        };

        if (response.usage) {
          output['usage'] = response.usage;
        }

        if (response.warnings.length > 0) {
          output['warnings'] = response.warnings;
        }

        if (response.fallbackUsed) {
          output['fallbackUsed'] = true;
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(output, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error('llm.chat tool failed', error, { requestId });

        if (isRouterError(error)) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  {
                    error: true,
                    code: error.code,
                    message: error.message,
                    provider: error.provider,
                  },
                  null,
                  2
                ),
              },
            ],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  error: true,
                  message: error instanceof Error ? error.message : String(error),
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }
    }
  );

  logger.info('llm.chat tool registered');
}

/**
 * Register llm.list_models tool
 */
export function registerListModelsTool(server: McpServer): void {
  server.registerTool(
    'llm.list_models',
    {
      title: 'List LLM Models',
      description: 'List available LLM models from configured providers',
      inputSchema: ListModelsInputSchema,
    },
    async (args) => {
      const requestId = generateRequestId();
      logger.info('llm.list_models tool called', { requestId, args });

      try {
        const router = getRouter();
        const providerModels = await router.listModels(args.provider);

        logger.info('llm.list_models tool completed', {
          requestId,
          providerCount: providerModels.length,
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(providerModels, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error('llm.list_models tool failed', error, { requestId });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  error: true,
                  message: error instanceof Error ? error.message : String(error),
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }
    }
  );

  logger.info('llm.list_models tool registered');
}

/**
 * Register router.health tool
 */
export function registerRouterHealthTool(server: McpServer): void {
  server.registerTool(
    'router.health',
    {
      title: 'Router Health',
      description: 'Get router and provider health status',
      inputSchema: HealthInputSchema,
    },
    async (args) => {
      const requestId = generateRequestId();
      logger.info('router.health tool called', { requestId, args });

      try {
        const router = getRouter();
        const health = await router.checkHealth();

        logger.info('router.health tool completed', {
          requestId,
          status: health.status,
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(health, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error('router.health tool failed', error, { requestId });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  error: true,
                  message: error instanceof Error ? error.message : String(error),
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }
    }
  );

  logger.info('router.health tool registered');
}
