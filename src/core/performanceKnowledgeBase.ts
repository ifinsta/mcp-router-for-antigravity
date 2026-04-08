/**
 * Performance Knowledge Base and Diagnostics System
 *
 * Provides structured knowledge about frontend performance optimization,
 * common bottlenecks, and targeted solutions. This knowledge base
 * enables systematic performance analysis and recommendation generation.
 */

// ============================================================================
// Performance Metrics and Thresholds
// ============================================================================

/**
 * Core Web Vitals thresholds
 */
export const CORE_WEB_VITALS_THRESHOLDS = {
  LCP: {
    GOOD: 2500, // 2.5s
    NEEDS_IMPROVEMENT: 4000, // 4.0s
    POOR: Infinity,
  },
  FID: {
    GOOD: 100, // 100ms
    NEEDS_IMPROVEMENT: 300, // 300ms
    POOR: Infinity,
  },
  CLS: {
    GOOD: 0.1,
    NEEDS_IMPROVEMENT: 0.25,
    POOR: Infinity,
  },
  TTFB: {
    GOOD: 800, // 800ms
    NEEDS_IMPROVEMENT: 1800, // 1.8s
    POOR: Infinity,
  },
  FCP: {
    GOOD: 1800, // 1.8s
    NEEDS_IMPROVEMENT: 3000, // 3.0s
    POOR: Infinity,
  },
} as const;

/**
 * Bundle size thresholds
 */
export const BUNDLE_SIZE_THRESHOLDS = {
  INITIAL_JS: {
    GOOD: 100 * 1024, // 100KB
    NEEDS_IMPROVEMENT: 250 * 1024, // 250KB
    POOR: Infinity,
  },
  TOTAL_JS: {
    GOOD: 300 * 1024, // 300KB
    NEEDS_IMPROVEMENT: 500 * 1024, // 500KB
    POOR: Infinity,
  },
  CSS: {
    GOOD: 30 * 1024, // 30KB
    NEEDS_IMPROVEMENT: 60 * 1024, // 60KB
    POOR: Infinity,
  },
  INITIAL_IMAGES: {
    GOOD: 200 * 1024, // 200KB
    NEEDS_IMPROVEMENT: 500 * 1024, // 500KB
    POOR: Infinity,
  },
} as const;

// ============================================================================
// Common Performance Bottlenecks
// ============================================================================

/**
 * Common performance bottlenecks with their causes and solutions
 */
