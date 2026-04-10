/**
 * sidepanel.js
 * ifin Platform Browser Sidepanel
 *
 * State management, UI rendering, and communication with the service worker.
 * Zero external dependencies.
 */

'use strict';

/* ==========================================================================
   1. Application State
   ========================================================================== */

const state = {
  connected: false,
  connectionStatus: 'disconnected', // 'connected' | 'disconnected' | 'reconnecting'
  webVitals: { lcp: null, fid: null, cls: null, fcp: null, ttfb: null, inp: null },
  testResults: [],     // { id, name, status, duration, details }
  screenshots: [],     // { id, dataUrl, timestamp, viewport, url }
  resources: [],       // { name, type, start, duration, size }
  consoleLogs: [],     // { level, message, timestamp }
  domTree: null,
  activeTests: 0,
  currentUrl: '',
  viewport: { width: 1440, height: 900 },
  consoleFilter: 'all',
  consoleAutoScroll: true,
};

/* ==========================================================================
   2. DOM References (cached once)
   ========================================================================== */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const dom = {
  connectionDot: $('#connectionDot'),
  activeTestBadge: $('#activeTestBadge'),
  urlInput: $('#urlInput'),
  viewportLabel: $('#viewportLabel'),
  // Vitals
  lcpValue: $('#lcpValue'),
  fidValue: $('#fidValue'),
  clsValue: $('#clsValue'),
  fcpValue: $('#fcpValue'),
  ttfbValue: $('#ttfbValue'),
  vitalsUpdated: $('#vitalsUpdated'),
  vitalsGauges: $('#vitalsGauges'),
  // Tests
  passCount: $('#passCount'),
  failCount: $('#failCount'),
  skipCount: $('#skipCount'),
  testProgress: $('#testProgress'),
  testProgressFill: $('#testProgressFill'),
  resultList: $('#resultList'),
  resultEmpty: $('#resultEmpty'),
  // Timeline
  timelineScale: $('#timelineScale'),
  timelineRows: $('#timelineRows'),
  timelineEmpty: $('#timelineEmpty'),
  timelineTooltip: $('#timelineTooltip'),
  // Screenshots
  screenshotGrid: $('#screenshotGrid'),
  screenshotEmpty: $('#screenshotEmpty'),
  screenshotModal: $('#screenshotModal'),
  modalImg: $('#modalImg'),
  // DOM Inspector
  domTree: $('#domTree'),
  domEmpty: $('#domEmpty'),
  domStyles: $('#domStyles'),
  // Console
  consoleEntries: $('#consoleEntries'),
  consoleEmpty: $('#consoleEmpty'),
  // Design Audit
  designAuditCard: $('#designAuditCard'),
  designAuditBadge: $('#designAuditBadge'),
  designAuditScore: $('#designAuditScore'),
  designAuditSections: $('#designAuditSections'),
  designAuditEmpty: $('#designAuditEmpty'),
  designAuditBtn: $('#designAuditBtn'),
  // Scroll simulation
  scrollBtn: $('#scrollBtn'),
  // Interactions
  interactionsCard: $('#interactionsCard'),
  interactionsBadge: $('#interactionsBadge'),
  interactionSelector: $('#interactionSelector'),
  interactionText: $('#interactionText'),
  interactionClearFirst: $('#interactionClearFirst'),
  interactionPressEnter: $('#interactionPressEnter'),
  formFieldsContainer: $('#formFieldsContainer'),
  interactionsResults: $('#interactionsResults'),
  interactionsResultsContent: $('#interactionsResultsContent'),
};

const BUTTON_LABELS = {
  capture: $('#captureBtn')?.innerHTML ?? 'Capture',
  audit: $('#designAuditBtn')?.innerHTML ?? 'Audit',
  scroll: $('#scrollBtn')?.innerHTML ?? 'Scroll',
};

/* ==========================================================================
   3. Gauge Helpers
   ========================================================================== */

const GAUGE_CIRCUMFERENCE = 2 * Math.PI * 35; // r=35

/** Thresholds: [good, poor] boundaries */
const THRESHOLDS = {
  lcp: { good: 2500, poor: 4000, unit: 's', divisor: 1000, precision: 1 },
  fid: { good: 100, poor: 300, unit: 'ms', divisor: 1, precision: 0 },
  inp: { good: 200, poor: 500, unit: 'ms', divisor: 1, precision: 0 },
  cls: { good: 0.1, poor: 0.25, unit: '', divisor: 1, precision: 3 },
};

function getIconMarkup(iconName) {
  switch (iconName) {
    case 'pass':
      return '<svg viewBox="0 0 16 16" fill="none"><path d="M3.5 8.5L6.5 11.5L12.5 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    case 'fail':
      return '<svg viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
    case 'skip':
      return '<svg viewBox="0 0 16 16" fill="none"><path d="M3.5 8h9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
    case 'running':
      return '<svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="5" stroke="currentColor" stroke-width="1.5" stroke-dasharray="8 4"/></svg>';
    case 'info':
      return '<svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="5.5" stroke="currentColor" stroke-width="1.5"/><path d="M8 7v3M8 5.25h.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
    case 'warn':
      return '<svg viewBox="0 0 16 16" fill="none"><path d="M8 2.5L13 12.5H3L8 2.5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 6v3M8 11h.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
    case 'error':
      return '<svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="5.5" stroke="currentColor" stroke-width="1.5"/><path d="M6 6l4 4M10 6l-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
    case 'empty':
      return '<svg viewBox="0 0 16 16" fill="none"><path d="M4 3.5h5l3 3V12a1 1 0 01-1 1H4a1 1 0 01-1-1V4.5a1 1 0 011-1Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M9 3.5v3h3" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    case 'close':
      return '<svg viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
    default:
      return '';
  }
}

