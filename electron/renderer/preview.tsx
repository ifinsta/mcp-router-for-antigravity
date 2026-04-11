import React, { useState, useEffect, useCallback } from 'react';

interface BrowserContext {
  url: string;
  title: string;
  selectedText?: string;
  metaDescription?: string;
}

interface BrowserStatus {
  connected: boolean;
}

export function BrowserPreview() {
  const [context, setContext] = useState<BrowserContext | null>(null);
  const [screenshot, setScreenshot] = useState<string>('');
  const [connected, setConnected] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);

  const refreshContext = useCallback(async () => {
    try {
      const ctxRes = await fetch('http://localhost:3000/api/browser/context');
      if (ctxRes.ok) {
        setContext(await ctxRes.json());
      }
    } catch {
      // ignore
    }
    try {
      const statusRes = await fetch('http://localhost:3000/api/browser/status');
      if (statusRes.ok) {
        const data = (await statusRes.json()) as BrowserStatus;
        setConnected(data.connected);
      }
    } catch {
      setConnected(false);
    }
    setLastUpdated(new Date().toLocaleTimeString());
  }, []);

  const captureScreenshot = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch('http://localhost:3000/api/browser/screenshot', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        if (data.screenshot) {
          setScreenshot(data.screenshot);
        }
      }
    } catch {
      // ignore
    }
    await refreshContext();
    setIsLoading(false);
  }, [refreshContext]);

  useEffect(() => {
    refreshContext();
    const interval = setInterval(refreshContext, 10000);
    return () => clearInterval(interval);
  }, [refreshContext]);

  const statusColor = connected ? 'var(--status-good)' : 'var(--status-poor)';
  const statusText = connected ? 'Connected' : 'Not Connected';

  return (
    <section className="panel-block preview-panel">
      <div className="panel-header">
        <h3>Browser Preview</h3>
        <div className="preview-status">
          <span className="status-dot" style={{ backgroundColor: statusColor }} />
          <span>{statusText}</span>
        </div>
      </div>

      <div className="preview-actions">
        <button
          type="button"
          className="btn-primary"
          onClick={captureScreenshot}
          disabled={isLoading}
        >
          {isLoading ? 'Capturing...' : 'Capture Screenshot'}
        </button>
        <button type="button" className="btn-secondary" onClick={refreshContext}>
          Refresh
        </button>
      </div>

      {context?.url ? (
        <div className="preview-info">
          <div className="preview-info-item">
            <span className="info-label">URL</span>
            <span className="info-value">{context.url}</span>
          </div>
          <div className="preview-info-item">
            <span className="info-label">Title</span>
            <span className="info-value">{context.title || 'Untitled'}</span>
          </div>
          {context.selectedText && (
            <div className="preview-info-item">
              <span className="info-label">Selected</span>
              <span className="info-value">{context.selectedText}</span>
            </div>
          )}
        </div>
      ) : (
        <div className="preview-placeholder">
          No browser context available. Make sure the browser extension is connected.
        </div>
      )}

      <div className="screenshot-area">
        {screenshot ? (
          <img src={`data:image/png;base64,${screenshot}`} alt="Browser Screenshot" />
        ) : (
          <div className="preview-placeholder">
            No screenshot captured yet. Click "Capture Screenshot" to take one.
          </div>
        )}
      </div>

      {lastUpdated && <div className="preview-timestamp">Last updated: {lastUpdated}</div>}
    </section>
  );
}
