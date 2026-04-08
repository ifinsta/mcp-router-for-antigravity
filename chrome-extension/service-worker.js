/**
 * MCP Router Test System - Service Worker (Background Script)
 * Version: 2.0.1 - Using CDP for screenshots
 *
 * The brain of the Chrome extension. Manages:
 * - WebSocket connection to MCP server
 * - Command routing and execution
 * - Tab lifecycle tracking
 * - Content script communication
 * - CDP (Chrome DevTools Protocol) profiling
 */

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** @type {WebSocket|null} */
let ws = null;

/** Flag to prevent concurrent connection attempts */
let isConnecting = false;

/** Timestamp of last connection attempt */
let lastConnectAttempt = 0;

/** Minimum time between connection attempts (ms) */
const MIN_CONNECT_INTERVAL = 1000;

/** Current connection status: 'connected' | 'disconnected' | 'reconnecting' */
let connectionStatus = 'disconnected';

/** Current reconnect delay in ms */
let reconnectDelay = 1000;

/** Max reconnect delay */
const MAX_RECONNECT_DELAY = 30_000;

/** Quick reconnect delay for first attempt */
const QUICK_RECONNECT_DELAY = 500;

/** Heartbeat interval id */
let heartbeatInterval = null;

/** Keepalive port to prevent service worker from sleeping */
let keepalivePort = null;

/** Active testing session flag - when true, keep service worker alive */
let activeTestingSession = false;

/** Alarm name for keepalive */
const KEEPALIVE_ALARM = 'mcp-keepalive';

/** Keepalive interval via self-messaging (runs in service worker context) */
let selfKeepaliveInterval = null;

/** Track if this is a reconnection */
let hasConnectedBefore = false;

/** Offscreen document created flag */
let offscreenCreated = false;

/** Tracked tabs: tabId -> { url, title, status, createdAt } */
const trackedTabs = new Map();

/** Active profiling sessions: tabId -> { profilingId, targets } */
const profilingSessions = new Map();

/** Default WebSocket URL */
const DEFAULT_WS_URL = 'ws://localhost:9315';

// ---------------------------------------------------------------------------
// WebSocket Connection
// ---------------------------------------------------------------------------

/**
 * Retrieve the configured WebSocket URL from chrome.storage, falling back to
 * the default when nothing has been stored yet.
 * @returns {Promise<string>}
 */
async function getWsUrl() {
  try {
    const result = await chrome.storage.local.get('wsUrl');
    return result.wsUrl || DEFAULT_WS_URL;
  } catch {
    return DEFAULT_WS_URL;
  }
}

/**
 * Establish (or re-establish) the WebSocket connection to the MCP server.
 */
async function connectWebSocket() {
  // Prevent concurrent connection attempts
  if (isConnecting) {
    console.log('[MCP-SW] Connection attempt already in progress, skipping');
    return;
  }

  // Rate limit connection attempts
  const now = Date.now();
  if (now - lastConnectAttempt < MIN_CONNECT_INTERVAL) {
    console.log('[MCP-SW] Rate limiting connection attempt');
    return;
  }
  lastConnectAttempt = now;
  isConnecting = true;

  // Tear down any previous connection
  if (ws) {
    try { ws.close(); } catch { /* ignore */ }
    ws = null;
  }

  const url = await getWsUrl();
  console.log(`[MCP-SW] Connecting to ${url} …`);

  try {
    ws = new WebSocket(url);
  } catch (err) {
    console.error('[MCP-SW] WebSocket constructor error:', err);
    isConnecting = false;
    scheduleReconnect(true);
    return;
  }

  ws.addEventListener('open', () => {
    isConnecting = false; // Connection established
    console.log('[MCP-SW] WebSocket connected');
    reconnectDelay = QUICK_RECONNECT_DELAY; // reset to quick reconnect

    // Broadcast connection status
    broadcastConnectionStatus('connected');

    // Announce ourselves - include reconnect flag if we've connected before
    const isReconnect = hasConnectedBefore;
    hasConnectedBefore = true;

    wsSend({
      type: 'extension-connect',
      extensionId: chrome.runtime.id,
      reconnect: isReconnect
    });

    console.log(`[MCP-SW] Sent extension-connect (reconnect: ${isReconnect})`);

    // Start heartbeat - more aggressive (5s) to prevent service worker sleep
    clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(() => {
      wsSend({ type: 'heartbeat', ts: Date.now() });
    }, 5_000);
  });

  ws.addEventListener('message', (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleIncomingMessage(msg);
    } catch (err) {
      console.error('[MCP-SW] Failed to parse WS message:', err);
    }
  });

  ws.addEventListener('close', () => {
    console.warn('[MCP-SW] WebSocket closed');
    isConnecting = false;
    broadcastConnectionStatus('disconnected');
    cleanup();
    // Quick reconnect for first attempt, then exponential backoff
    scheduleReconnect(true);
  });

  ws.addEventListener('error', (err) => {
    console.error('[MCP-SW] WebSocket error:', err);
    isConnecting = false;
    broadcastConnectionStatus('reconnecting');
    // Don't wait for close - start reconnecting immediately
    if (!ws || (ws.readyState !== WebSocket.OPEN && ws.readyState !== WebSocket.CONNECTING)) {
      cleanup();
      scheduleReconnect(true);
    }
  });
}