/**
 * Returns a rating class based on thresholds.
 */
function getRating(metric, value) {
  const t = THRESHOLDS[metric];
  if (!t) return 'neutral';
  if (value <= t.good) return 'good';
  if (value <= t.poor) return 'warning';
  return 'poor';
}

/**
 * Formats a raw metric value for display.
 */
function formatMetric(metric, value) {
  const t = THRESHOLDS[metric];
  if (t) {
    const v = value / t.divisor;
    return v.toFixed(t.precision) + t.unit;
  }
  if (value >= 1000) return (value / 1000).toFixed(1) + 's';
  return Math.round(value) + 'ms';
}

/**
 * Updates a single SVG gauge arc.
 * @param {string} metric - 'lcp', 'fid', or 'cls'
 * @param {number|null} value - raw value (ms for lcp/fid, ratio for cls)
 */
function setGauge(metric, value) {
  const gaugeEl = dom.vitalsGauges.querySelector(`[data-metric="${metric}"]`);
  if (!gaugeEl) return;
  const fill = gaugeEl.querySelector('.gauge__fill');
  const valEl = gaugeEl.querySelector('.gauge__value');

  if (value === null || value === undefined) {
    fill.style.strokeDashoffset = GAUGE_CIRCUMFERENCE;
    fill.className = 'gauge__fill color-neutral';
    valEl.textContent = '--';
    return;
  }

  const rating = getRating(metric, value);

  // Compute fill fraction (cap at 1.0)
  const t = THRESHOLDS[metric];
  let fraction = 0;
  if (t) {
    fraction = Math.min(value / (t.poor * 1.5), 1);
  }
  const offset = GAUGE_CIRCUMFERENCE * (1 - fraction);

  fill.style.strokeDasharray = GAUGE_CIRCUMFERENCE;
  fill.style.strokeDashoffset = offset;
  fill.className = `gauge__fill color-${rating}`;
  valEl.textContent = formatMetric(metric, value);
  valEl.className = `gauge__value color-${rating}`;
}

/* ==========================================================================
   4. UI Update Functions
   ========================================================================== */

/** A. Connection status */
function updateConnectionStatus(status) {
  state.connectionStatus = status;
  state.connected = status === 'connected';
  const dot = dom.connectionDot;
  dot.className = `status-dot status-dot--${status}`;
  dot.title = status.charAt(0).toUpperCase() + status.slice(1);
}

/** Active test badge */
function updateActiveTests(count) {
  state.activeTests = count;
  const badge = dom.activeTestBadge;
  badge.textContent = count;
  badge.className = count > 0 ? 'badge' : 'badge badge--empty';
}

/** C. Web Vitals */
function updateWebVitals(vitals) {
  Object.assign(state.webVitals, vitals);

  // Primary gauges
  setGauge('lcp', state.webVitals.lcp);
  setGauge('fid', state.webVitals.fid ?? state.webVitals.inp);
  setGauge('cls', state.webVitals.cls);

  // Secondary metrics
  dom.fcpValue.textContent = state.webVitals.fcp != null ? formatMetric('fcp', state.webVitals.fcp) : '--';
  dom.ttfbValue.textContent = state.webVitals.ttfb != null ? formatMetric('ttfb', state.webVitals.ttfb) : '--';

  // Timestamp
  dom.vitalsUpdated.textContent = `Last updated: ${new Date().toLocaleTimeString()}`;
}

/** D. Test Results */
function addTestResult(result) {
  // Remove empty state
  if (dom.resultEmpty) dom.resultEmpty.remove();

  // Check if result already exists (update in place)
  const existing = state.testResults.find(r => r.id === result.id);
  if (existing) {
    Object.assign(existing, result);
  } else {
    state.testResults.push(result);
  }

  renderTestResults();
}

function renderTestResults() {
  // Summary counts
  const counts = { pass: 0, fail: 0, skip: 0, running: 0 };
  state.testResults.forEach(r => {
    if (r.status === 'pass') counts.pass++;
    else if (r.status === 'fail') counts.fail++;
    else if (r.status === 'skip') counts.skip++;
    else if (r.status === 'running') counts.running++;
  });

  dom.passCount.textContent = counts.pass;
  dom.failCount.textContent = counts.fail;
  dom.skipCount.textContent = counts.skip;

  updateActiveTests(counts.running);

  // Progress bar
  const total = state.testResults.length;
  const completed = counts.pass + counts.fail + counts.skip;
  if (counts.running > 0) {
    dom.testProgress.classList.add('progress-bar--active');
    dom.testProgressFill.style.width = total ? `${(completed / total) * 100}%` : '0%';
  } else {
    dom.testProgress.classList.remove('progress-bar--active');
    dom.testProgressFill.style.width = total ? `${(completed / total) * 100}%` : '0%';
  }

  // Build result list HTML
  const iconMap = {
    pass: { icon: getIconMarkup('pass'), cls: 'pass' },
    fail: { icon: getIconMarkup('fail'), cls: 'fail' },
    skip: { icon: getIconMarkup('skip'), cls: 'skip' },
    running: { icon: getIconMarkup('running'), cls: 'running' },
  };

  let html = '';
  for (const r of state.testResults) {
    const ic = iconMap[r.status] || iconMap.skip;
    html += `
      <div class="result-item" data-id="${r.id}">
        <span class="result-item__icon result-item__icon--${ic.cls}">${ic.icon}</span>
        <div class="result-item__body">
          <div class="result-item__name">${escHtml(r.name)}</div>
          <div class="result-item__duration">${r.duration != null ? r.duration + 'ms' : ''}</div>
          ${r.details ? `<div class="result-item__details">${escHtml(r.details)}</div>` : ''}
        </div>
      </div>`;
  }
  dom.resultList.innerHTML =
    html ||
    `<div class="empty-state" id="resultEmpty"><span class="empty-state__icon">${getIconMarkup('empty')}</span><span>No test results yet</span></div>`;
}

