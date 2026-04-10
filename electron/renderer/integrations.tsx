import React from 'react';
import type {
  IntegrationPreview,
  IntegrationRecord,
  IntegrationTestResult,
  LauncherMode,
} from './types';

interface IntegrationsProps {
  launcherMode: LauncherMode;
  integrationRecords: IntegrationRecord[];
  integrationPreview: IntegrationPreview | null;
  integrationTestResult: IntegrationTestResult | null;
  onLauncherModeChange: (launcherMode: LauncherMode) => void;
  onPreview: (targetId: string) => void;
  onApply: (targetId: string, replaceInvalid?: boolean) => void;
  onTest: (targetId: string) => void;
  onOpenPath: (targetPath: string) => void;
  onOpenExtensionGuide: () => void;
  onRefresh: () => void;
}

const launcherModes: LauncherMode[] = ['auto', 'installed', 'repo'];

function getStatusLabel(status: IntegrationRecord['status'] | IntegrationTestResult['status']) {
  switch (status) {
    case 'not_configured':
      return 'Not Configured';
    case 'available':
      return 'Available';
    case 'configured':
      return 'Configured';
    case 'invalid_config':
      return 'Invalid Config';
    case 'ready':
      return 'Ready';
    case 'connected':
      return 'Connected';
    case 'degraded':
      return 'Degraded';
    case 'error':
      return 'Error';
    default:
      return status;
  }
}

function renderMetadataValue(value: string | boolean | null) {
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }

  return value ?? 'Unavailable';
}

function IntegrationCard({
  record,
  actions,
}: {
  record: IntegrationRecord;
  actions: React.ReactNode;
}) {
  const metadataEntries = Object.entries(record.metadata).slice(0, 4);

  return (
    <section className="integration-card">
      <div className="integration-card-header">
        <div>
          <h4>{record.label}</h4>
          <p>{record.summary}</p>
        </div>
        <span className={`status-pill status-${record.status}`}>{getStatusLabel(record.status)}</span>
      </div>

      <div className="integration-card-body">
        <div className="integration-path-row">
          <span className="detail-label">Path</span>
          <code>{record.path || 'Unavailable'}</code>
        </div>
        <p className="integration-detail">{record.detail}</p>

        {metadataEntries.length > 0 ? (
          <dl className="integration-metadata">
            {metadataEntries.map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{renderMetadataValue(value)}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>

      <div className="integration-card-actions">{actions}</div>
    </section>
  );
}

export default function Integrations({
  launcherMode,
  integrationRecords,
  integrationPreview,
  integrationTestResult,
  onLauncherModeChange,
  onPreview,
  onApply,
  onTest,
  onOpenPath,
  onOpenExtensionGuide,
  onRefresh,
}: IntegrationsProps) {
  const mcpClients = integrationRecords.filter((record) => record.kind === 'mcp-client');
  const ideExtension = integrationRecords.find((record) => record.id === 'ide-extension') ?? null;

  return (
    <div className="workspace-section integration-workspace">
      <section className="panel-block integration-overview">
        <div className="panel-header">
          <h3>Launcher Mode</h3>
          <div className="inline-actions">
            <button type="button" className="btn-secondary" onClick={onRefresh}>
              Refresh
            </button>
          </div>
        </div>
        <p className="panel-copy">
          Choose how local clients launch the router. Auto prefers the installed Windows
          application and falls back to the local repo checkout when available.
        </p>
        <div className="launcher-mode-group">
          {launcherModes.map((mode) => (
            <button
              key={mode}
              type="button"
              className={`mode-chip ${launcherMode === mode ? 'active' : ''}`}
              onClick={() => onLauncherModeChange(mode)}
            >
              {mode === 'auto' ? 'Auto' : mode === 'installed' ? 'Installed' : 'Repo'}
            </button>
          ))}
        </div>
      </section>

      <section className="panel-block">
        <div className="panel-header">
          <h3>MCP Clients</h3>
          <span className="panel-note">Config detection, repair, and launcher validation</span>
        </div>
        <div className="integration-grid">
          {mcpClients.map((record) => (
            <IntegrationCard
              key={record.id}
              record={record}
              actions={
                <>
                  <button type="button" className="btn-secondary" onClick={() => onPreview(record.id)}>
                    Preview
                  </button>
                  <button type="button" className="btn-primary" onClick={() => onApply(record.id, false)}>
                    Apply
                  </button>
                  {record.status === 'invalid_config' ? (
                    <button type="button" className="btn-warning" onClick={() => onApply(record.id, true)}>
                      Repair
                    </button>
                  ) : null}
                  <button type="button" className="btn-secondary" onClick={() => onTest(record.id)}>
                    Test
                  </button>
                  {record.path ? (
                    <button type="button" className="btn-secondary" onClick={() => onOpenPath(record.path!)}>
                      Open File
                    </button>
                  ) : null}
                </>
              }
            />
          ))}
        </div>

        {integrationPreview ? (
          <div className="integration-output-panel">
            <div className="panel-header">
              <h4>Generated Config Preview</h4>
              <span className="panel-note">
                {integrationPreview.targetLabel} - {integrationPreview.resolvedMode || 'Unavailable'}
              </span>
            </div>
            <div className="detail-stack compact">
              <div>
                <dt>Target Path</dt>
                <dd>{integrationPreview.configPath || 'Unavailable'}</dd>
              </div>
              <div>
                <dt>Command</dt>
                <dd>{integrationPreview.command || 'Unavailable'}</dd>
              </div>
              <div>
                <dt>Args</dt>
                <dd>{integrationPreview.args.join(' ') || 'None'}</dd>
              </div>
            </div>
            <pre className="integration-preview-code">{integrationPreview.configJson}</pre>
          </div>
        ) : null}

        {integrationTestResult ? (
          <div className={`integration-test-result status-${integrationTestResult.status}`}>
            <strong>{getStatusLabel(integrationTestResult.status)}</strong>
            <span>{integrationTestResult.message}</span>
            {integrationTestResult.detail ? <code>{integrationTestResult.detail}</code> : null}
          </div>
        ) : null}
      </section>

      <section className="panel-block">
        <div className="panel-header">
          <h3>IDE Extension</h3>
          <span className="panel-note">Editor integration and local API path</span>
        </div>
        {ideExtension ? (
          <IntegrationCard
            record={ideExtension}
            actions={
              <>
                {typeof ideExtension.metadata.vsixPath === 'string' ? (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => onOpenPath(String(ideExtension.metadata.vsixPath))}
                  >
                    Open VSIX
                  </button>
                ) : null}
                {ideExtension.path ? (
                  <button type="button" className="btn-secondary" onClick={() => onOpenPath(ideExtension.path!)}>
                    Open Folder
                  </button>
                ) : null}
                <button type="button" className="btn-primary" onClick={() => onTest('ide-extension')}>
                  Test API
                </button>
                <button type="button" className="btn-secondary" onClick={onOpenExtensionGuide}>
                  Open Guide
                </button>
              </>
            }
          />
        ) : null}
      </section>
    </div>
  );
}
