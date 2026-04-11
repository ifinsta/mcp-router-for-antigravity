import React, { useState, useEffect, useCallback } from 'react';

interface BrowserStatus {
  connected: boolean;
  tabCount: number;
  bridgeRunning: boolean;
  port: number;
}

interface PairingState {
  platform: string;
  extensionPath: string;
  verificationStatus: 'idle' | 'checking' | 'connected' | 'failed';
  statusDetails: BrowserStatus | null;
  errorMessage: string | null;
}

interface BrowserPairingProps {
  onClose?: () => void;
}

function detectPlatform(): string {
  const platform = navigator.platform;
  
  if (platform.includes('Win')) return 'Windows';
  if (platform.includes('Mac')) return 'Mac';
  if (platform.includes('Linux')) return 'Linux';
  return 'Unknown';
}

export function BrowserPairing({ onClose }: BrowserPairingProps) {
  const [state, setState] = useState<PairingState>({
    platform: detectPlatform(),
    extensionPath: '',
    verificationStatus: 'idle',
    statusDetails: null,
    errorMessage: null,
  });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Get extension path from system info
    const loadSystemInfo = async () => {
      try {
        if (window.electronAPI?.getSystemInfo) {
          const info = await window.electronAPI.getSystemInfo();
          // Construct path based on platform
          const separator = info.platform === 'win32' ? '\\' : '/';
          const basePath = info.appPath || '';
          const extPath = basePath ? `${basePath}${separator}chrome-extension` : '';
          
          setState(prev => ({
            ...prev,
            platform: info.platform === 'win32' ? 'Windows' : 
                     info.platform === 'darwin' ? 'Mac' : 'Linux',
            extensionPath: extPath,
          }));
        }
      } catch (error) {
        console.error('Failed to load system info:', error);
      }
    };

    loadSystemInfo();
  }, []);

  const copyExtensionPath = useCallback(async () => {
    if (state.extensionPath) {
      try {
        if (window.electronAPI?.copyText) {
          await window.electronAPI.copyText(state.extensionPath);
        } else {
          await navigator.clipboard.writeText(state.extensionPath);
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (error) {
        console.error('Failed to copy path:', error);
      }
    }
  }, [state.extensionPath]);

  const openExtensionFolder = useCallback(async () => {
    if (state.extensionPath && window.electronAPI?.openURL) {
      // Use file protocol to open folder
      await window.electronAPI.openURL(`file://${state.extensionPath}`);
    }
  }, [state.extensionPath]);

  const verifyConnection = useCallback(async () => {
    setState(prev => ({
      ...prev,
      verificationStatus: 'checking',
      errorMessage: null,
    }));

    try {
      const response = await fetch('http://localhost:3000/api/browser/status', {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }

      const data = await response.json() as BrowserStatus;
      
      setState(prev => ({
        ...prev,
        statusDetails: data,
        verificationStatus: data.connected ? 'connected' : 'failed',
        errorMessage: data.connected ? null : 'Browser extension is not connected. Please follow the setup steps.',
      }));
    } catch (error) {
      setState(prev => ({
        ...prev,
        verificationStatus: 'failed',
        statusDetails: null,
        errorMessage: error instanceof Error 
          ? `Connection failed: ${error.message}`
          : 'Unable to connect to the browser bridge. Make sure the MCP server is running.',
      }));
    }
  }, []);

  const getPlatformInstructions = () => {
    switch (state.platform) {
      case 'Windows':
        return (
          <div className="platform-note">
            <strong>Windows Users:</strong> The extension folder is located at:
            <code>{state.extensionPath || 'Loading...'}</code>
          </div>
        );
      case 'Mac':
        return (
          <div className="platform-note">
            <strong>Mac Users:</strong> The extension folder is located at:
            <code>{state.extensionPath || 'Loading...'}</code>
          </div>
        );
      case 'Linux':
        return (
          <div className="platform-note">
            <strong>Linux Users:</strong> The extension folder is located at:
            <code>{state.extensionPath || 'Loading...'}</code>
          </div>
        );
      default:
        return null;
    }
  };

  const getVerificationButton = () => {
    const { verificationStatus } = state;
    
    let buttonClass = 'btn-primary';
    let buttonText = 'Verify Connection';
    let disabled = false;

    if (verificationStatus === 'checking') {
      buttonClass = 'btn-secondary';
      buttonText = 'Checking...';
      disabled = true;
    } else if (verificationStatus === 'connected') {
      buttonClass = 'btn-success';
      buttonText = 'Connected ✓';
    }

    return (
      <button 
        className={`action-button ${buttonClass}`} 
        onClick={verifyConnection}
        disabled={disabled}
        type="button"
      >
        {buttonText}
      </button>
    );
  };

  const getStatusIndicator = () => {
    const { verificationStatus } = state;
    
    if (verificationStatus === 'idle') {
      return null;
    }

    if (verificationStatus === 'checking') {
      return (
        <div className="status-message checking">
          <span className="status-spinner"></span>
          Checking connection to browser extension...
        </div>
      );
    }

    if (verificationStatus === 'connected') {
      const tabCount = state.statusDetails?.tabCount || 0;
      return (
        <div className="status-message success">
          <span className="status-icon">✓</span>
          <div>
            <strong>Connected!</strong> Browser extension is active with {tabCount} tab{tabCount !== 1 ? 's' : ''}.
          </div>
        </div>
      );
    }

    return (
      <div className="status-message error">
        <span className="status-icon">✗</span>
        <div>
          <strong>Connection Failed</strong>
          {state.errorMessage && <p>{state.errorMessage}</p>}
        </div>
      </div>
    );
  };

  return (
    <div className="browser-pairing-overlay">
      <div className="browser-pairing-container">
        <div className="pairing-header">
          <h1>Browser Extension Setup</h1>
          <p>Follow these steps to install and connect the ifin browser extension</p>
          {onClose && (
            <button className="close-button" onClick={onClose} type="button">×</button>
          )}
        </div>

        <div className="steps-container">
          {/* Step 1: Platform Detection */}
          <div className="pairing-step">
            <div className="step-header">
              <div className="step-number">1</div>
              <div className="step-title">Platform Detected: {state.platform}</div>
            </div>
            <div className="step-content">
              {getPlatformInstructions()}
            </div>
          </div>

          {/* Step 2: Extension Location */}
          <div className="pairing-step">
            <div className="step-header">
              <div className="step-number">2</div>
              <div className="step-title">Locate Extension Files</div>
            </div>
            <div className="step-content">
              <p>The browser extension is located in the <code>chrome-extension/</code> directory of your workspace.</p>
              <div className="platform-note">
                <strong>Extension Path:</strong>
                <code>{state.extensionPath || 'Loading...'}</code>
              </div>
              <div className="button-group">
                <button 
                  className="action-button btn-secondary" 
                  onClick={copyExtensionPath}
                  type="button"
                >
                  {copied ? 'Copied!' : 'Copy Path'}
                </button>
                <button 
                  className="action-button btn-secondary" 
                  onClick={openExtensionFolder}
                  type="button"
                >
                  Open Folder
                </button>
              </div>
            </div>
          </div>

          {/* Step 3: Load Extension */}
          <div className="pairing-step">
            <div className="step-header">
              <div className="step-number">3</div>
              <div className="step-title">Load Extension in Chrome</div>
            </div>
            <div className="step-content">
              <ol className="instruction-list">
                <li>Open Chrome or Edge and navigate to <code>chrome://extensions</code></li>
                <li>Enable <strong>Developer mode</strong> (toggle in top-right corner)</li>
                <li>Click <strong>Load unpacked</strong> button</li>
                <li>Select the <code>chrome-extension</code> folder from your workspace</li>
                <li>The ifin extension should now appear in your extensions list</li>
              </ol>
            </div>
          </div>

          {/* Step 4: Verify Connection */}
          <div className="pairing-step">
            <div className="step-header">
              <div className="step-number">4</div>
              <div className="step-title">Verify Connection</div>
            </div>
            <div className="step-content">
              <p>Click the button below to verify the browser extension is connected to the MCP router.</p>
              <div className="button-group">
                {getVerificationButton()}
              </div>
              {getStatusIndicator()}
            </div>
          </div>

          {/* Troubleshooting Section */}
          {state.verificationStatus === 'failed' && (
            <div className="pairing-step troubleshooting">
              <div className="step-header">
                <div className="step-number">!</div>
                <div className="step-title">Troubleshooting</div>
              </div>
              <div className="step-content">
                <p>If the connection fails, try these steps:</p>
                <ul className="troubleshoot-list">
                  <li><strong>Restart Chrome</strong> - Close all Chrome windows and reopen</li>
                  <li><strong>Reinstall Extension</strong> - Remove and reload the unpacked extension</li>
                  <li><strong>Check Port 9315</strong> - Ensure port 9315 is not blocked by firewall</li>
                  <li><strong>Check WebSocket Bridge</strong> - Verify the bridge is running in the extension</li>
                  <li><strong>Check MCP Server</strong> - Make sure the MCP server is running on port 3000</li>
                </ul>
                <div className="troubleshoot-actions">
                  <button 
                    className="action-button btn-secondary" 
                    onClick={openExtensionFolder}
                    type="button"
                  >
                    Open Extension Folder
                  </button>
                  <button 
                    className="action-button btn-secondary" 
                    onClick={() => setState(prev => ({ ...prev, verificationStatus: 'idle', errorMessage: null }))}
                    type="button"
                  >
                    Reset Status
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
