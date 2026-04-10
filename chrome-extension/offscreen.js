/**
 * ifin Platform Browser Offscreen Document
 *
 * This script runs in an offscreen document to keep the service worker alive.
 * Chrome won't terminate the service worker while an offscreen document exists.
 * 
 * The offscreen document maintains a message port to the service worker,
 * ensuring continuous background operation for WebSocket connections.
 */

console.log('[MCP-Offscreen] Offscreen document loaded');

// Maintain a connection to the service worker
let port = null;

function connectToServiceWorker() {
  try {
    port = chrome.runtime.connect({ name: 'offscreen-keepalive' });
    
    port.onDisconnect.addListener(() => {
      console.log('[MCP-Offscreen] Port disconnected, reconnecting...');
      port = null;
      setTimeout(connectToServiceWorker, 1000);
    });

    port.onMessage.addListener((msg) => {
      if (msg.type === 'ping') {
        port.postMessage({ type: 'pong', ts: Date.now() });
      }
    });

    console.log('[MCP-Offscreen] Connected to service worker');
  } catch (err) {
    console.error('[MCP-Offscreen] Failed to connect:', err);
    setTimeout(connectToServiceWorker, 2000);
  }
}

// Start the connection immediately
connectToServiceWorker();

// Also send periodic heartbeats to ensure the service worker stays active
setInterval(() => {
  if (port) {
    try {
      port.postMessage({ type: 'heartbeat', ts: Date.now() });
    } catch {
      // Port may be closed
      connectToServiceWorker();
    }
  } else {
    connectToServiceWorker();
  }
}, 10000);

console.log('[MCP-Offscreen] Offscreen document initialized');