/** Send a JSON payload over the WebSocket (if open). */
function wsSend(data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

/** Broadcast connection status to all extension UIs (sidepanel, popup, etc). */
function broadcastConnectionStatus(status) {
  connectionStatus = status;
  try {
    chrome.runtime.sendMessage({ type: 'connection-status', status });
  } catch {
    // No listeners (sidepanel/popup may not be open)
  }
}

/** Clean up timers and state on disconnect. */
function cleanup() {
  clearInterval(heartbeatInterval);
  heartbeatInterval = null;
  clearInterval(selfKeepaliveInterval);
  selfKeepaliveInterval = null;
  ws = null;
}

// ---------------------------------------------------------------------------
// Service Worker Keepalive Mechanisms
// ---------------------------------------------------------------------------

/**
 * Set up alarm-based keepalive to wake up service worker periodically.
 * This helps prevent the service worker from being terminated during testing.
 * Note: Called from alarm handler, not needed at startup.
 */
async function setupKeepaliveAlarm() {
  try {
    // Clear any existing alarm
    await chrome.alarms.clear(KEEPALIVE_ALARM);

    // Create a repeating alarm every 15 seconds (well under the 30s idle timeout)
    chrome.alarms.create(KEEPALIVE_ALARM, {
      delayInMinutes: 15 / 60, // 15 seconds in minutes
      periodInMinutes: 15 / 60
    });

    console.log('[MCP-SW] Keepalive alarm set up (15s interval)');
  } catch (err) {
    console.error('[MCP-SW] Failed to set up keepalive alarm:', err);
  }
}

/**
 * Handle alarm events - this wakes up the service worker.
 */
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEPALIVE_ALARM) {
    console.log('[MCP-SW] Keepalive alarm triggered');

    // If WebSocket is not connected, try to reconnect
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.log('[MCP-SW] WebSocket disconnected, reconnecting...');
      connectWebSocket();
    } else {
      // Send a heartbeat to keep connection alive
      wsSend({ type: 'heartbeat', ts: Date.now() });
    }
  }
});

/**
 * Keep service worker alive by holding a port connection.
 * This is the most reliable way to prevent service worker termination.
 */
chrome.runtime.onConnect.addListener((port) => {
  console.log('[MCP-SW] Port connected:', port.name);

  if (port.name === 'keepalive') {
    keepalivePort = port;
    // Mark that we have an active testing session
    activeTestingSession = true;

    port.onDisconnect.addListener(() => {
      console.log('[MCP-SW] Keepalive port disconnected');
      keepalivePort = null;
      activeTestingSession = false;
    });

    port.onMessage.addListener((msg) => {
      if (msg.type === 'ping') {
        port.postMessage({ type: 'pong', ts: Date.now() });
      }
    });
  }

  if (port.name === 'offscreen-keepalive') {
    // Handle offscreen document connection
    port.onDisconnect.addListener(() => {
      console.log('[MCP-SW] Offscreen port disconnected');
      // Try to recreate offscreen document
      offscreenCreated = false;
      createOffscreenDocument().catch(() => {});
    });

    port.onMessage.addListener((msg) => {
      if (msg.type === 'heartbeat') {
        // Respond to keep the connection alive
        port.postMessage({ type: 'heartbeat-ack', ts: Date.now() });
      }
      if (msg.type === 'pong') {
        // Pong from offscreen - connection is alive
      }
    });
  }
});

/** Schedule a reconnect with smart back-off strategy. */
function scheduleReconnect(quickFirst = false) {
  broadcastConnectionStatus('reconnecting');

  // Use quick reconnect for first attempt
  const delay = quickFirst ? QUICK_RECONNECT_DELAY : reconnectDelay;

  // Only increase delay after first attempt
  if (!quickFirst) {
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
  } else {
    // Reset to slightly higher for next time after quick attempt
    reconnectDelay = 1000;
  }

  console.log(`[MCP-SW] Reconnecting in ${delay}ms …`);
  setTimeout(connectWebSocket, delay);
}

// ---------------------------------------------------------------------------
// Offscreen Document Management
// ---------------------------------------------------------------------------

/**
 * Create an offscreen document to keep the service worker alive.
 * This is the most reliable way to prevent service worker termination in MV3.
 */
async function createOffscreenDocument() {
  if (offscreenCreated) {
    return;
  }

  try {
    // Check if offscreen API is available (Chrome 109+)
    if (!chrome.offscreen) {
      console.warn('[MCP-SW] Offscreen API not available (Chrome < 109)');
      return;
    }

    // Try to create the offscreen document
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['WORKERS'], // We need workers for WebSocket
      justification: 'WebSocket connection for MCP Router testing system'
    });

    offscreenCreated = true;
    console.log('[MCP-SW] Offscreen document created');
  } catch (err) {
    // Document may already exist
    if (err.message.includes('already exists')) {
      offscreenCreated = true;
      console.log('[MCP-SW] Offscreen document already exists');
    } else {
      console.error('[MCP-SW] Failed to create offscreen document:', err);
    }
  }
}

