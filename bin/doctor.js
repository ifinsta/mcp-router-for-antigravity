#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..');
const ROUTER_SERVER_NAME = 'ifin-platform';
const PROVIDER_ENV_KEYS = [
  'OPENAI_API_KEY',
  'GLM_API_KEY',
  'CHUTES_API_KEY',
  'ANTHROPIC_API_KEY',
  'AZURE_OPENAI_API_KEY',
  'OLLAMA_BASE_URL',
];

function parseDotEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const result = {};
  const content = fs.readFileSync(filePath, 'utf-8');

  for (const line of content.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();

    if (key && value) {
      result[key] = value;
    }
  }

  return result;
}

function runCommand(command, args, cwd = projectRoot) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf-8',
    stdio: 'pipe',
  });

  return {
    ok: (result.status ?? 1) === 0,
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error ?? null,
  };
}

function runNpmVersion(commandRunner) {
  const npmExecPath = process.env.npm_execpath;
  if (typeof npmExecPath === 'string' && npmExecPath.length > 0) {
    const viaNode = commandRunner(process.execPath, [npmExecPath, '--version']);
    if (viaNode.ok) {
      return viaNode;
    }
  }

  return commandRunner('npm', ['--version']);
}

function compareVersions(left, right) {
  const leftParts = left
    .replace(/^v/u, '')
    .split('.')
    .map((value) => Number.parseInt(value, 10) || 0);
  const rightParts = right
    .replace(/^v/u, '')
    .split('.')
    .map((value) => Number.parseInt(value, 10) || 0);
  const maxLength = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < maxLength; index += 1) {
    const leftValue = leftParts[index] ?? 0;
    const rightValue = rightParts[index] ?? 0;
    if (leftValue > rightValue) {
      return 1;
    }
    if (leftValue < rightValue) {
      return -1;
    }
  }

  return 0;
}

