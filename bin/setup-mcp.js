#!/usr/bin/env node

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');
const compiledModulePath = join(rootDir, 'dist', 'src', 'integration', 'desktopIntegrations.js');
const CODEX_TARGET_ID = 'codex';
const ALL_TARGET_ID = 'all';
const FALLBACK_ROUTER_SERVER_NAME = 'mcp-router';

function showHelp() {
  console.log(`
ifin Platform Setup Tool

Usage:
  npm run setup -- <target> [options]
  node bin/setup-mcp.js <target> [options]

Available targets:
  qoder
  cursor
  windsurf
  claude-desktop
  antigravity
  codex
  all

Options:
  --mode <auto|installed|repo>  Choose the launcher source (default: repo)
  --output <path>               Write preview output to a file (single targets only)
  --show                        Display the generated config or command preview without saving
  --repair                      Replace malformed target config files
  --help                        Show this help message
`);
}

function getOptionValue(args, optionName) {
  const index = args.indexOf(optionName);
  return index >= 0 ? args[index + 1] ?? null : null;
}

async function loadIntegrationModule() {
  if (!existsSync(compiledModulePath)) {
    console.error('Build artifacts are missing. Run `npm run build` before using `npm run setup -- <target>`.');
    process.exit(1);
  }

  return import(pathToFileURL(compiledModulePath).href);
}

function getCodexConfigPath() {
  return join(os.homedir(), '.codex', 'config.toml');
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf-8',
    stdio: 'pipe',
    ...options,
  });

  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error ?? null,
  };
}

function ensureCodexCli() {
  const probe = runCommand('codex', ['mcp', '--help']);
  if (probe.error) {
    throw new Error('Codex CLI is not available on PATH. Install Codex or skip the `codex` target.');
  }

  if (probe.status !== 0) {
    throw new Error(probe.stderr.trim() || 'Codex CLI is installed, but `codex mcp` failed to run.');
  }
}

function normalizeEnvEntries(env) {
  return Object.entries(env)
    .filter(([, value]) => typeof value === 'string' && value.trim().length > 0)
    .sort(([left], [right]) => left.localeCompare(right));
}

function redactEnvKey(key) {
  return /(?:key|token|secret|password)/iu.test(key);
}

function redactEnvRecord(env) {
  return Object.fromEntries(
    Object.entries(env).map(([key, value]) => [key, redactEnvKey(key) ? '[redacted]' : value])
  );
}

function sanitizeJsonPreview(configJson) {
  try {
    const parsed = JSON.parse(configJson);
    const mcpServers = parsed?.mcpServers;
    if (mcpServers && typeof mcpServers === 'object') {
      for (const serverDefinition of Object.values(mcpServers)) {
        if (serverDefinition && typeof serverDefinition === 'object' && serverDefinition.env && typeof serverDefinition.env === 'object') {
          serverDefinition.env = redactEnvRecord(serverDefinition.env);
        }
      }
    }
    return JSON.stringify(parsed, null, 2);
  } catch {
    return configJson;
  }
}

function buildCodexPreview(integrationModule, context, launcherMode) {
  const launcher = integrationModule.resolveLauncher(context, launcherMode);
  const routerServerName = integrationModule.ROUTER_SERVER_NAME ?? FALLBACK_ROUTER_SERVER_NAME;

  if (!launcher.available || !launcher.command || launcher.resolvedMode === null) {
    return {
      ok: false,
      reason: launcher.reason ?? 'No valid launcher target is available.',
      configPath: getCodexConfigPath(),
      routerServerName,
    };
  }

  const env = integrationModule.getConfiguredEnv(context);

  return {
    ok: true,
    targetId: CODEX_TARGET_ID,
    targetLabel: 'Codex',
    configPath: getCodexConfigPath(),
    launcherMode,
    resolvedMode: launcher.resolvedMode,
    routerServerName,
    transport: {
      type: 'stdio',
      command: launcher.command,
      args: launcher.args,
      env,
    },
  };
}

function getCodexRegistration(routerServerName) {
  const result = runCommand('codex', ['mcp', 'get', routerServerName, '--json']);
  if (result.error) {
    return {
      available: false,
      registered: false,
      reason: 'Codex CLI is not available on PATH.',
      payload: null,
    };
  }

  if (result.status !== 0) {
    const stderr = result.stderr.trim();
    const missingServer = stderr.includes(`No MCP server named '${routerServerName}' found.`);
    return {
      available: true,
      registered: false,
      reason: missingServer ? 'Codex does not have an ifin Platform MCP server configured yet.' : stderr,
      payload: null,
    };
  }

  try {
    return {
      available: true,
      registered: true,
      reason: '',
      payload: JSON.parse(result.stdout),
    };
  } catch {
    return {
      available: true,
      registered: false,
      reason: 'Codex returned an unreadable MCP configuration payload.',
      payload: null,
    };
  }
}

