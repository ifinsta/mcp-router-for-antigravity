# Unified Implementation Plan: Tool Proxy + Long-Horizon Tasks

## Executive Summary

**Goal**: Build a production-grade MCP system that:
1. ✅ Gives custom models full access to Antigravity's tools (browser, files, terminal)
2. ✅ Supports long-horizon autonomous tasks (30 min → 6+ hours)
3. ✅ Stays under cost control ($5-25 per task)
4. ✅ Recovers from crashes and network failures
5. ✅ Suitable for complete frontend engineering assignments

**Timeline**: 3-4 weeks parallel development
**Investment**: $2000-3000 (dev time)
**Expected ROI**: Payback in ~1 month

---

## Architecture Overview

### The Complete System

```
┌─────────────────────────────────────────────────────────────┐
│                    Antigravity Chat UI                       │
│                                                              │
│  User: "Build a React dashboard with auth" (6-hour task)    │
│  Tools: [@browser, @workspace, @terminal, @vscode]          │
└────────────────────┬────────────────────────────────────────┘
                     │
                     │ messages + tools + task config
                     ▼
┌─────────────────────────────────────────────────────────────┐
│              Extension (VS Code API Layer)                   │
│                                                              │
│  ┌──────────────────┐  ┌──────────────────────────┐        │
│  │ Tool Mapper      │  │ Task Orchestrator        │        │
│  │                  │  │                          │        │
│  │ VS Code tools →  │  │ • Checkpoint management  │        │
│  │ Provider format  │  │ • Context compression    │        │
│  │ Tool calls →     │  │ • Cost tracking          │        │
│  │ VS Code execute  │  │ • Crash recovery         │        │
│  └──────────────────┘  └──────────────────────────┘        │
└────────────────────┬────────────────────────────────────────┘
                     │
                     │ HTTP with tools + task metadata
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                    MCP Router (Backend)                      │
│                                                              │
│  ┌──────────────────┐  ┌──────────────────────────┐        │
│  │ Multi-Provider   │  │ Resilience Engine        │        │
│  │ Orchestrator     │  │                          │        │
│  │                  │  │ • Adaptive retry         │        │
│  │ • Plan routing   │  │ • Circuit breakers       │        │
│  │ • Optimize cost  │  │ • Extended budgets       │        │
│  │ • Switch models  │  │ • Fallback logic         │        │
│  └──────────────────┘  └──────────────────────────┘        │
│                                                              │
│  ┌──────────────────┐  ┌──────────────────────────┐        │
│  │ Provider Adapters│  │ State Persistence        │        │
│  │                  │  │                          │        │
│  │ • OpenAI         │  │ • Checkpoint storage     │        │
│  │ • Claude         │  │ • Task queue             │        │
│  │ • GLM            │  │ • Cost tracking          │        │
│  └──────────────────┘  └──────────────────────────┘        │
└─────────────────────────────────────────────────────────────┘
```

---

## Implementation Strategy

### Why Parallel Development Works

**Tool Proxy** and **Long-Horizon** touch different layers:

| Layer | Tool Proxy | Long-Horizon | Conflict? |
|-------|-----------|--------------|-----------|
| Extension UI | ✅ Tool calling loop | ⚠️ Task config | Low |
| Extension → Router | ✅ Tool mapping | ⚠️ Task metadata | Low |
| Router API | ✅ Tool passthrough | ⚠️ Extended timeouts | None |
| Router Core | ❌ Unchanged | ✅ Budget manager | None |
| Providers | ❌ Unchanged | ✅ Multi-provider | None |
| Persistence | ❌ Unchanged | ✅ Checkpoints | None |

**Integration Points** (only 2):
1. Extension's `lmProvider.ts` - needs both tool loop AND task orchestration
2. Router's `extensionApiServer.ts` - needs both tool definitions AND task config

**Solution**: Build in coordinated sprints, integrate at the end of each sprint.

---

## Sprint Plan (3-4 Weeks)

### Sprint 1: Foundation (Week 1)

**Goal**: Basic tool calling + extended budgets

#### Day 1-2: Tool Mapper (Extension)

**Files to Create**:
- `extension/src/provider/toolMapper.ts`
- `extension/src/provider/toolExecutor.ts`

**What It Does**:
```typescript
// Convert VS Code tools to OpenAI format
const openaiTools = mapToolsToOpenAI(options.tools);

// Execute tool calls from provider
const result = await executeToolCall(toolCall, token);
```

