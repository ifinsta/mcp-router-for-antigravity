/**
 * CJS require-hook that redirects `require('vscode')` to the local mock.
 *
 * Must be loaded via --require BEFORE tsx registers its own hooks,
 * so that tsx can transpile the .ts mock file.
 *
 * Usage:  node --require ./test/setup-vscode-mock.cjs --import tsx --test ...
 */
'use strict';

const Module = require('node:module');
const path = require('node:path');

const mockPath = path.resolve(__dirname, '__mocks__', 'vscode.ts');

const _origResolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolveWithVscodeMock(request, parent, isMain, options) {
  if (request === 'vscode') {
    return mockPath;
  }
  return _origResolveFilename.call(this, request, parent, isMain, options);
};
