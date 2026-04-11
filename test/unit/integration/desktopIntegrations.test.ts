import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  applyMcpClientConfig,
  buildSystemReadiness,
  createIntegrationContext,
  detectAllIntegrationRecords,
  detectRepoRoot,
  previewMcpClientConfig,
  resolveLauncher,
} from '../../../src/integration/desktopIntegrations.js';

const tempDirs: string[] = [];

function createTempRepo(): string {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-router-integration-'));
  tempDirs.push(repoRoot);

  fs.writeFileSync(
    path.join(repoRoot, 'package.json'),
    JSON.stringify({ name: 'mcp-router-for-antigravity' }, null, 2),
    'utf-8'
  );
  fs.mkdirSync(path.join(repoRoot, 'dist', 'src'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'dist', 'src', 'index.js'), 'export {};', 'utf-8');

  return repoRoot;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('desktopIntegrations', () => {
  it('detects the repo root by package name', () => {
    const repoRoot = createTempRepo();
    const nestedDir = path.join(repoRoot, 'electron', 'renderer');
    fs.mkdirSync(nestedDir, { recursive: true });

    assert.strictEqual(detectRepoRoot(nestedDir), repoRoot);
  });

  it('resolves the repo launcher with the real dist/src/index.js entrypoint', () => {
    const repoRoot = createTempRepo();
    const context = createIntegrationContext({
      platform: 'win32',
      repoRoot,
      installedExecutablePath: null,
      env: {},
      homedir: path.join(repoRoot, 'home'),
      appDataDir: path.join(repoRoot, 'roaming'),
      localAppDataDir: path.join(repoRoot, 'local'),
    });

    const launcher = resolveLauncher(context, 'repo');

    assert.strictEqual(launcher.available, true);
    assert.strictEqual(launcher.resolvedMode, 'repo');
    assert.deepStrictEqual(launcher.args, [path.join(repoRoot, 'dist', 'src', 'index.js')]);
  });

  it('prefers the installed launcher in auto mode when available', () => {
    const repoRoot = createTempRepo();
    const installedExe = path.join(repoRoot, 'MCP Router Browser Control.exe');
    fs.writeFileSync(installedExe, 'binary', 'utf-8');

    const context = createIntegrationContext({
      platform: 'win32',
      repoRoot,
      installedExecutablePath: installedExe,
      env: {},
      homedir: path.join(repoRoot, 'home'),
      appDataDir: path.join(repoRoot, 'roaming'),
      localAppDataDir: path.join(repoRoot, 'local'),
    });

    const launcher = resolveLauncher(context, 'auto');

    assert.strictEqual(launcher.available, true);
    assert.strictEqual(launcher.resolvedMode, 'installed');
    assert.strictEqual(launcher.command, installedExe);
    assert.deepStrictEqual(launcher.args, [
      path.join(repoRoot, 'resources', 'app.asar', 'dist', 'src', 'index.js'),
    ]);
    assert.deepStrictEqual(launcher.env, { ELECTRON_RUN_AS_NODE: '1' });
  });

  it('preserves unrelated MCP servers when applying config', () => {
    const repoRoot = createTempRepo();
    const configDir = path.join(repoRoot, 'roaming', 'Cursor', 'User');
    fs.mkdirSync(configDir, { recursive: true });
    const configPath = path.join(configDir, 'mcp.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify(
        {
          mcpServers: {
            existing: {
              command: 'node',
              args: ['existing.js'],
            },
          },
        },
        null,
        2
      ),
      'utf-8'
    );

    const context = createIntegrationContext({
      platform: 'win32',
      repoRoot,
      env: {
        ROUTER_DEFAULT_PROVIDER: 'openai',
        ROUTER_DEFAULT_MODEL: 'gpt-4.1-mini',
      },
      installedExecutablePath: null,
      homedir: path.join(repoRoot, 'home'),
      appDataDir: path.join(repoRoot, 'roaming'),
      localAppDataDir: path.join(repoRoot, 'local'),
    });

    applyMcpClientConfig(context, 'cursor', 'repo', false);

    const updatedConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as {
      mcpServers: Record<string, { command: string; args: string[]; env?: Record<string, string> }>;
    };

    assert.ok(updatedConfig.mcpServers.existing);
    assert.ok(updatedConfig.mcpServers['mcp-router']);
    assert.strictEqual(updatedConfig.mcpServers['mcp-router'].command, 'node');
    assert.deepStrictEqual(updatedConfig.mcpServers['mcp-router'].args, [
      path.join(repoRoot, 'dist', 'src', 'index.js'),
    ]);
  });

  it('marks malformed JSON configs as requiring explicit repair', () => {
    const repoRoot = createTempRepo();
    const configDir = path.join(repoRoot, 'roaming', 'Cursor', 'User');
    fs.mkdirSync(configDir, { recursive: true });
    const configPath = path.join(configDir, 'mcp.json');
    fs.writeFileSync(configPath, '{invalid json', 'utf-8');

    const context = createIntegrationContext({
      platform: 'win32',
      repoRoot,
      env: {},
      installedExecutablePath: null,
      homedir: path.join(repoRoot, 'home'),
      appDataDir: path.join(repoRoot, 'roaming'),
      localAppDataDir: path.join(repoRoot, 'local'),
    });

    const preview = previewMcpClientConfig(context, 'cursor', 'repo');
    assert.strictEqual(preview.requiresReplace, true);

    assert.throws(() => applyMcpClientConfig(context, 'cursor', 'repo', false), {
      message: 'Existing config is malformed JSON. Use repair to replace it explicitly.',
    });
  });

  it('builds layered readiness for launcher, local API, and browser bridge', () => {
    const repoRoot = createTempRepo();
    const installedExe = path.join(repoRoot, 'MCP Router.exe');
    fs.writeFileSync(installedExe, 'binary', 'utf-8');

    const context = createIntegrationContext({
      platform: 'win32',
      repoRoot,
      installedExecutablePath: installedExe,
      env: {},
      homedir: path.join(repoRoot, 'home'),
      appDataDir: path.join(repoRoot, 'roaming'),
      localAppDataDir: path.join(repoRoot, 'local'),
      localApiPort: 4100,
      bridgePort: 9315,
    });

    const records = detectAllIntegrationRecords(
      context,
      'auto',
      { chrome: null, edge: null, firefox: null, safari: null },
      null
    );

    const readiness = buildSystemReadiness(context, 'auto', records, {
      localApi: { status: 'degraded', detail: 'Local API did not respond.' },
      browserBridge: { status: 'degraded', detail: 'Browser bridge did not respond.' },
    });

    assert.strictEqual(readiness.launcherMode, 'auto');
    assert.strictEqual(readiness.resolvedLauncherMode, 'installed');
    assert.strictEqual(readiness.planes[0].id, 'mcpLauncher');
    assert.strictEqual(readiness.planes[0].status, 'ready');
    assert.strictEqual(readiness.planes[1].status, 'degraded');
    assert.strictEqual(readiness.planes[2].status, 'degraded');
    assert.ok(readiness.checklist.some((item) => item.id === 'client-configs'));
    assert.ok(readiness.warnings.some((warning) => warning.includes('Local API')));
    assert.ok(readiness.summary.includes('blocked'));
  });
});
