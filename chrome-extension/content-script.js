/**
 * MCP Router Test System - Content Script
 *
 * Injected into every page. Provides:
 * - Core Web Vitals measurement (LCP, FID, CLS, FCP, TTFB, INP)
 * - DOM inspection and tree traversal
 * - Script execution in page context
 * - Resource timing collection
 * - Accessibility auditing
 * - DOM mutation monitoring
 */

// ---------------------------------------------------------------------------
// Web Vitals State
// ---------------------------------------------------------------------------

const webVitals = {
  lcp: null,
  fid: null,
  cls: 0,
  fcp: null,
  ttfb: null,
  inp: null,
};

/** Track CLS session values for session window algorithm */
let clsSessionValue = 0;
let clsSessionEntries = [];

/** Track INP: keep the worst interaction latencies */
const inpEntries = [];

// ---------------------------------------------------------------------------
// Service Worker Keepalive Port
// ---------------------------------------------------------------------------

/**
 * Maintain a persistent port connection to the service worker.
 * This helps keep the service worker alive in Manifest V3.
 */
let keepalivePort = null;

function initKeepalivePort() {
  try {
    keepalivePort = chrome.runtime.connect({ name: 'keepalive' });

    keepalivePort.onDisconnect.addListener(() => {
      // Service worker may have terminated - try to reconnect
      console.log('[MCP-CS] Keepalive port disconnected, reconnecting...');
      keepalivePort = null;
      // Brief delay before reconnecting
      setTimeout(initKeepalivePort, 1000);
    });

    keepalivePort.onMessage.addListener((msg) => {
      // Handle any messages from service worker if needed
      if (msg.type === 'ping') {
        keepalivePort.postMessage({ type: 'pong', ts: Date.now() });
      }
    });

    console.log('[MCP-CS] Keepalive port connected');
  } catch (err) {
    console.error('[MCP-CS] Failed to connect keepalive port:', err);
    // Retry after a delay
    setTimeout(initKeepalivePort, 2000);
  }
}

// Initialize keepalive port immediately
initKeepalivePort();

// ---------------------------------------------------------------------------
// Web Vitals Observers
// ---------------------------------------------------------------------------

/**
 * Safely create a PerformanceObserver for a given entry type.
 * @param {string} type
 * @param {(entries: PerformanceEntryList) => void} callback
 */
function observePerformance(type, callback) {
  try {
    const observer = new PerformanceObserver((list) => {
      try {
        callback(list.getEntries());
      } catch (err) {
        console.error(`[MCP-CS] Observer callback error (${type}):`, err);
      }
    });
    observer.observe({ type, buffered: true });
  } catch {
    // Entry type not supported in this browser
  }
}

// LCP (Largest Contentful Paint)
observePerformance('largest-contentful-paint', (entries) => {
  const last = entries[entries.length - 1];
  if (last) {
    webVitals.lcp = last.startTime;
  }
});

// FID (First Input Delay)
observePerformance('first-input', (entries) => {
  const first = entries[0];
  if (first) {
    webVitals.fid = first.processingStart - first.startTime;
  }
});

// CLS (Cumulative Layout Shift) - session window algorithm
observePerformance('layout-shift', (entries) => {
  for (const entry of entries) {
    if (entry.hadRecentInput) continue;

    const lastEntry = clsSessionEntries[clsSessionEntries.length - 1];
    if (lastEntry && entry.startTime - lastEntry.startTime < 1000 && entry.startTime - clsSessionEntries[0].startTime < 5000) {
      clsSessionValue += entry.value;
      clsSessionEntries.push(entry);
    } else {
      clsSessionValue = entry.value;
      clsSessionEntries = [entry];
    }

    if (clsSessionValue > webVitals.cls) {
      webVitals.cls = clsSessionValue;
    }
  }
});

// FCP (First Contentful Paint)
observePerformance('paint', (entries) => {
  for (const entry of entries) {
    if (entry.name === 'first-contentful-paint') {
      webVitals.fcp = entry.startTime;
    }
  }
});

// TTFB (Time to First Byte)
observePerformance('navigation', (entries) => {
  const nav = entries[0];
  if (nav) {
    webVitals.ttfb = nav.responseStart - nav.requestStart;
  }
});

// INP (Interaction to Next Paint)
observePerformance('event', (entries) => {
  for (const entry of entries) {
    if (entry.interactionId) {
      inpEntries.push(entry.duration);
      // INP is the p98 of interaction durations (approximated as worst minus outliers)
      inpEntries.sort((a, b) => b - a);
      const idx = Math.min(Math.floor(inpEntries.length * 0.02), inpEntries.length - 1);
      webVitals.inp = inpEntries[idx] ?? null;
    }
  }
});

// ---------------------------------------------------------------------------
// Periodic Web Vitals Reporting
// ---------------------------------------------------------------------------

setInterval(() => {
  try {
    chrome.runtime.sendMessage({
      type: 'event',
      event: 'webvitals-update',
      data: { ...webVitals },
    });
  } catch {
    // Extension context invalidated (e.g. extension reloaded)
  }
}, 2000);

// ---------------------------------------------------------------------------
// DOM Inspection
// ---------------------------------------------------------------------------

/**
 * Inspect a DOM element and return detailed information.
 * @param {string} selector
 * @returns {object}
 */
function inspectElement(selector) {
  const el = document.querySelector(selector);
  if (!el) {
    throw new Error(`Element not found: ${selector}`);
  }

  const rect = el.getBoundingClientRect();
  const computed = getComputedStyle(el);

  return {
    tagName: el.tagName.toLowerCase(),
    id: el.id || null,
    classes: Array.from(el.classList),
    attributes: getAttributes(el),
    boundingRect: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      left: rect.left,
    },
    computedStyles: {
      fontFamily: computed.fontFamily,
      fontSize: computed.fontSize,
      fontWeight: computed.fontWeight,
      color: computed.color,
      backgroundColor: computed.backgroundColor,
      padding: computed.padding,
      margin: computed.margin,
      border: computed.border,
      display: computed.display,
      position: computed.position,
      lineHeight: computed.lineHeight,
    },
    accessibility: {
      role: el.getAttribute('role') || el.tagName.toLowerCase(),
      ariaLabel: el.getAttribute('aria-label') || null,
      ariaDescribedBy: el.getAttribute('aria-describedby') || null,
      ariaHidden: el.getAttribute('aria-hidden'),
      tabIndex: el.tabIndex,
    },
    textContent: (el.textContent || '').substring(0, 500),
    childCount: el.children.length,
  };
}

/**
 * Get all attributes of an element as a plain object.
 * @param {Element} el
 * @returns {Record<string, string>}
 */
function getAttributes(el) {
  const attrs = {};
  for (const attr of el.attributes) {
    attrs[attr.name] = attr.value;
  }
  return attrs;
}

// ---------------------------------------------------------------------------
// DOM Tree
// ---------------------------------------------------------------------------

/**
 * Build a DOM tree starting from a root element.
 * @param {number} [maxDepth=5]
 * @param {string} [rootSelector='body']
 * @returns {{ tree: object[] }}
 */
function getDomTree(maxDepth = 5, rootSelector = 'body') {
  const root = document.querySelector(rootSelector);
  if (!root) {
    throw new Error(`Root element not found: ${rootSelector}`);
  }

  function buildNode(el, depth) {
    const rect = el.getBoundingClientRect();
    const node = {
      tag: el.tagName.toLowerCase(),
      id: el.id || undefined,
      classes: el.classList.length > 0 ? Array.from(el.classList) : undefined,
      childCount: el.children.length,
      visible: rect.width > 0 && rect.height > 0,
    };

    if (depth < maxDepth && el.children.length > 0) {
      node.children = Array.from(el.children).map((child) => buildNode(child, depth + 1));
    }

    return node;
  }

  return { tree: Array.from(root.children).map((child) => buildNode(child, 0)) };
}

// ---------------------------------------------------------------------------
// Computed Styles
// ---------------------------------------------------------------------------

/**
 * Get the full computed style map for an element.
 * @param {string} selector
 * @returns {{ styles: Record<string, string> }}
 */
function getFullComputedStyles(selector) {
  const el = document.querySelector(selector);
  if (!el) {
    throw new Error(`Element not found: ${selector}`);
  }

  const computed = getComputedStyle(el);
  const styles = {};

  for (let i = 0; i < computed.length; i++) {
    const prop = computed[i];
    styles[prop] = computed.getPropertyValue(prop);
  }

  return { styles };
}

