#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = path.join(rootDir, 'scripts/resolve-upstream-e2e-targets.mjs');

function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-targets-'));
  const e2eDir = path.join(dir, 'e2e');
  fs.mkdirSync(path.join(e2eDir, 'packages/plugin-block-iframe'), { recursive: true });
  fs.mkdirSync(path.join(e2eDir, 'packages/example-e2e'), { recursive: true });
  fs.mkdirSync(path.join(e2eDir, 'packages/e2e-shared'), { recursive: true });
  fs.writeFileSync(
    path.join(e2eDir, 'packages/plugin-block-iframe/package.json'),
    JSON.stringify({ scripts: { 'test:e2e': 'playwright test' } }),
  );
  fs.writeFileSync(
    path.join(e2eDir, 'packages/example-e2e/package.json'),
    JSON.stringify({ scripts: { 'test:e2e': 'playwright test' } }),
  );
  fs.writeFileSync(path.join(e2eDir, 'packages/e2e-shared/package.json'), JSON.stringify({}));
  return { dir, e2eDir };
}

function runCase({ sourceRepo, files }) {
  const { dir, e2eDir } = makeFixture();
  const changedFiles = path.join(dir, 'changed-files.txt');
  const output = path.join(dir, 'output.json');
  fs.writeFileSync(changedFiles, `${files.join('\n')}\n`);
  execFileSync('node', [
    scriptPath,
    '--source-repo',
    sourceRepo,
    '--changed-files',
    changedFiles,
    '--e2e-repo-dir',
    e2eDir,
    '--output',
    output,
  ]);
  return JSON.parse(fs.readFileSync(output, 'utf8'));
}

assert.deepEqual(
  runCase({
    sourceRepo: 'nocobase',
    files: ['packages/plugins/@nocobase/plugin-block-iframe/src/server/plugin.ts'],
  }).targetInput,
  'plugin-block-iframe',
);

assert.deepEqual(
  runCase({
    sourceRepo: 'nocobase',
    files: ['packages/core/database/src/index.ts'],
  }).targetInput,
  '*',
);

assert.deepEqual(
  runCase({
    sourceRepo: 'nocobase',
    files: ['docs/docs/en/file-manager/storage/index.md', '.node-version'],
  }).targetInput,
  '',
);

assert.deepEqual(
  runCase({
    sourceRepo: 'pro-plugins',
    files: ['@nocobase/plugin-action-import-pro/src/server/statics/commands/import-xlsx.ts'],
  }).missingTargets,
  ['plugin-action-import-pro'],
);

assert.deepEqual(
  runCase({
    sourceRepo: 'plugin-backups',
    files: ['src/server/plugin.ts'],
  }).missingTargets,
  ['plugin-backups'],
);

console.log('resolve-upstream-e2e-targets tests passed');
