import { describe, it } from 'node:test';
import assert from 'node:assert';
import type * as vscode from 'vscode';
import {
  buildRouterEntrypointCandidates,
  resolveRouterEntrypoint,
} from '../../../src/provider/mcpServerProvider';

function createWorkspaceFolder(fsPath: string): vscode.WorkspaceFolder {
  return {
    uri: { fsPath } as vscode.Uri,
    name: fsPath.split(/[\\/]/u).pop() ?? fsPath,
    index: 0,
  };
}

describe('McpRouterServerProvider path resolution', () => {
  it('prefers an explicitly configured built entrypoint', () => {
    const resolved = resolveRouterEntrypoint(
      {
        configuredRouterPath: 'C:\\router\\dist\\src\\index.js',
        workspaceFolders: [createWorkspaceFolder('C:\\workspace\\project')],
        extensionDir: 'C:\\Users\\user\\.vscode\\extensions\\ifinsta.ifin-platform-integrations\\dist\\provider',
        cwd: 'C:\\Users\\user',
      },
      (candidate) => candidate === 'C:\\router\\dist\\src\\index.js',
    );

    assert.strictEqual(resolved, 'C:\\router\\dist\\src\\index.js');
  });

  it('accepts a configured repo root and expands it to dist/src/index.js', () => {
    const candidates = buildRouterEntrypointCandidates({
      configuredRouterPath: 'C:\\router',
      workspaceFolders: [],
      extensionDir: 'C:\\Users\\user\\.vscode\\extensions\\ifinsta.ifin-platform-integrations\\dist\\provider',
      cwd: 'C:\\Users\\user',
    });

    assert.ok(candidates.includes('C:\\router'));
    assert.ok(candidates.includes('C:\\router\\dist\\src\\index.js'));
  });

  it('falls back to a workspace repo checkout when the extension is installed elsewhere', () => {
    const resolved = resolveRouterEntrypoint(
      {
        configuredRouterPath: null,
        workspaceFolders: [createWorkspaceFolder('C:\\dev\\mcp-router-for-antigravity')],
        extensionDir: 'C:\\Users\\user\\.vscode\\extensions\\ifinsta.ifin-platform-integrations\\dist\\provider',
        cwd: 'C:\\Users\\user',
      },
      (candidate) => candidate === 'C:\\dev\\mcp-router-for-antigravity\\dist\\src\\index.js',
    );

    assert.strictEqual(resolved, 'C:\\dev\\mcp-router-for-antigravity\\dist\\src\\index.js');
  });
});
