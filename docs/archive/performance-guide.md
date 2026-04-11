# Performance Optimization Guide for MCP Router

## Overview

The MCP Router now includes comprehensive frontend performance optimization capabilities, making it a go-to tool for any LLM wishing to create high-performance websites. This system infuses deep performance engineering knowledge into the routing layer, enabling systematic optimization across all areas of frontend performance.

## Philosophy: Vanilla Can Be Beautiful

This implementation emphasizes that **fundamental performance principles matter more than framework-specific tricks**. By understanding browser rendering pipelines, V8 internals, and network fundamentals, you can optimize any application — vanilla or framework-based.

## Core Components

### 1. Performance Templates (13 Specialized Templates)

Each template encodes specific performance engineering knowledge and provides structured prompts for optimization tasks.

#### Critical Path Optimization
- **`perf-critical-path-analysis`**: Analyze and optimize the critical rendering path
- **`perf-network-optimization`**: HTTP/2, caching, resource prioritization

#### Bundle & Code Optimization
- **`perf-bundle-optimization`**: Tree-shaking, code splitting, dependency elimination
- **`perf-vanilla-js-optimization`**: V8 internals, inline caching, object shapes

#### Render & Memory Performance
- **`perf-render-optimization`**: Layout thrashing elimination, 60fps animations
- **`perf-memory-optimization`**: Memory leak prevention, garbage collection awareness

#### User-Centric Metrics
- **`perf-core-web-vitals`**: LCP, FID, CLS optimization for Google ranking

#### Specialized Optimizations
- **`perf-image-optimization`**: WebP/AVIF, lazy loading, responsive images
- **`perf-css-optimization`**: Selector efficiency, GPU acceleration, containment
- **`perf-service-worker`**: Offline-first caching strategies
- **`perf-profiling-strategy`**: Systematic performance profiling workflows
- **`perf-audit-action-plan`**: Prioritized 6-month improvement roadmap

### 2. Performance Diagnostics Tools (6 Analysis Tools)

Automated analysis and recommendation tools using the performance knowledge base:

#### `perf_analyze_metrics`
Analyze Core Web Vitals and provide comprehensive diagnostics.

```json
{
  "lcp": 3200,
  "fid": 150,
  "cls": 0.15,
  "framework": "react",
  "pageType": "ecommerce"
}
```

**Output**:
- Overall performance rating
- Individual metric status
- Identified bottlenecks
- Prioritized recommendations with expected improvements

#### `perf_get_priorities`
Get prioritized optimization actions based on current state.

```json
{
  "lcp": 3200,
  "fid": 150,
  "cls": 0.15,
  "bundleSize": 512000,
  "imageCount": 25,
  "jsFiles": 12
}
```

**Output**:
- High-priority items (Core Web Vitals failures)
- Medium-priority items (bundle/resource optimization)
- Low-priority items (nice-to-have improvements)

#### `perf_framework_best_practices`
Get framework-specific performance patterns.

```json
{
  "framework": "react"
}
```

**Output**: 10+ React-specific best practices including:
- React.memo usage
- useMemo/useCallback patterns
- Virtual scrolling recommendations
- Code splitting strategies

#### `perf_identify_bottlenecks`
Match observed symptoms to known bottlenecks.

```json
{
  "symptoms": ["janky animations", "slow image loading", "layout shifts"],
  "framework": "vue",
  "pageType": "blog"
}
```

**Output**:
- Matched bottlenecks with causes and solutions
- Framework-specific considerations
- Context-aware recommendations

#### `perf_get_optimization_strategies`
Get detailed optimization strategies by effort/impact.

```json
{
  "category": "quick-wins"
}
```

**Output**:
- Compression, minification, image optimization
- Expected improvements (30-70% bandwidth reduction)
- Implementation guidance

### 3. Performance Knowledge Base

Structured knowledge about:
- **Core Web Vitals thresholds**: Good/Needs Improvement/Poor ranges
- **Common bottlenecks**: 8 major bottleneck categories with symptoms, causes, solutions
- **Optimization strategies**: Organized by quick wins, medium investments, high-impact changes
- **Framework best practices**: React, Vue, Angular, Vanilla JS patterns

## Usage Examples

### Example 1: Optimizing Critical Rendering Path

```bash
# Use LLM to analyze critical path
mcp_router perf-critical-path-analysis \
  --framework react \
  --html "$(cat index.html)" \
  --css "$(cat styles.css)" \
  --js "$(cat main.js)"
```

**LLM Response**:
- Identifies render-blocking CSS (2.1MB)
- Recommends critical CSS extraction
- Provides resource hint placement
- Quantifies impact: "Expected LCP improvement: 1.2-1.8s"

### Example 2: Comprehensive Performance Audit

```bash
# Analyze metrics and get priorities
mcp_router perf_analyze_metrics \
  --lcp 3200 --fid 150 --cls 0.15 \
  --framework react --pageType ecommerce

# Get optimization priorities
mcp_router perf_get_priorities \
  --lcp 3200 --fid 150 --cls 0.15 \
  --bundleSize 512000 --imageCount 25
```

