#!/usr/bin/env node

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');
const compiledModulePath = join(rootDir, 'dist', 'src', 'integration', 'desktopIntegrations.js');

function showHelp() {
  console.log(`
MCP Router Setup Tool

Usage:
  node bin/setup-mcp.js [ide] [options]

Available IDEs:
  qoder
  cursor
  windsurf
  claude-desktop
  antigravity

Options:
  --mode <auto|installed|repo>  Choose the launcher source (default: repo)
  --output <path>               Output configuration to a file
  --show                        Display configuration without saving
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
    console.error('Build artifacts are missing. Run `pnpm run build` before using setup-mcp.');
    process.exit(1);
  }

  return import(pathToFileURL(compiledModulePath).href);
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

  const integrationModule = await loadIntegrationModule();
  const repoRoot = integrationModule.detectRepoRoot(rootDir) ?? rootDir;
  const context = integrationModule.createIntegrationContext({
    repoRoot,
    env: process.env,
  });

  const preview = integrationModule.previewMcpClientConfig(context, targetId, launcherMode);

  if (preview.command === null || preview.resolvedMode === null) {
    console.error(preview.reason ?? 'No valid launcher target is available.');
    process.exit(1);
  }

  if (showOnly) {
    console.log(preview.configJson);
    process.exit(0);
  }

  if (outputPath) {
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, preview.configJson, 'utf-8');
    console.log(`Configuration written to ${outputPath}`);
    process.exit(0);
  }

  if (preview.requiresReplace && !repair) {
    console.error('Target config file contains invalid JSON. Re-run with --repair to replace it.');
    process.exit(1);
  }

  const applied = integrationModule.applyMcpClientConfig(context, targetId, launcherMode, repair);
  console.log(`Configured ${applied.targetLabel} at ${applied.configPath}`);
  console.log(`Launcher mode: ${applied.resolvedMode}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