export const PERFORMANCE_BOTTLENECKS = [
  {
    id: 'render-blocking-css',
    category: 'critical-path',
    name: 'Render-Blocking CSS',
    symptoms: ['Delayed first paint', 'Blank screen during load', 'Poor LCP'],
    causes: [
      'Large CSS files in <head>',
      'Unused CSS included in bundle',
      'Critical CSS not extracted',
    ],
    solutions: [
      'Extract critical CSS for above-fold content',
      'Inline critical CSS in <head>',
      'Load non-critical CSS asynchronously',
      'Purge unused CSS with tools like PurgeCSS',
    ],
    impact: 'high',
    effort: 'medium',
  },
  {
    id: 'render-blocking-js',
    category: 'critical-path',
    name: 'Render-Blocking JavaScript',
    symptoms: ['Delayed first paint', 'Poor FID', 'Sluggish initial interactions'],
    causes: [
      'Script tags without async/defer',
      'Large JS bundles in critical path',
      'Synchronous third-party scripts',
    ],
    solutions: [
      'Use async/defer for non-critical scripts',
      'Implement code splitting by route',
      'Lazy load third-party scripts',
      'Preload critical JavaScript',
    ],
    impact: 'high',
    effort: 'medium',
  },
  {
    id: 'layout-thrashing',
    category: 'render-performance',
    name: 'Layout Thrashing',
    symptoms: ['Janky animations', 'Poor scroll performance', 'High CPU usage'],
    causes: [
      'Alternating DOM reads and writes',
      'Reading layout properties in loops',
      'Modifying styles repeatedly',
    ],
    solutions: [
      'Batch DOM reads and writes',
      'Use requestAnimationFrame for animations',
      'Avoid forced synchronous layouts',
      'Implement virtual scrolling for long lists',
    ],
    impact: 'high',
    effort: 'medium',
  },
  {
    id: 'large-bundle-sizes',
    category: 'bundle-optimization',
    name: 'Large Bundle Sizes',
    symptoms: ['Slow initial load', 'High bandwidth usage', 'Poor mobile performance'],
    causes: [
      'Unused dependencies',
      'Inefficient tree-shaking',
      'No code splitting',
      'Heavy third-party libraries',
    ],
    solutions: [
      'Analyze bundle with webpack-bundle-analyzer',
      'Remove unused dependencies',
      'Implement route-based code splitting',
      'Replace heavy libraries with lighter alternatives',
      'Use ES modules for better tree-shaking',
    ],
    impact: 'high',
    effort: 'high',
  },
  {
    id: 'unoptimized-images',
    category: 'image-optimization',
    name: 'Unoptimized Images',
    symptoms: ['Slow image loading', 'High bandwidth usage', 'Poor LCP'],
    causes: [
      'Large image files',
      'Wrong image formats',
      'No responsive images',
      'No lazy loading',
    ],
    solutions: [
      'Convert to WebP/AVIF formats',
      'Implement responsive images with srcset',
      'Lazy load below-fold images',
      'Use image compression tools',
      'Implement critical image inlining',
    ],
    impact: 'high',
    effort: 'medium',
  },
  {
    id: 'memory-leaks',
    category: 'memory-optimization',
    name: 'Memory Leaks',
    symptoms: ['Increasing memory usage', 'Slowdown over time', 'Tab crashes'],
    causes: [
      'Uncleared event listeners',
      'Forgotten timers/intervals',
      'DOM node references',
      'Closure retainment',
    ],
    solutions: [
      'Remove event listeners on cleanup',
      'Clear timers in lifecycle hooks',
      'Use WeakMap/WeakSet for caches',
      'Monitor with Chrome DevTools Memory tab',
      'Implement proper cleanup patterns',
    ],
    impact: 'high',
    effort: 'high',
  },
  {
    id: 'expensive-css-selectors',
    category: 'css-optimization',
    name: 'Expensive CSS Selectors',
    symptoms: ['Slow rendering', 'Poor animation performance', 'High repaint costs'],
    causes: [
      ':nth-child and similar pseudo-selectors',
      'Deep selector nesting',
      'Universal selectors (*)',
      'Complex attribute selectors',
    ],
    solutions: [
      'Use BEM or similar methodologies',
      'Flatten selector nesting',
      'Avoid expensive pseudo-selectors',
      'Use CSS containment',
      'Prefer class selectors',
    ],
    impact: 'medium',
    effort: 'low',
  },
  {
    id: 'inefficient-caching',
    category: 'network-optimization',
    name: 'Inefficient Caching',
    symptoms: ['Repeated downloads', 'High server load', 'Slow subsequent loads'],
    causes: [
      'Missing cache headers',
      'Short cache durations',
      'No service worker',
      'No CDN caching',
    ],
    solutions: [
      'Implement proper Cache-Control headers',
      'Use ETags for conditional requests',
      'Implement service worker caching',
      'Configure CDN edge caching',
      'Use resource versioning',
    ],
    impact: 'high',
    effort: 'medium',
  },
] as const;

// ============================================================================
// Performance Optimization Strategies
// ============================================================================

/**
 * Optimization strategies organized by area and impact
 */