// ---------------------------------------------------------------------------
// Page Context Script Execution
// ---------------------------------------------------------------------------

/**
 * Execute code in the actual page context (not the content script isolated world).
 * Uses script injection + CustomEvent to pass data back.
 * @param {string} code
 * @returns {Promise<any>}
 */
function executeInPageContext(code) {
  return new Promise((resolve, reject) => {
    const eventId = `mcp-result-${crypto.randomUUID()}`;

    // Listen for the result
    const handler = (event) => {
      document.removeEventListener(eventId, handler);
      if (event.detail && event.detail.error) {
        reject(new Error(event.detail.error));
      } else {
        resolve(event.detail?.result ?? null);
      }
    };
    document.addEventListener(eventId, handler);

    // Inject a script that runs in page context and fires a CustomEvent with the result
    const script = document.createElement('script');
    script.textContent = `
      (function() {
        try {
          const __result = (function() { ${code} })();
          document.dispatchEvent(new CustomEvent('${eventId}', {
            detail: { result: __result }
          }));
        } catch (e) {
          document.dispatchEvent(new CustomEvent('${eventId}', {
            detail: { error: e.message }
          }));
        }
      })();
    `;
    document.documentElement.appendChild(script);
    script.remove();

    // Timeout after 10s
    setTimeout(() => {
      document.removeEventListener(eventId, handler);
      reject(new Error('Page context execution timed out'));
    }, 10_000);
  });
}

// ---------------------------------------------------------------------------
// Resource Timing
// ---------------------------------------------------------------------------

/**
 * Collect resource timing entries.
 * @returns {{ resources: object[], navigation: object|null }}
 */
function getResourceTiming() {
  const resources = performance.getEntriesByType('resource').map((r) => ({
    name: r.name,
    initiatorType: r.initiatorType,
    transferSize: r.transferSize,
    encodedBodySize: r.encodedBodySize,
    decodedBodySize: r.decodedBodySize,
    duration: r.duration,
    timing: {
      dns: r.domainLookupEnd - r.domainLookupStart,
      tcp: r.connectEnd - r.connectStart,
      ssl: r.secureConnectionStart > 0 ? r.connectEnd - r.secureConnectionStart : 0,
      ttfb: r.responseStart - r.requestStart,
      download: r.responseEnd - r.responseStart,
    },
  }));

  const navEntries = performance.getEntriesByType('navigation');
  const nav = navEntries[0] ? {
    type: navEntries[0].type,
    redirectCount: navEntries[0].redirectCount,
    domContentLoaded: navEntries[0].domContentLoadedEventEnd - navEntries[0].startTime,
    loadComplete: navEntries[0].loadEventEnd - navEntries[0].startTime,
    domInteractive: navEntries[0].domInteractive - navEntries[0].startTime,
    timing: {
      dns: navEntries[0].domainLookupEnd - navEntries[0].domainLookupStart,
      tcp: navEntries[0].connectEnd - navEntries[0].connectStart,
      ssl: navEntries[0].secureConnectionStart > 0 ? navEntries[0].connectEnd - navEntries[0].secureConnectionStart : 0,
      ttfb: navEntries[0].responseStart - navEntries[0].requestStart,
      download: navEntries[0].responseEnd - navEntries[0].responseStart,
    },
  } : null;

  return { resources, navigation: nav };
}

// ---------------------------------------------------------------------------
// Accessibility Audit
// ---------------------------------------------------------------------------

/**
 * Run a basic accessibility audit on the page.
 * @returns {{ violations: object[], passes: object[], score: number }}
 */
function runAccessibilityAudit() {
  const violations = [];
  const passes = [];

  // 1. Check images for alt text
  const images = document.querySelectorAll('img');
  let imagesWithAlt = 0;
  images.forEach((img) => {
    if (!img.getAttribute('alt') && img.getAttribute('alt') !== '') {
      violations.push({
        rule: 'image-alt',
        severity: 'critical',
        element: describeElement(img),
        message: 'Image missing alt attribute',
      });
    } else {
      imagesWithAlt++;
    }
  });
  if (imagesWithAlt === images.length && images.length > 0) {
    passes.push({ rule: 'image-alt', message: 'All images have alt attributes' });
  }

  // 2. Check color contrast
  checkColorContrast(violations, passes);

  // 3. Check heading hierarchy
  checkHeadingHierarchy(violations, passes);

  // 4. Check form labels
  checkFormLabels(violations, passes);

  // 5. Check ARIA attributes
  checkAriaAttributes(violations, passes);

  // 6. Check touch target sizes
  checkTouchTargets(violations, passes);

  // Compute score (simple: passes / (passes + violations) * 100)
  const total = passes.length + violations.length;
  const score = total > 0 ? Math.round((passes.length / total) * 100) : 100;

  return { violations, passes, score };
}

/**
 * Create a short description of an element for audit reports.
 * @param {Element} el
 * @returns {string}
 */
function describeElement(el) {
  let desc = el.tagName.toLowerCase();
  if (el.id) desc += `#${el.id}`;
  if (el.className && typeof el.className === 'string') {
    desc += `.${el.className.split(/\s+/).join('.')}`;
  }
  return desc;
}

/**
 * Compute relative luminance of an RGB color.
 * @param {number} r 0-255
 * @param {number} g 0-255
 * @param {number} b 0-255
 * @returns {number}
 */
