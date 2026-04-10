#!/usr/bin/env node

import { spawn } from 'node:child_process';
import electronBinary from 'electron';

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronBinary, ['electron'], {
  stdio: 'inherit',
  env,
  shell: false,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});

child.on('error', (error) => {
  console.error('Failed to start Electron app:', error);
  process.exit(1);
});
