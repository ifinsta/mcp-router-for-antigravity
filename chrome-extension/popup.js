/**
 * popup.js
 * ifin Platform Browser popup
 */

'use strict';

const state = {
  connected: false,
  connectionStatus: 'disconnected',
  webVitals: { lcp: null, fid: null, cls: null },
  activeSessions: 0,
  monitorActive: false,
};

const $ = (sel) => document.querySelector(sel);

const dom = {
  statusDot: $('#popupStatusDot'),
  statusLabel: $('#popupStatusLabel'),
  hostInput: $('#hostInput'),
  portInput: $('#portInput'),
  connectBtn: $('#connectBtn'),
  sessionCount: $('#sessionCount'),
  awaitingLabel: $('#awaitingLabel'),
  miniLcpBar: $('#miniLcpBar'),
  miniLcpVal: $('#miniLcpVal'),
  miniFidBar: $('#miniFidBar'),
  miniFidVal: $('#miniFidVal'),
  miniClsBar: $('#miniClsBar'),
  miniClsVal: $('#miniClsVal'),
};

const THRESHOLDS = {
  lcp: { good: 2500, poor: 4000, unit: 's', divisor: 1000, precision: 1 },
  fid: { good: 100, poor: 300, unit: 'ms', divisor: 1, precision: 0 },
  cls: { good: 0.1, poor: 0.25, unit: '', divisor: 1, precision: 3 },
};

function getRating(metric, value) {
  const threshold = THRESHOLDS[metric];
  if (!threshold) {
    return 'neutral';
  }
  if (value <= threshold.good) {
    return 'good';
  }
  if (value <= threshold.poor) {
    return 'warning';
  }
  return 'poor';
}

function formatMetric(metric, value) {
  const threshold = THRESHOLDS[metric];
  if (!threshold) {
    return '--';
  }
  return `${(value / threshold.divisor).toFixed(threshold.precision)}${threshold.unit}`;
}

function updateConnectionStatus(status) {
  state.connectionStatus = status;
  state.connected = status === 'connected';
  dom.statusDot.className = `status-dot status-dot--${status}`;
  dom.statusDot.title = status;
  dom.statusLabel.textContent = status.charAt(0).toUpperCase() + status.slice(1);
  dom.connectBtn.textContent = state.connected ? 'Disconnect' : 'Connect';
  dom.connectBtn.className = state.connected ? 'btn btn--danger' : 'btn btn--primary';
}

function setMiniBar(metric, value, barEl, valueEl) {
  if (value == null) {
    barEl.style.width = '0%';
    barEl.className = 'mini-vital-bar__fill';
    valueEl.textContent = '--';
    valueEl.style.color = '';
    return;
  }

  const threshold = THRESHOLDS[metric];
  const rating = getRating(metric, value);
  const fraction = Math.min(value / (threshold.poor * 1.5), 1);

  barEl.style.width = `${fraction * 100}%`;
  barEl.className = `mini-vital-bar__fill mini-vital-bar__fill--${rating}`;
  valueEl.textContent = formatMetric(metric, value);
  valueEl.style.color = `var(--status-${rating})`;
}

function updateMiniVitals(vitals) {
  Object.assign(state.webVitals, vitals);
  setMiniBar('lcp', state.webVitals.lcp, dom.miniLcpBar, dom.miniLcpVal);
  setMiniBar('fid', state.webVitals.fid, dom.miniFidBar, dom.miniFidVal);
  setMiniBar('cls', state.webVitals.cls, dom.miniClsBar, dom.miniClsVal);

  if (state.webVitals.lcp != null || state.webVitals.fid != null || state.webVitals.cls != null) {
    dom.awaitingLabel.style.display = 'none';
  }
}

function updateSessionCount(count) {
  state.activeSessions = count;
  dom.sessionCount.textContent = String(count);
}

function sendToServiceWorker(type, payload) {
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ type, ...payload });
    }
  } catch (error) {
    console.warn('[popup] Failed to send message:', error);
  }
}

function initListener() {
  if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.onMessage) {
    console.info('[popup] Chrome runtime not available - standalone mode');
    return;
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || !message.type) {
      return;
    }

    switch (message.type) {
      case 'connection-status':
        updateConnectionStatus(message.status || 'disconnected');
        break;
      case 'webvitals-update':
        updateMiniVitals(message.vitals || {});
        break;
      case 'active-sessions':
      case 'active-tests':
        updateSessionCount(message.count || 0);
        break;
      default:
        break;
    }
  });
}

function bindEvents() {
  dom.connectBtn.addEventListener('click', () => {
    if (state.connected) {
      sendToServiceWorker('disconnect', {});
      return;
    }

    const host = dom.hostInput.value.trim() || 'localhost';
    const port = dom.portInput.value.trim() || '3700';

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ mcpHost: host, mcpPort: port });
    }

    sendToServiceWorker('connect', { host, port: Number(port) });
  });

  $('#actionScreenshot').addEventListener('click', () => sendToServiceWorker('capture-screenshot', {}));
  $('#actionAudit').addEventListener('click', () => sendToServiceWorker('run-audit', {}));
  $('#actionVitals').addEventListener('click', () => sendToServiceWorker('request-vitals', {}));

  $('#actionMonitor').addEventListener('click', () => {
    state.monitorActive = !state.monitorActive;
    $('#actionMonitor').classList.toggle('action-btn--active', state.monitorActive);
    sendToServiceWorker('toggle-monitor', { active: state.monitorActive });
  });

  $('#openDashboardBtn').addEventListener('click', () => {
    if (typeof chrome !== 'undefined' && chrome.sidePanel) {
      chrome.windows.getCurrent((windowRecord) => {
        chrome.sidePanel.open({ windowId: windowRecord.id });
      });
      return;
    }

    sendToServiceWorker('open-sidepanel', {});
  });
}

function init() {
  if (window.ifinTheme) {
    window.ifinTheme.init();
  }

  bindEvents();
  initListener();
  updateConnectionStatus('disconnected');

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(['mcpHost', 'mcpPort'], (result) => {
      if (result.mcpHost) {
        dom.hostInput.value = result.mcpHost;
      }
      if (result.mcpPort) {
        dom.portInput.value = result.mcpPort;
      }
    });
  }

  sendToServiceWorker('popup-ready', {});
}

document.addEventListener('DOMContentLoaded', init);