export const OPTIMIZATION_STRATEGIES = {
  QUICK_WINS: [
    {
      name: 'Enable Compression',
      description: 'Use Brotli and gzip compression',
      implementation: 'Configure server compression middleware',
      expectedImprovement: '30-70% bandwidth reduction',
      effort: 'low',
      impact: 'high',
    },
    {
      name: 'Minify CSS and JS',
      description: 'Remove whitespace, comments, and shorten identifiers',
      implementation: 'Use build tools (webpack, terser, cssnano)',
      expectedImprovement: '20-30% size reduction',
      effort: 'low',
      impact: 'medium',
    },
    {
      name: 'Optimize Images',
      description: 'Convert to modern formats and compress',
      implementation: 'Use sharp, imagemin, or online tools',
      expectedImprovement: '50-70% image size reduction',
      effort: 'medium',
      impact: 'high',
    },
    {
      name: 'Lazy Load Images',
      description: 'Load images only when they enter viewport',
      implementation: 'Use loading="lazy" or IntersectionObserver',
      expectedImprovement: '30-50% initial load reduction',
      effort: 'low',
      impact: 'high',
    },
  ],
  MEDIUM_INVESTMENTS: [
    {
      name: 'Code Splitting',
      description: 'Split bundle into smaller chunks loaded on demand',
      implementation: 'Use dynamic imports and webpack splitChunks',
      expectedImprovement: '40-60% initial JS reduction',
      effort: 'medium',
      impact: 'high',
    },
    {
      name: 'Tree Shaking',
      description: 'Remove unused code from bundles',
      implementation: 'Use ES modules and configure bundler',
      expectedImprovement: '20-40% bundle reduction',
      effort: 'medium',
      impact: 'medium',
    },
    {
      name: 'Critical CSS Extraction',
      description: 'Extract and inline above-fold CSS',
      implementation: 'Use critical, penthouse, or similar tools',
      expectedImprovement: 'Improved LCP by 0.5-1.5s',
      effort: 'medium',
      impact: 'high',
    },
    {
      name: 'Resource Hints',
      description: 'Guide browser resource loading with preconnect, preload, prefetch',
      implementation: 'Add <link rel="preconnect"> and related hints',
      expectedImprovement: '100-300ms faster critical resources',
      effort: 'low',
      impact: 'medium',
    },
  ],
  HIGH_IMPACT_CHANGES: [
    {
      name: 'SSR/SSG Implementation',
      description: 'Server-side rendering or static site generation',
      implementation: 'Use Next.js, Nuxt.js, or similar frameworks',
      expectedImprovement: 'LCP improvement of 1-3s',
      effort: 'high',
      impact: 'very-high',
    },
    {
      name: 'Service Worker Caching',
      description: 'Implement intelligent caching strategies',
      implementation: 'Create service worker with Workbox or custom logic',
      expectedImprovement: '50-90% faster repeat visits',
      effort: 'medium',
      impact: 'high',
    },
    {
      name: 'Bundle Restructuring',
      description: 'Redesign bundle architecture for optimal loading',
      implementation: 'Analyze dependencies and create optimal split points',
      expectedImprovement: '30-50% initial bundle reduction',
      effort: 'high',
      impact: 'high',
    },
    {
      name: 'Render Optimization',
      description: 'Eliminate layout thrashing and optimize animations',
      implementation: 'Implement virtual scrolling, GPU acceleration',
      expectedImprovement: '60fps animations, smooth scrolling',
      effort: 'high',
      impact: 'high',
    },
  ],
} as const;

// ============================================================================
// Performance Diagnostics
// ============================================================================

/**
 * Performance diagnostics result
 */
export interface PerformanceDiagnostic {
  overall: 'good' | 'needs-improvement' | 'poor';
  metrics: {
    lcp: { value: number; status: 'good' | 'needs-improvement' | 'poor' };
    fid: { value: number; status: 'good' | 'needs-improvement' | 'poor' };
    cls: { value: number; status: 'good' | 'needs-improvement' | 'poor' };
  };
  bottlenecks: string[];
  recommendations: Array<{
    priority: 'high' | 'medium' | 'low';
    description: string;
    implementation: string;
    expectedImprovement: string;
  }>;
}

/**
 * Analyze performance metrics and provide diagnostics
 */