**System Response**:
- Overall rating: "poor"
- High priority: Critical path optimization, JavaScript execution
- Medium priority: Bundle size reduction, image optimization
- Low priority: Service Worker, monitoring setup

### Example 3: Framework-Specific Optimization

```bash
# Get React best practices
mcp_router perf_framework_best_practices --framework react

# Optimize React component
mcp_router perf-render-optimization \
  --framework react \
  --component "$(cat UserProfile.tsx)" \
  --context "user list with infinite scroll"
```

**LLM Response**:
- React.memo implementation
- Virtual scrolling recommendation (react-window)
- Animation optimization with GPU acceleration
- Memory cleanup in useEffect

### Example 4: Bundle Optimization

```bash
# Analyze and optimize bundle
mcp_router perf-bundle-optimization \
  --framework react \
  --bundleAnalysis "$(webpack-bundle-analyzer report)" \
  --dependencies "$(cat package.json)"
```

**LLM Response**:
- Identifies moment.js (large, replace with date-fns)
- Recommends route-based code splitting
- Vendor chunk optimization
- Expected: "40-60% initial JS reduction"

## Integration with Existing Tools

All performance tools integrate seamlessly with existing MCP Router features:

### Structured Output
```bash
mcp_router perf-core-web-vitals \
  --framework react \
  --lcp 3200 --fid 150 --cls 0.15 \
  --responseFormat json \
  --schema '{"recommendations": "array", "metrics": "object"}'
```

### Caching
```bash
mcp_router perf-critical-path-analysis \
  --framework react \
  --html "$(cat index.html)" \
  --cache '{"enabled": true, "ttlMs": 3600000}'
```

### Quality Guards
```bash
mcp_router perf-audit-action-plan \
  --framework react \
  --lcp 3200 --fid 150 --cls 0.15 \
  --qualityGuards '{"enabled": true, "minLength": 500}'
```

### Consensus Execution
```bash
mcp_router llm_consensus \
  --models '[{"provider":"openai","model":"gpt-4"},{"provider":"anthropic","model":"claude-sonnet-4-6"}]' \
  --messages '[{"role":"user","content":"Optimize performance for this React component..."}]'
```

## Performance Optimization Workflow

### Phase 1: Assessment (Week 1)

1. **Run Diagnostics**
   ```bash
   perf_analyze_metrics --lcp X --fid Y --cls Z
   perf_get_priorities --lcp X --fid Y --cls Z --bundleSize N
   ```

2. **Identify Bottlenecks**
   ```bash
   perf_identify_bottlenecks --symptoms ["symptoms"] --framework react
   ```

3. **Create Baseline**
   - Record current metrics
   - Set up monitoring (Lighthouse CI, RUM)
   - Document technical constraints

### Phase 2: Quick Wins (Weeks 2-3)

```bash
# Implement quick wins
perf-critical-path-analysis --framework react --html ... --css ... --js ...
perf-image-optimization --type ecommerce --imageList ... --context hero
perf-get_optimization_strategies --category quick-wins
```

**Expected Results**:
- 30-70% bandwidth reduction
- 0.5-1.5s LCP improvement
- Better mobile performance

### Phase 3: Medium Investments (Weeks 4-6)

```bash
# Bundle optimization
perf-bundle-optimization --framework react --bundleAnalysis ... --dependencies ...

# Render optimization
perf-render-optimization --framework react --component ... --context list

# CSS optimization
perf-css-optimization --framework react --css ... --structure ...
```

**Expected Results**:
- 40-60% initial JS reduction
- 60fps animations
- Eliminated layout thrashing

### Phase 4: Strategic Changes (Months 2-3)

```bash
# Network optimization
perf-network-optimization --type SPA --currentSetup ... --metrics ...

# Memory optimization
perf-memory-optimization --framework react --component ... --lifecycle ...

# Service Worker
perf-service-worker --type PWA --currentSetup ... --apis ... --assets ...
```

**Expected Results**:
- 50-90% faster repeat visits
- Eliminated memory leaks
- Offline capability

### Phase 5: Continuous Improvement (Ongoing)

```bash
# Regular audits
perf-audit-action-plan --framework react --lcp X --fid Y --cls Z --constraints ...

# Framework updates
perf_framework_best_practices --framework react

# Profiling strategies
perf-profiling-strategy --type SPA --issues ... --stack ...
```

## Core Performance Principles

### 1. Understand the Browser Rendering Pipeline
```
Parse HTML → DOM
Parse CSS → CSSOM
Combine → Render Tree
Layout → Paint → Composite
```

Every optimization targets a specific stage. Know where your bottleneck is.

### 2. Critical Path First
Optimize for first paint of visible content, defer everything else.
- Extract critical CSS
- Inline critical JS
- Lazy load below-fold content

### 3. Measure, Don't Guess
- Use Chrome DevTools (Performance, Memory, Network tabs)
- Run Lighthouse audits
- Monitor real user metrics (Web Vitals API)
- Track over time