function codexConfigMatches(preview, registration) {
  if (!preview.ok || !registration.registered || !registration.payload) {
    return false;
  }

  const transport = registration.payload.transport;
  if (!transport || transport.type !== 'stdio') {
    return false;
  }

  const actualArgs = Array.isArray(transport.args)
    ? transport.args.filter((value) => typeof value === 'string')
    : [];

  return transport.command === preview.transport.command
    && JSON.stringify(actualArgs) === JSON.stringify(preview.transport.args);
}

function applyCodexPreview(preview) {
  if (!preview.ok) {
    throw new Error(preview.reason);
  }

  ensureCodexCli();
  const registration = getCodexRegistration(preview.routerServerName);

  if (registration.available && registration.registered) {
    const removeResult = runCommand('codex', ['mcp', 'remove', preview.routerServerName]);
    if (removeResult.status !== 0) {
      throw new Error(removeResult.stderr.trim() || 'Failed to remove the existing Codex MCP registration.');
    }
  }

  const envArgs = normalizeEnvEntries(preview.transport.env).flatMap(([key, value]) => ['--env', `${key}=${value}`]);
  const addArgs = [
    'mcp',
    'add',
    preview.routerServerName,
    ...envArgs,
    '--',
    preview.transport.command,
    ...preview.transport.args,
  ];

  const addResult = runCommand('codex', addArgs);
  if (addResult.status !== 0) {
    throw new Error(addResult.stderr.trim() || 'Failed to register the ifin Platform MCP server with Codex.');
  }

  return {
    targetId: CODEX_TARGET_ID,
    targetLabel: 'Codex',
    configPath: preview.configPath,
    resolvedMode: preview.resolvedMode,
    detail: codexConfigMatches(preview, getCodexRegistration(preview.routerServerName))
      ? 'Codex MCP registration matches the current launcher target.'
      : 'Codex MCP registration was updated.',
  };
}

function formatCodexPreview(preview) {
  if (!preview.ok) {
    return preview.reason;
  }

  return JSON.stringify(
    {
      name: preview.routerServerName,
      transport: {
        ...preview.transport,
        env: redactEnvRecord(preview.transport.env),
      },
      configPath: preview.configPath,
      launcherMode: preview.resolvedMode,
    },
    null,
    2,
  );
}

function printResultLine(status, label, detail) {
  console.log(`${status.toUpperCase()}: ${label}`);
  if (detail) {
    console.log(`  ${detail}`);
  }
}

function buildJsonTargetResults(integrationModule, context, launcherMode) {
  const records = integrationModule.detectMcpClientRecords(context, launcherMode);
  return records.map((record) => ({
    id: record.id,
    label: record.label,
    record,
  }));
}