**Deliverable**: Tools flow from Antigravity → Extension → Router → Provider

---

#### Day 3-4: Extended Budget Manager (Router)

**Files to Modify**:
- `src/infra/config.ts` - Add task budget config
- `src/resilience/requestBudget.ts` - Support long budgets
- `src/resilience/executor.ts` - Use configurable budgets

**What It Does**:
```typescript
interface TaskBudgetConfig {
  simple: { timeoutMs: 60_000, maxTokens: 10_000 };
  complex: { timeoutMs: 600_000, maxTokens: 100_000 };
  engineering: { timeoutMs: 3_600_000, maxTokens: 500_000 };
}
```

**Deliverable**: Router supports 1-hour+ tasks

---

#### Day 5: Integration + Testing

**Test Scenarios**:
1. ✅ Tool call works end-to-end (single tool)
2. ✅ Extended budget allows 10-min task
3. ✅ Cost tracking reports accurately

**Sprint 1 Demo**: 
- Custom model calls `@workspace` to read a file
- Task runs for 10 minutes without timeout

---

### Sprint 2: Intelligence (Week 2)

**Goal**: Tool loop + context management + checkpointing

#### Day 6-7: Tool Calling Loop (Extension)

**Files to Create**:
- `extension/src/provider/toolLoop.ts`

**Files to Modify**:
- `extension/src/provider/lmProvider.ts`
- `extension/src/provider/responseMapper.ts`

**What It Does**:
```typescript
async provideLanguageModelChatResponse(...): Promise<void> {
  const toolLoop = new ToolLoopExecutor();
  
  while (!isComplete && iterations < MAX_ITERATIONS) {
    // Send to provider with tools
    const response = await sendToProvider(messages, tools);
    
    if (response.hasToolCalls) {
      // Execute all tools
      const results = await toolLoop.executeAll(response.toolCalls);
      
      // Add tool results to conversation
      messages.push(response.assistantMessage);
      messages.push(createToolResultMessage(results));
    } else {
      // Final text response
      streamToUser(response.text);
      break;
    }
  }
}
```

**Deliverable**: Provider can call multiple tools in sequence

---

#### Day 8-9: Context Manager (Extension)

**Files to Create**:
- `extension/src/provider/contextManager.ts`

**What It Does**:
```typescript
class HierarchicalContextManager {
  compress(messages: Message[]): Message[] {
    return [
      ...this.keepSystemPrompts(),      // Always keep
      ...this.summarizeOldMessages(),   // Summarize > 10 messages old
      ...this.keepRecentMessages(),     // Full context for last 10
      ...this.keepCurrentFiles(),       // Full file content
      ...this.summarizeOldFiles(),      // Summaries for old files
    ];
  }
}
```

**Deliverable**: Context stays under token limits, costs drop 60-80%

---

#### Day 10: File-Based Checkpoints (Router)

**Files to Create**:
- `src/core/checkpoint.ts`
- `src/core/checkpointStore.ts`

**What It Does**:
```typescript
interface TaskCheckpoint {
  taskId: string;
  step: number;
  state: {
    filesCreated: string[];
    messages: Message[];  // Compressed
    decisions: Record<string, any>;
  };
  costSoFar: number;
}

// Save after each step
await checkpointStore.save(checkpoint);

// Resume on crash
const lastCheckpoint = await checkpointStore.load(taskId);
```

**Deliverable**: Crash recovery works

---

#### Day 11: Integration + Testing

**Test Scenarios**:
1. ✅ Multiple tool calls in one turn
2. ✅ Context compression reduces tokens by 70%
3. ✅ Checkpoint saves and restores correctly
4. ✅ Simulated crash recovery works

**Sprint 2 Demo**:
- Custom model reads 5 files, writes 3 files (multiple tool calls)
- Context compressed from 100K → 30K tokens
- Simulated crash, resumes from checkpoint

---

### Sprint 3: Production Features (Week 3)

**Goal**: Multi-provider + cost controls + adaptive retry

#### Day 12-13: Multi-Provider Orchestrator (Router)

**Files to Create**:
- `src/core/taskPlanner.ts`
- `src/core/costOptimizer.ts`