// ---------------------------------------------------------------------------
// Self-Messaging Keepalive
// ---------------------------------------------------------------------------

/**
 * Start self-messaging keepalive loop.
 * This helps keep the service worker active by periodically triggering activity.
 */
function startSelfKeepalive() {
  // Clear any existing interval
  if (selfKeepaliveInterval) {
    clearInterval(selfKeepaliveInterval);
  }

  // Self-message every 15 seconds (more aggressive to prevent SW termination)
  selfKeepaliveInterval = setInterval(() => {
    // Try to message ourselves - this triggers service worker activity
    chrome.runtime.sendMessage({ type: 'self-keepalive', ts: Date.now() }).catch(() => {
      // No listener is fine - the act of sending keeps us alive
    });
  }, 15_000);

  console.log('[MCP-SW] Self-keepalive started (15s interval)');
}

// ---------------------------------------------------------------------------
// Incoming Message Router
// ---------------------------------------------------------------------------

/**
 * Handle a message received from the MCP server via WebSocket.
 * @param {{ id?: string, type: string, command?: string, params?: object, ts?: number }} msg
 */
async function handleIncomingMessage(msg) {
  // Handle ping from server - respond immediately with pong
  if (msg.type === 'ping') {
    wsSend({ type: 'pong', ts: Date.now(), requestTs: msg.ts });
    return;
  }

  if (msg.type !== 'command' || !msg.command) return;

  const { id, command, params } = msg;

  try {
    const result = await executeCommand(command, params || {});
    wsSend({ id, type: 'response', result });
  } catch (err) {
    console.error(`[MCP-SW] Command "${command}" failed:`, err);
    wsSend({ id, type: 'error', error: err.message || String(err) });
  }
}

// ---------------------------------------------------------------------------
// Command Dispatcher
// ---------------------------------------------------------------------------

/** @type {Record<string, (params: object) => Promise<object>>} */
const COMMANDS = {
  navigate: cmdNavigate,
  screenshot: cmdScreenshot,
  executeScript: cmdExecuteScript,
  getWebVitals: cmdGetWebVitals,
  inspectElement: cmdInspectElement,
  getDomTree: cmdGetDomTree,
  getComputedStyles: cmdGetComputedStyles,
  startProfiling: cmdStartProfiling,
  stopProfiling: cmdStopProfiling,
  getMetrics: cmdGetMetrics,
  runAccessibilityAudit: cmdRunAccessibilityAudit,
  runDesignAudit: cmdRunDesignAudit,
  closeTabs: cmdCloseTabs,
  listTabs: cmdListTabs,
  simulateUserScroll: cmdSimulateUserScroll,
  clickElement: cmdClickElement,
  typeText: cmdTypeText,
  fillForm: cmdFillForm,
  hoverElement: cmdHoverElement,
  selectOption: cmdSelectOption,
  waitForElement: cmdWaitForElement,
  getFormState: cmdGetFormState,
};

/**
 * Execute a named command.
 * @param {string} command
 * @param {object} params
 * @returns {Promise<object>}
 */
async function executeCommand(command, params) {
  const handler = COMMANDS[command];
  if (!handler) {
    throw new Error(`Unknown command: ${command}`);
  }
  return handler(params);
}

// ---------------------------------------------------------------------------
// Command Implementations
// ---------------------------------------------------------------------------

/**
 * Navigate to a URL.
 * @param {{ url: string, tabId?: number, waitUntil?: string }} params
 */
async function cmdNavigate({ url, tabId, waitUntil }) {
  const start = Date.now();

  let tab;
  if (tabId) {
    tab = await chrome.tabs.update(tabId, { url });
  } else {
    tab = await chrome.tabs.create({ url });
  }

  // Wait for the tab to finish loading
  await waitForTabLoad(tab.id, waitUntil);

  // Re-fetch to get final title/url
  tab = await chrome.tabs.get(tab.id);

  return {
    tabId: tab.id,
    url: tab.url,
    title: tab.title,
    loadTime: Date.now() - start,
  };
}

/**
 * Wait for a tab to reach 'complete' status.
 * @param {number} tabId
 * @param {string} [_waitUntil]
 * @param {number} [timeout=30000]
 * @returns {Promise<void>}
 */
function waitForTabLoad(tabId, _waitUntil, timeout = 30_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Tab load timed out'));
    }, timeout);

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }

    chrome.tabs.onUpdated.addListener(listener);

    // Immediately check if already complete
    chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }).catch(() => { /* tab might be mid-navigate */ });
  });
}

/**
 * Capture a screenshot using Chrome DevTools Protocol.
 * This bypasses the permission issues with chrome.tabs.captureVisibleTab in Manifest V3.
 * @param {{ tabId?: number, fullPage?: boolean, selector?: string, format?: string, quality?: number }} params
 */
