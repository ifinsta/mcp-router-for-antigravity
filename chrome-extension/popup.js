/**
 * popup.js
 * MCP Router – Popup quick-access panel
 *
 * Handles server connection toggle, quick actions, mini web vitals display,
 * and communication with the service worker.
 */

'use strict';

/* ==========================================================================
   State
   ========================================================================== */

const state = {
  connected: false,
  connectionStatus: 'disconnected',
  webVitals: { lcp: null, fid: null, cls: null },
  activeSessions: 0,
  monitorActive: false,
};

/* ==========================================================================
   DOM References
   ========================================================================== */

const $ = (sel) => document.querySelector(sel);

const dom = {
  statusDot: $('#popupStatusDot'),
  statusLabel: $('#popupStatusLabel'),
  hostInput: $('#hostInput'),
  portInput: $('#portInput'),
  connectBtn: $('#connectBtn'),
  sessionCount: $('#sessionCount'),
  awaitingLabel: $('#awaitingLabel'),
  // Mini vitals
  miniLcpBar: $('#miniLcpBar'),
  miniLcpVal: $('#miniLcpVal'),
  miniFidBar: $('#miniFidBar'),
  miniFidVal: $('#miniFidVal'),
  miniClsBar: $('#miniClsBar'),
  miniClsVal: $('#miniClsVal'),
};

/* ==========================================================================
   Thresholds (same as sidepanel)
   ========================================================================== */

const THRESHOLDS = {
  lcp: { good: 2500, poor: 4000, unit: 's', divisor: 1000, precision: 1 },
  fid: { good: 100, poor: 300, unit: 'ms', divisor: 1, precision: 0 },
  cls: { good: 0.1, poor: 0.25, unit: '', divisor: 1, precision: 3 },
};

function getRating(metric, value) {
  const t = THRESHOLDS[metric];
  if (!t) return 'neutral';
  if (value <= t.good) return 'good';
  if (value <= t.poor) return 'warning';
  return 'poor';
}

function formatMetric(metric, value) {
  const t = THRESHOLDS[metric];
  if (!t) return '—';
  const v = value / t.divisor;
  return v.toFixed(t.precision) + t.unit;
}

/* ==========================================================================
   UI Updates
   ========================================================================== */

function updateConnectionStatus(status) {
  state.connectionStatus = status;
  state.connected = status === 'connected';
  dom.statusDot.className = `status-dot status-dot--${status}`;
  dom.statusDot.title = status;
  dom.statusLabel.textContent = status.charAt(0).toUpperCase() + status.slice(1);

  // Toggle button text
  dom.connectBtn.textContent = state.connected ? 'Disconnect' : 'Connect';
  dom.connectBtn.className = state.connected ? 'btn btn--danger' : 'btn btn--primary';
}

function updateMiniVitals(vitals) {
  Object.assign(state.webVitals, vitals);

  setMiniBar('lcp', state.webVitals.lcp, dom.miniLcpBar, dom.miniLcpVal);
  setMiniBar('fid', state.webVitals.fid, dom.miniFidBar, dom.miniFidVal);
  setMiniBar('cls', state.webVitals.cls, dom.miniClsBar, dom.miniClsVal);

  // Hide awaiting label once we have data
  if (state.webVitals.lcp != null || state.webVitals.fid != null || state.webVitals.cls != null) {
    dom.awaitingLabel.style.display = 'none';
  }
}

function setMiniBar(metric, value, barEl, valEl) {
  if (value == null) {
    barEl.style.width = '0%';
    barEl.className = 'mini-vital-bar__fill';
    valEl.textContent = '—';
    return;
  }

  const rating = getRating(metric, value);
  const t = THRESHOLDS[metric];
  const fraction = Math.min(value / (t.poor * 1.5), 1);
  barEl.style.width = `${fraction * 100}%`;
  barEl.className = `mini-vital-bar__fill mini-vital-bar__fill--${rating}`;
  valEl.textContent = formatMetric(metric, value);
  valEl.style.color = `var(--status-${rating})`;
}

function updateSessionCount(count) {
  state.activeSessions = count;
  dom.sessionCount.textContent = count;
}

/* ==========================================================================
   Service Worker Communication
   ========================================================================== */

function sendToServiceWorker(type, payload) {
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ type, ...payload });
    }
  } catch (e) {
    console.warn('[popup] Failed to send message:', e);
  }
}

function initListener() {
  if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.onMessage) {
    console.info('[popup] Chrome runtime not available – standalone mode');
    return;
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || !msg.type) return;

    switch (msg.type) {
      case 'connection-status':
        updateConnectionStatus(msg.status || 'disconnected');
        break;
      case 'webvitals-update':
        updateMiniVitals(msg.vitals || {});
        break;
      case 'active-sessions':
        updateSessionCount(msg.count || 0);
        break;
      case 'active-tests':
        updateSessionCount(msg.count || 0);
        break;
      default:
        break;
    }
  });
}

/* ==========================================================================
   Event Binding
   ========================================================================== */

function bindEvents() {
  // Connect / Disconnect
  dom.connectBtn.addEventListener('click', () => {
    if (state.connected) {
      sendToServiceWorker('disconnect', {});
    } else {
      const host = dom.hostInput.value.trim() || 'localhost';
      const port = dom.portInput.value.trim() || '3700';
      sendToServiceWorker('connect', { host, port: Number(port) });
    }
  });

  // Quick actions
  $('#actionScreenshot').addEventListener('click', () => {
    sendToServiceWorker('capture-screenshot', {});
  });

  $('#actionAudit').addEventListener('click', () => {
    sendToServiceWorker('run-audit', {});
  });

  $('#actionVitals').addEventListener('click', () => {
    sendToServiceWorker('request-vitals', {});
  });

  $('#actionMonitor').addEventListener('click', () => {
    state.monitorActive = !state.monitorActive;
    sendToServiceWorker('toggle-monitor', { active: state.monitorActive });
    const btn = $('#actionMonitor');
    btn.style.borderColor = state.monitorActive ? 'var(--accent-green)' : '';
    btn.style.color = state.monitorActive ? 'var(--accent-green)' : '';
  });

  // Open Dashboard (side panel)
  $('#openDashboardBtn').addEventListener('click', () => {
    if (typeof chrome !== 'undefined' && chrome.sidePanel) {
      // Open side panel for the current window
      chrome.windows.getCurrent((win) => {
        chrome.sidePanel.open({ windowId: win.id });
      });
    } else {
      sendToServiceWorker('open-sidepanel', {});
    }
  });
}

/* ==========================================================================
   Init
   ========================================================================== */

function init() {
  bindEvents();
  initListener();
  updateConnectionStatus('disconnected');

  // Load saved host/port from storage
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(['mcpHost', 'mcpPort'], (result) => {
      if (result.mcpHost) dom.hostInput.value = result.mcpHost;
      if (result.mcpPort) dom.portInput.value = result.mcpPort;
    });
  }

  // Request current state
  sendToServiceWorker('popup-ready', {});
}

document.addEventListener('DOMContentLoaded', init);