**What It Does**:
```typescript
class TaskPlanner {
  plan(task: EngineeringTask): ProviderStrategy {
    return {
      planning: { provider: 'gpt-4', reason: 'architecture' },
      codeGeneration: { provider: 'claude-sonnet', reason: 'quality/cost' },
      boilerplate: { provider: 'glm-4-plus', reason: 'cheapest' },
      codeReview: { provider: 'gpt-4-turbo', reason: 'bug detection' },
    };
  }
}
```

**Deliverable**: Automatic model selection per sub-task

---

#### Day 14-15: Adaptive Retry Engine (Router)

**Files to Modify**:
- `src/resilience/retryPolicy.ts` - Add adaptive strategies
- `src/resilience/executor.ts` - Use error-specific retry

**What It Does**:
```typescript
class AdaptiveRetryPolicy {
  getStrategy(error: RouterError): RetryConfig {
    switch (error.code) {
      case 'RATE_LIMIT':
        return { maxRetries: 10, backoff: 'exponential', respectRetryAfter: true };
      case 'TIMEOUT':
        return { maxRetries: 3, increaseTimeout: true };
      case 'CONTEXT_LIMIT':
        return { maxRetries: 1, action: 'compress_and_retry' };
      default:
        return this.defaultStrategy;
    }
  }
}
```

**Deliverable**: Smart retry based on error type

---

#### Day 16-17: Cost Controller (Router + Extension)

**Files to Create**:
- `src/core/costTracker.ts`
- `extension/src/client/costMonitor.ts`

**What It Does**:
```typescript
class CostController {
  async checkBudget(taskId: string): Promise<BudgetAction> {
    const spent = await this.getCostSoFar(taskId);
    const estimated = await this.estimateRemaining(taskId);
    
    if (spent + estimated > this.budget * 1.5) {
      return { action: 'STOP', reason: 'Budget exceeded by 50%' };
    }
    if (spent + estimated > this.budget * 1.2) {
      return { action: 'DOWNGRADE_MODEL', reason: 'Approaching budget limit' };
    }
    if (spent + estimated > this.budget) {
      return { action: 'COMPRESS_CONTEXT', reason: 'Need to reduce costs' };
    }
    return { action: 'CONTINUE' };
  }
}
```

**Deliverable**: Real-time cost tracking and control

---

#### Day 18-19: Integration + Testing

**Test Scenarios**:
1. ✅ Multi-provider strategy reduces cost by 40%
2. ✅ Rate limit triggers adaptive retry (waits, then retries)
3. ✅ Cost controller stops task at 150% of budget
4. ✅ Context limit triggers compression and retry

**Sprint 3 Demo**:
- 30-min engineering task runs with 3 different providers
- Cost stays under $15 (target was $25)
- Rate limit hit once, recovered automatically
- Context compressed twice when approaching limits

---

### Sprint 4: Polish & Hardening (Week 4)

**Goal**: Production-ready, tested, documented

#### Day 20-21: Comprehensive Testing

**Unit Tests**:
- Tool mapping (VS Code → OpenAI, GLM, Claude)
- Context compression algorithms
- Checkpoint save/restore
- Cost calculations
- Retry strategies

**Integration Tests**:
- Full tool calling loop
- Multi-provider orchestration
- Crash recovery
- Budget enforcement

**Manual Tests**:
- Build a simple component (15 min)
- Build a full page (1 hour)
- Build a multi-page app (3 hours)

---

#### Day 22-23: Observability & Monitoring

**Files to Create**:
- `src/core/metrics/longHorizonMetrics.ts`
- `extension/src/telemetry/taskTelemetry.ts`

**Metrics to Track**:
```typescript
interface TaskMetrics {
  taskId: string;
  duration: number;
  totalCost: number;
  tokensUsed: { input: number; output: number };
  toolCalls: number;
  retries: number;
  checkpoints: number;
  providersUsed: string[];
  contextCompressions: number;
  success: boolean;
  failureReason?: string;
}
```

**Deliverable**: Full visibility into task execution

---

#### Day 24-25: Documentation & Deployment

**Documents to Create**:
1. `LONG_HORIZON_GUIDE.md` - User guide
2. `TOOL_PROXY_GUIDE.md` - Tool configuration
3. `COST_OPTIMIZATION.md` - How to minimize costs
4. `TROUBLESHOOTING.md` - Common issues and fixes
5. `DEPLOYMENT.md` - Production deployment guide

**Deliverable**: Production-ready documentation

---

#### Day 26-27: Final Testing & Bug Fixes

- Fix any bugs found in testing
- Performance optimization
- Security audit
- Load testing

---

