# Performance Optimization Quick Start

Get started with frontend performance optimization using MCP Router in 5 minutes.

## Prerequisites

- MCP Router installed and configured
- At least one LLM provider configured (OpenAI, GLM, Anthropic, etc.)
- Basic understanding of web performance concepts

## Quick Start (5 Minutes)

### 1. Analyze Your Current Performance

Run a quick diagnostic on your application:

```bash
# If you have Core Web Vitals data
mcp_router perf_analyze_metrics \
  --lcp 3200 \
  --fid 150 \
  --cls 0.15 \
  --framework react \
  --pageType ecommerce

# If you don't have metrics, get priorities based on resources
mcp_router perf_get_priorities \
  --lcp 3200 \
  --fid 150 \
  --cls 0.15 \
  --bundleSize 512000 \
  --imageCount 25
```

### 2. Get Your First Recommendation

The diagnostic will return prioritized recommendations. Start with the highest priority items:

```bash
# Example: Critical path optimization (high priority)
mcp_router perf-critical-path-analysis \
  --framework react \
  --html "$(cat index.html)" \
  --css "$(cat styles.css)" \
  --js "$(cat main.js)"
```

### 3. Implement Quick Wins

Get easy wins first:

```bash
mcp_router perf-get_optimization_strategies --category quick-wins
```

This returns strategies like:
- Enable compression (30-70% bandwidth reduction)
- Minify CSS and JS (20-30% size reduction)
- Optimize images (50-70% image size reduction)
- Lazy load images (30-50% initial load reduction)

### 4. Optimize Your Framework

Get framework-specific best practices:

```bash
mcp_router perf_framework_best_practices --framework react
```

Returns 10+ best practices tailored to React development.

## Common Use Cases

### Use Case 1: Slow Initial Load

**Problem**: Your page takes 4+ seconds to load

**Solution**:
```bash
# 1. Analyze critical path
mcp_router perf-critical-path-analysis --framework react --html ... --css ... --js ...

# 2. Optimize images
mcp_router perf-image-optimization --type blog --imageList "hero.jpg 500KB, gallery/*.jpg 200KB each" --context "blog post"

# 3. Get optimization priorities
mcp_router perf_get_priorities --lcp 4000 --fid 200 --cls 0.2 --bundleSize 800000
```

**Expected Result**: 1-3s LCP improvement

### Use Case 2: Janky Animations

**Problem**: Animations feel choppy, scrolling is not smooth

**Solution**:
```bash
# 1. Analyze render performance
mcp_router perf-render-optimization --framework react --component "$(cat AnimatedList.tsx)" --context "infinite scroll list"

# 2. Get framework best practices
mcp_router perf_framework_best_practices --framework react

# 3. Identify bottlenecks
mcp_router perf_identify_bottlenecks --symptoms ["janky animations", "poor scroll performance"] --framework react
```

**Expected Result**: 60fps animations, smooth scrolling

### Use Case 3: Large Bundle Size

**Problem**: JavaScript bundle is too big (500KB+)

**Solution**:
```bash
# 1. Analyze bundle
mcp_router perf-bundle-optimization --framework react --bundleAnalysis "$(webpack-bundle-analyzer output)" --dependencies "$(cat package.json)"

# 2. Get medium investment strategies
mcp_router perf-get_optimization_strategies --category medium-investments
```

**Expected Result**: 40-60% initial JS reduction

### Use Case 4: Poor Core Web Vitals

**Problem**: Failing Google's Core Web Vitals assessment

**Solution**:
```bash
# 1. Optimize for Core Web Vitals
mcp_router perf-core-web-vitals --framework react --lcp 3200 --fid 150 --cls 0.15 --pageContent "$(cat index.html)" --lcpStatus poor --fidStatus needs-improvement --clsStatus poor

# 2. Create 6-month action plan
mcp_router perf-audit-action-plan --framework react --lcp 3200 --fid 150 --cls 0.15 --constraints "legacy browser support"
```

**Expected Result**: Achieve "Good" ratings for all Core Web Vitals

## Integration Examples

### Example 1: CI/CD Pipeline

Add to your `package.json`:

```json
{
  "scripts": {
    "perf:audit": "mcp_router perf-audit-action-plan --framework react --lcp 3200 --fid 150 --cls 0.15",
    "perf:bundle": "mcp_router perf-bundle-optimization --framework react --bundleAnalysis report.txt --dependencies package.json",
    "perf:analyze": "mcp_router perf_analyze_metrics --lcp 3200 --fid 150 --cls 0.15"
  }
}
```

### Example 2: Pre-commit Hook