function luminance(r, g, b) {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    c = c / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

/**
 * Parse a CSS color string (rgb/rgba) into [r,g,b].
 * @param {string} color
 * @returns {number[]|null}
 */
function parseColor(color) {
  const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (match) return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
  return null;
}

/**
 * Check color contrast of text elements.
 */
function checkColorContrast(violations, passes) {
  const textElements = document.querySelectorAll('p, span, a, li, h1, h2, h3, h4, h5, h6, label, td, th, button');
  let contrastPassing = 0;
  const checked = Math.min(textElements.length, 50); // sample up to 50 elements

  for (let i = 0; i < checked; i++) {
    const el = textElements[i];
    const computed = getComputedStyle(el);
    const fgColor = parseColor(computed.color);
    const bgColor = parseColor(computed.backgroundColor);

    if (!fgColor || !bgColor) continue;
    // Skip transparent backgrounds
    if (computed.backgroundColor === 'rgba(0, 0, 0, 0)') continue;

    const fgLum = luminance(...fgColor);
    const bgLum = luminance(...bgColor);
    const ratio = (Math.max(fgLum, bgLum) + 0.05) / (Math.min(fgLum, bgLum) + 0.05);

    const fontSize = parseFloat(computed.fontSize);
    const isBold = parseInt(computed.fontWeight) >= 700;
    const isLargeText = fontSize >= 18.66 || (fontSize >= 14 && isBold);
    const minRatio = isLargeText ? 3.0 : 4.5;

    if (ratio < minRatio) {
      violations.push({
        rule: 'color-contrast',
        severity: 'serious',
        element: describeElement(el),
        message: `Contrast ratio ${ratio.toFixed(2)}:1 is below ${minRatio}:1 threshold`,
      });
    } else {
      contrastPassing++;
    }
  }

  if (contrastPassing === checked && checked > 0) {
    passes.push({ rule: 'color-contrast', message: 'Sampled text elements pass contrast requirements' });
  }
}

/**
 * Check that heading levels don't skip (e.g. h1 -> h3 without h2).
 */
function checkHeadingHierarchy(violations, passes) {
  const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
  let lastLevel = 0;
  let hierarchyOk = true;

  headings.forEach((h) => {
    const level = parseInt(h.tagName[1]);
    if (level > lastLevel + 1 && lastLevel > 0) {
      violations.push({
        rule: 'heading-order',
        severity: 'moderate',
        element: describeElement(h),
        message: `Heading level skipped from h${lastLevel} to h${level}`,
      });
      hierarchyOk = false;
    }
    lastLevel = level;
  });

  if (hierarchyOk && headings.length > 0) {
    passes.push({ rule: 'heading-order', message: 'Heading hierarchy is correct' });
  }
}

/**
 * Check that form inputs have associated labels.
 */
function checkFormLabels(violations, passes) {
  const inputs = document.querySelectorAll('input, select, textarea');
  let allLabeled = true;

  inputs.forEach((input) => {
    if (input.type === 'hidden' || input.type === 'submit' || input.type === 'button') return;

    const hasLabel = input.id && document.querySelector(`label[for="${input.id}"]`);
    const hasAriaLabel = input.getAttribute('aria-label');
    const hasAriaLabelledBy = input.getAttribute('aria-labelledby');
    const wrappedInLabel = input.closest('label');

    if (!hasLabel && !hasAriaLabel && !hasAriaLabelledBy && !wrappedInLabel) {
      violations.push({
        rule: 'form-label',
        severity: 'critical',
        element: describeElement(input),
        message: 'Form input has no associated label',
      });
      allLabeled = false;
    }
  });

  if (allLabeled && inputs.length > 0) {
    passes.push({ rule: 'form-label', message: 'All form inputs have labels' });
  }
}

/**
 * Check for invalid ARIA attributes.
 */
function checkAriaAttributes(violations, passes) {
  const ariaElements = document.querySelectorAll('[role], [aria-label], [aria-labelledby], [aria-describedby], [aria-hidden]');
  let allValid = true;

  ariaElements.forEach((el) => {
    const role = el.getAttribute('role');
    if (role) {
      const validRoles = [
        'alert', 'alertdialog', 'application', 'article', 'banner', 'button',
        'cell', 'checkbox', 'columnheader', 'combobox', 'complementary',
        'contentinfo', 'definition', 'dialog', 'directory', 'document',
        'feed', 'figure', 'form', 'grid', 'gridcell', 'group', 'heading',
        'img', 'link', 'list', 'listbox', 'listitem', 'log', 'main',
        'marquee', 'math', 'menu', 'menubar', 'menuitem', 'menuitemcheckbox',
        'menuitemradio', 'navigation', 'none', 'note', 'option', 'presentation',
        'progressbar', 'radio', 'radiogroup', 'region', 'row', 'rowgroup',
        'rowheader', 'scrollbar', 'search', 'searchbox', 'separator',
        'slider', 'spinbutton', 'status', 'switch', 'tab', 'table',
        'tablist', 'tabpanel', 'term', 'textbox', 'timer', 'toolbar',
        'tooltip', 'tree', 'treegrid', 'treeitem',
      ];
      if (!validRoles.includes(role)) {
        violations.push({
          rule: 'aria-role',
          severity: 'serious',
          element: describeElement(el),
          message: `Invalid ARIA role: "${role}"`,
        });
        allValid = false;
      }
    }

    // Check aria-labelledby references exist
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const ids = labelledBy.split(/\s+/);
      for (const id of ids) {
        if (!document.getElementById(id)) {
          violations.push({
            rule: 'aria-labelledby',
            severity: 'serious',
            element: describeElement(el),
            message: `aria-labelledby references non-existent id: "${id}"`,
          });
          allValid = false;
        }
      }
    }
  });

  if (allValid && ariaElements.length > 0) {
    passes.push({ rule: 'aria-valid', message: 'ARIA attributes are valid' });
  }
}

/**
 * Check interactive elements meet minimum touch target size (48x48px).
 */
function checkTouchTargets(violations, passes) {
  const interactiveElements = document.querySelectorAll('a, button, input, select, textarea, [role="button"], [role="link"]');
  let allGood = true;
  const MIN_SIZE = 48;

  interactiveElements.forEach((el) => {
    if (el.type === 'hidden') return;
    const rect = el.getBoundingClientRect();
    // Only check visible elements
    if (rect.width === 0 && rect.height === 0) return;

    if (rect.width < MIN_SIZE || rect.height < MIN_SIZE) {
      violations.push({
        rule: 'touch-target-size',
        severity: 'moderate',
        element: describeElement(el),
        message: `Touch target is ${Math.round(rect.width)}x${Math.round(rect.height)}px, minimum is ${MIN_SIZE}x${MIN_SIZE}px`,
      });
      allGood = false;
    }
  });

  if (allGood && interactiveElements.length > 0) {
    passes.push({ rule: 'touch-target-size', message: 'All interactive elements meet minimum touch target size' });
  }
}

// ---------------------------------------------------------------------------
// DOM Mutation Monitoring
// ---------------------------------------------------------------------------

/** Track significant DOM mutations and report to service worker. */
const mutationBatch = [];
let mutationFlushTimer = null;

const mutationObserver = new MutationObserver((mutations) => {
  try {
    for (const mutation of mutations) {
      if (mutation.type === 'childList' && (mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0)) {
        mutationBatch.push({
          type: 'childList',
          target: describeElement(mutation.target),
          added: mutation.addedNodes.length,
          removed: mutation.removedNodes.length,
        });
      } else if (mutation.type === 'attributes') {
        mutationBatch.push({
          type: 'attributes',
          target: describeElement(mutation.target),
          attribute: mutation.attributeName,
        });
      }
    }

    // Debounce: flush after 500ms of quiet
    clearTimeout(mutationFlushTimer);
    mutationFlushTimer = setTimeout(flushMutations, 500);
  } catch (err) {
    console.error('[MCP-CS] Mutation observer error:', err);
  }
});

function flushMutations() {
  if (mutationBatch.length === 0) return;

  const batch = mutationBatch.splice(0, mutationBatch.length);
  try {
    chrome.runtime.sendMessage({
      type: 'event',
      event: 'dom-mutations',
      data: { count: batch.length, mutations: batch.slice(0, 50) }, // cap at 50 per batch
    });
  } catch {
    // Extension context may have been invalidated
  }
}

// Start observing once DOM is ready
if (document.body) {
  mutationObserver.observe(document.body, {
    childList: true,
    attributes: true,
    subtree: true,
  });
} else {
  document.addEventListener('DOMContentLoaded', () => {
    mutationObserver.observe(document.body, {
      childList: true,
      attributes: true,
      subtree: true,
    });
  });
}

// ---------------------------------------------------------------------------
// Design Audit Functions
// ---------------------------------------------------------------------------

/**
 * Get the effective background color for an element, walking up ancestors
 * to resolve transparent backgrounds.
 * @param {Element} el
 * @returns {number[]|null} [r,g,b] or null
 */
function getEffectiveBackgroundColor(el) {
  try {
    let current = el;
    while (current && current !== document.documentElement) {
      const bg = getComputedStyle(current).backgroundColor;
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
        return parseColor(bg);
      }
      current = current.parentElement;
    }
    return [255, 255, 255]; // default white
  } catch {
    return [255, 255, 255];
  }
}

/**
 * Build a unique CSS selector for an element.
 * @param {Element} el
 * @returns {string}
 */
function getSelector(el) {
  try {
    if (el.id) return `#${el.id}`;
    const parts = [];
    let current = el;
    while (current && current !== document.body && parts.length < 4) {
      let part = current.tagName.toLowerCase();
      if (current.id) { parts.unshift(`#${current.id}`); break; }
      if (current.className && typeof current.className === 'string') {
        const cls = current.className.trim().split(/\s+/).slice(0, 2).join('.');
        if (cls) part += `.${cls}`;
      }
      parts.unshift(part);
      current = current.parentElement;
    }
    return parts.join(' > ');
  } catch {
    return el.tagName ? el.tagName.toLowerCase() : 'unknown';
  }
}

/**
 * Check color contrast of all visible text elements (WCAG AA/AAA).
 * @returns {{ passes: object[], violations: object[] }}
 */