export function analyzePerformanceMetrics(
  lcp: number,
  fid: number,
  cls: number,
  context?: {
    framework?: string;
    pageType?: string;
    constraints?: string[];
  }
): PerformanceDiagnostic {
  const getMetricStatus = (value: number, thresholds: typeof CORE_WEB_VITALS_THRESHOLDS[keyof typeof CORE_WEB_VITALS_THRESHOLDS]): 'good' | 'needs-improvement' | 'poor' => {
    if (value <= thresholds.GOOD) return 'good';
    if (value <= thresholds.NEEDS_IMPROVEMENT) return 'needs-improvement';
    return 'poor';
  };

  const lcpStatus = getMetricStatus(lcp, CORE_WEB_VITALS_THRESHOLDS.LCP);
  const fidStatus = getMetricStatus(fid, CORE_WEB_VITALS_THRESHOLDS.FID);
  const clsStatus = getMetricStatus(cls, CORE_WEB_VITALS_THRESHOLDS.CLS);

  const bottlenecks: string[] = [];
  const recommendations: PerformanceDiagnostic['recommendations'] = [];

  // LCP analysis
  if (lcpStatus !== 'good') {
    bottlenecks.push('Large Contentful Paint (LCP) needs improvement');
    recommendations.push({
      priority: 'high',
      description: 'Optimize largest contentful paint',
      implementation: 'Extract critical CSS, optimize hero images, use resource hints',
      expectedImprovement: `${Math.round((lcp - 2500) / 100) / 10}s LCP improvement`,
    });
  }

  // FID analysis
  if (fidStatus !== 'good') {
    bottlenecks.push('First Input Delay (FID) needs improvement');
    recommendations.push({
      priority: 'high',
      description: 'Reduce main thread work during page load',
      implementation: 'Code split JavaScript, defer non-critical scripts, break up long tasks',
      expectedImprovement: `${Math.round((fid - 100) / 10) / 10}s FID improvement`,
    });
  }

  // CLS analysis
  if (clsStatus !== 'good') {
    bottlenecks.push('Cumulative Layout Shift (CLS) needs improvement');
    recommendations.push({
      priority: 'medium',
      description: 'Eliminate layout shifts',
      implementation: 'Reserve space for dynamic content, use font-display: swap with size attributes',
      expectedImprovement: `${(cls - 0.1).toFixed(2)} CLS reduction`,
    });
  }

  // Add context-specific recommendations
  if (context?.framework === 'react') {
    recommendations.push({
      priority: 'medium',
      description: 'Optimize React-specific performance',
      implementation: 'Use React.memo, useMemo, useCallback for expensive operations',
      expectedImprovement: '20-40% render performance improvement',
    });
  }

  if (context?.pageType === 'ecommerce') {
    recommendations.push({
      priority: 'high',
      description: 'Optimize for e-commerce performance',
      implementation: 'Implement product image lazy loading, optimize cart components, prioritize checkout flow',
      expectedImprovement: 'Improved conversion rate by 10-20%',
    });
  }

  const overall = lcpStatus === 'good' && fidStatus === 'good' && clsStatus === 'good'
    ? 'good'
    : lcpStatus === 'poor' || fidStatus === 'poor' || clsStatus === 'poor'
    ? 'poor'
    : 'needs-improvement';

  return {
    overall,
    metrics: {
      lcp: { value: lcp, status: lcpStatus },
      fid: { value: fid, status: fidStatus },
      cls: { value: cls, status: clsStatus },
    },
    bottlenecks,
    recommendations,
  };
}

/**
 * Get optimization priorities based on current state
 */
