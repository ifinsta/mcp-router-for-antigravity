/**
 * Core domain types for MCP Router for Antigravity
 *
 * These are the normalized contracts that all internal components use.
 * Provider-specific types live in their respective adapters.
 */

// ============================================================================
// Normalized Request Types
// ============================================================================

/**
 * Normalized chat request format used internally
 * Provider-specific request formats are mapped to/from this
 */
export interface NormalizedChatRequest {
  /** Provider identifier (e.g., 'openai', 'glm', 'ollama') */
  provider?: string | undefined;

  /** Model identifier (e.g., 'gpt-4.1-mini', 'glm-4.5') */
  model?: string | undefined;

  /** Message array with standardized roles */
  messages: Array<{
    role: "system" | "user" | "assistant" | "tool";
    content: string;
    name?: string | undefined;
  }>;

  /** Temperature for generation (typically 0.0 to 2.0) */
  temperature?: number | undefined;

  /** Maximum tokens to generate */
  maxTokens?: number | undefined;

  /** Per-request timeout in milliseconds */
  timeoutMs?: number | undefined;

  /** Fallback provider to use if primary fails */
  fallbackProvider?: string | undefined;

  /** Optional schema for structured output (future expansion) */
  schema?: Record<string, unknown> | null | undefined;

  /** Optional metadata for tracing and sensitivity handling */
  metadata?: {
    requestId?: string | undefined;
    source?: string | undefined;
    sensitivity?: string | undefined;
  } | undefined;
}

/**
 * Request to list available models
 */
export interface ListModelsRequest {
  /** Optional provider filter */
  provider?: string | undefined;
}

// ============================================================================
// Normalized Response Types
// ============================================================================

/**
 * Normalized usage information
 */
export interface NormalizedUsage {
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  totalTokens?: number | undefined;
  /** Accuracy level of usage data */
  accuracy?: "exact" | "estimated" | "unavailable" | undefined;
}

/**
 * Normalized chat response format
 * All provider responses are normalized to this shape
 */
export interface NormalizedChatResponse {
  /** Actual provider that executed the request */
  provider: string;

  /** Actual model that executed the request */
  model: string;

  /** Generated text content */
  outputText: string;

  /** Reason generation stopped */
  finishReason: string;

  /** Token usage information */
  usage: NormalizedUsage | null;

  /** Total request latency in milliseconds */
  latencyMs: number;

  /** Estimated cost in USD */
  costEstimate: number | null;

  /** Warnings about degraded execution */
  warnings: string[];

  /** Whether fallback provider was used */
  fallbackUsed: boolean;

  /** Whether this response was served from cache */
  cacheHit?: boolean | undefined;
}

/**
 * Model information from provider
 */
export interface ModelInfo {
  /** Model identifier */
  id: string;

  /** Human-readable name */
  name: string;

  /** Provider that owns this model */
  provider: string;

  /** Capabilities of this model */
  capabilities: {
    chat: boolean;
    structured: boolean;
    embeddings: boolean;
    streaming: boolean;
    vision: boolean;
  };

  /** Maximum context window in tokens */
  maxContextTokens?: number | undefined;

  /** Maximum output tokens */
  maxOutputTokens?: number | undefined;
}

/**
 * Normalized list models response
 */
export interface ListModelsResponse {
  /** Models by provider */
  providers: Array<{
    provider: string;
    models: ModelInfo[];
    warnings: string[];
  }>;

  /** Aggregate warnings */
  warnings: string[];
}

/**
 * Cache statistics
 */
export interface CacheStats {
  /** Current number of entries */
  size: number;
  /** Maximum number of entries */
  maxSize: number;
  /** Total cache hits */
  hits: number;
  /** Total cache misses */
  misses: number;
  /** Hit rate (0.0 to 1.0) */
  hitRate: number;
  /** Total evictions */
  evictions: number;
}

// ============================================================================
// Provider Adapter Contract
// ============================================================================

/**
 * Provider capabilities declaration
 */
