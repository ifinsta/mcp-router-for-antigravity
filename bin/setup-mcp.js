#!/usr/bin/env node

/**
 * MCP Router Setup Script
 * 
 * Generates MCP configuration for any IDE that supports MCP servers.
 * Supports: Qoder, Cursor, Windsurf, Claude Desktop, Antigravity, and more.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

/**
 * IDE configurations
 */
const IDE_CONFIGS = {
  qoder: {
    name: 'Qoder',
    configPath: null, // Set dynamically based on OS
    format: 'json',
    template: {
      mcpServers: {
        'mcp-router': {
          command: 'node',
          args: ['{DIST_PATH}'],
          env: {}
        }
      }
    }
  },
  cursor: {
    name: 'Cursor',
    configPath: null,
    format: 'json',
    template: {
      mcpServers: {
        'mcp-router': {
          command: 'node',
          args: ['{DIST_PATH}'],
          env: {}
        }
      }
    }
  },
  windsurf: {
    name: 'Windsurf',
    configPath: null,
    format: 'json',
    template: {
      mcpServers: {
        'mcp-router': {
          command: 'node',
          args: ['{DIST_PATH}'],
          env: {}
        }
      }
    }
  },
  'claude-desktop': {
    name: 'Claude Desktop',
    configPath: null,
    format: 'json',
    template: {
      mcpServers: {
        'mcp-router': {
          command: 'node',
          args: ['{DIST_PATH}'],
          env: {}
        }
      }
    }
  },
  antigravity: {
    name: 'Antigravity',
    configPath: null,
    format: 'json',
    template: {
      mcpServers: {
        'mcp-router': {
          command: 'node',
          args: ['{DIST_PATH}'],
          env: {}
        }
      }
    }
  }
};

/**
 * Get config paths based on OS
 */
function getConfigPaths() {
  const isWin = process.platform === 'win32';
  const home = process.env.HOME || process.env.USERPROFILE;
  
  if (isWin) {
    const appData = process.env.APPDATA || join(home, 'AppData', 'Roaming');
    const localAppData = process.env.LOCALAPPDATA || join(home, 'AppData', 'Local');
    
    return {
      qoder: join(appData, 'Qoder', 'User', 'mcp.json'),
      cursor: join(appData, 'Cursor', 'User', 'mcp.json'),
      windsurf: join(home, '.codeium', 'windsurf', 'mcp_config.json'),
      'claude-desktop': join(appData, 'Claude', 'claude_desktop_config.json'),
      antigravity: join(appData, 'antigravity', 'mcp_servers.json')
    };
  } else {
    return {
      qoder: join(home, '.config', 'Qoder', 'User', 'mcp.json'),
      cursor: join(home, '.cursor', 'mcp.json'),
      windsurf: join(home, '.codeium', 'windsurf', 'mcp_config.json'),
      'claude-desktop': join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
      antigravity: join(home, '.config', 'antigravity', 'mcp_servers.json')
    };
  }
}

/**
 * Load environment variables from .env file
 */
function loadEnvFile() {
  const envPath = join(rootDir, '.env');
  if (!existsSync(envPath)) {
    console.warn('⚠️  Warning: .env file not found');
    return {};
  }
  
  const content = readFileSync(envPath, 'utf-8');
  const env = {};
  
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      if (key && valueParts.length > 0) {
        env[key.trim()] = valueParts.join('=').trim();
      }
    }
  }
  
  return env;
}

/**
 * Get available providers from env
 */
function getAvailableProviders(env) {
  const providers = [];
  if (env.OPENAI_API_KEY && env.OPENAI_API_KEY !== 'test-key') {
    providers.push('openai');
  }
  if (env.GLM_API_KEY && !env.GLM_API_KEY.includes('your-')) {
    providers.push('glm');
  }
  if (env.CHUTES_API_KEY && !env.CHUTES_API_KEY.includes('your-')) {
    providers.push('chutes');
  }
  return providers;
}

/**
 * Generate configuration for selected IDE
 */