#### Day 28: Launch! 🚀

- Deploy to production
- Monitor first real tasks
- Collect metrics
- Iterate based on feedback

---

## File Structure

### New Files (Extension)

```
extension/src/
├── provider/
│   ├── toolMapper.ts          # Convert tools between formats
│   ├── toolExecutor.ts        # Execute tools via VS Code API
│   ├── toolLoop.ts            # Tool calling loop
│   ├── contextManager.ts      # Hierarchical context management
│   └── lmProvider.ts          # Modified: Add tool + task support
├── client/
│   ├── costMonitor.ts         # Track costs in real-time
│   └── routerClient.ts        # Modified: Add task metadata
└── task/
    └── taskConfig.ts          # Task configuration helper
```

### New Files (Router)

```
src/
├── core/
│   ├── checkpoint.ts          # Checkpoint interface
│   ├── checkpointStore.ts     # File-based checkpoint storage
│   ├── taskPlanner.ts         # Multi-provider task planning
│   ├── costOptimizer.ts       # Cost optimization logic
│   ├── costTracker.ts         # Real-time cost tracking
│   └── router.ts              # Modified: Long-horizon support
├── resilience/
│   ├── retryPolicy.ts         # Modified: Adaptive retry
│   ├── executor.ts            # Modified: Extended budgets
│   └── requestBudget.ts       # Modified: Task budgets
├── infra/
│   └── config.ts              # Modified: Task budget config
└── server/
    └── extensionApiServer.ts  # Modified: Task endpoints
```

### Modified Files

**Extension**:
- `extension/src/provider/lmProvider.ts` - Add tool loop + task orchestration
- `extension/src/provider/requestMapper.ts` - Include tools in requests
- `extension/src/provider/responseMapper.ts` - Handle tool_call responses
- `extension/src/client/routerClient.ts` - Add task metadata to requests

**Router**:
- `src/infra/config.ts` - Add task budget configuration
- `src/resilience/requestBudget.ts` - Support extended budgets
- `src/resilience/retryPolicy.ts` - Add adaptive strategies
- `src/resilience/executor.ts` - Use task budgets
- `src/server/extensionApiServer.ts` - Add task endpoints

---

## Configuration

### Task Budget Configuration

```env
# Task Budget Configuration
TASK_BUDGET_SIMPLE_TIMEOUT=60000        # 1 min
TASK_BUDGET_SIMPLE_MAX_TOKENS=10000

TASK_BUDGET_COMPLEX_TIMEOUT=600000      # 10 min
TASK_BUDGET_COMPLEX_MAX_TOKENS=100000

TASK_BUDGET_ENGINEERING_TIMEOUT=3600000 # 1 hour
TASK_BUDGET_ENGINEERING_MAX_TOKENS=500000

TASK_BUDGET_MARATHON_TIMEOUT=21600000   # 6 hours
TASK_BUDGET_MARATHON_MAX_TOKENS=2000000

# Cost Controls
MAX_COST_PER_TASK_USD=25.00
COST_WARNING_THRESHOLD=0.8              # 80% of budget
COST_CRITICAL_THRESHOLD=1.2             # 120% of budget

# Context Management
CONTEXT_MAX_MESSAGES=50                 # Before compression
CONTEXT_COMPRESSION_RATIO=0.4           # Compress to 40%
CONTEXT_ALWAYS_KEEP_SYSTEM=true         # Never compress system prompts

# Checkpoint Settings
CHECKPOINT_INTERVAL_SECONDS=60          # Save every 60s
CHECKPOINT_MAX_AGE_HOURS=24             # Delete old checkpoints
CHECKPOINT_STORAGE_PATH=./checkpoints   # Local storage
```

### Provider Strategy Configuration

```json
{
  "providerStrategy": {
    "planning": {
      "provider": "openai",
      "model": "gpt-4",
      "reason": "Best for architecture decisions"
    },
    "codeGeneration": {
      "provider": "anthropic",
      "model": "claude-3-sonnet",
      "reason": "Best code quality/cost ratio"
    },
    "boilerplate": {
      "provider": "glm",
      "model": "glm-4-plus",
      "reason": "Cheapest for routine work"
    },
    "codeReview": {
      "provider": "openai",
      "model": "gpt-4-turbo",
      "reason": "Excellent at finding bugs"
    }
  }
}
```

---

## Testing Strategy

### Unit Tests (70% coverage target)

