/**
 * MCP Tool Handlers
 *
 * Implements tool handlers for llm_chat, llm_list_models, router_health,
 * router_cache, llm_consensus, llm_from_template, and llm_list_templates.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getLogger } from '../infra/logger.js';
import {
  NormalizedChatRequest,
  NormalizedChatResponse,
  ListModelsRequest,
  ListModelsResponse,
  HealthResponse,
  ConsensusRequest,
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
import { getResponseCache, generateCacheKey } from '../core/cache.js';
import { StructuredOutputProcessor, validateJsonOutput } from '../core/structuredOutput.js';
import { ConsensusEngine } from '../core/consensus.js';
import { getTemplateRegistry } from '../core/templates.js';
import { QualityGuardRunner, buildQualityRetryMessages } from '../core/qualityGuards.js';

const logger = getLogger('tool-handlers');

/**
 * Generate a unique request ID
 */
function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

// ============================================================================
// Shared error helpers
// ============================================================================

function routerErrorResponse(error: unknown) {
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

// ============================================================================
// Input schemas
// ============================================================================

const ChatInputSchema = z.object({
  provider: z
    .string()
    .optional()
    .describe('Provider to use (openai, glm, chutes, anthropic, azure-openai). Defaults to configured default provider.'),
  model: z
    .string()
    .describe('Model identifier. Use llm_list_models to see available models for each provider.'),
  messages: z
    .array(
      z.object({
        role: z.enum(['system', 'user', 'assistant']),
        content: z.string(),
        name: z.string().optional(),
      })
    )
    .describe('Conversation messages'),
  temperature: z.number().min(0).max(2).optional().describe('Sampling temperature (0-2)'),
  maxTokens: z.number().int().positive().optional().describe('Maximum tokens to generate'),
  timeoutMs: z.number().int().positive().optional().describe('Request timeout in milliseconds'),
  fallbackProvider: z.string().optional().describe('Fallback provider if primary fails'),
  schema: z.record(z.unknown()).optional().describe('JSON schema for structured output'),
  cache: z.object({
    enabled: z.boolean().optional(),
    ttlMs: z.number().int().positive().optional(),
  }).optional().describe('Response caching options'),
  responseFormat: z.enum(['text', 'json']).optional().describe('Response format. Use "json" for structured output with schema validation'),
  qualityGuards: z.object({
    enabled: z.boolean().optional(),
    guards: z.array(z.enum(['syntax', 'length', 'repetition', 'nonAnswer'])).optional(),
    minLength: z.number().int().positive().optional(),
  }).optional().describe('Output quality checks with auto-retry'),
});

const ListModelsInputSchema = z.object({
  provider: z
    .string()
    .optional()
    .describe('Filter models by provider (openai, glm, chutes, anthropic, azure-openai). If omitted, lists all models.'),
});

const HealthInputSchema = z.object({});

const CacheInputSchema = z.object({
  action: z.enum(['stats', 'clear', 'invalidate']).describe('Cache action to perform'),
  key: z.string().optional().describe('Cache key (required for invalidate action)'),
});

const ConsensusInputSchema = z.object({
  models: z.array(z.object({
    provider: z.string(),
    model: z.string(),
  })).min(2).max(4).describe('Models to query (2-4)'),
  messages: z.array(z.object({
    role: z.enum(['system', 'user', 'assistant']),
    content: z.string(),
    name: z.string().optional(),
  })).describe('Conversation messages'),
  temperature: z.number().min(0).max(2).optional().describe('Sampling temperature (0-2)'),
  maxTokens: z.number().int().positive().optional().describe('Maximum tokens to generate'),
  timeoutMs: z.number().int().positive().optional().describe('Per-model timeout in milliseconds'),
  strategy: z.enum(['all', 'fastest', 'best']).optional().default('all').describe('Selection strategy'),
});

const TemplateInputSchema = z.object({
  template: z.string().describe('Template name (use llm_list_templates to see available)'),
  vars: z.record(z.string()).describe('Template variables'),
  provider: z.string().optional().describe('Provider override'),
  model: z.string().optional().describe('Model override'),
  temperature: z.number().min(0).max(2).optional().describe('Sampling temperature (0-2)'),
  maxTokens: z.number().int().positive().optional().describe('Maximum tokens to generate'),
});

const ListTemplatesInputSchema = z.object({
  category: z.string().optional().describe('Filter templates by category'),
});

// ============================================================================
// llm_chat handler helpers
// ============================================================================

/** Maximum quality-guard retries */
const MAX_QUALITY_RETRIES = 2;

/**
 * Handle cache-aware, structured-output-aware, quality-guarded chat execution.
 */
async function executeChatWithFeatures(
  args: z.infer<typeof ChatInputSchema>,
  requestId: string,
): Promise<Record<string, unknown>> {
  const router = getRouter();
  const cache = getResponseCache();

  // Separate core chat fields from server-layer feature flags
  const {
    cache: cacheOptions,
    responseFormat,
    qualityGuards,
    ...chatArgs
  } = args;

  // Build normalized request from core fields only
  const normalizedRequest = normalizeChatRequest(chatArgs);
  if (isRouterError(normalizedRequest)) {
    throw normalizedRequest;
  }

  // ---- 1. Cache check ----
  let cacheHit = false;
  if (cacheOptions?.enabled) {
    const cacheKey = generateCacheKey(normalizedRequest);
    const cached = cache.get(cacheKey);
    if (cached !== undefined) {
      logger.info('llm_chat cache hit', { requestId });
      cacheHit = true;
      return buildChatOutput({ ...cached, cacheHit: true }, { cacheHit: true });
    }
  }

  // ---- 2. Execute (with structured output if json mode) ----
  let response: NormalizedChatResponse;
  let structuredOutput: Record<string, unknown> | unknown[] | null | undefined;
  let validationAttempts: number | undefined;

  if (responseFormat === 'json') {
    const processor = new StructuredOutputProcessor(
      (req: NormalizedChatRequest) => router.executeChat(req),
    );
    const { schema: _nrSchema, ...restNormalized } = normalizedRequest;
    const soRequest: NormalizedChatRequest & { responseFormat: 'json'; schema?: Record<string, unknown> } = {
      ...restNormalized,
      messages: normalizedRequest.messages,
      responseFormat: 'json' as const,
    };
    if (args.schema !== undefined && args.schema !== null) {
      soRequest.schema = args.schema as Record<string, unknown>;
    }
    const soResult = await processor.executeWithValidation(soRequest);
    response = soResult;
    structuredOutput = soResult.structuredOutput;
    validationAttempts = soResult.validationAttempts;
  } else {
    response = await router.executeChat(normalizedRequest);
  }

  // ---- 3. Quality guards ----
  let qualityRetries = 0;
  if (qualityGuards?.enabled) {
    const runner = new QualityGuardRunner({
      enabled: true,
      guards: qualityGuards.guards,
      minLength: qualityGuards.minLength,
    });

    let check = runner.runGuards(response.outputText);
    let retryMessages = normalizedRequest.messages;

    while (!check.passed && qualityRetries < MAX_QUALITY_RETRIES) {
      qualityRetries++;
      logger.info('Quality guard failed, retrying', { requestId, qualityRetries, failures: check.failures });

      retryMessages = buildQualityRetryMessages(retryMessages, check);
      response = await router.executeChat({ ...normalizedRequest, messages: retryMessages });
      check = runner.runGuards(response.outputText);
    }

    if (!check.passed) {
      response = {
        ...response,
        warnings: [...response.warnings, `Quality guards still failing after ${qualityRetries} retries: ${check.failures.join('; ')}`],
      };
    }
  }

  // ---- 4. Cache store ----
  if (cacheOptions?.enabled && response.finishReason !== 'error') {
    const cacheKey = generateCacheKey(normalizedRequest);
    cache.set(cacheKey, response, cacheOptions.ttlMs);
    logger.debug('Response cached', { requestId });
  }

  // ---- 5. Build output with metadata ----
  const metadata: Record<string, unknown> = {};
  if (cacheHit) metadata['cacheHit'] = true;
  if (structuredOutput !== undefined) metadata['structuredOutput'] = structuredOutput;
  if (validationAttempts !== undefined) metadata['validationAttempts'] = validationAttempts;
  if (qualityRetries > 0) metadata['qualityRetries'] = qualityRetries;

  return buildChatOutput(response, metadata);
}

function buildChatOutput(
  response: NormalizedChatResponse,
  extra: Record<string, unknown>,
): Record<string, unknown> {
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

  // Merge extra metadata
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined && value !== null) {
      output[key] = value;
    }
  }

  return output;
}