async function cmdScreenshot({ tabId, fullPage, selector, format = 'png', quality }) {
  if (!tabId) {
    throw new Error('tabId is required for screenshot');
  }

  // Ensure the target tab is active
  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch (e) {
    throw new Error(`Failed to get tab ${tabId}: ${e.message}`);
  }

  try {
    await chrome.tabs.update(tabId, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  } catch (e) {
    throw new Error(`Failed to activate tab/window: ${e.message}`);
  }

  // If a selector is specified, ask content script to scroll it into view first
  if (selector) {
    await sendToContentScript(tabId, {
      id: crypto.randomUUID(),
      command: 'scrollIntoView',
      params: { selector },
    });
    await sleep(150);
  }

  const debuggee = { tabId };
  const captureFormat = format === 'jpeg' ? 'jpeg' : 'png';

  // Check if there's an active profiling session for this tab
  const profilingSession = profilingSessions.get(tabId);
  const isDebuggerAttached = profilingSession !== undefined;

  let debuggerWasAttached = false;

  try {
    if (!isDebuggerAttached) {
      // Attach debugger to use CDP for screenshot capture
      // This works because we have the 'debugger' permission
      await chrome.debugger.attach(debuggee, '1.3');
      debuggerWasAttached = true;
    }

    // Enable Page domain
    await chrome.debugger.sendCommand(debuggee, 'Page.enable');

    // Wait a moment for the page to be ready
    await sleep(100);

    // Capture screenshot using CDP
    const result = await chrome.debugger.sendCommand(debuggee, 'Page.captureScreenshot', {
      format: captureFormat,
      quality: format === 'jpeg' && quality !== undefined ? quality : undefined,
      fromSurface: true,
      captureBeyondViewport: fullPage || false,
    });

    return {
      data: result.data,
      format: captureFormat,
      width: 0,
      height: 0,
    };
  } finally {
    // Only detach debugger if we attached it (not if it was already attached for profiling)
    if (debuggerWasAttached) {
      try {
        await chrome.debugger.detach(debuggee);
      } catch { /* ignore detach errors */ }
    }
  }
}

/**
 * Execute arbitrary JS in a tab's page context.
 * @param {{ tabId: number, code: string, timeout?: number }} params
 */
async function cmdExecuteScript({ tabId, code, timeout = 10_000 }) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: new Function(code),
    world: 'MAIN',
  });

  return { result: results?.[0]?.result ?? null };
}

/**
 * Get current Web Vitals from the content script.
 * @param {{ tabId: number }} params
 */
async function cmdGetWebVitals({ tabId }) {
  const resp = await sendToContentScript(tabId, {
    id: crypto.randomUUID(),
    command: 'getWebVitals',
    params: {},
  });
  return resp.data;
}

/**
 * Inspect a specific DOM element.
 * @param {{ tabId: number, selector: string }} params
 */
async function cmdInspectElement({ tabId, selector }) {
  const resp = await sendToContentScript(tabId, {
    id: crypto.randomUUID(),
    command: 'inspectElement',
    params: { selector },
  });
  return resp.data;
}

/**
 * Get DOM tree from content script.
 * @param {{ tabId: number, depth?: number, selector?: string }} params
 */
async function cmdGetDomTree({ tabId, depth, selector }) {
  const resp = await sendToContentScript(tabId, {
    id: crypto.randomUUID(),
    command: 'getDomTree',
    params: { depth, selector },
  });
  return resp.data;
}

/**
 * Get computed styles for an element.
 * @param {{ tabId: number, selector: string }} params
 */
async function cmdGetComputedStyles({ tabId, selector }) {
  const resp = await sendToContentScript(tabId, {
    id: crypto.randomUUID(),
    command: 'getComputedStyles',
    params: { selector },
  });
  return resp.data;
}

/**
 * Start CPU/memory profiling via Chrome DevTools Protocol.
 * @param {{ tabId: number, options?: object }} params
 */
async function cmdStartProfiling({ tabId, options = {} }) {
  const profilingId = crypto.randomUUID();
  const debuggee = { tabId };

  await chrome.debugger.attach(debuggee, '1.3');

  // Enable profiling domains
  await chrome.debugger.sendCommand(debuggee, 'Profiler.enable');
  await chrome.debugger.sendCommand(debuggee, 'Profiler.start');

  if (options.heap) {
    await chrome.debugger.sendCommand(debuggee, 'HeapProfiler.enable');
  }

  // Enable Performance domain for metrics
  await chrome.debugger.sendCommand(debuggee, 'Performance.enable');

  // Enable Network domain to collect network requests during profiling
  try {
    await chrome.debugger.sendCommand(debuggee, 'Network.enable');
  } catch { /* optional domain */ }

  // Enable CSS domain for stylesheet analysis
  try {
    await chrome.debugger.sendCommand(debuggee, 'CSS.enable');
  } catch { /* optional domain */ }

  // Enable DOM domain for node tracking
  try {
    await chrome.debugger.sendCommand(debuggee, 'DOM.enable');
  } catch { /* optional domain */ }

  // Track network requests during profiling
  const networkRequests = [];
  const networkHandler = (source, method, params) => {
    if (source.tabId === tabId && method === 'Network.responseReceived') {
      networkRequests.push({
        url: params.response?.url || '',
        status: params.response?.status || 0,
        mimeType: params.response?.mimeType || '',
        encodedDataLength: params.response?.encodedDataLength || 0,
      });
    }
  };
  chrome.debugger.onEvent.addListener(networkHandler);

  profilingSessions.set(tabId, {
    profilingId,
    debuggee,
    options,
    networkRequests,
    networkHandler,
  });

  return { profilingId };
}