function checkColorContrastDesignAudit() {
  const passes = [];
  const violations = [];
  try {
    const textSelectors = 'p, span, a, li, h1, h2, h3, h4, h5, h6, label, td, th, button, div, strong, em, b, i, blockquote, figcaption, dt, dd';
    const elements = document.querySelectorAll(textSelectors);
    const checked = Math.min(elements.length, 200);

    for (let i = 0; i < checked; i++) {
      const el = elements[i];
      try {
        const computed = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        if (!el.textContent || el.textContent.trim().length === 0) continue;

        const fgColor = parseColor(computed.color);
        if (!fgColor) continue;
        const bgColor = getEffectiveBackgroundColor(el);
        if (!bgColor) continue;

        const fgLum = luminance(...fgColor);
        const bgLum = luminance(...bgColor);
        const ratio = (Math.max(fgLum, bgLum) + 0.05) / (Math.min(fgLum, bgLum) + 0.05);

        const fontSize = parseFloat(computed.fontSize);
        const isBold = parseInt(computed.fontWeight) >= 700;
        const isLargeText = fontSize >= 18.66 || (fontSize >= 14 && isBold);
        const requiredAA = isLargeText ? 3.0 : 4.5;
        const requiredAAA = isLargeText ? 4.5 : 7.0;

        const entry = {
          element: describeElement(el),
          selector: getSelector(el),
          foreground: computed.color,
          background: computed.backgroundColor,
          ratio: Math.round(ratio * 100) / 100,
          requiredAA,
          requiredAAA,
        };

        if (ratio >= requiredAAA) {
          passes.push({ ...entry, level: 'AAA' });
        } else if (ratio >= requiredAA) {
          passes.push({ ...entry, level: 'AA' });
        } else {
          violations.push({ ...entry, level: ratio >= 3.0 ? 'partial' : 'fail' });
        }
      } catch { /* skip element */ }
    }
  } catch (err) {
    console.error('[MCP-CS] checkColorContrastDesignAudit error:', err);
  }
  return { passes, violations };
}

/**
 * Analyze typography: font inventory, readability issues.
 * @returns {{ fonts: object[], issues: string[], readabilityScore: number }}
 */
function analyzeTypography() {
  const fontMap = new Map();
  const issues = [];
  let totalElements = 0;
  let readableCount = 0;

  try {
    const elements = document.querySelectorAll('p, span, a, li, h1, h2, h3, h4, h5, h6, label, td, th, button, div, blockquote');
    const checked = Math.min(elements.length, 300);

    for (let i = 0; i < checked; i++) {
      const el = elements[i];
      try {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        if (!el.textContent || el.textContent.trim().length === 0) continue;

        const computed = getComputedStyle(el);
        const fontSize = parseFloat(computed.fontSize);
        const lineHeight = parseFloat(computed.lineHeight) || fontSize * 1.2;
        const fontFamily = computed.fontFamily;
        const key = `${fontSize}px|${Math.round(lineHeight * 10) / 10}px|${fontFamily}`;

        if (!fontMap.has(key)) {
          fontMap.set(key, { fontSize, lineHeight, fontFamily, count: 0 });
        }
        fontMap.get(key).count++;
        totalElements++;

        const lhRatio = lineHeight / fontSize;
        let readable = true;
        if (fontSize < 12) {
          issues.push(`Small font (${fontSize}px) on: ${describeElement(el)}`);
          readable = false;
        }
        if (lhRatio < 1.2) {
          issues.push(`Tight line-height (${lhRatio.toFixed(2)}) on: ${describeElement(el)}`);
          readable = false;
        }
        if (rect.width > 0 && fontSize > 0) {
          const charsPerLine = rect.width / (fontSize * 0.5);
          if (charsPerLine > 80 && el.tagName !== 'DIV') {
            issues.push(`Long lines (~${Math.round(charsPerLine)}ch) on: ${describeElement(el)}`);
            readable = false;
          }
        }
        if (readable) readableCount++;
      } catch { /* skip */ }
    }
  } catch (err) {
    console.error('[MCP-CS] analyzeTypography error:', err);
  }

  const fonts = Array.from(fontMap.values()).sort((a, b) => b.count - a.count);
  const readabilityScore = totalElements > 0 ? Math.round((readableCount / totalElements) * 100) : 100;
  return { fonts, issues: issues.slice(0, 50), readabilityScore };
}

/**
 * Check touch target sizes (>= 48x48px for interactive elements).
 * @returns {{ total: number, passing: number, failing: number, violations: object[] }}
 */
function checkTouchTargetsDesignAudit() {
  const violations = [];
  let total = 0;
  let passing = 0;
  let failing = 0;
  const MIN = 48;

  try {
    const elements = document.querySelectorAll('a, button, input, select, textarea, [role="button"], [role="link"], [onclick]');
    for (const el of elements) {
      try {
        if (el.type === 'hidden') continue;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        total++;
        if (rect.width >= MIN && rect.height >= MIN) {
          passing++;
        } else {
          failing++;
          violations.push({
            element: describeElement(el),
            selector: getSelector(el),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          });
        }
      } catch { /* skip */ }
    }
  } catch (err) {
    console.error('[MCP-CS] checkTouchTargetsDesignAudit error:', err);
  }
  return { total, passing, failing, violations: violations.slice(0, 50) };
}

/**
 * Get CLS data with element attributions from layout shift entries.
 * @returns {{ score: number, shifts: object[] }}
 */
function getLayoutShiftScore() {
  return {
    score: webVitals.cls,
    shifts: clsSessionEntries.map(e => ({
      value: e.value,
      startTime: e.startTime,
      sources: (e.sources || []).map(s => s.node ? describeElement(s.node) : 'unknown'),
    })),
  };
}

/**
 * Check for responsiveness issues: overflow, horizontal scroll.
 * @returns {{ overflowingElements: object[], hasHorizontalScroll: boolean, viewportWidth: number }}
 */
function checkResponsiveness() {
  const overflowingElements = [];
  const vw = document.documentElement.clientWidth;
  let hasHorizontalScroll = document.documentElement.scrollWidth > vw;

  try {
    const all = document.querySelectorAll('*');
    const checked = Math.min(all.length, 500);
    for (let i = 0; i < checked; i++) {
      try {
        const el = all[i];
        const rect = el.getBoundingClientRect();
        if (rect.right > vw + 1) {
          overflowingElements.push({
            element: describeElement(el),
            selector: getSelector(el),
            width: Math.round(rect.width),
            right: Math.round(rect.right),
          });
        }
      } catch { /* skip */ }
    }
  } catch (err) {
    console.error('[MCP-CS] checkResponsiveness error:', err);
  }
  return { overflowingElements: overflowingElements.slice(0, 30), hasHorizontalScroll, viewportWidth: vw };
}

/**
 * Analyze z-index stacking: collect layers, flag high values.
 * @returns {{ layers: object[], maxZIndex: number, potentialIssues: string[] }}
 */
function analyzeZIndex() {
  const layers = [];
  let maxZIndex = 0;
  const potentialIssues = [];

  try {
    const all = document.querySelectorAll('*');
    for (const el of all) {
      try {
        const computed = getComputedStyle(el);
        const zIndex = parseInt(computed.zIndex);
        if (!isNaN(zIndex) && computed.position !== 'static') {
          layers.push({
            element: describeElement(el),
            selector: getSelector(el),
            zIndex,
            position: computed.position,
          });
          if (zIndex > maxZIndex) maxZIndex = zIndex;
          if (zIndex > 9999) {
            potentialIssues.push(`Suspiciously high z-index (${zIndex}) on: ${describeElement(el)}`);
          }
        }
      } catch { /* skip */ }
    }
  } catch (err) {
    console.error('[MCP-CS] analyzeZIndex error:', err);
  }
  layers.sort((a, b) => b.zIndex - a.zIndex);
  return { layers: layers.slice(0, 50), maxZIndex, potentialIssues };
}

/**
 * Analyze spacing consistency (margins and paddings).
 * @returns {{ commonMargins: object[], commonPaddings: object[], consistencyScore: number }}
 */