// ============================================================================
// Tool registration functions
// ============================================================================

/**
 * Register llm_chat tool
 */
export function registerLlmChatTool(server: McpServer): void {
  server.registerTool(
    'llm_chat',
    {
      title: 'LLM Chat',
      description:
        'Send a chat message to an LLM via MCP Router. Supports OpenAI, GLM (Z.AI), Chutes.ai, Anthropic, and Azure OpenAI providers. Supports response caching (cache option), structured JSON output (responseFormat "json"), and output quality guards with auto-retry. Requires model parameter - use llm_list_models to see available models.',
      inputSchema: ChatInputSchema,
    },
    async (args) => {
      const requestId = generateRequestId();
      logger.info('llm_chat tool called', { requestId, args });

      try {
        const output = await executeChatWithFeatures(args, requestId);

        logger.info('llm_chat tool completed', {
          requestId,
          provider: output['provider'],
          model: output['model'],
          latencyMs: output['latencyMs'],
          cacheHit: output['cacheHit'] ?? false,
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(output, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error('llm_chat tool failed', error, { requestId });
        return routerErrorResponse(error);
      }
    }
  );

  logger.info('llm_chat tool registered');
}

/**
 * Register llm_list_models tool
 */
export function registerListModelsTool(server: McpServer): void {
  server.registerTool(
    'llm_list_models',
    {
      title: 'List LLM Models',
      description: 'List available LLM models from all configured providers (OpenAI, GLM, Chutes.ai, Anthropic, Azure OpenAI)',
      inputSchema: ListModelsInputSchema,
    },
    async (args) => {
      const requestId = generateRequestId();
      logger.info('llm_list_models tool called', { requestId, args });

      try {
        const router = getRouter();
        const providerModels = await router.listModels(args.provider);

        logger.info('llm_list_models tool completed', {
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
        logger.error('llm_list_models tool failed', error, { requestId });
        return routerErrorResponse(error);
      }
    }
  );

  logger.info('llm_list_models tool registered');
}

/**
 * Register router_health tool
 */
export function registerRouterHealthTool(server: McpServer): void {
  server.registerTool(
    'router_health',
    {
      title: 'Router Health',
      description: 'Get router and provider health status',
      inputSchema: HealthInputSchema,
    },
    async (args) => {
      const requestId = generateRequestId();
      logger.info('router_health tool called', { requestId, args });

      try {
        const router = getRouter();
        const health = await router.checkHealth();

        logger.info('router_health tool completed', {
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
        logger.error('router_health tool failed', error, { requestId });
        return routerErrorResponse(error);
      }
    }
  );

  logger.info('router_health tool registered');
}

/**
 * Register router_cache tool
 */
export function registerRouterCacheTool(server: McpServer): void {
  server.registerTool(
    'router_cache',
    {
      title: 'Router Cache',
      description: 'Manage the response cache: get statistics, clear all entries, or invalidate a specific key',
      inputSchema: CacheInputSchema,
    },
    async (args) => {
      const requestId = generateRequestId();
      logger.info('router_cache tool called', { requestId, action: args.action });

      try {
        const cache = getResponseCache();

        switch (args.action) {
          case 'stats': {
            const stats = cache.getStats();
            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify(stats, null, 2),
                },
              ],
            };
          }

          case 'clear': {
            cache.clear();
            logger.info('Cache cleared', { requestId });
            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({ success: true, message: 'Cache cleared' }, null, 2),
                },
              ],
            };
          }

          case 'invalidate': {
            if (!args.key) {
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: JSON.stringify(
                      { error: true, message: 'key is required for invalidate action' },
                      null,
                      2
                    ),
                  },
                ],
                isError: true,
              };
            }

            const existed = cache.invalidate(args.key);
            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      found: existed,
                      message: existed ? 'Key invalidated' : 'Key not found in cache',
                    },
                    null,
                    2
                  ),
                },
              ],
            };
          }
        }
      } catch (error) {
        logger.error('router_cache tool failed', error, { requestId });
        return routerErrorResponse(error);
      }
    }
  );

  logger.info('router_cache tool registered');
}