/**
 * Stop profiling and collect results.
 * @param {{ tabId: number, profilingId: string }} params
 */
async function cmdStopProfiling({ tabId, profilingId }) {
  const session = profilingSessions.get(tabId);
  if (!session || session.profilingId !== profilingId) {
    throw new Error('No active profiling session for this tab/profilingId');
  }

  const debuggee = session.debuggee;
  const result = {};

  try {
    // Stop CPU profiler
    const cpuResult = await chrome.debugger.sendCommand(debuggee, 'Profiler.stop');
    result.cpuProfile = cpuResult.profile;

    // Collect Performance metrics
    const metricsResult = await chrome.debugger.sendCommand(debuggee, 'Performance.getMetrics');
    result.metrics = metricsResult.metrics;

    // Collect heap statistics
    try {
      const heapStats = await chrome.debugger.sendCommand(debuggee, 'Runtime.getHeapUsage');
      result.heapUsage = heapStats;
    } catch { /* heap stats optional */ }

    // Collect network requests captured during profiling
    result.networkRequests = session.networkRequests || [];

    // Collect heap snapshot if enabled
    if (session.options.heap) {
      let heapChunks = '';
      const chunkHandler = (source, method, params) => {
        if (source.tabId === tabId && method === 'HeapProfiler.addHeapSnapshotChunk') {
          heapChunks += params.chunk;
        }
      };
      chrome.debugger.onEvent.addListener(chunkHandler);
      await chrome.debugger.sendCommand(debuggee, 'HeapProfiler.takeHeapSnapshot', {
        reportProgress: false,
      });
      chrome.debugger.onEvent.removeListener(chunkHandler);
      result.heapSnapshot = heapChunks;
    }
  } finally {
    // Remove network listener
    if (session.networkHandler) {
      try {
        chrome.debugger.onEvent.removeListener(session.networkHandler);
      } catch { /* ignore */ }
    }

    // Always clean up - disable all domains and detach
    try {
      await chrome.debugger.sendCommand(debuggee, 'Profiler.disable');
      if (session.options.heap) {
        await chrome.debugger.sendCommand(debuggee, 'HeapProfiler.disable');
      }
      await chrome.debugger.sendCommand(debuggee, 'Performance.disable');
      try { await chrome.debugger.sendCommand(debuggee, 'Network.disable'); } catch { /* ignore */ }
      try { await chrome.debugger.sendCommand(debuggee, 'CSS.disable'); } catch { /* ignore */ }
      try { await chrome.debugger.sendCommand(debuggee, 'DOM.disable'); } catch { /* ignore */ }
      await chrome.debugger.detach(debuggee);
    } catch { /* detach may fail if tab closed */ }

    profilingSessions.delete(tabId);
  }

  return result;
}

/**
 * Get Performance.getMetrics via CDP.
 * @param {{ tabId: number }} params
 */
async function cmdGetMetrics({ tabId }) {
  const debuggee = { tabId };

  await chrome.debugger.attach(debuggee, '1.3');

  try {
    await chrome.debugger.sendCommand(debuggee, 'Performance.enable');
    const result = await chrome.debugger.sendCommand(debuggee, 'Performance.getMetrics');
    await chrome.debugger.sendCommand(debuggee, 'Performance.disable');
    return { metrics: result.metrics };
  } finally {
    try {
      await chrome.debugger.detach(debuggee);
    } catch { /* ignore */ }
  }
}

/**
 * Run accessibility audit via content script.
 * @param {{ tabId: number }} params
 */
async function cmdRunAccessibilityAudit({ tabId }) {
  const resp = await sendToContentScript(tabId, {
    id: crypto.randomUUID(),
    command: 'runAccessibilityAudit',
    params: {},
  });
  return resp.data;
}

/**
 * Run comprehensive UI/UX design audit via content script.
 * @param {{ tabId: number }} params
 */
async function cmdRunDesignAudit({ tabId }) {
  const resp = await sendToContentScript(tabId, {
    id: crypto.randomUUID(),
    command: 'runDesignAudit',
    params: {},
  });

  // Forward results to side panel
  try {
    chrome.runtime.sendMessage({
      type: 'event',
      event: 'design-audit-result',
      data: resp.data,
    });
  } catch {
    // Side panel may not be open
  }

  return resp.data;
}

/**
 * Simulate user scrolling via content script.
 * @param {{ tabId: number, speed?: string, pauseOnSections?: boolean }} params
 */