export interface ProviderCapabilities {
  chat: boolean;
  structured: boolean;
  embeddings: boolean;
  streaming: boolean;
  vision: boolean;
}

/**
 * Health status for a provider
 */
export interface ProviderHealthStatus {
  provider: string;
  status: "healthy" | "degraded" | "unhealthy" | "unknown";
  lastCheckAt: number;
  latencyMs?: number | undefined;
  error?: string | undefined;
}

/**
 * Core provider adapter interface
 * All providers must implement this contract
 */
export interface ProviderAdapter {
  /** Provider identifier */
  readonly name: string;

  /** Provider capabilities */
  readonly capabilities: ProviderCapabilities;

  /**
   * List available models from this provider
   */
  listModels(): Promise<ModelInfo[]>;

  /**
   * Execute a chat request
   */
  chat(request: NormalizedChatRequest): Promise<NormalizedChatResponse>;

  /**
   * Check provider health
   */
  healthCheck(): Promise<ProviderHealthStatus>;
}

// ============================================================================
// Error Taxonomy
// ============================================================================

/**
 * Error codes for classification and retry/fallback decisions
 */
export enum ErrorCode {
  // Validation errors
  VALIDATION_ERROR = "ValidationError",
  MISSING_REQUIRED_FIELD = "MissingRequiredField",
  INVALID_TYPE = "InvalidType",
  INVALID_RANGE = "InvalidRange",
  INVALID_ROLE = "InvalidRole",
  INPUT_TOO_LARGE = "InputTooLarge",

  // Policy errors
  POLICY_ERROR = "PolicyError",
  PROVIDER_NOT_ALLOWED = "ProviderNotAllowed",
  MODEL_NOT_ALLOWED = "ModelNotAllowed",
  COST_LIMIT_EXCEEDED = "CostLimitExceeded",

  // Configuration errors
  CONFIGURATION_ERROR = "ConfigurationError",
  MISSING_SECRET = "MissingSecret",
  INVALID_SECRET_FORMAT = "InvalidSecretFormat",

  // Authentication errors
  AUTHENTICATION_ERROR = "AuthenticationError",
  INVALID_CREDENTIALS = "InvalidCredentials",
  EXPIRED_CREDENTIALS = "ExpiredCredentials",

  // Timeout errors
  TIMEOUT_ERROR = "TimeoutError",
  REQUEST_TIMEOUT = "RequestTimeout",
  OPERATION_TIMEOUT = "OperationTimeout",

  // Network errors
  NETWORK_ERROR = "NetworkError",
  CONNECTION_FAILED = "ConnectionFailed",
  DNS_FAILURE = "DNSFailure",

  // Overload errors
  OVERLOAD_ERROR = "OverloadError",
  CONCURRENCY_LIMIT_EXCEEDED = "ConcurrencyLimitExceeded",
  QUEUE_FULL = "QueueFull",

  // Upstream errors
  UPSTREAM_ERROR = "UpstreamError",
  PROVIDER_FAILURE = "ProviderFailure",
  RATE_LIMITED = "RateLimited",
  UPSTREAM_TIMEOUT = "UpstreamTimeout",

  // Capability errors
  UNSUPPORTED_CAPABILITY = "UnsupportedCapability",
  FEATURE_NOT_SUPPORTED = "FeatureNotSupported",

  // Provider errors
  PROVIDER_NOT_FOUND = "ProviderNotFoundError",
  PROVIDER_UNAVAILABLE = "ProviderUnavailable",

  // Cancellation errors
  CANCELLED = "Cancelled",

  // Unknown errors
  UNKNOWN_ERROR = "UnknownError",
}

/**
 * Router error base interface
 */
export interface RouterError extends Error {
  /** Error code for classification */
  code: ErrorCode;

  /** Whether error is retryable */
  retryable: boolean;

  /** Provider that caused error (if applicable) */
  provider: string | undefined;

  /** Model that caused error (if applicable) */
  model: string | undefined;

  /** Underlying error (if any) */
  cause: Error | undefined;

  /** Additional context */
  context: Record<string, unknown> | undefined;
}

