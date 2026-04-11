import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectDoctorReport, renderDoctorReport } from '../../../bin/doctor.js';

const tempDirs: string[] = [];

function createTempProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ifin-doctor-'));
  tempDirs.push(root);

  fs.mkdirSync(path.join(root, 'dist', 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'extension', 'dist'), { recursive: true });
  fs.mkdirSync(path.join(root, 'electron', 'renderer', 'dist'), { recursive: true });
  fs.mkdirSync(path.join(root, 'electron', 'dist'), { recursive: true });
  fs.mkdirSync(path.join(root, 'electron', 'installer'), { recursive: true });
  fs.mkdirSync(path.join(root, 'node_modules', 'electron-builder'), { recursive: true });

  fs.writeFileSync(path.join(root, 'dist', 'src', 'index.js'), 'export {};', 'utf-8');
  fs.writeFileSync(path.join(root, 'extension', 'dist', 'extension.js'), 'export {};', 'utf-8');
  fs.writeFileSync(path.join(root, 'electron', 'renderer', 'dist', 'index.html'), '<html></html>', 'utf-8');
  fs.writeFileSync(path.join(root, 'electron', 'dist', 'main.js'), 'module.exports = {};', 'utf-8');
  fs.writeFileSync(path.join(root, 'electron', 'icon.ico'), 'ico', 'utf-8');
  fs.writeFileSync(path.join(root, 'electron', 'installer', 'build-installer.cjs'), 'module.exports = {};', 'utf-8');
  fs.writeFileSync(path.join(root, '.env'), 'OPENAI_API_KEY=test-key\nROUTER_DEFAULT_PROVIDER=openai\nROUTER_DEFAULT_MODEL=gpt-4.1-mini\n', 'utf-8');

  return root;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('doctor', () => {
  it('reports a healthy project when required artifacts are present', () => {
    const root = createTempProject();
    const report = collectDoctorReport({
      projectRoot: root,
      platform: 'win32',
      homedir: path.join(root, 'home'),
      appDataDir: path.join(root, 'roaming'),
      localAppDataDir: path.join(root, 'local'),
      env: {},
      commandRunner: (command: string) => {
        if (command === 'npm') {
          return { ok: true, status: 0, stdout: '10.9.0\n', stderr: '', error: null };
        }

        return {
          ok: true,
          status: 0,
          stdout: JSON.stringify({
            transport: {
              type: 'stdio',
              command: 'node',
              args: ['dist/src/index.js'],
            },
          }),
          stderr: '',
          error: null,
        };
      },
    });

    assert.strictEqual(report.hasFailures, false);
    assert.match(renderDoctorReport(report), /\[PASS\] Router build/);
    assert.match(renderDoctorReport(report), /\[PASS\] Codex MCP registration/);
  });

  it('flags missing dependencies and malformed client configs', () => {
    const root = createTempProject();
    fs.rmSync(path.join(root, 'node_modules'), { recursive: true, force: true });
    const cursorConfigDir = path.join(root, 'roaming', 'Cursor', 'User');
    fs.mkdirSync(cursorConfigDir, { recursive: true });
    fs.writeFileSync(path.join(cursorConfigDir, 'mcp.json'), '{invalid json', 'utf-8');

    const report = collectDoctorReport({
      projectRoot: root,
      platform: 'win32',
      homedir: path.join(root, 'home'),
      appDataDir: path.join(root, 'roaming'),
      localAppDataDir: path.join(root, 'local'),
      env: {},
      commandRunner: (command: string) => {
        if (command === 'npm') {
          return { ok: true, status: 0, stdout: '10.9.0\n', stderr: '', error: null };
        }

        return { ok: false, status: 1, stdout: '', stderr: 'missing', error: null };
      },
    });

    const output = renderDoctorReport(report);
    assert.strictEqual(report.hasFailures, true);
    assert.match(output, /\[FAIL\] Dependencies/);
    assert.match(output, /\[FAIL\] Cursor/);
  });
});
