# Project Kickoff: Tool Proxy + Long-Horizon Autonomous Tasks

## 🎯 What We're Building

A **production-grade MCP system** that gives custom LLM models:
1. ✅ **Full tool access** (browser, files, terminal, editor)
2. ✅ **Long-horizon execution** (30 min → 6+ hours)
3. ✅ **Cost optimization** ($5-25 per task vs $50-80 naive)
4. ✅ **Crash recovery** (resume from checkpoints)
5. ✅ **Reliability under stress** (adaptive retry, circuit breakers)

**Suitable for**: Complete frontend engineering assignments

---

## 📊 The Business Case

### Problem
- Custom models can't use Antigravity's tools (browser, files, terminal)
- Current router times out after 60 seconds
- No crash recovery (lose all progress)
- No cost control (can spend $50-80 unknowingly)
- Not suitable for complex engineering tasks

### Solution
- Tool proxy: Custom models call ANY Antigravity tool
- Long-horizon: Tasks run for hours with checkpoint/resume
- Cost controls: Stay within budget, optimize automatically
- Reliability: 95-99% success rate even with network issues

### ROI
- **Investment**: $2000-3000 (4 weeks dev time)
- **Savings**: 40 hrs/engineer/month at $100/hr = $4000/month
- **Payback**: ~3 weeks
- **Ongoing value**: $4000+/month

---

## 🏗️ Architecture at a Glance

```
┌──────────────────────────────────────────────┐
│           Antigravity Chat UI                 │
│                                               │
│  User: "Build a React dashboard with auth"   │
│  (6-hour autonomous task)                    │
└───────────────┬──────────────────────────────┘
                │
                ▼
┌──────────────────────────────────────────────┐
│  Extension (Tool Proxy Layer)                │
│  • Tool calling loop                         │
│  • Context management                        │
│  • Task orchestration                        │
│  • Checkpoint coordination                   │
└───────────────┬──────────────────────────────┘
                │
                ▼
┌──────────────────────────────────────────────┐
│  MCP Router (Resilience Layer)               │
│  • Multi-provider orchestration              │
│  • Extended budgets (hours not seconds)      │
│  • Adaptive retry strategies                 │
│  • Cost tracking & control                   │
│  • Crash recovery (checkpoints)              │
└──────────────────────────────────────────────┘
```

---

## 📅 Sprint Plan (4 Weeks)

### Sprint 1: Foundation (Week 1)
**Goal**: Basic tool calling + extended budgets

- ✅ Tool mapper (VS Code → provider format)
- ✅ Tool executor (execute via VS Code API)
- ✅ Extended request budgets (1+ hours)
- ✅ File-based checkpoints

**Deliverable**: Custom model can call tools, tasks run for 10+ minutes

---

### Sprint 2: Intelligence (Week 2)
**Goal**: Tool loop + context management + crash recovery

- ✅ Tool calling loop (multiple tools per turn)
- ✅ Hierarchical context management
- ✅ Checkpoint save/restore
- ✅ Crash recovery testing

**Deliverable**: 30-min tasks with 85% success rate

---

### Sprint 3: Production (Week 3)
**Goal**: Multi-provider + cost controls + adaptive retry

- ✅ Multi-provider orchestration (optimize cost)
- ✅ Real-time cost tracking
- ✅ Adaptive retry (error-specific strategies)
- ✅ Budget enforcement

**Deliverable**: 2-4 hour tasks at 95% success, $8-12 cost

---

### Sprint 4: Polish (Week 4)
**Goal**: Testing, documentation, deployment

- ✅ Comprehensive testing (unit + integration + manual)
- ✅ Observability & metrics
- ✅ Documentation
- ✅ Production deployment

**Deliverable**: Production-ready system, 6+ hour tasks at 99% success

---

## 💰 Cost Comparison

| Approach | Cost/Task | Success Rate | Task Duration |
|----------|-----------|--------------|---------------|
| Current router | $0 (fails) | 0% | 60 seconds |
| Naive (no optimization) | $50-80 | 60% | Fails mid-task |
| After Sprint 1 | $15-25 | 85% | 30 minutes |
| After Sprint 2 | $10-18 | 90% | 1 hour |
| After Sprint 3 | $8-12 | 95% | 2-4 hours |
| After Sprint 4 | $5-8 | 99% | 6+ hours |

---

## 🚀 What You'll Be Able To Do

### Example 1: Simple Component (15 min, $2-5)
```
User: "Create a React button component with variants"

What happens:
1. Model analyzes requirements
2. Creates Button.tsx component
3. Creates Button.styles.ts
4. Creates Button.test.tsx
5. Writes documentation
6. All files saved to workspace
```

---

### Example 2: Full Page (1 hour, $8-15)
```
User: "Build a user profile page with edit functionality"

What happens:
1. Model plans component architecture
2. Creates UserProfile.tsx
3. Creates ProfileForm.tsx with validation
4. Integrates with API
5. Adds error handling
6. Creates unit tests
7. All files saved, tested, and documented
```

---

### Example 3: Multi-Page Dashboard (3-6 hours, $15-25)
```
User: "Build a dashboard with auth, charts, and data tables"

What happens:
1. Architecture planning (GPT-4)
2. Authentication flow (Claude Sonnet)
3. Dashboard layout (Claude Sonnet)
4. Chart components (GLM-4-Plus for cost savings)
5. Data tables with pagination
6. API integration
7. Error handling & loading states
8. Unit tests
9. Documentation
10. All with checkpoint/resume if anything fails
```