/** E. Performance Timeline */
function updateTimeline(resources) {
  state.resources = resources;
  if (!resources.length) return;

  dom.timelineEmpty?.remove();

  const maxTime = Math.max(...resources.map(r => r.start + r.duration), 1);

  // Scale labels
  const steps = 5;
  let scaleHtml = '';
  for (let i = 0; i <= steps; i++) {
    const t = (maxTime / steps) * i;
    scaleHtml += `<span>${t < 1000 ? Math.round(t) + 'ms' : (t / 1000).toFixed(1) + 's'}</span>`;
  }
  dom.timelineScale.innerHTML = scaleHtml;

  // Rows
  let rowsHtml = '';
  for (const r of resources) {
    const leftPct = (r.start / maxTime) * 100;
    const widthPct = Math.max((r.duration / maxTime) * 100, 0.5);
    const typeCls = getResourceTypeClass(r.type);
    const label = r.name.split('/').pop() || r.name;
    rowsHtml += `
      <div class="timeline__row">
        <span class="timeline__label" title="${escHtml(r.name)}">${escHtml(label)}</span>
        <div class="timeline__bar-track">
          <div class="timeline__bar timeline__bar--${typeCls}"
               style="left:${leftPct}%;width:${widthPct}%"
               data-name="${escAttr(r.name)}"
               data-duration="${r.duration}"
               data-size="${r.size || ''}"></div>
        </div>
      </div>`;
  }
  dom.timelineRows.innerHTML = rowsHtml;
}

function getResourceTypeClass(type) {
  const map = { document: 'document', script: 'script', stylesheet: 'stylesheet', css: 'stylesheet', image: 'image', img: 'image', font: 'font', xhr: 'xhr', fetch: 'xhr', xmlhttprequest: 'xhr' };
  return map[(type || '').toLowerCase()] || 'other';
}

/** F. Screenshots */
function addScreenshot(screenshot) {
  if (dom.screenshotEmpty) dom.screenshotEmpty.remove();
  state.screenshots.push(screenshot);

  const thumb = document.createElement('div');
  thumb.className = 'screenshot-thumb';
  thumb.innerHTML = `
    <img src="${screenshot.dataUrl}" alt="Screenshot" loading="lazy">
    <div class="screenshot-thumb__info">
      <span>${new Date(screenshot.timestamp).toLocaleTimeString()}</span>
      <span>${screenshot.viewport || ''}</span>
    </div>`;
  thumb.addEventListener('click', () => openScreenshotModal(screenshot.dataUrl));
  dom.screenshotGrid.appendChild(thumb);
}

function openScreenshotModal(dataUrl) {
  dom.modalImg.src = dataUrl;
  dom.screenshotModal.classList.add('visible');
}

function closeScreenshotModal() {
  dom.screenshotModal.classList.remove('visible');
  dom.modalImg.src = '';
}

/** G. DOM Inspector */
function updateDomTree(tree) {
  state.domTree = tree;
  if (!tree) return;
  dom.domEmpty?.remove();

  dom.domTree.innerHTML = renderDomNode(tree, 0);
}

function renderDomNode(node, depth) {
  if (!node) return '';
  const indent = depth * 16;
  const idStr = node.id ? `<span class="dom-node__id">#${escHtml(node.id)}</span>` : '';
  const classStr = node.classes ? `<span class="dom-node__class">.${escHtml(node.classes.join('.'))}</span>` : '';
  const a11y = node.a11yViolation ? `<span class="dom-node__a11y-violation">${escHtml(node.a11yViolation)}</span>` : '';

  let html = `<div class="dom-node" style="padding-left:${indent}px" data-path="${escAttr(node.path || '')}">
    <span class="dom-node__tag">&lt;${escHtml(node.tag)}&gt;</span>${idStr}${classStr}${a11y}
  </div>`;

  if (node.children) {
    for (const child of node.children) {
      html += renderDomNode(child, depth + 1);
    }
  }
  return html;
}

/** H. Console Mirror */
function addConsoleEntry(entry) {
  if (dom.consoleEmpty) dom.consoleEmpty.remove();
  state.consoleLogs.push(entry);

  const el = document.createElement('div');
  el.className = `console-entry console-entry--${entry.level || 'info'}`;
  el.dataset.level = entry.level || 'info';

  const iconMap = {
    info: getIconMarkup('info'),
    warn: getIconMarkup('warn'),
    error: getIconMarkup('error'),
  };
  el.innerHTML = `
    <span class="console-entry__icon">${iconMap[entry.level] || getIconMarkup('info')}</span>
    <span class="console-entry__time">${new Date(entry.timestamp || Date.now()).toLocaleTimeString()}</span>
    <span class="console-entry__msg">${escHtml(entry.message)}</span>`;

  // Apply current filter
  if (state.consoleFilter !== 'all' && (entry.level || 'info') !== state.consoleFilter) {
    el.style.display = 'none';
  }

  dom.consoleEntries.appendChild(el);

  if (state.consoleAutoScroll) {
    dom.consoleEntries.scrollTop = dom.consoleEntries.scrollHeight;
  }
}

function applyConsoleFilter(filter) {
  state.consoleFilter = filter;
  dom.consoleEntries.querySelectorAll('.console-entry').forEach(el => {
    if (filter === 'all' || el.dataset.level === filter) {
      el.style.display = '';
    } else {
      el.style.display = 'none';
    }
  });
}

