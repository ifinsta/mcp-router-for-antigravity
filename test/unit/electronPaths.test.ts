import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { resolveElectronAssetPaths } from '../../src/infra/electronPaths.js';

describe('resolveElectronAssetPaths', () => {
  it('resolves the packaged MCP server entry from the compiled Electron directory', () => {
    const mainDir = path.join('C:', 'app', 'dist', 'electron');
    const paths = resolveElectronAssetPaths(mainDir);

    assert.equal(paths.serverEntryScript, path.join('C:', 'app', 'dist', 'src', 'index.js'));
  });

  it('resolves renderer and preload assets from the repository electron directory', () => {
    const mainDir = path.join('C:', 'app', 'dist', 'electron');
    const paths = resolveElectronAssetPaths(mainDir);

    assert.equal(paths.preloadScript, path.join('C:', 'app', 'electron', 'preload.js'));
    assert.equal(paths.rendererIndexHtml, path.join('C:', 'app', 'electron', 'renderer', 'dist', 'index.html'));
    assert.equal(paths.appIcon, path.join('C:', 'app', 'electron', 'assets', 'icon.png'));
  });
});