function analyzeSpacing() {
  const marginCounts = new Map();
  const paddingCounts = new Map();

  try {
    const blocks = document.querySelectorAll('div, section, article, main, aside, header, footer, nav, p, ul, ol, form, fieldset');
    const checked = Math.min(blocks.length, 300);

    for (let i = 0; i < checked; i++) {
      try {
        const el = blocks[i];
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;

        const computed = getComputedStyle(el);
        const m = computed.margin;
        const p = computed.padding;
        marginCounts.set(m, (marginCounts.get(m) || 0) + 1);
        paddingCounts.set(p, (paddingCounts.get(p) || 0) + 1);
      } catch { /* skip */ }
    }
  } catch (err) {
    console.error('[MCP-CS] analyzeSpacing error:', err);
  }

  const toSorted = (map) => Array.from(map.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

  const commonMargins = toSorted(marginCounts);
  const commonPaddings = toSorted(paddingCounts);

  // Consistency: top values cover what % of total
  const totalM = Array.from(marginCounts.values()).reduce((s, v) => s + v, 0);
  const topMCoverage = commonMargins.slice(0, 5).reduce((s, v) => s + v.count, 0) / (totalM || 1);
  const totalP = Array.from(paddingCounts.values()).reduce((s, v) => s + v, 0);
  const topPCoverage = commonPaddings.slice(0, 5).reduce((s, v) => s + v.count, 0) / (totalP || 1);
  const consistencyScore = Math.round(((topMCoverage + topPCoverage) / 2) * 100);

  return { commonMargins, commonPaddings, consistencyScore };
}

/**
 * Extract all colors used on the page.
 * @returns {{ colors: object[], totalUnique: number, groups: object[] }}
 */
function extractColorPalette() {
  const colorMap = new Map();

  try {
    const elements = document.querySelectorAll('*');
    const checked = Math.min(elements.length, 500);

    for (let i = 0; i < checked; i++) {
      try {
        const computed = getComputedStyle(elements[i]);
        const rect = elements[i].getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;

        const props = [
          { value: computed.color, usage: 'text' },
          { value: computed.backgroundColor, usage: 'background' },
          { value: computed.borderColor, usage: 'border' },
        ];

        for (const { value, usage } of props) {
          if (!value || value === 'rgba(0, 0, 0, 0)' || value === 'transparent') continue;
          const key = value;
          if (!colorMap.has(key)) {
            colorMap.set(key, { value: key, count: 0, usage: new Set() });
          }
          const entry = colorMap.get(key);
          entry.count++;
          entry.usage.add(usage);
        }
      } catch { /* skip */ }
    }
  } catch (err) {
    console.error('[MCP-CS] extractColorPalette error:', err);
  }

  const colors = Array.from(colorMap.values())
    .map(c => ({ value: c.value, count: c.count, usage: Array.from(c.usage) }))
    .sort((a, b) => b.count - a.count);

  // Simple grouping by RGB proximity
  const groups = [];
  const used = new Set();
  for (const c of colors) {
    if (used.has(c.value)) continue;
    const group = { representative: c.value, members: [c.value] };
    used.add(c.value);
    const rgb1 = parseColor(c.value);
    if (rgb1) {
      for (const other of colors) {
        if (used.has(other.value)) continue;
        const rgb2 = parseColor(other.value);
        if (rgb2) {
          const dist = Math.abs(rgb1[0] - rgb2[0]) + Math.abs(rgb1[1] - rgb2[1]) + Math.abs(rgb1[2] - rgb2[2]);
          if (dist < 30) {
            group.members.push(other.value);
            used.add(other.value);
          }
        }
      }
    }
    groups.push(group);
  }

  return { colors: colors.slice(0, 50), totalUnique: colors.length, groups: groups.slice(0, 20) };
}

/**
 * Audit images: alt text, dimensions, oversized, lazy loading.
 * @returns {object}
 */
function auditImages() {
  const missingAlt = [];
  const oversized = [];
  const missingDimensions = [];
  let lazyLoaded = 0;
  let eagerLoaded = 0;

  try {
    const images = document.querySelectorAll('img');
    for (const img of images) {
      try {
        if (!img.getAttribute('alt') && img.getAttribute('alt') !== '') {
          missingAlt.push({ src: (img.src || '').substring(0, 200), selector: getSelector(img) });
        }
        if (!img.hasAttribute('width') || !img.hasAttribute('height')) {
          missingDimensions.push({ src: (img.src || '').substring(0, 200), selector: getSelector(img) });
        }
        if (img.naturalWidth > 0 && img.width > 0 && img.naturalWidth > img.width * 2) {
          oversized.push({
            src: (img.src || '').substring(0, 200),
            selector: getSelector(img),
            naturalWidth: img.naturalWidth,
            displayWidth: img.width,
            ratio: Math.round((img.naturalWidth / img.width) * 10) / 10,
          });
        }
        if (img.loading === 'lazy') lazyLoaded++;
        else eagerLoaded++;
      } catch { /* skip */ }
    }
    return { total: images.length, missingAlt, oversized, missingDimensions, lazyLoaded, eagerLoaded };
  } catch (err) {
    console.error('[MCP-CS] auditImages error:', err);
    return { total: 0, missingAlt: [], oversized: [], missingDimensions: [], lazyLoaded: 0, eagerLoaded: 0 };
  }
}

/**
 * Audit forms: labels, placeholders, required, types.
 * @returns {{ total: number, withLabels: number, withoutLabels: number, violations: object[] }}
 */
function auditForms() {
  const violations = [];
  let withLabels = 0;
  let withoutLabels = 0;

  try {
    const inputs = document.querySelectorAll('input, select, textarea');
    for (const input of inputs) {
      try {
        if (input.type === 'hidden' || input.type === 'submit' || input.type === 'button') continue;

        const hasLabel = input.id && document.querySelector(`label[for="${input.id}"]`);
        const hasAriaLabel = input.getAttribute('aria-label');
        const hasAriaLabelledBy = input.getAttribute('aria-labelledby');
        const wrappedInLabel = input.closest('label');
        const hasPlaceholder = input.getAttribute('placeholder');

        if (hasLabel || hasAriaLabel || hasAriaLabelledBy || wrappedInLabel) {
          withLabels++;
        } else {
          withoutLabels++;
          violations.push({
            element: describeElement(input),
            selector: getSelector(input),
            type: input.type || 'text',
            hasPlaceholder: !!hasPlaceholder,
            hasRequired: input.hasAttribute('required'),
            issue: 'No associated label',
          });
        }
      } catch { /* skip */ }
    }
    return { total: inputs.length, withLabels, withoutLabels, violations };
  } catch (err) {
    console.error('[MCP-CS] auditForms error:', err);
    return { total: 0, withLabels: 0, withoutLabels: 0, violations: [] };
  }
}

/**
 * Audit interactive elements: buttons, links — sizing, contrast, aria.
 * @returns {{ total: number, violations: object[] }}
 */
function auditInteractive() {
  const violations = [];
  let total = 0;

  try {
    const elements = document.querySelectorAll('a, button, [role="button"], [role="link"]');
    for (const el of elements) {
      try {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        total++;

        // Check minimum size
        if (rect.width < 44 || rect.height < 44) {
          violations.push({
            element: describeElement(el),
            selector: getSelector(el),
            issue: 'undersized',
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          });
        }

        // Check icon-only buttons without aria-label
        const text = (el.textContent || '').trim();
        if (text.length === 0 && !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby')) {
          violations.push({
            element: describeElement(el),
            selector: getSelector(el),
            issue: 'icon-only without aria-label',
          });
        }
      } catch { /* skip */ }
    }
  } catch (err) {
    console.error('[MCP-CS] auditInteractive error:', err);
  }
  return { total, violations: violations.slice(0, 50) };
}

/**
 * Run a comprehensive UI/UX design audit.
 * @returns {Promise<object>}
 */
async function runDesignAudit() {
  try {
    return {
      colorContrast: checkColorContrastDesignAudit(),
      typography: analyzeTypography(),
      touchTargets: checkTouchTargetsDesignAudit(),
      layoutShifts: getLayoutShiftScore(),
      responsiveness: checkResponsiveness(),
      zIndexStacking: analyzeZIndex(),
      spacing: analyzeSpacing(),
      colorPalette: extractColorPalette(),
      images: auditImages(),
      forms: auditForms(),
      interactiveElements: auditInteractive(),
    };
  } catch (err) {
    console.error('[MCP-CS] runDesignAudit error:', err);
    return { error: err.message || String(err) };
  }
}

// Layout shift tracking (for DOM mutation reporting)
observePerformance('layout-shift', (entries) => {
  const significant = entries.filter((e) => !e.hadRecentInput && e.value > 0.01);
  if (significant.length > 0) {
    try {
      chrome.runtime.sendMessage({
        type: 'event',
        event: 'layout-shifts',
        data: {
          shifts: significant.map((e) => ({
            value: e.value,
            startTime: e.startTime,
            sources: e.sources?.map((s) => s.node ? describeElement(s.node) : 'unknown') || [],
          })),
        },
      });
    } catch {
      // Extension context invalidated
    }
  }
});

// ---------------------------------------------------------------------------
// Visual User Simulation (Virtual Cursor & Scroll)
// ---------------------------------------------------------------------------

/** @type {HTMLElement|null} */
let virtualCursor = null;

/** @type {HTMLElement|null} */
let cursorTrailContainer = null;

/** Cursor state for natural movement */
const cursorState = {
  x: 0,
  y: 0,
  targetX: 0,
  targetY: 0,
  velocityX: 0,
  velocityY: 0,
};

/**
 * Inject the virtual cursor into the page.
 * Creates a floating SVG cursor with glow effect.
 */
function injectVirtualCursor() {
  if (virtualCursor) return;

n  // Create cursor container
  virtualCursor = document.createElement('div');
  virtualCursor.id = 'mcp-virtual-cursor';
  virtualCursor.innerHTML = `
    <svg viewBox="0 0 24 24" width="24" height="24" style="filter: drop-shadow(0 0 4px rgba(88, 166, 255, 0.6));">
      <path d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.87c.48 0 .72-.58.38-.92L6.35 2.85a.5.5 0 0 0-.85.36Z"
        fill="white"
        stroke="#222"
        stroke-width="1.5"
        stroke-linejoin="round"
      />
    </svg>
  `;
  virtualCursor.style.cssText = `
    position: fixed;
    z-index: 2147483647;
    pointer-events: none;
    width: 24px;
    height: 24px;
    transition: left 0.15s ease-out, top 0.15s ease-out;
    opacity: 0;
  `;

  // Create trail container for click ripples
  cursorTrailContainer = document.createElement('div');
  cursorTrailContainer.id = 'mcp-cursor-trail';
  cursorTrailContainer.style.cssText = `
    position: fixed;
    z-index: 2147483646;
    pointer-events: none;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
  `;

  document.body.appendChild(cursorTrailContainer);
  document.body.appendChild(virtualCursor);

n  // Initialize position
  cursorState.x = window.innerWidth / 2;
  cursorState.y = window.innerHeight / 4;
  virtualCursor.style.left = cursorState.x + 'px';
  virtualCursor.style.top = cursorState.y + 'px';
  virtualCursor.style.opacity = '1';
}

/**
 * Remove the virtual cursor from the page.
 */
function removeVirtualCursor() {
  if (virtualCursor) {
    virtualCursor.remove();
    virtualCursor = null;
  }
  if (cursorTrailContainer) {
    cursorTrailContainer.remove();
    cursorTrailContainer = null;
  }
}

/**
 * Move cursor smoothly to a position.
 * @param {number} x - Target X coordinate
 * @param {number} y - Target Y coordinate
 * @param {number} [duration=300] - Animation duration in ms
 */
async function moveCursorTo(x, y, duration = 300) {
  return new Promise((resolve) => {
    if (!virtualCursor) {
      resolve();
      return;
    }

    const startX = cursorState.x;
    const startY = cursorState.y;
    const startTime = Date.now();

    // Add slight random offset for natural movement
    const offsetX = (Math.random() - 0.5) * 10;
    const offsetY = (Math.random() - 0.5) * 10;
    const targetX = x + offsetX;
    const targetY = y + offsetY;

    function animate() {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);

      cursorState.x = startX + (targetX - startX) * eased;
      cursorState.y = startY + (targetY - startY) * eased;

      virtualCursor.style.left = cursorState.x + 'px';
      virtualCursor.style.top = cursorState.y + 'px';

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        resolve();
      }
    }

    requestAnimationFrame(animate);
  });
}