/** I. Design Audit Display */
function displayDesignAuditResults(data) {
  if (!data || data.error) {
    return;
  }

  // Remove empty state
  if (dom.designAuditEmpty) dom.designAuditEmpty.remove();

  // Expand the card
  dom.designAuditCard.classList.remove('collapsed');

  // Calculate overall score (0-100)
  let totalViolations = 0;
  let totalChecks = 0;

  const cc = data.colorContrast || {};
  totalViolations += (cc.violations || []).length;
  totalChecks += (cc.passes || []).length + (cc.violations || []).length;

  const tt = data.touchTargets || {};
  totalViolations += tt.failing || 0;
  totalChecks += tt.total || 0;

  const ty = data.typography || {};
  totalViolations += (ty.issues || []).length;
  totalChecks += (ty.fonts || []).length + (ty.issues || []).length;

  const resp = data.responsiveness || {};
  totalViolations += (resp.overflowingElements || []).length;
  totalChecks += (resp.overflowingElements || []).length + 1;

  const imgs = data.images || {};
  totalViolations += (imgs.missingAlt || []).length + (imgs.oversized || []).length;
  totalChecks += imgs.total || 0;

  const forms = data.forms || {};
  totalViolations += forms.withoutLabels || 0;
  totalChecks += forms.total || 0;

  const interactive = data.interactiveElements || {};
  totalViolations += (interactive.violations || []).length;
  totalChecks += interactive.total || 0;

  const score = totalChecks > 0 ? Math.max(0, Math.round(((totalChecks - totalViolations) / totalChecks) * 100)) : 100;

  // Update score display
  const scoreValue = dom.designAuditScore.querySelector('.design-audit__score-value');
  if (scoreValue) {
    scoreValue.textContent = score;
    scoreValue.className = 'design-audit__score-value ' + (score >= 80 ? 'color-good' : score >= 50 ? 'color-warning' : 'color-poor');
  }

  // Update badge
  dom.designAuditBadge.textContent = totalViolations;
  dom.designAuditBadge.className = totalViolations > 0 ? 'badge badge--warn' : 'badge badge--empty';

  // Build sections HTML
  let html = '';

  // Color Contrast
  const ccViols = (cc.violations || []).length;
  html += buildAuditSection('Color Contrast', ccViols,
    ccViols > 0
      ? (cc.violations || []).slice(0, 10).map(v =>
          `<div class="audit-item audit-item--fail">
            <span class="audit-item__swatch" style="background:${escHtml(v.foreground)};border:1px solid #666"></span>
            <span class="audit-item__swatch" style="background:${escHtml(v.background)};border:1px solid #666"></span>
            <span>${escHtml(v.element)} -- ratio ${v.ratio}:1 (need ${v.requiredAA}:1 AA)</span>
          </div>`).join('')
      : '<div class="audit-item audit-item--pass">All sampled elements pass contrast checks</div>'
  );

  // Typography
  const tyIssues = (ty.issues || []).length;
  html += buildAuditSection('Typography', tyIssues,
    `<div class="audit-item">Readability score: ${ty.readabilityScore ?? '--'}/100</div>
     <div class="audit-item">${(ty.fonts || []).length} unique font combinations</div>`
    + (ty.issues || []).slice(0, 5).map(i => `<div class="audit-item audit-item--warn">${escHtml(i)}</div>`).join('')
  );

  // Touch Targets
  const ttFailing = tt.failing || 0;
  html += buildAuditSection('Touch Targets', ttFailing,
    `<div class="audit-item">${tt.passing || 0}/${tt.total || 0} pass (>= 48x48px)</div>`
    + (tt.violations || []).slice(0, 5).map(v =>
        `<div class="audit-item audit-item--warn">${escHtml(v.element)} -- ${v.width}x${v.height}px</div>`).join('')
  );

  // Responsiveness
  const respViols = (resp.overflowingElements || []).length;
  html += buildAuditSection('Responsiveness', respViols + (resp.hasHorizontalScroll ? 1 : 0),
    `<div class="audit-item">${resp.hasHorizontalScroll ? 'Horizontal scroll detected' : 'No horizontal scroll'}</div>
     <div class="audit-item">Viewport: ${resp.viewportWidth || '--'}px</div>`
    + (resp.overflowingElements || []).slice(0, 5).map(e =>
        `<div class="audit-item audit-item--warn">${escHtml(e.element)} overflows (right: ${e.right}px)</div>`).join('')
  );

  // Images
  const imgViols = (imgs.missingAlt || []).length + (imgs.oversized || []).length;
  html += buildAuditSection('Images', imgViols,
    `<div class="audit-item">${imgs.total || 0} images -- ${imgs.lazyLoaded || 0} lazy, ${imgs.eagerLoaded || 0} eager</div>`
    + (imgs.missingAlt || []).slice(0, 3).map(i => `<div class="audit-item audit-item--fail">Missing alt: ${escHtml(i.selector)}</div>`).join('')
    + (imgs.oversized || []).slice(0, 3).map(i => `<div class="audit-item audit-item--warn">Oversized (${i.ratio}x): ${escHtml(i.selector)}</div>`).join('')
  );

  // Forms
  const formViols = forms.withoutLabels || 0;
  html += buildAuditSection('Forms', formViols,
    `<div class="audit-item">${forms.withLabels || 0}/${forms.total || 0} inputs with labels</div>`
    + (forms.violations || []).slice(0, 5).map(v =>
        `<div class="audit-item audit-item--fail">${escHtml(v.element)} -- ${escHtml(v.issue)}</div>`).join('')
  );

  // Interactive Elements
  const intViols = (interactive.violations || []).length;
  html += buildAuditSection('Interactive Elements', intViols,
    `<div class="audit-item">${interactive.total || 0} interactive elements</div>`
    + (interactive.violations || []).slice(0, 5).map(v =>
        `<div class="audit-item audit-item--warn">${escHtml(v.element)} -- ${escHtml(v.issue)}</div>`).join('')
  );

  // Z-Index
  const zi = data.zIndexStacking || {};
  html += buildAuditSection('Z-Index Stacking', (zi.potentialIssues || []).length,
    `<div class="audit-item">Max z-index: ${zi.maxZIndex || 0}, ${(zi.layers || []).length} positioned layers</div>`
    + (zi.potentialIssues || []).slice(0, 3).map(i => `<div class="audit-item audit-item--warn">${escHtml(i)}</div>`).join('')
  );

  // Spacing
  const sp = data.spacing || {};
  html += buildAuditSection('Spacing Consistency', sp.consistencyScore != null && sp.consistencyScore < 60 ? 1 : 0,
    `<div class="audit-item">Consistency score: ${sp.consistencyScore ?? '--'}/100</div>`
  );

  // Color Palette
  const cp = data.colorPalette || {};
  html += buildAuditSection('Color Palette', 0,
    `<div class="audit-item">${cp.totalUnique || 0} unique colors in ${(cp.groups || []).length} groups</div>
     <div class="audit-palette">`
    + (cp.colors || []).slice(0, 12).map(c =>
        `<span class="audit-palette__swatch" style="background:${escHtml(c.value)}" title="${escHtml(c.value)} (${c.count})"></span>`).join('')
    + '</div>'
  );

  dom.designAuditSections.innerHTML = html;
}