/**
 * Create a router error
 */
export function createRouterError(
  code: ErrorCode,
  message: string,
  options: {
    retryable?: boolean | undefined;
    provider?: string | undefined;
    model?: string | undefined;
    cause?: Error | undefined;
    context?: Record<string, unknown> | undefined;
  } = {},
): RouterError {
  const error = new Error(message) as RouterError;
  error.name = code;
  error.code = code;
  error.retryable = options.retryable ?? false;
  error.provider = options.provider;
  error.model = options.model;
  error.cause = options.cause;
  error.context = options.context;

  return error;
}

/**
 * Check if error code is retryable
 */
export function isRetryableError(code: ErrorCode): boolean {
  const retryableCodes = [
    ErrorCode.TIMEOUT_ERROR,
    ErrorCode.REQUEST_TIMEOUT,
    ErrorCode.NETWORK_ERROR,
    ErrorCode.CONNECTION_FAILED,
    ErrorCode.DNS_FAILURE,
    ErrorCode.UPSTREAM_ERROR,
    ErrorCode.RATE_LIMITED,
    ErrorCode.UPSTREAM_TIMEOUT,
  ];

  return retryableCodes.includes(code);
}

// ============================================================================
// Attempt History
// ============================================================================

/**
 * Phase of an attempt
 */
export enum AttemptPhase {
  PRIMARY = "primary",
  RETRY = "retry",
  FALLBACK = "fallback",
}

/**
 * Status of an attempt
 */
export enum AttemptStatus {
  SUCCESS = "success",
  FAILED = "failed",
  SKIPPED = "skipped",
  BLOCKED = "blocked",
}

/**
 * Circuit breaker state
 */
export enum CircuitBreakerState {
  CLOSED = "closed",
  OPEN = "open",
  HALF_OPEN = "half_open",
}

/**
 * Individual attempt record
 */
export interface AttemptRecord {
  /** Attempt sequence number (1-indexed) */
  attemptNumber: number;

  /** Provider used for this attempt */
  provider: string;

  /** Model used for this attempt */
  model: string;

  /** Phase of this attempt */
  phase: AttemptPhase;

  /** When attempt started (ms timestamp) */
  startedAtMs: number;

  /** When attempt ended (ms timestamp) */
  endedAtMs?: number | undefined;

  /** Final status */
  status: AttemptStatus;

  /** Error code if failed */
  errorCode?: string | undefined;

  /** Whether error was classified as retryable */
  retryable?: boolean | undefined;

  /** Circuit breaker state when attempt started */
  breakerState?: CircuitBreakerState | undefined;

  /** Warnings generated during attempt */
  warnings?: string[] | undefined;
}

/**
 * Complete attempt history for a request
 */
export interface AttemptHistory {
  /** All attempts made */
  attempts: AttemptRecord[];

  /** Final status of request */
  finalStatus: "success" | "failed";

  /** Total duration in milliseconds */
  totalDurationMs: number;

  /** Whether fallback was used */
  fallbackUsed: boolean;

  /** Number of retries attempted */
  retryCount: number;
}

// ============================================================================
// Health Status
// ============================================================================

/**
 * Overall router status
 */
export enum RouterStatus {
  HEALTHY = "healthy",
  DEGRADED = "degraded",
  UNHEALTHY = "unhealthy",
}

/**
 * Provider health summary
 */
export interface ProviderHealthSummary {
  /** Provider identifier */
  provider: string;

  /** Current status */
  status: ProviderHealthStatus["status"];

  /** Circuit breaker state */
  breakerState: CircuitBreakerState;

  /** Last check timestamp */
  lastCheckAt: number;

  /** Recent error rate (0.0 to 1.0) */
  recentErrorRate?: number | undefined;
}

/**
 * Configuration health
 */
export interface ConfigurationHealth {
  /** Overall config status */
  status: "valid" | "invalid" | "warnings";

  /** Configuration warnings */
  warnings: string[];

  /** Configuration errors */
  errors: string[];
}

/**
 * Discovery health
 */