### 4. Prioritize by Impact
1. **Fix Core Web Vitals failures** (LCP, FID, CLS)
2. **Reduce initial payload** (bundle, images)
3. **Optimize rendering** (layout thrashing, animations)
4. **Enhance experience** (Service Worker, monitoring)

### 5. Vanilla Fundamentals Apply Everywhere
Whether React, Vue, Angular, or vanilla:
- Batch DOM reads and writes
- Use requestAnimationFrame for animations
- Implement event delegation
- Avoid memory leaks
- Understand JavaScript engine optimizations

## Metrics and Thresholds

### Core Web Vitals Targets
- **LCP**: < 2.5s (Good), < 4.0s (Needs Improvement)
- **FID**: < 100ms (Good), < 300ms (Needs Improvement)
- **CLS**: < 0.1 (Good), < 0.25 (Needs Improvement)

### Bundle Size Targets
- **Initial JS**: < 100KB (Good), < 250KB (Needs Improvement)
- **Total JS**: < 300KB (Good), < 500KB (Needs Improvement)
- **CSS**: < 30KB (Good), < 60KB (Needs Improvement)

### Network Performance Targets
- **TTFB**: < 800ms (Good), < 1.8s (Needs Improvement)
- **FCP**: < 1.8s (Good), < 3.0s (Needs Improvement)

## Tool Reference

### Performance Template Tools
- `perf-critical-path-analysis`: Critical rendering path optimization
- `perf-bundle-optimization`: Bundle size reduction
- `perf-render-optimization`: Rendering performance (60fps)
- `perf-network-optimization`: Network and caching optimization
- `perf-core-web-vitals`: Core Web Vitals optimization
- `perf-memory-optimization`: Memory leak prevention
- `perf-image-optimization`: Image optimization (70%+ reduction)
- `perf-vanilla-js-optimization`: V8/JavaScript optimization
- `perf-css-optimization`: CSS performance optimization
- `perf-profiling-strategy`: Profiling workflows
- `perf-audit-action-plan`: 6-month improvement roadmap
- `perf-service-worker`: Service Worker implementation
- `perf-list-templates`: List all performance templates

### Performance Diagnostics Tools
- `perf_analyze_metrics`: Analyze Core Web Vitals
- `perf_get_priorities`: Get optimization priorities
- `perf_framework_best_practices`: Framework-specific patterns
- `perf_identify_bottlenecks`: Match symptoms to bottlenecks
- `perf_get_optimization_strategies`: Get optimization strategies

## Best Practices

### For LLM Users

1. **Start with Diagnostics**
   - Always run `perf_analyze_metrics` first
   - Get priorities before making changes
   - Understand current state

2. **Use Templates for Structured Tasks**
   - Templates provide deep domain knowledge
   - Consistent outputs across models
   - Better than generic prompts

3. **Measure Impact**
   - Run before/after metrics
   - Use real user monitoring
   - Track over time

4. **Framework Awareness**
   - Use `perf_framework_best_practices` for your framework
   - Tailor recommendations to your stack
   - Understand framework-specific optimizations

### For Developers

1. **Integrate into Build Process**
   ```bash
   # CI/CD pipeline
   npm run build
   mcp_router perf-bundle-optimization --framework react ...
   npm run test:performance
   ```

2. **Set Up Monitoring**
   - Lighthouse CI
   - Web Vitals API
   - Real User Monitoring (RUM)

3. **Regular Audits**
   - Weekly quick wins review
   - Monthly comprehensive audit
   - Quarterly strategic planning

## Future Enhancements

Planned features for future releases:

1. **Automated Performance Testing**
   - Integration with Lighthouse CI
   - Automated regression detection
   - Performance budgets enforcement

2. **Performance Budgeting**
   - Budget definition and enforcement
   - CI/CD pipeline integration
   - Automated alerts

3. **Real User Monitoring**
   - RUM data ingestion
   - Real-time performance dashboards
   - User segmentation analysis

4. **Performance Comparison**
   - Compare against industry benchmarks
   - Competitor analysis
   - Best practice recommendations

## Contributing

To add new performance templates or improve diagnostics:

1. Add template to `src/core/performanceTemplates.ts`
2. Update knowledge base in `src/core/performanceKnowledgeBase.ts`
3. Register tool handlers in `src/server/performanceToolHandlers.ts`
4. Update documentation

## Resources

- [Web Vitals](https://web.dev/vitals/)
- [Chrome DevTools](https://developer.chrome.com/docs/devtools/)
- [Performance API](https://developer.mozilla.org/en-US/docs/Web/API/Performance)
- [High Performance Browser Networking](https://hpbn.co/)
- [V8 Internals](https://v8.dev/)

## Support

For issues, questions, or feature requests:
- Check existing GitHub issues
- Create new issue with performance metrics
- Include tool output and context

---

**Remember**: Performance optimization is iterative. Start with fundamentals, measure impact, prioritize by user value, and iterate based on data.