function generateConfig(ide, env) {
  const config = JSON.parse(JSON.stringify(IDE_CONFIGS[ide].template));
  const distPath = join(rootDir, 'dist', 'index.js');
  
  // Replace path placeholder
  config.mcpServers['mcp-router'].args[0] = distPath;
  
  // Add environment variables
  const envVars = {};
  if (env.ROUTER_DEFAULT_PROVIDER) envVars.ROUTER_DEFAULT_PROVIDER = env.ROUTER_DEFAULT_PROVIDER;
  if (env.ROUTER_DEFAULT_MODEL) envVars.ROUTER_DEFAULT_MODEL = env.ROUTER_DEFAULT_MODEL;
  if (env.OPENAI_API_KEY && !env.OPENAI_API_KEY.includes('your-')) envVars.OPENAI_API_KEY = env.OPENAI_API_KEY;
  if (env.GLM_API_KEY && !env.GLM_API_KEY.includes('your-')) envVars.GLM_API_KEY = env.GLM_API_KEY;
  if (env.CHUTES_API_KEY && !env.CHUTES_API_KEY.includes('your-')) envVars.CHUTES_API_KEY = env.CHUTES_API_KEY;
  if (env.ALLOWED_PROVIDERS) envVars.ALLOWED_PROVIDERS = env.ALLOWED_PROVIDERS;
  
  config.mcpServers['mcp-router'].env = envVars;
  
  return config;
}

/**
 * Display available options
 */
function showHelp() {
  console.log(`
🚀 MCP Router Setup Tool

Usage:
  node bin/setup-mcp.js [ide] [options]

Available IDEs:
  qoder           Qoder IDE
  cursor          Cursor IDE
  windsurf        Windsurf (Codeium)
  claude-desktop  Claude Desktop
  antigravity     Antigravity

Options:
  --output <path>  Output configuration to a file
  --show           Display configuration without saving
  --help           Show this help message

Examples:
  # Setup for Qoder
  node bin/setup-mcp.js qoder

  # Show configuration without saving
  node bin/setup-mcp.js cursor --show

  # Save to custom location
  node bin/setup-mcp.js windsurf --output ./my-mcp-config.json
`);
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.length === 0) {
    showHelp();
    process.exit(0);
  }
  
  const ide = args[0];
  const showOnly = args.includes('--show');
  const outputPath = args.includes('--output') ? args[args.indexOf('--output') + 1] : null;
  
  if (!IDE_CONFIGS[ide]) {
    console.error(`❌ Unknown IDE: ${ide}`);
    console.log('Available IDEs:', Object.keys(IDE_CONFIGS).join(', '));
    process.exit(1);
  }
  
  console.log(`\n🔧 Setting up MCP Router for ${IDE_CONFIGS[ide].name}...\n`);
  
  // Load environment
  const env = loadEnvFile();
  const providers = getAvailableProviders(env);
  
  if (providers.length === 0) {
    console.warn('⚠️  No API keys configured in .env file');
    console.log('   Please add at least one API key to .env before setting up MCP\n');
  } else {
    console.log(`✅ Found ${providers.length} configured provider(s): ${providers.join(', ')}\n`);
  }
  
  // Generate configuration
  const config = generateConfig(ide, env);
  const configJson = JSON.stringify(config, null, 2);
  
  if (showOnly) {
    console.log('📋 Generated Configuration:\n');
    console.log(configJson);
    console.log('\n✨ To apply this configuration:');
    console.log(`   1. Open ${IDE_CONFIGS[ide].name} settings`);
    console.log('   2. Navigate to MCP settings');
    console.log('   3. Paste this configuration\n');
  } else if (outputPath) {
    const outputDir = dirname(outputPath);
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }
    writeFileSync(outputPath, configJson, 'utf-8');
    console.log(`✅ Configuration saved to: ${outputPath}\n`);
    console.log('Next steps:');
    console.log(`   1. Open ${IDE_CONFIGS[ide].name}`);
    console.log('   2. Import or copy this configuration to MCP settings\n');
  } else {
    // Auto-detect and save to IDE's config location
    const configPaths = getConfigPaths();
    const targetPath = configPaths[ide];
    
    if (!targetPath) {
      console.error('❌ Could not determine config path for your OS');
      console.log('\n📋 Here is your configuration:\n');
      console.log(configJson);
      console.log('\n💡 Save this to your MCP configuration file manually\n');
      process.exit(1);
    }
    
    const targetDir = dirname(targetPath);
    if (!existsSync(targetDir)) {
      console.log(`📁 Creating config directory: ${targetDir}`);
      mkdirSync(targetDir, { recursive: true });
    }
    
    writeFileSync(targetPath, configJson, 'utf-8');
    console.log(`✅ Configuration saved to: ${targetPath}\n`);
    console.log('✨ Next steps:');
    console.log(`   1. Restart ${IDE_CONFIGS[ide].name}`);
    console.log('   2. The MCP server should automatically connect');
    console.log('   3. Look for a link icon or connection indicator\n');
  }
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