export function getOptimizationPriorities(
  currentMetrics: { lcp: number; fid: number; cls: number },
  resources: {
    bundleSize?: number;
    imageCount?: number;
    jsFiles?: number;
    cssFiles?: number;
  } = {}
): Array<{ priority: 'high' | 'medium' | 'low'; action: string; reasoning: string }> {
  const priorities: Array<{ priority: 'high' | 'medium' | 'low'; action: string; reasoning: string }> = [];
  const { lcp, fid, cls } = currentMetrics;

  // High-priority items (Core Web Vitals failures)
  if (lcp > CORE_WEB_VITALS_THRESHOLDS.LCP.NEEDS_IMPROVEMENT) {
    priorities.push({
      priority: 'high',
      action: 'Critical path optimization',
      reasoning: `LCP of ${lcp}ms is significantly above 2.5s target`,
    });
  }

  if (fid > CORE_WEB_VITALS_THRESHOLDS.FID.NEEDS_IMPROVEMENT) {
    priorities.push({
      priority: 'high',
      action: 'JavaScript execution optimization',
      reasoning: `FID of ${fid}ms indicates excessive main thread work`,
    });
  }

  if (cls > CORE_WEB_VITALS_THRESHOLDS.CLS.NEEDS_IMPROVEMENT) {
    priorities.push({
      priority: 'high',
      action: 'Layout stability improvement',
      reasoning: `CLS of ${cls} exceeds 0.1 threshold`,
    });
  }

  // Medium-priority items (bundle and resource optimization)
  if (resources.bundleSize && resources.bundleSize > BUNDLE_SIZE_THRESHOLDS.INITIAL_JS.NEEDS_IMPROVEMENT) {
    priorities.push({
      priority: 'medium',
      action: 'Bundle size reduction',
      reasoning: `Initial bundle size of ${Math.round(resources.bundleSize / 1024)}KB is above optimal`,
    });
  }

  if (resources.imageCount && resources.imageCount > 20) {
    priorities.push({
      priority: 'medium',
      action: 'Image optimization',
      reasoning: `High image count (${resources.imageCount}) suggests optimization opportunities`,
    });
  }

  if (resources.jsFiles && resources.jsFiles > 10) {
    priorities.push({
      priority: 'medium',
      action: 'JavaScript consolidation',
      reasoning: `Many JS files (${resources.jsFiles}) may cause connection overhead`,
    });
  }

  // Low-priority items (nice-to-have optimizations)
  priorities.push({
    priority: 'low',
    action: 'Service Worker implementation',
    reasoning: 'Caching strategies can significantly improve repeat load performance',
  });

  priorities.push({
    priority: 'low',
    action: 'Performance monitoring setup',
    reasoning: 'Continuous monitoring enables data-driven optimization decisions',
  });

  return priorities;
}

/**
 * Get performance best practices for specific framework
 */
export function getFrameworkPerformanceBestPractices(framework: 'react' | 'vue' | 'angular' | 'vanilla'): string[] {
  const frameworkBestPractices: Record<string, string[]> = {
    react: [
      'Use React.memo for expensive components',
      'Implement useMemo/useCallback for expensive computations',
      'Avoid inline object creation in JSX props',
      'Use React.lazy and Suspense for code splitting',
      'Implement virtual scrolling for long lists (react-window, react-virtualized)',
      'Avoid unnecessary re-renders with proper dependency arrays',
      'Use CSS-in-JS or styled-components judiciously',
      'Implement proper cleanup in useEffect',
      'Consider using React.StrictMode for development',
      'Optimize context usage to prevent unnecessary re-renders',
    ],
    vue: [
      'Use v-once for static content',
      'Implement computed properties instead of methods in templates',
      'Use functional components where possible',
      'Lazy load components with Vue async components',
      'Use v-if/v-show appropriately (v-if for conditional rendering, v-show for toggling)',
      'Implement virtual scrolling for long lists (vue-virtual-scroller)',
      'Avoid unnecessary watchers and computed properties',
      'Use provide/inject for deeply nested props',
      'Optimize list rendering with proper keys',
      'Implement proper cleanup in onBeforeUnmount',
    ],
    angular: [
      'Use OnPush change detection strategy',
      'Implement trackBy functions in ngFor',
      'Use pure pipes for expensive transformations',
      'Lazy load modules with loadChildren',
      'Implement virtual scrolling (CDK Virtual Scroll)',
      'Avoid template expressions that trigger change detection',
      'Use async pipe for observables',
      'Implement proper unsubscribes in OnDestroy',
      'Use ng-container for structural directives',
      'Optimize dependency injection with providedIn',
    ],
    vanilla: [
      'Use class-based inheritance for consistent object shapes',
      'Avoid modifying object structure after creation',
      'Use template literals over string concatenation',
      'Implement event delegation instead of individual listeners',
      'Use requestAnimationFrame for animations',
      'Batch DOM reads and writes',
      'Use WeakMap/WeakSet for cache storage',
      'Implement proper cleanup for event listeners and timers',
      'Use IntersectionObserver for lazy loading',
      'Avoid anti-patterns like delete operator and arguments manipulation',
    ],
  };

  return frameworkBestPractices[framework] ?? frameworkBestPractices['vanilla'] ?? [];
}