async function cmdSimulateUserScroll({ tabId, speed, pauseOnSections }) {
  const resp = await sendToContentScript(tabId, {
    id: crypto.randomUUID(),
    command: 'simulateUserScroll',
    params: { speed, pauseOnSections },
  }, 120_000); // 2 minute timeout for long scroll

  // Forward progress to side panel
  try {
    chrome.runtime.sendMessage({
      type: 'event',
      event: 'user-scroll-result',
      data: resp.data,
    });
  } catch {
    // Side panel may not be open
  }

  return resp.data;
}

/**
 * Click an element via content script.
 * @param {{ tabId: number, selector: string, waitAfter?: number }} params
 */
async function cmdClickElement({ tabId, selector, waitAfter }) {
  const resp = await sendToContentScript(tabId, {
    id: crypto.randomUUID(),
    command: 'clickElement',
    params: { selector, waitAfter },
  }, 30_000);
  return resp.data;
}

/**
 * Type text into an input via content script.
 * @param {{ tabId: number, selector: string, text: string, delay?: number, clearFirst?: boolean, pressEnter?: boolean }} params
 */
async function cmdTypeText({ tabId, selector, text, delay, clearFirst, pressEnter }) {
  const resp = await sendToContentScript(tabId, {
    id: crypto.randomUUID(),
    command: 'typeText',
    params: { selector, text, delay, clearFirst, pressEnter },
  }, 60_000); // Longer timeout for typing
  return resp.data;
}

/**
 * Fill a form via content script.
 * @param {{ tabId: number, fields: Array<{selector: string, value: string, type: string}> }} params
 */
async function cmdFillForm({ tabId, fields }) {
  const resp = await sendToContentScript(tabId, {
    id: crypto.randomUUID(),
    command: 'fillForm',
    params: { fields },
  }, 120_000); // Long timeout for form filling
  return resp.data;
}

/**
 * Hover over an element via content script.
 * @param {{ tabId: number, selector: string }} params
 */
async function cmdHoverElement({ tabId, selector }) {
  const resp = await sendToContentScript(tabId, {
    id: crypto.randomUUID(),
    command: 'hoverElement',
    params: { selector },
  }, 30_000);
  return resp.data;
}

/**
 * Select an option from a dropdown via content script.
 * @param {{ tabId: number, selector: string, value: string }} params
 */
async function cmdSelectOption({ tabId, selector, value }) {
  const resp = await sendToContentScript(tabId, {
    id: crypto.randomUUID(),
    command: 'selectOption',
    params: { selector, value },
  }, 30_000);
  return resp.data;
}

/**
 * Wait for an element to appear via content script.
 * @param {{ tabId: number, selector: string, timeout?: number }} params
 */
async function cmdWaitForElement({ tabId, selector, timeout }) {
  const resp = await sendToContentScript(tabId, {
    id: crypto.randomUUID(),
    command: 'waitForElement',
    params: { selector, timeout },
  }, (timeout || 10000) + 5000);
  return resp.data;
}

/**
 * Get form state via content script.
 * @param {{ tabId: number, formSelector: string }} params
 */
async function cmdGetFormState({ tabId, formSelector }) {
  const resp = await sendToContentScript(tabId, {
    id: crypto.randomUUID(),
    command: 'getFormState',
    params: { formSelector },
  }, 30_000);
  return resp.data;
}

/**
 * Close specified tabs.
 * @param {{ tabIds: number[] }} params
 */
async function cmdCloseTabs({ tabIds }) {
  await chrome.tabs.remove(tabIds);
  return { closed: tabIds };
}

/**
 * List all open tabs.
 */
async function cmdListTabs() {
  const tabs = await chrome.tabs.query({});
  return {
    tabs: tabs.map((t) => ({
      tabId: t.id,
      windowId: t.windowId,
      url: t.url,
      title: t.title,
      status: t.status,
      active: t.active,
      favIconUrl: t.favIconUrl,
    })),
  };
}

// ---------------------------------------------------------------------------
// Content Script Communication
// ---------------------------------------------------------------------------

/**
 * Send a command to a content script and await its response.
 * @param {number} tabId
 * @param {{ id: string, command: string, params: object }} message
 * @param {number} [timeout=10000]
 * @returns {Promise<{ success: boolean, data?: any, error?: string }>}
 */