**Tool Proxy Tests**:
- `toolMapper.test.ts` - Format conversion
- `toolExecutor.test.ts` - Mock tool execution
- `toolLoop.test.ts` - Loop logic

**Long-Horizon Tests**:
- `contextManager.test.ts` - Compression algorithms
- `checkpointStore.test.ts` - Save/restore
- `costTracker.test.ts` - Cost calculations
- `taskPlanner.test.ts` - Provider selection

### Integration Tests

**Tool Proxy**:
1. End-to-end tool call (single tool)
2. Multiple tools in one turn
3. Tool error handling
4. Tool confirmation flow

**Long-Horizon**:
1. 10-minute task completion
2. Checkpoint save and restore
3. Crash recovery
4. Cost budget enforcement
5. Context compression under load

### Manual Tests (Real Engineering Tasks)

**Test 1: Simple Component (15 min)**
```
Task: "Create a React button component with variants"
Expected: 
- Component file created
- Styles file created
- Tests file created
- Cost: $2-5
```

**Test 2: Full Page (1 hour)**
```
Task: "Build a user profile page with edit functionality"
Expected:
- Multiple components created
- API integration
- Form validation
- Cost: $8-15
```

**Test 3: Multi-Page App (3 hours)**
```
Task: "Build a dashboard with auth, charts, and data tables"
Expected:
- Authentication flow
- Multiple pages
- Charts integration
- API calls
- Error handling
- Cost: $15-25
```

---

## Risk Mitigation

### Risk 1: Scope Creep

**Mitigation**: 
- Stick to sprint goals
- Defer "nice-to-haves" to Phase 2
- Weekly progress reviews

### Risk 2: Integration Complexity

**Mitigation**:
- Build tool proxy and long-horizon separately
- Integrate at sprint boundaries
- Comprehensive integration tests

### Risk 3: Cost Overruns

**Mitigation**:
- Hard budget limits (stop at 150%)
- Real-time cost tracking
- Daily cost reports

### Risk 4: Performance Issues

**Mitigation**:
- Load testing in Sprint 4
- Performance budgets (response < 5s)
- Profiling and optimization

---

## Success Metrics

### Tool Proxy Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Tool call success rate | > 95% | Automated tests |
| Tool execution time | < 5s (p95) | Metrics |
| Multi-tool support | 5+ tools/turn | Manual tests |
| Tool error recovery | > 90% | Automated tests |

### Long-Horizon Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Task completion rate | > 85% | Task tracking |
| Cost per task | $5-25 | Cost tracker |
| Crash recovery success | 100% | Checkpoint tests |
| Context compression ratio | 60-80% | Token counts |
| Multi-provider savings | 40-60% | Cost comparison |

---

## Deployment Plan

### Week 1-2: Development Environment

- Local development
- Manual testing
- Unit tests passing

### Week 3: Staging Environment

- Deploy to staging
- Integration tests
- Real task testing

### Week 4: Production

- Deploy to production
- Monitor first tasks
- Collect metrics
- Iterate

---

## Next Steps

### Immediate (Today)

1. ✅ Review this plan
2. ✅ Confirm sprint timeline
3. ⏳ Start Sprint 1, Day 1

### This Week

- Create tool mapper (Day 1-2)
- Create extended budget manager (Day 3-4)
- Integration testing (Day 5)

### Next Week

- Tool calling loop (Day 6-7)
- Context manager (Day 8-9)
- Checkpoint system (Day 10)

---

## Budget Breakdown

| Sprint | Duration | Dev Cost | Result |
|--------|----------|----------|--------|
| Sprint 1 | 1 week | $500-700 | Basic tools + extended budgets |
| Sprint 2 | 1 week | $600-800 | Tool loop + context + checkpoints |
| Sprint 3 | 1 week | $600-900 | Multi-provider + cost controls |
| Sprint 4 | 1 week | $300-600 | Testing + docs + polish |
| **Total** | **4 weeks** | **$2000-3000** | **Production-ready system** |

**Expected ROI**: 
- Saves 40 hrs/engineer/month
- At $100/hr = $4000/month
- **Payback**: ~3 weeks

---

## Ready to Start?

**Shall I begin Sprint 1, Day 1 (Tool Mapper implementation)?**

I'll create:
1. `extension/src/provider/toolMapper.ts`
2. `extension/src/provider/toolExecutor.ts`
3. Unit tests
4. Integration guide

This will enable the foundation for tool calling in custom models.