export interface DiscoveryHealth {
  /** Overall discovery status */
  status: "healthy" | "degraded" | "failed";

  /** Provider discovery status by provider */
  providers: Array<{
    provider: string;
    status: "success" | "failed";
    modelCount?: number | undefined;
    error?: string | undefined;
  }>;

  /** Discovery warnings */
  warnings: string[];
}

/**
 * Execution path health
 */
export interface ExecutionHealth {
  /** Overall execution status */
  status: "healthy" | "degraded" | "failed";

  /** Active execution statistics */
  activeRequests: number;

  /** Concurrency utilization */
  concurrencyUtilization: number;

  /** Recent error rate */
  recentErrorRate?: number | undefined;

  /** Execution warnings */
  warnings: string[];
}

/**
 * Complete health response
 */
export interface HealthResponse {
  /** Overall router status */
  status: RouterStatus;

  /** Router version */
  version: string;

  /** Configuration health */
  config: ConfigurationHealth;

  /** Discovery health */
  discovery: DiscoveryHealth;

  /** Execution health */
  execution: ExecutionHealth;

  /** Provider health summary */
  providers: ProviderHealthSummary[];

  /** General warnings */
  warnings: string[];

  /** Metrics snapshot (when available) */
  metrics?: MetricsSnapshot | undefined;

  /** Response timestamp */
  timestamp: number;
}

/**
 * Metrics snapshot exposed through health endpoint
 */
export interface MetricsSnapshot {
  counters: {
    requestCount: number;
    successCount: number;
    failureCount: number;
    retryCount: number;
    fallbackCount: number;
    overloadRejectionCount: number;
  };
  gauges: {
    activeConcurrency: {
      global: number;
      providers: Record<string, number>;
    };
  };
  latency: {
    p50: number;
    p95: number;
    p99: number;
    min: number;
    max: number;
    count: number;
    mean: number;
  };
  breakerTransitions: Array<{
    provider: string;
    from: CircuitBreakerState;
    to: CircuitBreakerState;
    timestamp: number;
  }>;
  collectedSince: number;
}

// ============================================================================
// Policy Types
// ============================================================================

/**
 * Policy check result
 */
export interface PolicyCheckResult {
  /** Whether request is allowed */
  allowed: boolean;

  /** Reason for denial if not allowed */
  denialReason?: string | undefined;

  /** Warnings even if allowed */
  warnings: string[];
}

/**
 * Policy configuration
 */
export interface PolicyConfig {
  /** Allowed provider identifiers */
  allowedProviders: string[];

  /** Allowed model identifiers */
  allowedModels: string[];

  /** Maximum input characters */
  maxInputChars: number;

  /** Maximum output tokens */
  maxOutputTokens: number;

  /** Maximum cost per request in USD */
  maxCostUsdPerRequest?: number | undefined;
}

// ============================================================================
// Resilience Types
// ============================================================================

/**
 * Request budget configuration
 */
export interface RequestBudgetConfig {
  /** Total budget in milliseconds */
  totalBudgetMs: number;

  /** Minimum remaining budget for new attempt */
  minRemainingMs: number;
}

/**
 * Retry policy configuration
 */
export interface RetryPolicyConfig {
  /** Maximum attempts per request */
  maxAttempts: number;

  /** Base delay in milliseconds */
  baseDelayMs: number;

  /** Maximum delay in milliseconds */
  maxDelayMs: number;

  /** Backoff multiplier */
  backoffMultiplier: number;

  /** Jitter factor (0.0 to 1.0) */
  jitterFactor: number;

  /** Provider-specific retry rules */
  providerRules: Record<string, Partial<RetryPolicyConfig> | undefined>;
}

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  /** Number of failures before opening */
  failureThreshold: number;

  /** Cooldown period in milliseconds */
  cooldownMs: number;

  /** Half-open probe success count to close */
  halfOpenSuccessCount: number;

  /** Time window for failure rate calculation (ms) */
  failureRateWindowMs: number;
}

/**
 * Concurrency configuration
 */
export interface ConcurrencyConfig {
  /** Global concurrency limit */
  globalLimit: number;