/**
 * Build a collapsible audit sub-section.
 */
function buildAuditSection(title, violationCount, innerHtml) {
  const badge = violationCount > 0
    ? `<span class="audit-section__badge audit-section__badge--warn">${violationCount}</span>`
    : '<span class="audit-section__badge audit-section__badge--pass">OK</span>';
  return `
    <details class="audit-section">
      <summary class="audit-section__header">${escHtml(title)} ${badge}</summary>
      <div class="audit-section__body">${innerHtml}</div>
    </details>`;
}

/* ==========================================================================
   5. User Interaction Handlers
   ========================================================================== */

async function onNavigate(url) {
  if (!url) return;

  // Add protocol if missing
  if (!url.match(/^https?:\/\//)) {
    url = 'https://' + url;
  }

  state.currentUrl = url;
  dom.urlInput.value = url;

  // Visual feedback
  const goBtn = $('#goBtn');
  const originalText = goBtn.textContent;
  goBtn.textContent = 'Loading...';
  goBtn.disabled = true;

  const result = await sendToServiceWorker('navigate', { url });

  // Restore button
  goBtn.textContent = originalText;
  goBtn.disabled = false;

  if (!result.success) {
    addConsoleEntry({
      level: 'error',
      message: `Navigation failed: ${result.error || 'Unknown error'}`,
      timestamp: Date.now(),
    });
  } else {
    addConsoleEntry({
      level: 'info',
      message: `Navigated to: ${result.data?.url || url}`,
      timestamp: Date.now(),
    });
  }
}

async function onScreenshot() {
  const captureBtn = $('#captureBtn');
  const originalText = captureBtn.innerHTML;
  captureBtn.innerHTML = 'Capturing...';
  captureBtn.disabled = true;

  const result = await sendToServiceWorker('capture-screenshot', { viewport: state.viewport });

  captureBtn.innerHTML = originalText;
  captureBtn.disabled = false;

  if (!result.success) {
    addConsoleEntry({
      level: 'error',
      message: `Screenshot failed: ${result.error || 'Unknown error'}`,
      timestamp: Date.now(),
    });
  } else {
    addConsoleEntry({
      level: 'info',
      message: 'Screenshot captured successfully',
      timestamp: Date.now(),
    });
  }
}

async function onViewportChange(width) {
  const presets = { 375: 667, 768: 1024, 1440: 900 };
  const height = presets[width] || 900;
  state.viewport = { width, height };
  dom.viewportLabel.innerHTML = `${width} &times; ${height}`;

  // Update active button
  $$('#viewportPresets .btn').forEach(b => {
    b.classList.toggle('btn--active', Number(b.dataset.viewport) === width);
  });

  const result = await sendToServiceWorker('viewport-change', { width, height });

  if (!result.success) {
    addConsoleEntry({
      level: 'error',
      message: `Viewport change failed: ${result.error || 'Unknown error'}`,
      timestamp: Date.now(),
    });
  } else {
    addConsoleEntry({
      level: 'info',
      message: `Viewport set to ${width}x${height}`,
      timestamp: Date.now(),
    });
  }
}

function onRunAudit() {
  sendToServiceWorker('run-audit', {});
}

async function onRunDesignAudit() {
  // Visual feedback
  if (dom.designAuditBtn) {
    dom.designAuditBtn.disabled = true;
    dom.designAuditBtn.textContent = 'Auditing...';
  }

  addConsoleEntry({
    level: 'info',
    message: 'Starting design audit...',
    timestamp: Date.now(),
  });

  const result = await sendToServiceWorker('runDesignAudit', {});

  if (!result.success) {
    addConsoleEntry({
      level: 'error',
      message: `Design audit failed: ${result.error || 'Unknown error'}`,
      timestamp: Date.now(),
    });
    // Re-enable button on error
    if (dom.designAuditBtn) {
      dom.designAuditBtn.disabled = false;
      dom.designAuditBtn.innerHTML = BUTTON_LABELS.audit;
    }
  }
  // On success, the service worker broadcasts the results via 'design-audit-result' event
  // which is handled by initServiceWorkerListener
}

async function onSimulateScroll() {
  // Visual feedback
  if (dom.scrollBtn) {
    dom.scrollBtn.disabled = true;
    dom.scrollBtn.innerHTML = 'Scrolling... 0%';
  }

  addConsoleEntry({
    level: 'info',
    message: 'Starting visual scroll simulation...',
    timestamp: Date.now(),
  });

  const result = await sendToServiceWorker('simulateUserScroll', { speed: 'medium' });

  if (!result.success) {
    addConsoleEntry({
      level: 'error',
      message: `Scroll simulation failed: ${result.error || 'Unknown error'}`,
      timestamp: Date.now(),
    });
    // Re-enable button on error
    if (dom.scrollBtn) {
      dom.scrollBtn.disabled = false;
      dom.scrollBtn.innerHTML = BUTTON_LABELS.scroll;
    }
  }
  // On success, the service worker broadcasts the results via 'user-scroll-result' event
}

/* ==========================================================================
   Interactions Panel Functions
   ========================================================================== */

function showInteractionResult(result) {
  dom.interactionsResults.style.display = 'block';
  dom.interactionsResultsContent.textContent = JSON.stringify(result, null, 2);
}

async function onInteractClick() {
  const selector = dom.interactionSelector.value.trim();
  if (!selector) {
    addConsoleEntry({ level: 'warn', message: 'Please enter a CSS selector', timestamp: Date.now() });
    return;
  }

  const btn = $('#interactClickBtn');
  btn.disabled = true;

  addConsoleEntry({ level: 'info', message: `Clicking: ${selector}`, timestamp: Date.now() });

  const result = await sendToServiceWorker('interact-click', { selector });

  btn.disabled = false;

  if (result.success) {
    showInteractionResult(result.data);
    addConsoleEntry({ level: 'info', message: `Clicked ${result.data?.element?.tagName || 'element'}`, timestamp: Date.now() });
    incrementInteractionCount();
  } else {
    addConsoleEntry({ level: 'error', message: `Click failed: ${result.error}`, timestamp: Date.now() });
  }
}

async function onInteractHover() {
  const selector = dom.interactionSelector.value.trim();
  if (!selector) {
    addConsoleEntry({ level: 'warn', message: 'Please enter a CSS selector', timestamp: Date.now() });
    return;
  }

  const btn = $('#interactHoverBtn');
  btn.disabled = true;

  addConsoleEntry({ level: 'info', message: `Hovering: ${selector}`, timestamp: Date.now() });

  const result = await sendToServiceWorker('interact-hover', { selector });

  btn.disabled = false;

  if (result.success) {
    showInteractionResult(result.data);
    addConsoleEntry({ level: 'info', message: `Hovered ${result.data?.element?.tagName || 'element'}`, timestamp: Date.now() });
    incrementInteractionCount();
  } else {
    addConsoleEntry({ level: 'error', message: `Hover failed: ${result.error}`, timestamp: Date.now() });
  }
}

async function onInteractWait() {
  const selector = dom.interactionSelector.value.trim();
  if (!selector) {
    addConsoleEntry({ level: 'warn', message: 'Please enter a CSS selector', timestamp: Date.now() });
    return;
  }

  const btn = $('#interactWaitBtn');
  btn.disabled = true;

  addConsoleEntry({ level: 'info', message: `Waiting for: ${selector}`, timestamp: Date.now() });

  const result = await sendToServiceWorker('interact-wait', { selector, timeout: 10000 });

  btn.disabled = false;

  if (result.success) {
    showInteractionResult(result.data);
    if (result.data?.found) {
      addConsoleEntry({ level: 'info', message: `Element found after ${result.data.waitTime}ms`, timestamp: Date.now() });
    } else {
      addConsoleEntry({ level: 'warn', message: 'Element not found within timeout', timestamp: Date.now() });
    }
    incrementInteractionCount();
  } else {
    addConsoleEntry({ level: 'error', message: `Wait failed: ${result.error}`, timestamp: Date.now() });
  }
}

async function onInteractType() {
  const selector = dom.interactionSelector.value.trim();
  const text = dom.interactionText.value;

  if (!selector) {
    addConsoleEntry({ level: 'warn', message: 'Please enter a CSS selector', timestamp: Date.now() });
    return;
  }

  const btn = $('#interactTypeBtn');
  btn.disabled = true;

  addConsoleEntry({ level: 'info', message: `Typing into: ${selector}`, timestamp: Date.now() });

  const result = await sendToServiceWorker('interact-type', {
    selector,
    text,
    clearFirst: dom.interactionClearFirst.checked,
    pressEnter: dom.interactionPressEnter.checked,
  });

  btn.disabled = false;

  if (result.success) {
    showInteractionResult(result.data);
    addConsoleEntry({ level: 'info', message: `Typed ${result.data?.typedText?.length || 0} characters`, timestamp: Date.now() });
    incrementInteractionCount();
  } else {
    addConsoleEntry({ level: 'error', message: `Type failed: ${result.error}`, timestamp: Date.now() });
  }
}

function addFormFieldRow() {
  const container = dom.formFieldsContainer;
  const index = container.children.length;

  const row = document.createElement('div');
  row.className = 'form-field-row';
  row.dataset.index = index;
  row.innerHTML = `
    <input type="text" class="form-field__selector" placeholder="Selector">
    <input type="text" class="form-field__value" placeholder="Value">
    <select class="form-field__type">
      <option value="text">Text</option>
      <option value="select">Select</option>
      <option value="checkbox">Checkbox</option>
      <option value="radio">Radio</option>
      <option value="click">Click</option>
    </select>
    <button class="btn btn--sm form-field__remove" title="Remove field" type="button">${getIconMarkup('close')}</button>
  `;

  row.querySelector('.form-field__remove').addEventListener('click', () => {
    row.remove();
  });

  container.appendChild(row);
}

function getFormFields() {
  const rows = dom.formFieldsContainer.querySelectorAll('.form-field-row');
  const fields = [];

  rows.forEach(row => {
    const selector = row.querySelector('.form-field__selector').value.trim();
    const value = row.querySelector('.form-field__value').value;
    const type = row.querySelector('.form-field__type').value;

    if (selector) {
      fields.push({ selector, value, type });
    }
  });

  return fields;
}

async function onInteractFillForm() {
  const fields = getFormFields();

  if (fields.length === 0) {
    addConsoleEntry({ level: 'warn', message: 'Please add at least one form field', timestamp: Date.now() });
    return;
  }

  const btn = $('#interactFillFormBtn');
  btn.disabled = true;

  addConsoleEntry({ level: 'info', message: `Filling form with ${fields.length} fields`, timestamp: Date.now() });

  const result = await sendToServiceWorker('interact-fill-form', { fields });

  btn.disabled = false;

  if (result.success) {
    showInteractionResult(result.data);
    addConsoleEntry({
      level: result.data?.success ? 'info' : 'warn',
      message: `Form fill completed: ${result.data?.fieldsCompleted || 0}/${result.data?.totalFields || 0} fields`,
      timestamp: Date.now(),
    });
    incrementInteractionCount();
  } else {
    addConsoleEntry({ level: 'error', message: `Form fill failed: ${result.error}`, timestamp: Date.now() });
  }
}

function incrementInteractionCount() {
  const badge = dom.interactionsBadge;
  const count = parseInt(badge.textContent) + 1;
  badge.textContent = count;
  badge.className = count > 0 ? 'badge' : 'badge badge--empty';
}

/* ==========================================================================
   6. Service Worker Communication
   ========================================================================== */

/**
 * Send a message to the extension's service worker.
 * @param {string} type - The command type
 * @param {object} payload - Additional data
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 */
function sendToServiceWorker(type, payload) {
  return new Promise((resolve) => {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ type, ...payload }, (response) => {
          if (chrome.runtime.lastError) {
            console.warn('[sidepanel] Message error:', chrome.runtime.lastError);
            resolve({ success: false, error: chrome.runtime.lastError.message });
            return;
          }
          resolve(response || { success: true });
        });
      } else {
        resolve({ success: false, error: 'Chrome runtime not available' });
      }
    } catch (e) {
      console.warn('[sidepanel] Failed to send message to service worker:', e);
      resolve({ success: false, error: e.message });
    }
  });
}