function readJson(filePath) {
  try {
    return {
      ok: true,
      value: JSON.parse(fs.readFileSync(filePath, 'utf-8')),
      error: '',
    };
  } catch (error) {
    return {
      ok: false,
      value: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function getClientDefinitions(platform, homedir, appDataDir, localAppDataDir) {
  if (platform === 'win32') {
    return [
      {
        id: 'ifin-platform',
        label: 'ifin-platform',
        configPath: path.join(appDataDir, 'ifin-platform', 'mcp_servers.json'),
        appPath: path.join(localAppDataDir, 'Programs', 'ifin-platform', 'ifin-platform.exe'),
      },
      {
        id: 'cursor',
        label: 'Cursor',
        configPath: path.join(appDataDir, 'Cursor', 'User', 'mcp.json'),
        appPath: path.join(localAppDataDir, 'Programs', 'Cursor', 'Cursor.exe'),
      },
      {
        id: 'windsurf',
        label: 'Windsurf',
        configPath: path.join(homedir, '.codeium', 'windsurf', 'mcp_config.json'),
        appPath: path.join(localAppDataDir, 'Programs', 'Windsurf', 'Windsurf.exe'),
      },
      {
        id: 'qoder',
        label: 'Qoder',
        configPath: path.join(appDataDir, 'Qoder', 'User', 'mcp.json'),
        appPath: path.join(localAppDataDir, 'Programs', 'Qoder', 'Qoder.exe'),
      },
      {
        id: 'claude-desktop',
        label: 'Claude Desktop',
        configPath: path.join(appDataDir, 'Claude', 'claude_desktop_config.json'),
        appPath: path.join(localAppDataDir, 'Programs', 'Claude', 'Claude.exe'),
      },
    ];
  }

  return [
    {
      id: 'ifin-platform',
      label: 'ifin-platform',
      configPath: path.join(homedir, '.config', 'ifin-platform', 'mcp_servers.json'),
      appPath: null,
    },
    {
      id: 'cursor',
      label: 'Cursor',
      configPath: path.join(homedir, '.cursor', 'mcp.json'),
      appPath: null,
    },
    {
      id: 'windsurf',
      label: 'Windsurf',
      configPath: path.join(homedir, '.codeium', 'windsurf', 'mcp_config.json'),
      appPath: null,
    },
    {
      id: 'qoder',
      label: 'Qoder',
      configPath: path.join(homedir, '.config', 'Qoder', 'User', 'mcp.json'),
      appPath: null,
    },
    {
      id: 'claude-desktop',
      label: 'Claude Desktop',
      configPath:
        platform === 'darwin'
          ? path.join(
              homedir,
              'Library',
              'Application Support',
              'Claude',
              'claude_desktop_config.json'
            )
          : path.join(homedir, '.config', 'Claude', 'claude_desktop_config.json'),
      appPath: null,
    },
  ];
}

function getCodexRegistration(commandRunner = runCommand) {
  const result = commandRunner('codex', ['mcp', 'get', ROUTER_SERVER_NAME, '--json']);
  if (result.error) {
    return {
      status: 'WARN',
      label: 'Codex CLI',
      detail: 'Codex CLI is not available on PATH.',
      remediation: 'Install Codex or skip Codex integration setup.',
    };
  }

  if (!result.ok) {
    return {
      status: 'WARN',
      label: 'Codex MCP registration',
      detail: `No Codex MCP server named \`${ROUTER_SERVER_NAME}\` is configured.`,
      remediation: 'Run `npm run setup -- codex --mode repo`.',
    };
  }

  try {
    const payload = JSON.parse(result.stdout);
    const transport = payload.transport;
    const args = Array.isArray(transport?.args) ? transport.args.join(' ') : '';
    return {
      status: 'PASS',
      label: 'Codex MCP registration',
      detail: `${transport?.command ?? 'unknown'} ${args}`.trim(),
      remediation: '',
    };
  } catch {
    return {
      status: 'FAIL',
      label: 'Codex MCP registration',
      detail: 'Codex returned unreadable JSON for the configured server.',
      remediation:
        'Remove and recreate the registration with `npm run setup -- codex --mode repo`.',
    };
  }
}

function makeItem(status, label, detail, remediation = '') {
  return { status, label, detail, remediation };
}

export function collectDoctorReport(overrides = {}) {
  const currentProjectRoot = overrides.projectRoot ?? projectRoot;
  const platform = overrides.platform ?? process.platform;
  const homedir = overrides.homedir ?? os.homedir();
  const env = {
    ...parseDotEnvFile(path.join(currentProjectRoot, '.env')),
    ...process.env,
    ...(overrides.env ?? {}),
  };
  const appDataDir =
    overrides.appDataDir ?? process.env.APPDATA ?? path.join(homedir, 'AppData', 'Roaming');
  const localAppDataDir =
    overrides.localAppDataDir ?? process.env.LOCALAPPDATA ?? path.join(homedir, 'AppData', 'Local');

  const sections = [];

  const commandRunner =
    overrides.commandRunner ?? ((command, args) => runCommand(command, args, currentProjectRoot));
  const npmVersion = runNpmVersion(commandRunner);
  sections.push({
    title: 'Toolchain',
    items: [
      compareVersions(process.version, '20.10.0') >= 0
        ? makeItem('PASS', 'Node.js', process.version)
        : makeItem(
            'FAIL',
            'Node.js',
            `${process.version} detected`,
            'Install Node.js 20.10.0 or newer.'
          ),
      npmVersion.error
        ? makeItem(
            'FAIL',
            'npm',
            'npm is not available on PATH.',
            'Install npm and rerun `npm install`.'
          )
        : makeItem('PASS', 'npm', npmVersion.stdout.trim()),
      fs.existsSync(path.join(currentProjectRoot, 'node_modules'))
        ? makeItem('PASS', 'Dependencies', 'node_modules is present.')
        : makeItem('FAIL', 'Dependencies', 'node_modules is missing.', 'Run `npm install`.'),
    ],
  });

  const routerEntrypoint = path.join(currentProjectRoot, 'dist', 'src', 'index.js');
  const legacyEntrypoint = path.join(currentProjectRoot, 'dist', 'index.js');
  const extensionEntrypoint = path.join(currentProjectRoot, 'extension', 'dist', 'extension.js');
  const rendererEntrypoint = path.join(
    currentProjectRoot,
    'electron',
    'renderer',
    'dist',
    'index.html'
  );
  const electronEntrypoint = path.join(currentProjectRoot, 'electron', 'dist', 'main.js');

  sections.push({
    title: 'Build Artifacts',
    items: [
      fs.existsSync(routerEntrypoint)
        ? makeItem('PASS', 'Router build', routerEntrypoint)
        : makeItem('FAIL', 'Router build', 'Missing dist/src/index.js.', 'Run `npm run build`.'),
      fs.existsSync(legacyEntrypoint)
        ? makeItem(
            'WARN',
            'Legacy router entrypoint',
            legacyEntrypoint,
            'Use `dist/src/index.js` in client configs, not `dist/index.js`.'
          )
        : makeItem('PASS', 'Router entrypoint path', 'Canonical entrypoint is dist/src/index.js.'),
      fs.existsSync(extensionEntrypoint)
        ? makeItem('PASS', 'Extension build', extensionEntrypoint)
        : makeItem(
            'FAIL',
            'Extension build',
            'Missing extension/dist/extension.js.',
            'Run `npm run build:ide-extension`.'
          ),
      fs.existsSync(rendererEntrypoint) && fs.existsSync(electronEntrypoint)
        ? makeItem('PASS', 'Desktop build', `${electronEntrypoint} + renderer bundle present`)
        : makeItem(
            'FAIL',
            'Desktop build',
            'Electron main build or renderer bundle is missing.',
            'Run `npm run build:all`.'
          ),
    ],
  });

  const configuredProviders = PROVIDER_ENV_KEYS.filter(
    (key) => typeof env[key] === 'string' && env[key].trim().length > 0
  );
  sections.push({
    title: 'Environment',
    items: [
      fs.existsSync(path.join(currentProjectRoot, '.env'))
        ? makeItem('PASS', '.env file', '.env is present.')
        : makeItem(
            'WARN',
            '.env file',
            '.env is missing.',
            'Copy `.env.example` to `.env` if you want router-mode provider config.'
          ),
      configuredProviders.length > 0
        ? makeItem('PASS', 'Provider configuration', configuredProviders.join(', '))
        : makeItem(
            'WARN',
            'Provider configuration',
            'No provider API keys or Ollama base URL were detected.',
            'Set provider values in `.env` or use Agent mode until router-mode providers are configured.'
          ),
      typeof env.ROUTER_DEFAULT_PROVIDER === 'string' &&
      typeof env.ROUTER_DEFAULT_MODEL === 'string'
        ? makeItem(
            'PASS',
            'Default router target',
            `${env.ROUTER_DEFAULT_PROVIDER} / ${env.ROUTER_DEFAULT_MODEL}`
          )
        : makeItem(
            'WARN',
            'Default router target',
            'ROUTER_DEFAULT_PROVIDER or ROUTER_DEFAULT_MODEL is missing.',
            'Set both values in `.env` if you want a stable default router target.'
          ),
    ],
  });

  const clientItems = [];
  for (const client of getClientDefinitions(platform, homedir, appDataDir, localAppDataDir)) {
    const configExists = fs.existsSync(client.configPath);
    const appDetected = client.appPath
      ? fs.existsSync(client.appPath)
      : fs.existsSync(path.dirname(client.configPath));

    if (!configExists) {
      clientItems.push(
        makeItem(
          appDetected ? 'WARN' : 'PASS',
          client.label,
          appDetected
            ? `No MCP config found at ${client.configPath}.`
            : 'Target not detected on this machine.',
          appDetected ? `Run \`npm run setup -- ${client.id} --mode repo\`.` : ''
        )
      );
      continue;
    }

    const parsed = readJson(client.configPath);
    if (!parsed.ok || typeof parsed.value !== 'object' || parsed.value === null) {
      clientItems.push(
        makeItem(
          'FAIL',
          client.label,
          `Malformed JSON at ${client.configPath}.`,
          `Run \`npm run setup -- ${client.id} --mode repo --repair\`.`
        )
      );
      continue;
    }

    const mcpServers = parsed.value.mcpServers;
    const hasRouterEntry =
      typeof mcpServers === 'object' && mcpServers !== null && ROUTER_SERVER_NAME in mcpServers;
    clientItems.push(
      hasRouterEntry
        ? makeItem('PASS', client.label, `${client.configPath} contains \`${ROUTER_SERVER_NAME}\`.`)
        : makeItem(
            'WARN',
            client.label,
            `${client.configPath} does not contain \`${ROUTER_SERVER_NAME}\`.`,
            `Run \`npm run setup -- ${client.id} --mode repo\`.`
          )
    );
  }
  clientItems.push(getCodexRegistration(commandRunner));
  sections.push({
    title: 'Client Setup',
    items: clientItems,
  });

  if (platform === 'win32') {
    sections.push({
      title: 'Windows Packaging',
      items: [
        fs.existsSync(path.join(currentProjectRoot, 'electron', 'icon.ico'))
          ? makeItem('PASS', 'Installer icon', 'electron/icon.ico is present.')
          : makeItem(
              'FAIL',
              'Installer icon',
              'electron/icon.ico is missing.',
              'Generate the installer assets before packaging.'
            ),
        fs.existsSync(path.join(currentProjectRoot, 'electron', 'installer', 'build-installer.cjs'))
          ? makeItem(
              'PASS',
              'Installer builder',
              'electron/installer/build-installer.cjs is present.'
            )
          : makeItem(
              'FAIL',
              'Installer builder',
              'Installer builder script is missing.',
              'Restore the installer builder script before packaging.'
            ),
        fs.existsSync(path.join(currentProjectRoot, 'node_modules', 'electron-builder'))
          ? makeItem('PASS', 'electron-builder', 'electron-builder dependency is installed.')
          : makeItem(
              'FAIL',
              'electron-builder',
              'electron-builder dependency is missing.',
              'Run `npm install` before packaging the Windows app.'
            ),
      ],
    });
  }

  const hasFailures = sections.some((section) =>
    section.items.some((item) => item.status === 'FAIL')
  );
  return { sections, hasFailures };
}

export function renderDoctorReport(report) {
  const lines = [];

  for (const section of report.sections) {
    lines.push(section.title.toUpperCase());
    for (const item of section.items) {
      lines.push(`[${item.status}] ${item.label}: ${item.detail}`);
      if (item.remediation) {
        lines.push(`  Remediation: ${item.remediation}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

function main() {
  const report = collectDoctorReport();
  console.log(renderDoctorReport(report));
  process.exit(report.hasFailures ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main();
}