async function configureAllTargets(integrationModule, context, launcherMode, repair, showOnly) {
  const results = [];
  const jsonTargets = buildJsonTargetResults(integrationModule, context, launcherMode);

  for (const target of jsonTargets) {
    if (target.record.status === 'not_configured') {
      results.push({
        status: 'skipped',
        label: target.label,
        detail: 'Target was not detected on this machine, so no config file was created.',
      });
      continue;
    }

    if (target.record.status === 'invalid_config' && !repair) {
      results.push({
        status: 'blocked',
        label: target.label,
        detail: 'Config file is malformed JSON. Re-run with --repair to replace it.',
      });
      continue;
    }

    if (showOnly) {
      const preview = integrationModule.previewMcpClientConfig(context, target.id, launcherMode);
      results.push({
        status: 'preview',
        label: target.label,
        detail: preview.command === null || preview.resolvedMode === null
          ? (preview.reason ?? 'No valid launcher target is available.')
          : `${preview.configPath} (${preview.resolvedMode})`,
      });
      continue;
    }

    try {
      const applied = integrationModule.applyMcpClientConfig(context, target.id, launcherMode, repair);
      results.push({
        status: 'configured',
        label: applied.targetLabel,
        detail: `${applied.configPath} (${applied.resolvedMode})`,
      });
    } catch (error) {
      results.push({
        status: 'blocked',
        label: target.label,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const codexPreview = buildCodexPreview(integrationModule, context, launcherMode);
  if (showOnly) {
    results.push({
      status: codexPreview.ok ? 'preview' : 'skipped',
      label: 'Codex',
      detail: codexPreview.ok
        ? `${codexPreview.configPath} (${codexPreview.resolvedMode})`
        : codexPreview.reason,
    });
    return results;
  }

  try {
    const applied = applyCodexPreview(codexPreview);
    results.push({
      status: 'configured',
      label: applied.targetLabel,
      detail: `${applied.configPath} (${applied.resolvedMode})`,
    });
  } catch (error) {
    results.push({
      status: 'skipped',
      label: 'Codex',
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  return results;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help')) {
    showHelp();
    process.exit(0);
  }

  const targetId = args[0];
  const launcherMode = getOptionValue(args, '--mode') ?? 'repo';
  const outputPath = getOptionValue(args, '--output');
  const showOnly = args.includes('--show');
  const repair = args.includes('--repair');

  if (!['auto', 'installed', 'repo'].includes(launcherMode)) {
    console.error(`Invalid launcher mode: ${launcherMode}`);
    process.exit(1);
  }

  if (targetId === ALL_TARGET_ID && outputPath) {
    console.error('`--output` is only supported for a single target preview.');
    process.exit(1);
  }

  const integrationModule = await loadIntegrationModule();
  const repoRoot = integrationModule.detectRepoRoot(rootDir) ?? rootDir;
  const context = integrationModule.createIntegrationContext({
    repoRoot,
    env: process.env,
  });

  const jsonTargetIds = integrationModule.getMcpClientDefinitions(context).map((target) => target.id);
  const routerServerName = integrationModule.ROUTER_SERVER_NAME ?? FALLBACK_ROUTER_SERVER_NAME;

  if (targetId === ALL_TARGET_ID) {
    const results = await configureAllTargets(integrationModule, context, launcherMode, repair, showOnly);
    results.forEach((result) => printResultLine(result.status, result.label, result.detail));
    process.exit(results.some((result) => result.status === 'blocked') ? 1 : 0);
  }

  if (targetId === CODEX_TARGET_ID) {
    const preview = buildCodexPreview(integrationModule, context, launcherMode);
    if (!preview.ok) {
      console.error(preview.reason);
      process.exit(1);
    }

    if (showOnly) {
      console.log(formatCodexPreview(preview));
      process.exit(0);
    }

    if (outputPath) {
      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, formatCodexPreview(preview), 'utf-8');
      console.log(`PREVIEW: Codex`);
      console.log(`  ${outputPath}`);
      process.exit(0);
    }

    const applied = applyCodexPreview(preview);
    printResultLine('configured', applied.targetLabel, `${applied.configPath} (${applied.resolvedMode})`);
    process.exit(0);
  }

  if (!jsonTargetIds.includes(targetId)) {
    console.error(`Unknown setup target: ${targetId}`);
    console.error(`Supported targets: ${[...jsonTargetIds, CODEX_TARGET_ID, ALL_TARGET_ID].join(', ')}`);
    process.exit(1);
  }

  const preview = integrationModule.previewMcpClientConfig(context, targetId, launcherMode);

  if (preview.command === null || preview.resolvedMode === null) {
    console.error(preview.reason ?? 'No valid launcher target is available.');
    process.exit(1);
  }

  if (showOnly) {
    console.log(sanitizeJsonPreview(preview.configJson));
    process.exit(0);
  }

  if (outputPath) {
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, preview.configJson, 'utf-8');
    console.log(`PREVIEW: ${preview.targetLabel}`);
    console.log(`  ${outputPath}`);
    process.exit(0);
  }

  if (preview.requiresReplace && !repair) {
    console.error('Target config file contains invalid JSON. Re-run with --repair to replace it.');
    process.exit(1);
  }

  const applied = integrationModule.applyMcpClientConfig(context, targetId, launcherMode, repair);
  printResultLine('configured', applied.targetLabel, `${applied.configPath} (${applied.resolvedMode})`);

  if (targetId !== CODEX_TARGET_ID) {
    const codexRegistration = getCodexRegistration(routerServerName);
    if (codexRegistration.available && !codexRegistration.registered) {
      printResultLine('hint', 'Codex', 'Run `npm run setup -- codex --mode repo` if you want the same server available in Codex.');
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