/**
 * Listen for messages from the service worker.
 */
function initServiceWorkerListener() {
  if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.onMessage) {
    console.info('[sidepanel] Chrome runtime not available - running in standalone mode');
    return;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, _sendResponse) => {
    if (!msg || !msg.type) return;

    switch (msg.type) {
      case 'webvitals-update':
        updateWebVitals(msg.vitals || {});
        break;
      case 'test-result':
        addTestResult(msg.result || msg);
        break;
      case 'test-results-batch':
        (msg.results || []).forEach(addTestResult);
        break;
      case 'screenshot-captured':
        addScreenshot(msg.screenshot || msg);
        break;
      case 'resource-loaded':
        state.resources.push(msg.resource || msg);
        updateTimeline(state.resources);
        break;
      case 'resources-batch':
        updateTimeline(msg.resources || []);
        break;
      case 'console-entry':
        addConsoleEntry(msg.entry || msg);
        break;
      case 'connection-status':
        updateConnectionStatus(msg.status || 'disconnected');
        break;
      case 'dom-tree':
        updateDomTree(msg.tree || null);
        break;
      case 'active-tests':
        updateActiveTests(msg.count || 0);
        break;
      case 'url-changed':
        if (msg.url) {
          state.currentUrl = msg.url;
          dom.urlInput.value = msg.url;
        }
        break;
      case 'viewport-changed':
        if (msg.width && msg.height) {
          state.viewport = { width: msg.width, height: msg.height };
          dom.viewportLabel.innerHTML = `${msg.width} &times; ${msg.height}`;
        }
        break;
      default:
        // Handle events forwarded from content scripts
        if (msg.type === 'event' && msg.event === 'design-audit-result') {
          displayDesignAuditResults(msg.data || {});
          // Re-enable audit button
          if (dom.designAuditBtn) {
            dom.designAuditBtn.disabled = false;
            dom.designAuditBtn.innerHTML = BUTTON_LABELS.audit;
          }
        }
        if (msg.type === 'event' && msg.event === 'user-scroll-result') {
          const scrollData = msg.data || {};
          addConsoleEntry({
            level: 'info',
            message: `Scroll complete: ${scrollData.pausePoints || 0} sections visited in ${((scrollData.duration || 0) / 1000).toFixed(1)}s`,
            timestamp: Date.now(),
          });
          // Re-enable scroll button
          if (dom.scrollBtn) {
            dom.scrollBtn.disabled = false;
            dom.scrollBtn.innerHTML = BUTTON_LABELS.scroll;
          }
        }
        break;
    }
  });
}