/**
 * Show a click ripple effect at the specified position.
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 */
function showClickRipple(x, y) {
  if (!cursorTrailContainer) return;

  const ripple = document.createElement('div');
  ripple.style.cssText = `
    position: absolute;
    left: ${x}px;
    top: ${y}px;
    width: 20px;
    height: 20px;
    margin-left: -10px;
    margin-top: -10px;
    border-radius: 50%;
    background: rgba(88, 166, 255, 0.5);
    transform: scale(0);
    animation: mcp-cursor-ripple 0.4s ease-out forwards;
    pointer-events: none;
  `;
  cursorTrailContainer.appendChild(ripple);

  // Remove after animation
  setTimeout(() => ripple.remove(), 400);
}

/**
 * Simulate a click at a position.
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 */
async function simulateClick(x, y) {
  await moveCursorTo(x, y, 200);
  showClickRipple(x, y);

  // Brief pause to show the click
  await new Promise(r => setTimeout(r, 150));
}

/**
 * Find interesting elements to pause on during scroll.
 * @returns {Array<{y: number, element: string, rect: DOMRect}>}
 */
function findScrollPausePoints() {
  const points = [];
  const selectors = 'h1, h2, h3, h4, img, button, section, form, [role="banner"], [role="main"], article, .hero, .banner';

  document.querySelectorAll(selectors).forEach(el => {
    const rect = el.getBoundingClientRect();
    // Only include visible elements with reasonable size
    if (rect.width > 50 && rect.height > 20) {
      const absoluteY = rect.top + window.scrollY;
      points.push({
        y: absoluteY,
        element: el.tagName.toLowerCase(),
        rect,
        selector: describeElement(el),
      });
    }
  });

n  // Sort by Y position
  return points.sort((a, b) => a.y - b.y);
}

/**
 * Simulate smooth scrolling while moving cursor.
 * @param {object} options - Scroll options
 * @param {'slow'|'medium'|'fast'} [options.speed='medium'] - Scroll speed
 * @param {boolean} [options.pauseOnSections=true] - Pause on interesting elements
 * @param {boolean} [options.captureScreenshots=false] - Capture screenshots during scroll
 * @returns {Promise<object>}
 */
async function simulateUserScroll(options = {}) {
  const speed = options.speed || 'medium';
  const pauseOnSections = options.pauseOnSections !== false;

  // Speed presets (scroll step, pause between steps, pause on sections)
  const speedPresets = {
    slow: { scrollStep: 100, betweenScroll: 180, sectionPause: 2000 },
    medium: { scrollStep: 150, betweenScroll: 100, sectionPause: 1000 },
    fast: { scrollStep: 200, betweenScroll: 50, sectionPause: 500 },
  };
  const preset = speedPresets[speed] || speedPresets.medium;

  const result = {
    totalScrollDistance: 0,
    duration: 0,
    pausePoints: 0,
    pageHeight: document.documentElement.scrollHeight,
    viewportHeight: window.innerHeight,
    sectionsVisited: [],
  };

  const startTime = Date.now();

  // Inject cursor
  injectVirtualCursor();

  // Find pause points
  const pausePoints = pauseOnSections ? findScrollPausePoints() : [];
  let currentPauseIndex = 0;

  // Track the max scroll to prevent infinite scroll pages
  const maxScrollDistance = result.viewportHeight * 10;
  let lastScrollY = window.scrollY;
  let stuckCount = 0;

  // Start cursor at center-top
  cursorState.x = window.innerWidth / 2;
  cursorState.y = window.innerHeight / 4;
  await moveCursorTo(cursorState.x, cursorState.y, 300);

  // Small initial movement to "wake up"
  await moveCursorTo(cursorState.x + (Math.random() - 0.5) * 100, cursorState.y + 50, 400);
  await new Promise(r => setTimeout(r, 300));

  // Scroll loop
  while (window.scrollY < result.pageHeight - result.viewportHeight && result.totalScrollDistance < maxScrollDistance) {
    // Check if we're stuck (infinite scroll detection)
    if (window.scrollY === lastScrollY) {
      stuckCount++;
      if (stuckCount > 5) break;
    } else {
      stuckCount = 0;
    }
    lastScrollY = window.scrollY;

    // Check if we should pause at an element
    if (currentPauseIndex < pausePoints.length) {
      const point = pausePoints[currentPauseIndex];
      const viewportTop = window.scrollY;
      const viewportBottom = viewportTop + result.viewportHeight;

      // If pause point is in viewport
      if (point.y >= viewportTop && point.y <= viewportBottom - 100) {
        // Move cursor to the element (relative to viewport)
        const targetX = point.rect.left + point.rect.width / 2;
        const targetY = point.rect.top + point.rect.height / 2;

        // Only move if it's a significant element
        if (['h1', 'h2', 'h3', 'h4', 'img', 'button', 'article'].includes(point.element)) {
          await moveCursorTo(targetX, Math.min(targetY, result.viewportHeight * 0.6), 400);
          await new Promise(r => setTimeout(r, preset.sectionPause));
          result.pausePoints++;
          result.sectionsVisited.push(point.element);
        }
        currentPauseIndex++;
      }
    }

    // Scroll with slight cursor movement for natural feel
    const scrollAmount = preset.scrollStep + Math.floor(Math.random() * 50);
    window.scrollBy({ top: scrollAmount, behavior: 'instant' });
    result.totalScrollDistance += scrollAmount;

    // Move cursor slightly horizontally during scroll
    const cursorDrift = (Math.random() - 0.5) * 30;
    cursorState.x = Math.max(50, Math.min(window.innerWidth - 50, cursorState.x + cursorDrift));
    cursorState.y = window.innerHeight / 3 + (Math.random() - 0.5) * 100;

    if (virtualCursor) {
      virtualCursor.style.left = cursorState.x + 'px';
      virtualCursor.style.top = cursorState.y + 'px';
    }

    await new Promise(r => setTimeout(r, preset.betweenScroll + Math.random() * 50));

    // Update page height (may have changed due to lazy loading)
    result.pageHeight = document.documentElement.scrollHeight;
  }

  // Pause briefly at the bottom
  await new Promise(r => setTimeout(r, 500));

  // Remove cursor
  removeVirtualCursor();

  result.duration = Date.now() - startTime;
  return result;
}