/**
 * Register llm_consensus tool
 */
export function registerLlmConsensusTool(server: McpServer): void {
  server.registerTool(
    'llm_consensus',
    {
      title: 'LLM Consensus',
      description: 'Send the same prompt to multiple models in parallel and get quality-ranked responses. Useful for comparing outputs or picking the best answer.',
      inputSchema: ConsensusInputSchema,
    },
    async (args) => {
      const requestId = generateRequestId();
      logger.info('llm_consensus tool called', { requestId, modelCount: args.models.length, strategy: args.strategy });

      try {
        const router = getRouter();
        const engine = new ConsensusEngine(
          (req: NormalizedChatRequest) => router.executeChat(req),
        );

        const consensusRequest: ConsensusRequest = {
          models: args.models,
          messages: args.messages,
          temperature: args.temperature,
          maxTokens: args.maxTokens,
          timeoutMs: args.timeoutMs,
          strategy: args.strategy,
        };

        const result = await engine.execute(consensusRequest);

        logger.info('llm_consensus tool completed', {
          requestId,
          responseCount: result.responses.length,
          recommended: result.recommended,
          totalLatencyMs: result.totalLatencyMs,
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error('llm_consensus tool failed', error, { requestId });
        return routerErrorResponse(error);
      }
    }
  );

  logger.info('llm_consensus tool registered');
}

/**
 * Register llm_from_template tool
 */
export function registerLlmFromTemplateTool(server: McpServer): void {
  server.registerTool(
    'llm_from_template',
    {
      title: 'LLM From Template',
      description: 'Execute a chat request using a pre-defined prompt template. Templates provide optimized system/user prompts for common tasks. Use llm_list_templates to see available templates.',
      inputSchema: TemplateInputSchema,
    },
    async (args) => {
      const requestId = generateRequestId();
      logger.info('llm_from_template tool called', { requestId, template: args.template });

      try {
        const registry = getTemplateRegistry();
        const rendered = registry.render(args.template, args.vars);

        const router = getRouter();

        // Build request from rendered template + caller overrides
        const request: NormalizedChatRequest = {
          provider: args.provider,
          model: args.model ?? rendered.recommendedModel,
          messages: rendered.messages,
          temperature: args.temperature,
          maxTokens: args.maxTokens,
        };

        let response: NormalizedChatResponse;
        let structuredOutput: Record<string, unknown> | unknown[] | null | undefined;
        let validationAttempts: number | undefined;

        if (rendered.outputFormat === 'json') {
          const processor = new StructuredOutputProcessor(
            (req: NormalizedChatRequest) => router.executeChat(req),
          );
          const { schema: _tplSchema, ...restRequest } = request;
          const templateSoRequest: NormalizedChatRequest & { responseFormat: 'json'; schema?: Record<string, unknown> } = {
            ...restRequest,
            messages: request.messages,
            responseFormat: 'json' as const,
          };
          if (rendered.schema !== undefined) {
            templateSoRequest.schema = rendered.schema;
          }
          const soResult = await processor.executeWithValidation(templateSoRequest);
          response = soResult;
          structuredOutput = soResult.structuredOutput;
          validationAttempts = soResult.validationAttempts;
        } else {
          response = await router.executeChat(request);
        }

        const output: Record<string, unknown> = {
          outputText: response.outputText,
          provider: response.provider,
          model: response.model,
          finishReason: response.finishReason,
          latencyMs: response.latencyMs,
          template: args.template,
        };

        if (response.usage) {
          output['usage'] = response.usage;
        }

        if (response.warnings.length > 0) {
          output['warnings'] = response.warnings;
        }

        if (structuredOutput !== undefined) {
          output['structuredOutput'] = structuredOutput;
        }

        if (validationAttempts !== undefined) {
          output['validationAttempts'] = validationAttempts;
        }

        logger.info('llm_from_template tool completed', {
          requestId,
          template: args.template,
          provider: response.provider,
          model: response.model,
          latencyMs: response.latencyMs,
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(output, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error('llm_from_template tool failed', error, { requestId });
        return routerErrorResponse(error);
      }
    }
  );

  logger.info('llm_from_template tool registered');
}

/**
 * Register llm_list_templates tool
 */
export function registerLlmListTemplatesTool(server: McpServer): void {
  server.registerTool(
    'llm_list_templates',
    {
      title: 'List Prompt Templates',
      description: 'List available prompt templates. Templates provide optimized prompts for common tasks like code review, React components, unit tests, etc.',
      inputSchema: ListTemplatesInputSchema,
    },
    async (args) => {
      const requestId = generateRequestId();
      logger.info('llm_list_templates tool called', { requestId, category: args.category });

      try {
        const registry = getTemplateRegistry();
        let templates = registry.list();

        if (args.category) {
          templates = templates.filter((t) => t.category === args.category);
        }

        const summaries = templates.map((t) => ({
          name: t.name,
          description: t.description,
          category: t.category,
          variables: t.variables,
          outputFormat: t.outputFormat ?? 'text',
        }));

        logger.info('llm_list_templates tool completed', {
          requestId,
          templateCount: summaries.length,
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(summaries, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error('llm_list_templates tool failed', error, { requestId });
        return routerErrorResponse(error);
      }
    }
  );

  logger.info('llm_list_templates tool registered');
}