/* ==========================================================================
   7. Event Binding
   ========================================================================== */

function bindEvents() {
  // Navigation
  $('#goBtn').addEventListener('click', () => onNavigate(dom.urlInput.value.trim()));
  dom.urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') onNavigate(dom.urlInput.value.trim());
  });

  $('#backBtn').addEventListener('click', async () => {
    const btn = $('#backBtn');
    btn.disabled = true;
    const result = await sendToServiceWorker('navigate-back', {});
    btn.disabled = false;
    if (!result.success) {
      addConsoleEntry({ level: 'error', message: `Back navigation failed: ${result.error}`, timestamp: Date.now() });
    }
  });

  $('#forwardBtn').addEventListener('click', async () => {
    const btn = $('#forwardBtn');
    btn.disabled = true;
    const result = await sendToServiceWorker('navigate-forward', {});
    btn.disabled = false;
    if (!result.success) {
      addConsoleEntry({ level: 'error', message: `Forward navigation failed: ${result.error}`, timestamp: Date.now() });
    }
  });

  $('#refreshBtn').addEventListener('click', async () => {
    const btn = $('#refreshBtn');
    btn.disabled = true;
    const result = await sendToServiceWorker('navigate-refresh', {});
    btn.disabled = false;
    if (!result.success) {
      addConsoleEntry({ level: 'error', message: `Refresh failed: ${result.error}`, timestamp: Date.now() });
    }
  });

  // Viewport presets
  $$('#viewportPresets .btn').forEach(btn => {
    btn.addEventListener('click', () => onViewportChange(Number(btn.dataset.viewport)));
  });

  // Screenshot capture
  $('#captureBtn').addEventListener('click', onScreenshot);

  // Design Audit button
  if (dom.designAuditBtn) {
    dom.designAuditBtn.addEventListener('click', onRunDesignAudit);
  }

  // Scroll simulation button
  if (dom.scrollBtn) {
    dom.scrollBtn.addEventListener('click', onSimulateScroll);
  }

  // Screenshot modal close
  $('#modalClose').addEventListener('click', closeScreenshotModal);
  dom.screenshotModal.addEventListener('click', (e) => {
    if (e.target === dom.screenshotModal) closeScreenshotModal();
  });

  // Collapsible cards
  $$('.card--collapsible .card__header').forEach(header => {
    header.addEventListener('click', () => {
      header.closest('.card').classList.toggle('collapsed');
    });
  });

  // Test result expand
  dom.resultList.addEventListener('click', (e) => {
    const item = e.target.closest('.result-item');
    if (item) item.classList.toggle('expanded');
  });

  // Console filters
  $$('#consoleFilters .console-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('#consoleFilters .console-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      applyConsoleFilter(btn.dataset.filter);
    });
  });

  // Console auto-scroll pause on user scroll up
  dom.consoleEntries.addEventListener('scroll', () => {
    const el = dom.consoleEntries;
    state.consoleAutoScroll = el.scrollTop + el.clientHeight >= el.scrollHeight - 10;
  });

  // Timeline bar hover tooltip
  document.addEventListener('mouseover', (e) => {
    const bar = e.target.closest('.timeline__bar');
    if (bar) {
      const tip = dom.timelineTooltip;
      const name = bar.dataset.name;
      const dur = bar.dataset.duration;
      const size = bar.dataset.size;
      tip.innerHTML = `${escHtml(name)}<br>${dur}ms${size ? ' · ' + formatBytes(Number(size)) : ''}`;
      tip.style.display = 'block';
      positionTooltip(tip, e);
    }
  });
  document.addEventListener('mouseout', (e) => {
    if (e.target.closest('.timeline__bar')) {
      dom.timelineTooltip.style.display = 'none';
    }
  });
  document.addEventListener('mousemove', (e) => {
    if (dom.timelineTooltip.style.display === 'block') {
      positionTooltip(dom.timelineTooltip, e);
    }
  });

  // DOM Inspector node click
  dom.domTree.addEventListener('click', (e) => {
    const node = e.target.closest('.dom-node');
    if (!node) return;
    dom.domTree.querySelectorAll('.dom-node').forEach(n => n.classList.remove('selected'));
    node.classList.add('selected');
    sendToServiceWorker('inspect-element', { path: node.dataset.path });
  });

  // Theme mode
  $('#settingsBtn').addEventListener('click', () => {
    if (window.ifinTheme) {
      window.ifinTheme.cycleMode();
    }
  });

  // Interactions panel
  $('#interactClickBtn').addEventListener('click', onInteractClick);
  $('#interactHoverBtn').addEventListener('click', onInteractHover);
  $('#interactWaitBtn').addEventListener('click', onInteractWait);
  $('#interactTypeBtn').addEventListener('click', onInteractType);
  $('#addFormFieldBtn').addEventListener('click', addFormFieldRow);
  $('#interactFillFormBtn').addEventListener('click', onInteractFillForm);

  // Remove form field buttons (delegated)
  dom.formFieldsContainer.addEventListener('click', (e) => {
    const removeButton = e.target.closest('.form-field__remove');
    if (removeButton) {
      const row = removeButton.closest('.form-field-row');
      if (row && dom.formFieldsContainer.children.length > 1) {
        row.remove();
      }
    }
  });
}

/* ==========================================================================
   8. Utility Helpers
   ========================================================================== */

function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}

function escAttr(str) {
  return String(str ?? '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

function positionTooltip(tip, e) {
  const pad = 12;
  tip.style.left = (e.clientX + pad) + 'px';
  tip.style.top = (e.clientY + pad) + 'px';
}

/* ==========================================================================
   9. Initialization
   ========================================================================== */

function init() {
  if (window.ifinTheme) {
    window.ifinTheme.init();
  }

  bindEvents();
  initServiceWorkerListener();
  updateConnectionStatus('disconnected');

  // Request initial state from service worker
  sendToServiceWorker('sidepanel-ready', {});
}

document.addEventListener('DOMContentLoaded', init);