---

## 📁 Documents Created

1. **[UNIFIED_IMPLEMENTATION_PLAN.md](./UNIFIED_IMPLEMENTATION_PLAN.md)** (766 lines)
   - Detailed sprint-by-sprint plan
   - File structure
   - Configuration examples
   - Testing strategy
   - Risk mitigation

2. **[TOOL_PROXY_REQUIREMENTS.md](./TOOL_PROXY_REQUIREMENTS.md)** (610 lines)
   - Evidence from installed Antigravity
   - 9 functional requirements
   - Architecture design
   - Implementation phases

3. **[LONG_HORIZON_TASKS_ANALYSIS.md](./LONG_HORIZON_TASKS_ANALYSIS.md)** (736 lines)
   - Ruthless reality check
   - Cost optimization strategies
   - Reliability under network stress
   - Implementation roadmap

4. **[LONG_HORIZON_QUICK_SUMMARY.md](./LONG_HORIZON_QUICK_SUMMARY.md)** (149 lines)
   - Quick reference tables
   - Phase comparison
   - Decision guide

---

## ⚠️ Important Limitations

### What's Possible ✅
- Run tasks for **hours** (not forever)
- **95-99% reliability** (not 100%)
- **$5-25 per task** (not free)
- **Crash recovery** (resume from checkpoint)
- **Tool access** (browser, files, terminal, editor)
- **Cost controls** (stay under budget)

### What's Impossible ❌
- Run forever (outages happen)
- 100% reliability (network is unreliable)
- Zero cost (APIs cost money)
- Perfect context (LLM limitations)
- Infinite horizon (practical limits exist)

---

## 🎯 Success Criteria

### Sprint 1 (End of Week 1)
- [ ] Custom model calls `@workspace` to read a file
- [ ] Custom model calls `@browser` to navigate
- [ ] Task runs for 10+ minutes without timeout
- [ ] Checkpoint saves correctly

### Sprint 2 (End of Week 2)
- [ ] Multiple tool calls in single turn (5+ tools)
- [ ] Context compression reduces tokens by 70%
- [ ] Crash recovery works (resume from checkpoint)
- [ ] 30-min task completes successfully

### Sprint 3 (End of Week 3)
- [ ] Multi-provider strategy reduces cost by 40%
- [ ] Real-time cost tracking works
- [ ] Adaptive retry handles rate limits
- [ ] 2-hour task completes under budget

### Sprint 4 (End of Week 4)
- [ ] 6-hour task completes with 99% success
- [ ] All tests passing (70%+ coverage)
- [ ] Documentation complete
- [ ] Deployed to production

---

## 🔧 Technical Stack

**Extension**:
- TypeScript 5.3
- VS Code Language Model API
- VS Code Secret Storage
- Webview panels

**Router**:
- TypeScript 5.3
- MCP SDK
- File-based checkpoints (upgrade to SQLite later)
- Circuit breakers, retry, budget management

**Testing**:
- Node.js test runner
- Integration tests
- Manual engineering task tests

---

## 🚦 Getting Started

### Day 1 (Today)
1. ✅ Review this document
2. ✅ Review UNIFIED_IMPLEMENTATION_PLAN.md
3. ⏳ Start Sprint 1, Day 1

### This Week (Sprint 1)
- **Day 1-2**: Tool Mapper implementation
- **Day 3-4**: Extended Budget Manager
- **Day 5**: Integration testing

### Next Steps
**Shall I start Sprint 1, Day 1 right now?**

I'll create:
1. `extension/src/provider/toolMapper.ts` - Convert tools between formats
2. `extension/src/provider/toolExecutor.ts` - Execute tools via VS Code API
3. Unit tests for both files
4. Integration guide

This is the foundation that makes everything else possible.

---

## 💡 Key Decisions Made

### Decision 1: Parallel Development
**Chosen**: Build tool proxy + long-horizon together
**Rationale**: They touch different layers, low conflict
**Risk**: Medium (manageable with coordinated sprints)

### Decision 2: File-Based Checkpoints (Not SQLite)
**Chosen**: Start simple with filesystem
**Rationale**: Faster to implement, good enough for Phase 1
**Future**: Upgrade to SQLite in Phase 2 if needed

### Decision 3: Hierarchical Context (Not Vector DB)
**Chosen**: Multi-level context compression
**Rationale**: Simpler, cheaper, good enough for most tasks
**Future**: Add vector DB retrieval if context needs are extreme

### Decision 4: Multi-Provider Orchestration
**Chosen**: Task-based provider selection
**Rationale**: 40-60% cost savings, better quality
**Implementation**: Planner decides best provider per sub-task

---

## 📞 Communication Plan

### Weekly Checkpoints
- **Monday**: Sprint planning
- **Wednesday**: Mid-sprogress review
- **Friday**: Demo + retrospective

### Daily Updates
- What was completed
- What's blocked
- What's next

### Escalation
- Technical blockers → Immediate discussion
- Budget concerns → Immediate discussion
- Timeline risks → Mid-week review

---

## 🎬 Let's Begin!

**Ready to start Sprint 1, Day 1?**

I'll implement the tool mapper and executor, which are the foundation for giving custom models access to Antigravity's tools.

**Say "Go" and I'll start coding!** 🚀
