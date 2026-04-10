import * as path from 'node:path';

export interface ElectronAssetPaths {
  preloadScript: string;
  rendererIndexHtml: string;
  appIcon: string;
  serverEntryScript: string;
}

/**
 * Resolve Electron runtime assets from the compiled main-process directory.
 * The Windows app ships the Electron UI assets under `electron/` and the
 * MCP server under `dist/src/`.
 */
export function resolveElectronAssetPaths(mainProcessDir: string): ElectronAssetPaths {
  return {
    preloadScript: path.resolve(mainProcessDir, '../../electron/preload.js'),
    rendererIndexHtml: path.resolve(mainProcessDir, '../../electron/renderer/dist/index.html'),
    appIcon: path.resolve(mainProcessDir, '../../electron/icon.png'),
    serverEntryScript: path.resolve(mainProcessDir, '../src/index.js'),
  };
}
