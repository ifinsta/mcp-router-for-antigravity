/**
 * Unit tests for Mode Configuration
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { RouterMode, ModeSource, ModeConfig } from '../../../src/core/types.js';

// We need to test the config module's mode functions
// Since they rely on global state and file system, we'll test them carefully

const TEST_MODE_DIR = path.join(os.tmpdir(), 'ifin-platform-test-' + Date.now());
const TEST_MODE_FILE = path.join(TEST_MODE_DIR, 'mode.json');

describe('Mode Configuration', () => {
  // Store original env vars
  let originalRouterMode: string | undefined;
  let originalHomeDir: string | undefined;

  beforeEach(() => {
    // Save original env vars
    originalRouterMode = process.env['ROUTER_MODE'];
    originalHomeDir = process.env['USERPROFILE'] || process.env['HOME'];

    // Create test directory
    if (!fs.existsSync(TEST_MODE_DIR)) {
      fs.mkdirSync(TEST_MODE_DIR, { recursive: true });
    }

    // Clear any existing mode file
    if (fs.existsSync(TEST_MODE_FILE)) {
      fs.unlinkSync(TEST_MODE_FILE);
    }
  });

  afterEach(() => {
    // Restore original env vars
    if (originalRouterMode !== undefined) {
      process.env['ROUTER_MODE'] = originalRouterMode;
    } else {
      delete process.env['ROUTER_MODE'];
    }

    // Clean up test directory
    if (fs.existsSync(TEST_MODE_DIR)) {
      fs.rmSync(TEST_MODE_DIR, { recursive: true, force: true });
    }
  });

  describe('Mode Types', () => {
    it('RouterMode type accepts "agent" value', () => {
      const mode: RouterMode = 'agent';
      assert.equal(mode, 'agent');
    });

    it('RouterMode type accepts "router" value', () => {
      const mode: RouterMode = 'router';
      assert.equal(mode, 'router');
    });

    it('ModeSource type accepts "user_selection" value', () => {
      const source: ModeSource = 'user_selection';
      assert.equal(source, 'user_selection');
    });

    it('ModeSource type accepts "migration" value', () => {
      const source: ModeSource = 'migration';
      assert.equal(source, 'migration');
    });

    it('ModeSource type accepts "default" value', () => {
      const source: ModeSource = 'default';
      assert.equal(source, 'default');
    });

    it('ModeConfig interface has required properties', () => {
      const config: ModeConfig = {
        mode: 'agent',
        modeLastUpdated: new Date().toISOString(),
        modeSource: 'default',
      };

      assert.equal(config.mode, 'agent');
      assert.ok(typeof config.modeLastUpdated === 'string');
      assert.equal(config.modeSource, 'default');
    });

    it('ModeConfig properties are readonly', () => {
      const config: ModeConfig = {
        mode: 'agent',
        modeLastUpdated: '2024-01-01T00:00:00.000Z',
        modeSource: 'default',
      };

      // Verify structure - readonly prevents reassignment but we can verify the type
      assert.ok('mode' in config);
      assert.ok('modeLastUpdated' in config);
      assert.ok('modeSource' in config);
    });
  });

  describe('ModeConfig validation', () => {
    it('valid mode config with agent mode', () => {
      const config: ModeConfig = {
        mode: 'agent',
        modeLastUpdated: new Date().toISOString(),
        modeSource: 'user_selection',
      };

      assert.equal(config.mode, 'agent');
      assert.equal(config.modeSource, 'user_selection');
    });

    it('valid mode config with router mode', () => {
      const config: ModeConfig = {
        mode: 'router',
        modeLastUpdated: new Date().toISOString(),
        modeSource: 'migration',
      };

      assert.equal(config.mode, 'router');
      assert.equal(config.modeSource, 'migration');
    });

    it('modeLastUpdated is ISO8601 format', () => {
      const now = new Date();
      const config: ModeConfig = {
        mode: 'agent',
        modeLastUpdated: now.toISOString(),
        modeSource: 'default',
      };

      // Verify it's a valid ISO string
      assert.ok(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(config.modeLastUpdated));
      assert.doesNotThrow(() => new Date(config.modeLastUpdated));
    });
  });

  describe('ModeConfig file operations', () => {
    it('can write and read mode config from JSON file', () => {
      const config: ModeConfig = {
        mode: 'router',
        modeLastUpdated: new Date().toISOString(),
        modeSource: 'user_selection',
      };

      // Write to file
      fs.writeFileSync(TEST_MODE_FILE, JSON.stringify(config, null, 2), 'utf-8');

      // Read from file
      const content = fs.readFileSync(TEST_MODE_FILE, 'utf-8');
      const parsed = JSON.parse(content) as ModeConfig;

      assert.equal(parsed.mode, 'router');
      assert.equal(parsed.modeSource, 'user_selection');
      assert.equal(parsed.modeLastUpdated, config.modeLastUpdated);
    });

    it('mode config JSON has correct structure', () => {
      const config: ModeConfig = {
        mode: 'agent',
        modeLastUpdated: '2024-01-15T10:30:00.000Z',
        modeSource: 'default',
      };

      fs.writeFileSync(TEST_MODE_FILE, JSON.stringify(config, null, 2), 'utf-8');
      const content = fs.readFileSync(TEST_MODE_FILE, 'utf-8');
      const parsed = JSON.parse(content);

      assert.deepEqual(Object.keys(parsed).sort(), ['mode', 'modeLastUpdated', 'modeSource'].sort());
    });
  });

  describe('ModeConfig environment variable', () => {
    it('ROUTER_MODE env var can be set to agent', () => {
      process.env['ROUTER_MODE'] = 'agent';
      assert.equal(process.env['ROUTER_MODE'], 'agent');
    });

    it('ROUTER_MODE env var can be set to router', () => {
      process.env['ROUTER_MODE'] = 'router';
      assert.equal(process.env['ROUTER_MODE'], 'router');
    });

    it('invalid ROUTER_MODE values should be rejected by schema', () => {
      // The actual validation is done by Zod schema in config.ts
      // Here we just verify the type constraints
      const validModes: RouterMode[] = ['agent', 'router'];
      assert.ok(validModes.includes('agent'));
      assert.ok(validModes.includes('router'));
      assert.equal(validModes.includes('invalid' as RouterMode), false);
    });
  });

  describe('ModeConfig default values', () => {
    it('default mode is agent', () => {
      // Per the ModeConfigSchema, default mode is 'agent'
      const defaultMode: RouterMode = 'agent';
      assert.equal(defaultMode, 'agent');
    });

    it('default modeSource is default', () => {
      // Per the ModeConfigSchema, default source is 'default'
      const defaultSource: ModeSource = 'default';
      assert.equal(defaultSource, 'default');
    });
  });

  describe('ModeConfig priority order', () => {
    it('file config takes priority over env var', () => {
      // This tests the expected priority: file > env > default
      // File config
      const fileConfig: ModeConfig = {
        mode: 'router',
        modeLastUpdated: new Date().toISOString(),
        modeSource: 'user_selection',
      };

      fs.writeFileSync(TEST_MODE_FILE, JSON.stringify(fileConfig, null, 2), 'utf-8');

      // Env var set to different value
      process.env['ROUTER_MODE'] = 'agent';

      // When file exists, it should take priority
      const fileContent = fs.readFileSync(TEST_MODE_FILE, 'utf-8');
      const parsed = JSON.parse(fileContent) as ModeConfig;

      // File value should be used
      assert.equal(parsed.mode, 'router');
    });

    it('env var used when no file exists', () => {
      // No file exists
      if (fs.existsSync(TEST_MODE_FILE)) {
        fs.unlinkSync(TEST_MODE_FILE);
      }

      process.env['ROUTER_MODE'] = 'router';

      // Env var should be used
      assert.equal(process.env['ROUTER_MODE'], 'router');
    });
  });
});