function sendToContentScript(tabId, message, timeout = 10_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Content script response timed out for command: ${message.command}`));
    }, timeout);

    chrome.tabs.sendMessage(tabId, message, (response) => {
      clearTimeout(timer);
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response) {
        reject(new Error('No response from content script'));
        return;
      }
      if (!response.success) {
        reject(new Error(response.error || 'Content script command failed'));
        return;
      }
      resolve(response);
    });
  });
}

// ---------------------------------------------------------------------------
// Tab Tracking
// ---------------------------------------------------------------------------

chrome.tabs.onCreated.addListener((tab) => {
  try {
    trackedTabs.set(tab.id, {
      url: tab.url || tab.pendingUrl || '',
      title: tab.title || '',
      status: tab.status || 'loading',
      createdAt: Date.now(),
    });

    wsSend({
      type: 'event',
      event: 'tab-created',
      data: { tabId: tab.id, ...trackedTabs.get(tab.id) },
    });
  } catch (err) {
    console.error('[MCP-SW] Tab created handler error:', err);
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  try {
    const existing = trackedTabs.get(tabId) || { createdAt: Date.now() };
    const updated = {
      ...existing,
      url: tab.url || existing.url,
      title: tab.title || existing.title,
      status: changeInfo.status || existing.status,
    };
    trackedTabs.set(tabId, updated);

    wsSend({
      type: 'event',
      event: 'tab-updated',
      data: { tabId, changeInfo, ...updated },
    });
  } catch (err) {
    console.error('[MCP-SW] Tab updated handler error:', err);
  }
});

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  try {
    trackedTabs.delete(tabId);
    profilingSessions.delete(tabId);

    wsSend({
      type: 'event',
      event: 'tab-removed',
      data: { tabId, ...removeInfo },
    });
  } catch (err) {
    console.error('[MCP-SW] Tab removed handler error:', err);
  }
});

// ---------------------------------------------------------------------------
// Content Script Event Forwarding
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  try {
    // Forward events from content scripts to MCP server
    if (message.type === 'event' && sender.tab) {
      wsSend({
        type: 'event',
        event: message.event,
        tabId: sender.tab.id,
        data: message.data,
      });
    }
  } catch (err) {
    console.error('[MCP-SW] Message forwarding error:', err);
  }
  // Return false — we don't send a response for events
  return false;
});

// ---------------------------------------------------------------------------
// Side Panel
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(async () => {
  try {
    // Set side panel behavior: open on action click
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (err) {
    console.error('[MCP-SW] Side panel setup error:', err);
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Promise-based sleep. */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

// Track if we've initialized in this service worker lifecycle
let initializedInThisLifecycle = false;

/**
 * Initialize the service worker.
 */
function initializeServiceWorker() {
  // Only initialize once per SW lifecycle
  if (initializedInThisLifecycle) {
    console.log('[MCP-SW] Already initialized in this lifecycle, reconnecting if needed');
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      connectWebSocket();
    }
    return;
  }
  initializedInThisLifecycle = true;

  console.log('[MCP-SW] Initializing service worker');

  // Start self-keepalive
  startSelfKeepalive();

  // Register alarm
  chrome.alarms.create(KEEPALIVE_ALARM, {
    delayInMinutes: 15 / 60,
    periodInMinutes: 15 / 60
  }).catch(() => {});

  // Create offscreen document (async but don't wait)
  if (chrome.offscreen) {
    chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['WORKERS'],
      justification: 'WebSocket connection for MCP Router testing system'
    }).then(() => {
      offscreenCreated = true;
      console.log('[MCP-SW] Offscreen document created');
    }).catch((err) => {
      if (err.message && err.message.includes('already exists')) {
        offscreenCreated = true;
        console.log('[MCP-SW] Offscreen document already exists');
      } else {
        console.error('[MCP-SW] Failed to create offscreen document:', err);
      }
    });
  } else {
    console.warn('[MCP-SW] Offscreen API not available (Chrome < 109)');
  }

  // Start WebSocket connection
  connectWebSocket();
}

// Run initialization
initializeServiceWorker();

// Handle sidepanel ready message - send current connection status
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'sidepanel-ready') {
    // Send current connection status to the newly opened sidepanel
    broadcastConnectionStatus(connectionStatus);
    return false;
  }

  // Handle commands from sidepanel/popup
  if (msg && msg.type) {
    handleExtensionCommand(msg, sender, sendResponse);
    return true; // Keep sendResponse channel open for async
  }

  return false;
});

// ---------------------------------------------------------------------------
// Extension Command Handler (from sidepanel/popup)
// ---------------------------------------------------------------------------

/**
 * Handle commands from extension pages (sidepanel, popup).
 * Routes to the same command implementations used by WebSocket.
 * @param {object} msg
 * @param {chrome.runtime.MessageSender} sender
 * @param {function} sendResponse
 */
async function handleExtensionCommand(msg, sender, sendResponse) {
  const { type } = msg;

  try {
    let result;
    let activeTab;

    switch (type) {
      case 'navigate': {
        const url = msg.url || msg.params?.url;
        if (!url) {
          throw new Error('URL required for navigation');
        }
        result = await cmdNavigate({ url });
        // Update sidepanel with the new URL
        broadcastToExtension({ type: 'url-changed', url: result.url, title: result.title });
        break;
      }

      case 'navigate-back': {
        activeTab = await getActiveTab();
        if (activeTab) {
          await chrome.tabs.goBack(activeTab.id);
          result = { success: true };
        } else {
          throw new Error('No active tab');
        }
        break;
      }

      case 'navigate-forward': {
        activeTab = await getActiveTab();
        if (activeTab) {
          await chrome.tabs.goForward(activeTab.id);
          result = { success: true };
        } else {
          throw new Error('No active tab');
        }
        break;
      }

      case 'navigate-refresh': {
        activeTab = await getActiveTab();
        if (activeTab) {
          await chrome.tabs.reload(activeTab.id);
          result = { success: true };
        } else {
          throw new Error('No active tab');
        }
        break;
      }

      case 'capture-screenshot': {
        activeTab = await getActiveTab();
        if (!activeTab) {
          throw new Error('No active tab to capture');
        }
        result = await cmdScreenshot({ tabId: activeTab.id });
        // Forward screenshot to sidepanel
        broadcastToExtension({
          type: 'screenshot-captured',
          screenshot: {
            id: crypto.randomUUID(),
            dataUrl: `data:image/${result.format};base64,${result.data}`,
            timestamp: Date.now(),
            viewport: `${result.width}x${result.height}`,
            url: activeTab.url,
          },
        });
        break;
      }

      case 'viewport-change': {
        const { width, height } = msg;
        // Store viewport preference
        await chrome.storage.local.set({ viewportWidth: width, viewportHeight: height });
        // Note: Actual window resizing requires special permissions
        // We just store the preference and notify
        broadcastToExtension({ type: 'viewport-changed', width, height });
        result = { success: true, width, height };
        break;
      }

      case 'runDesignAudit': {
        activeTab = await getActiveTab();
        if (!activeTab) {
          throw new Error('No active tab to audit');
        }
        result = await cmdRunDesignAudit({ tabId: activeTab.id });
        break;
      }

      case 'simulateUserScroll': {
        activeTab = await getActiveTab();
        if (!activeTab) {
          throw new Error('No active tab to scroll');
        }
        const scrollSpeed = msg.speed || msg.params?.speed || 'medium';
        result = await cmdSimulateUserScroll({
          tabId: activeTab.id,
          speed: scrollSpeed,
          pauseOnSections: msg.pauseOnSections ?? msg.params?.pauseOnSections ?? true,
        });
        break;
      }

      case 'run-audit': {
        activeTab = await getActiveTab();
        if (!activeTab) {
          throw new Error('No active tab to audit');
        }
        result = await cmdRunAccessibilityAudit({ tabId: activeTab.id });
        break;
      }

      case 'request-vitals': {
        activeTab = await getActiveTab();
        if (!activeTab) {
          throw new Error('No active tab');
        }
        result = await cmdGetWebVitals({ tabId: activeTab.id });
        broadcastToExtension({ type: 'webvitals-update', vitals: result });
        break;
      }

      case 'inspect-element': {
        const { path } = msg;
        activeTab = await getActiveTab();
        if (!activeTab) {
          throw new Error('No active tab');
        }
        result = await cmdInspectElement({ tabId: activeTab.id, selector: path });
        break;
      }

      case 'open-settings': {
        // Open options page or show settings
        chrome.runtime.openOptionsPage?.();
        result = { success: true };
        break;
      }

      case 'popup-ready':
      case 'sidepanel-ready': {
        // Already handled above, but acknowledge
        broadcastConnectionStatus(connectionStatus);
        result = { success: true };
        break;
      }

      case 'interact-click': {
        activeTab = await getActiveTab();
        if (!activeTab) {
          throw new Error('No active tab');
        }
        result = await cmdClickElement({ tabId: activeTab.id, selector: msg.selector });
        break;
      }

      case 'interact-hover': {
        activeTab = await getActiveTab();
        if (!activeTab) {
          throw new Error('No active tab');
        }
        result = await cmdHoverElement({ tabId: activeTab.id, selector: msg.selector });
        break;
      }

      case 'interact-wait': {
        activeTab = await getActiveTab();
        if (!activeTab) {
          throw new Error('No active tab');
        }
        result = await cmdWaitForElement({ tabId: activeTab.id, selector: msg.selector, timeout: msg.timeout });
        break;
      }

      case 'interact-type': {
        activeTab = await getActiveTab();
        if (!activeTab) {
          throw new Error('No active tab');
        }
        result = await cmdTypeText({
          tabId: activeTab.id,
          selector: msg.selector,
          text: msg.text,
          clearFirst: msg.clearFirst,
          pressEnter: msg.pressEnter,
        });
        break;
      }

      case 'interact-fill-form': {
        activeTab = await getActiveTab();
        if (!activeTab) {
          throw new Error('No active tab');
        }
        result = await cmdFillForm({ tabId: activeTab.id, fields: msg.fields });
        break;
      }

      default: {
        // Unknown command
        sendResponse({ success: false, error: `Unknown command: ${type}` });
        return;
      }
    }

    sendResponse({ success: true, data: result });
  } catch (err) {
    console.error(`[MCP-SW] Extension command "${type}" failed:`, err);
    sendResponse({ success: false, error: err.message || String(err) });
  }
}

/**
 * Get the currently active tab.
 * @returns {Promise<chrome.tabs.Tab|null>}
 */
async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

/**
 * Broadcast a message to all extension pages (sidepanel, popup, etc).
 * @param {object} message
 */
function broadcastToExtension(message) {
  try {
    chrome.runtime.sendMessage(message).catch(() => {
      // No listeners (sidepanel/popup may not be open)
    });
  } catch {
    // Ignore errors when no receivers
  }
}