  /** Per-provider limits */
  providerLimits: Record<string, number | undefined>;

  /** Queue size (0 = no queue, reject immediately) */
  queueSize: number;
}

// ============================================================================
// Structured Output Types
// ============================================================================

/**
 * Result of JSON validation
 */
export interface JsonValidationResult {
  /** Whether the JSON is valid */
  valid: boolean;
  /** Parsed JSON if valid */
  parsed: unknown | null;
  /** Extracted JSON string */
  rawJson: string | null;
  /** Parse/validation error message */
  error: string | null;
}

/**
 * Enhanced response with structured output
 */
export interface StructuredOutputResponse extends NormalizedChatResponse {
  /** Parsed JSON output, null if not in json mode */
  structuredOutput?: Record<string, unknown> | unknown[] | null | undefined;
  /** Number of validation attempts made */
  validationAttempts?: number | undefined;
}

// ============================================================================
// Prompt Template Types
// ============================================================================

/**
 * Definition of a reusable prompt template
 */
export interface PromptTemplate {
  /** Template identifier */
  name: string;
  /** Human-readable description */
  description: string;
  /** Template category (e.g., 'frontend', 'testing') */
  category: string;
  /** System prompt text (may contain {{variable}} placeholders) */
  systemPrompt: string;
  /** User prompt template (may contain {{variable}} placeholders) */
  userPromptTemplate: string;
  /** Required variable names for substitution */
  variables: string[];
  /** Recommended model for this template */
  recommendedModel?: string | undefined;
  /** Output format hint */
  outputFormat?: 'text' | 'json' | undefined;
  /** JSON schema for structured output validation */
  schema?: Record<string, unknown> | undefined;
}

/**
 * Result of rendering a prompt template with variable substitution
 */
export interface TemplateRenderResult {
  /** Rendered messages ready for chat execution */
  messages: NormalizedChatRequest['messages'];
  /** Output format for the rendered template */
  outputFormat: 'text' | 'json';
  /** JSON schema if template specifies one */
  schema?: Record<string, unknown> | undefined;
  /** Recommended model if template specifies one */
  recommendedModel?: string | undefined;
}

// ============================================================================
// Quality Guard Types
// ============================================================================

/**
 * Guard identifiers for quality checks
 */
export type QualityGuardName = 'syntax' | 'length' | 'repetition' | 'nonAnswer';

/**
 * Configuration for quality guards
 */
export interface QualityGuardConfig {
  /** Whether quality guards are enabled */
  enabled?: boolean | undefined;
  /** Which guards to run (default: all) */
  guards?: Array<QualityGuardName> | undefined;
  /** Minimum response length in characters (default: 20) */
  minLength?: number | undefined;
}

/**
 * Result of running quality guards on a response
 */
export interface QualityCheckResult {
  /** Whether all guards passed */
  passed: boolean;
  /** Human-readable failure descriptions */
  failures: string[];
  /** Correction hint for retry prompt */
  correctionHint: string;
  /** Names of guards that failed */
  failedGuards: string[];
}

// ============================================================================
// Consensus Types
// ============================================================================

/**
 * Target model for consensus execution
 */
export interface ConsensusModelTarget {
  provider: string;
  model: string;
}

/**
 * Request for multi-model consensus execution
 */
export interface ConsensusRequest {
  models: ConsensusModelTarget[];
  messages: NormalizedChatRequest['messages'];
  temperature?: number | undefined;
  maxTokens?: number | undefined;
  timeoutMs?: number | undefined;
  strategy: 'all' | 'fastest' | 'best';
}

/**
 * Individual result from one model in a consensus execution
 */
export interface ConsensusResult {
  provider: string;
  model: string;
  response: NormalizedChatResponse | null;
  error: string | null;
  latencyMs: number;
  qualityScore: number;
}

/**
 * Aggregated response from consensus execution
 */
export interface ConsensusResponse {
  responses: ConsensusResult[];
  recommended: number;
  totalLatencyMs: number;
  strategy: string;
}