```bash
#!/bin/bash
# .git/hooks/pre-commit

echo "Running performance check..."

# Check bundle size hasn't increased significantly
CURRENT_SIZE=$(du -b dist/main.js | cut -f1)
if [ $CURRENT_SIZE -gt 500000 ]; then
  echo "Bundle size exceeds 500KB. Consider optimization."
  mcp_router perf-bundle-optimization --framework react --bundleAnalysis "$CURRENT_SIZE" --dependencies "$(cat package.json)"
fi
```

### Example 3: Performance Monitoring

```javascript
// Monitor real user metrics
const observer = new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    if (entry.name === 'LCP') {
      const lcp = entry.startTime;
      console.log(`LCP: ${lcp}ms`);

      // Trigger optimization if threshold exceeded
      if (lcp > 2500) {
        // Call your MCP router optimization endpoint
        fetch('/api/optimize-lcp', {
          method: 'POST',
          body: JSON.stringify({ lcp, framework: 'react' })
        });
      }
    }
  }
});

observer.observe({ type: 'largest-contentful-paint', buffered: true });
```

## Performance Improvement Roadmap

### Week 1: Assessment & Quick Wins
- [ ] Run `perf_analyze_metrics`
- [ ] Run `perf_get_priorities`
- [ ] Implement compression (Brotli/gzip)
- [ ] Minify CSS and JS
- [ ] Enable image lazy loading

### Week 2: Critical Path Optimization
- [ ] Run `perf-critical-path-analysis`
- [ ] Extract critical CSS
- [ ] Optimize images (WebP/AVIF)
- [ ] Add resource hints (preload, preconnect)

### Week 3: Bundle Optimization
- [ ] Run `perf-bundle-optimization`
- [ ] Implement code splitting
- [ ] Remove unused dependencies
- [ ] Replace heavy libraries

### Week 4: Render Optimization
- [ ] Run `perf-render-optimization`
- [ ] Eliminate layout thrashing
- [ ] Optimize animations (GPU acceleration)
- [ ] Implement virtual scrolling

### Month 2-3: Strategic Improvements
- [ ] Run `perf-network-optimization`
- [ ] Run `perf-memory-optimization`
- [ ] Implement Service Worker
- [ ] Set up monitoring

### Ongoing: Continuous Improvement
- [ ] Weekly: Review `perf-get_optimization_strategies`
- [ ] Monthly: Run `perf-audit-action-plan`
- [ ] Quarterly: Update framework best practices

## Tips for Success

### 1. Measure First, Optimize Second
Always have baseline metrics before making changes. You can't improve what you don't measure.

### 2. Prioritize by User Impact
Focus on Core Web Vitals first (LCP, FID, CLS). These directly impact user experience and Google ranking.

### 3. Use Framework-Specific Guidance
Your framework has specific optimization patterns. Always use `perf_framework_best_practices` for your stack.

### 4. Implement Incrementally
Don't try to optimize everything at once. Implement one change, measure impact, then move to the next.

### 5. Monitor Over Time
Performance degrades as code grows. Set up continuous monitoring and regular audits.

## Common Mistakes to Avoid

### ❌ Optimizing Without Metrics
**Don't**: Guess where your bottlenecks are.
**Do**: Run `perf_analyze_metrics` and `perf_get_priorities` first.

### ❌ Optimizing Everything at Once
**Don't**: Try to implement all recommendations simultaneously.
**Do**: Prioritize high-impact items and implement incrementally.

### ❌ Ignoring Framework-Specific Patterns
**Don't**: Apply generic optimizations to framework code.
**Do**: Use `perf_framework_best_practices` for your framework.

### ❌ Not Measuring Impact
**Don't**: Make changes without verifying they help.
**Do**: Run before/after metrics for every optimization.

### ❌ Optimizing the Wrong Thing
**Don't**: Optimize for theoretical performance.
**Do**: Optimize for real user experience (Core Web Vitals).

## Getting Help

### Debug Mode
```bash
# Enable verbose logging
DEBUG=performance:* mcp_router perf-critical-path-analysis --framework react --html ... --css ... --js ...
```

### Template List
```bash
# See all available performance templates
mcp_router perf-list-templates

# Filter by category
mcp_router perf-list-templates --category critical-path
```

### Version Info
```bash
mcp_router --version
```

## Next Steps

1. **Run your first diagnostic**: `perf_analyze_metrics`
2. **Implement one quick win**: Compression or image optimization
3. **Measure impact**: Compare before/after metrics
4. **Iterate**: Move to next priority item
5. **Set up monitoring**: Continuous performance tracking

## Resources

- [Full Performance Guide](./PERFORMANCE_OPTIMIZATION_GUIDE.md)
- [Core Web Vitals](https://web.dev/vitals/)
- [Chrome DevTools](https://developer.chrome.com/docs/devtools/)
- [Web Performance APIs](https://developer.mozilla.org/en-US/docs/Web/API/Performance)

---

**Start optimizing in 5 minutes**: Run your first `perf_analyze_metrics` command now!