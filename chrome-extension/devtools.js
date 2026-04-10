/**
 * ifin Platform Browser - DevTools Page Script
 *
 * Creates a DevTools panel that hosts the MCP Testing dashboard,
 * allowing it to appear as a tab within Chrome DevTools.
 */

chrome.devtools.panels.create(
  'MCP Testing',
  'icons/icon48.png',
  'sidepanel.html',
  (panel) => {
    console.log('[MCP-DevTools] Panel created');
  }
);