// Inject ripple animation styles
const rippleStyle = document.createElement('style');
rippleStyle.textContent = `
  @keyframes mcp-cursor-ripple {
    0% {
      transform: scale(0);
      opacity: 0.5;
    }
    100% {
      transform: scale(2);
      opacity: 0;
    }
  }
  @keyframes mcp-highlight-pulse {
    0% {
      opacity: 0;
      transform: scale(0.95);
    }
    50% {
      opacity: 1;
      transform: scale(1);
    }
    100% {
      opacity: 0;
      transform: scale(1.05);
    }
  }
  @keyframes mcp-type-blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }
`;
document.head.appendChild(rippleStyle);

// ---------------------------------------------------------------------------
// Visual User Interaction Functions
// ---------------------------------------------------------------------------

/**
 * Highlight an element with a subtle blue outline pulse.
 * @param {Element} el
 * @param {number} [duration=600]
 */
function highlightElement(el, duration = 600) {
  const rect = el.getBoundingClientRect();
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed;
    top: ${rect.top + window.scrollY}px;
    left: ${rect.left + window.scrollX}px;
    width: ${rect.width}px;
    height: ${rect.height}px;
    border: 2px solid rgba(88, 166, 255, 0.8);
    border-radius: 4px;
    pointer-events: none;
    z-index: 2147483646;
    animation: mcp-highlight-pulse ${duration}ms ease-out;
  `;
  document.body.appendChild(overlay);
  setTimeout(() => overlay.remove(), duration);
}

/**
 * Show a typing indicator near the cursor.
 * @param {number} x
 * @param {number} y
 * @returns {HTMLElement} The typing indicator element
 */
function showTypingIndicator(x, y) {
  const indicator = document.createElement('div');
  indicator.id = 'mcp-typing-indicator';
  indicator.style.cssText = `
    position: fixed;
    left: ${x + 15}px;
    top: ${y - 5}px;
    width: 3px;
    height: 16px;
    background: rgba(88, 166, 255, 0.9);
    pointer-events: none;
    z-index: 2147483646;
    animation: mcp-type-blink 0.8s ease-in-out infinite;
  `;
  document.body.appendChild(indicator);
  return indicator;
}

/**
 * Remove the typing indicator.
 */
function removeTypingIndicator() {
  const indicator = document.getElementById('mcp-typing-indicator');
  if (indicator) indicator.remove();
}

/**
 * Get element center coordinates.
 * @param {Element} el
 * @returns {{x: number, y: number}}
 */
function getElementCenter(el) {
  const rect = el.getBoundingClientRect();
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

/**
 * Dispatch mouse events on an element.
 * @param {Element} el
 * @param {number} x
 * @param {number} y
 */
function dispatchMouseEvents(el, x, y) {
  const eventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: x,
    clientY: y,
    screenX: x + window.screenX,
    screenY: y + window.screenY,
  };

  el.dispatchEvent(new MouseEvent('mouseover', eventInit));
  el.dispatchEvent(new MouseEvent('mouseenter', eventInit));
  el.dispatchEvent(new MouseEvent('mousemove', eventInit));
  el.dispatchEvent(new MouseEvent('mousedown', { ...eventInit, button: 0, buttons: 1 }));
  el.dispatchEvent(new MouseEvent('mouseup', { ...eventInit, button: 0, buttons: 0 }));
  el.dispatchEvent(new MouseEvent('click', eventInit));
}

/**
 * Click an element with visual feedback.
 * @param {string} selector - CSS selector
 * @param {object} options - Options
 * @returns {Promise<object>}
 */
async function clickElement(selector, options = {}) {
  const el = document.querySelector(selector);
  if (!el) {
    throw new Error(`Element not found: ${selector}`);
  }

  // Scroll into view
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  await new Promise(r => setTimeout(r, 300));

  // Get coordinates
  const { x, y } = getElementCenter(el);

  // Inject cursor if not present
  injectVirtualCursor();

  // Move cursor to element
  await moveCursorTo(x, y, 300);

  // Highlight element
  highlightElement(el);

  // Show click ripple
  showClickRipple(x, y);

  // Dispatch mouse events
  dispatchMouseEvents(el, x, y);

  // Wait after click if specified
  if (options.waitAfter) {
    await new Promise(r => setTimeout(r, options.waitAfter));
  }

  return {
    success: true,
    element: {
      tagName: el.tagName.toLowerCase(),
      id: el.id || null,
      text: (el.textContent || '').substring(0, 100),
    },
    coordinates: { x, y },
  };
}

/**
 * Type text into an input element.
 * @param {string} selector - CSS selector
 * @param {string} text - Text to type
 * @param {object} options - Options
 * @returns {Promise<object>}
 */
async function typeText(selector, text, options = {}) {
  const el = document.querySelector(selector);
  if (!el) {
    throw new Error(`Element not found: ${selector}`);
  }

  const isInput = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
  if (!isInput) {
    throw new Error(`Element is not an input: ${selector}`);
  }

  const delay = options.delay || 50;
  const clearFirst = options.clearFirst !== false;
  const pressEnter = options.pressEnter || false;

  // Scroll into view
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  await new Promise(r => setTimeout(r, 300));

  // Get coordinates and move cursor
  const { x, y } = getElementCenter(el);
  injectVirtualCursor();
  await moveCursorTo(x, y, 300);

  // Click to focus
  highlightElement(el);
  showClickRipple(x, y);
  dispatchMouseEvents(el, x, y);
  el.focus();
  await new Promise(r => setTimeout(r, 100));

  // Clear existing text if requested
  if (clearFirst) {
    if (el.isContentEditable) {
      el.innerHTML = '';
    } else {
      el.value = '';
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Show typing indicator
  const indicator = showTypingIndicator(x, y);

  const startTime = Date.now();

  // Type each character
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const charDelay = delay * (0.7 + Math.random() * 0.6); // Variable delay

    // Dispatch key events
    const keyInit = {
      key: char,
      code: `Key${char.toUpperCase()}`,
      keyCode: char.charCodeAt(0),
      which: char.charCodeAt(0),
      bubbles: true,
      cancelable: true,
      composed: true,
    };

    el.dispatchEvent(new KeyboardEvent('keydown', keyInit));
    el.dispatchEvent(new KeyboardEvent('keypress', keyInit));

    // Update value
    if (el.isContentEditable) {
      el.textContent += char;
    } else {
      el.value += char;
    }

    // Dispatch input event
    el.dispatchEvent(new Event('input', { bubbles: true }));

    el.dispatchEvent(new KeyboardEvent('keyup', keyInit));

    await new Promise(r => setTimeout(r, charDelay));
  }

  // Press Enter if requested
  if (pressEnter) {
    const enterInit = {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
      composed: true,
    };
    el.dispatchEvent(new KeyboardEvent('keydown', enterInit));
    el.dispatchEvent(new KeyboardEvent('keypress', enterInit));
    el.dispatchEvent(new KeyboardEvent('keyup', enterInit));
  }

  // Final change event
  el.dispatchEvent(new Event('change', { bubbles: true }));

  // Remove typing indicator
  removeTypingIndicator();

  return {
    success: true,
    element: {
      tagName: el.tagName.toLowerCase(),
      id: el.id || null,
    },
    typedText: text,
    duration: Date.now() - startTime,
  };
}

/**
 * Select an option from a dropdown.
 * @param {string} selector - CSS selector for the select element
 * @param {string} value - Value or text to select
 * @returns {Promise<object>}
 */
async function selectOption(selector, value) {
  const el = document.querySelector(selector);
  if (!el) {
    throw new Error(`Element not found: ${selector}`);
  }

  if (el.tagName !== 'SELECT') {
    throw new Error(`Element is not a select: ${selector}`);
  }

  // Scroll into view and move cursor
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  await new Promise(r => setTimeout(r, 300));

  const { x, y } = getElementCenter(el);
  injectVirtualCursor();
  await moveCursorTo(x, y, 300);

  // Click to open
  highlightElement(el);
  showClickRipple(x, y);
  dispatchMouseEvents(el, x, y);
  await new Promise(r => setTimeout(r, 200));

  // Find option by value or text
  let option = null;
  for (const opt of el.options) {
    if (opt.value === value || opt.textContent === value) {
      option = opt;
      break;
    }
  }

  if (!option) {
    throw new Error(`Option not found: ${value}`);
  }

  // Set value and dispatch change
  el.value = option.value;
  el.dispatchEvent(new Event('change', { bubbles: true }));

  return {
    success: true,
    selected: {
      value: option.value,
      text: option.textContent,
    },
  };
}

/**
 * Hover over an element.
 * @param {string} selector - CSS selector
 * @returns {Promise<object>}
 */
async function hoverElement(selector) {
  const el = document.querySelector(selector);
  if (!el) {
    throw new Error(`Element not found: ${selector}`);
  }

  // Scroll into view
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  await new Promise(r => setTimeout(r, 300));

  // Get coordinates and move cursor
  const { x, y } = getElementCenter(el);
  injectVirtualCursor();
  await moveCursorTo(x, y, 300);

  // Dispatch hover events
  const eventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: x,
    clientY: y,
  };

  el.dispatchEvent(new MouseEvent('mouseover', eventInit));
  el.dispatchEvent(new MouseEvent('mouseenter', eventInit));

  // Wait to show hover state
  await new Promise(r => setTimeout(r, 500));

  const computed = getComputedStyle(el);

  return {
    success: true,
    element: {
      tagName: el.tagName.toLowerCase(),
      id: el.id || null,
    },
    hoverStyles: {
      cursor: computed.cursor,
      backgroundColor: computed.backgroundColor,
      color: computed.color,
    },
  };
}

/**
 * Wait for an element to appear in the DOM.
 * @param {string} selector - CSS selector
 * @param {number} [timeout=10000] - Timeout in ms
 * @returns {Promise<object>}
 */
async function waitForElement(selector, timeout = 10000) {
  const startTime = Date.now();

  // Check if already exists
  let el = document.querySelector(selector);
  if (el) {
    return {
      found: true,
      element: {
        tagName: el.tagName.toLowerCase(),
        id: el.id || null,
      },
      waitTime: 0,
    };
  }

  // Wait for element using MutationObserver
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      el = document.querySelector(selector);
      if (el) {
        observer.disconnect();
        resolve({
          found: true,
          element: {
            tagName: el.tagName.toLowerCase(),
            id: el.id || null,
          },
          waitTime: Date.now() - startTime,
        });
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    // Timeout
    setTimeout(() => {
      observer.disconnect();
      resolve({
        found: false,
        waitTime: Date.now() - startTime,
      });
    }, timeout);
  });
}

/**
 * Get current state of all form inputs.
 * @param {string} formSelector - CSS selector for the form
 * @returns {Promise<object>}
 */
async function getFormState(formSelector) {
  const form = document.querySelector(formSelector);
  if (!form) {
    throw new Error(`Form not found: ${formSelector}`);
  }

  const inputs = form.querySelectorAll('input, textarea, select');
  const fields = [];

  inputs.forEach((input) => {
    const field = {
      selector: getSelector(input),
      type: input.type || input.tagName.toLowerCase(),
      name: input.name || null,
      value: input.value || null,
      placeholder: input.placeholder || null,
      required: input.required || false,
      valid: input.validity ? input.validity.valid : true,
    };
    fields.push(field);
  });

  return { fields };
}

/**
 * Fill a form with multiple fields.
 * @param {Array<{selector: string, value: string, type: string}>} formData
 * @returns {Promise<object>}
 */
async function fillForm(formData) {
  if (!Array.isArray(formData)) {
    throw new Error('formData must be an array');
  }

  const errors = [];
  let completed = 0;

  for (const field of formData) {
    try {
      const { selector, value, type } = field;

      switch (type) {
        case 'text':
          await typeText(selector, value, { clearFirst: true });
          break;

        case 'select':
          await selectOption(selector, value);
          break;

        case 'checkbox': {
          const cb = document.querySelector(selector);
          if (!cb) throw new Error(`Checkbox not found: ${selector}`);
          const shouldCheck = value === 'true' || value === true;
          if (cb.checked !== shouldCheck) {
            await clickElement(selector);
          }
          break;
        }

        case 'radio': {
          const radio = document.querySelector(`${selector}[value="${value}"]`);
          if (!radio) throw new Error(`Radio button not found: ${selector}[value="${value}"]`);
          if (!radio.checked) {
            const { x, y } = getElementCenter(radio);
            injectVirtualCursor();
            await moveCursorTo(x, y, 300);
            highlightElement(radio);
            showClickRipple(x, y);
            dispatchMouseEvents(radio, x, y);
            radio.checked = true;
            radio.dispatchEvent(new Event('change', { bubbles: true }));
          }
          break;
        }

        case 'click':
          await clickElement(selector);
          break;

        default:
          throw new Error(`Unknown field type: ${type}`);
      }

      completed++;

      // Pause between fields for natural rhythm
      if (completed < formData.length) {
        await new Promise(r => setTimeout(r, 300 + Math.random() * 200));
      }
    } catch (err) {
      errors.push({ field, error: err.message });
    }
  }

  return {
    success: errors.length === 0,
    fieldsCompleted: completed,
    totalFields: formData.length,
    errors,
  };
}

// ---------------------------------------------------------------------------
// Message Handler (from Service Worker)
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // All commands are handled asynchronously
  handleCommand(message)
    .then((data) => sendResponse({ success: true, data }))
    .catch((err) => sendResponse({ success: false, error: err.message || String(err) }));

  // Return true to indicate we will respond asynchronously
  return true;
});

/**
 * Route a command from the service worker to the appropriate handler.
 * @param {{ id?: string, command: string, params?: object }} message
 * @returns {Promise<any>}
 */
async function handleCommand(message) {
  const { command, params = {} } = message;

  switch (command) {
    case 'getWebVitals':
      return { ...webVitals };

    case 'inspectElement':
      return inspectElement(params.selector);

    case 'getDomTree':
      return getDomTree(params.depth, params.selector);

    case 'getComputedStyles':
      return getFullComputedStyles(params.selector);

    case 'executeInPageContext':
      return { result: await executeInPageContext(params.code) };

    case 'getResourceTiming':
      return getResourceTiming();

    case 'runAccessibilityAudit':
      return runAccessibilityAudit();

    case 'runDesignAudit':
      return await runDesignAudit();

    case 'scrollIntoView': {
      const el = document.querySelector(params.selector);
      if (el) {
        el.scrollIntoView({ behavior: 'instant', block: 'center' });
        return { scrolled: true };
      }
      throw new Error(`Element not found: ${params.selector}`);
    }

    case 'simulateUserScroll':
      return await simulateUserScroll(params);

    case 'clickElement':
      return await clickElement(params.selector, { waitAfter: params.waitAfter });

    case 'typeText':
      return await typeText(params.selector, params.text, {
        delay: params.delay,
        clearFirst: params.clearFirst,
        pressEnter: params.pressEnter,
      });

    case 'fillForm':
      return await fillForm(params.fields);

    case 'hoverElement':
      return await hoverElement(params.selector);

    case 'selectOption':
      return await selectOption(params.selector, params.value);

    case 'waitForElement':
      return await waitForElement(params.selector, params.timeout);

    case 'getFormState':
      return await getFormState(params.formSelector);

    default:
      throw new Error(`Unknown content script command: ${command}`);
  }
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

console.log('[MCP-CS] Content script loaded');
