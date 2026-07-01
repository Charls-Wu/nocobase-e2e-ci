#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = path.join(rootDir, 'scripts/resolve-2013-build-e2e-targets.mjs');

function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-2013-targets-'));
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

function runCase({ branch = 'develop', repository, nocobasePrNumber = '', proPlugin = '', proPrNumber = '', files }) {
  const { dir, e2eDir } = makeFixture();
  const changedFiles = path.join(dir, 'changed-files.txt');
  const output = path.join(dir, 'output.json');
  fs.writeFileSync(changedFiles, `${files.join('\n')}\n`);

  execFileSync('node', [
    scriptPath,
    '--branch',
    branch,
    '--repository',
    repository,
    '--nocobase-pr-number',
    nocobasePrNumber,
    '--pro-plugin',
    proPlugin,
    '--pro-pr-number',
    proPrNumber,
    '--changed-files',
    changedFiles,
    '--e2e-repo-dir',
    e2eDir,
    '--output',
    output,
  ]);

  return JSON.parse(fs.readFileSync(output, 'utf8'));
}

const mainPluginPr = runCase({
  repository: 'nocobase',
  nocobasePrNumber: '8743',
  files: ['packages/plugins/@nocobase/plugin-block-iframe/src/server/plugin.ts'],
});

assert.equal(mainPluginPr.targetInput, 'plugin-block-iframe');
assert.equal(mainPluginPr.e2eRef, 'develop');
assert.equal(mainPluginPr.e2eRefSupported, true);
assert.equal(mainPluginPr.shouldRun, true);

assert.deepEqual(
  runCase({
    repository: 'nocobase',
    files: ['packages/core/database/src/index.ts'],
  }).targetInput,
  '*',
);

assert.deepEqual(
  runCase({
    repository: 'nocobase',
    files: ['docs/docs/en/file-manager/storage/index.md', '.node-version'],
  }).shouldRun,
  false,
);

assert.deepEqual(
  runCase({
    repository: 'pro-plugins',
    proPlugin: 'pro-plugins',
    proPrNumber: '520',
    files: ['@nocobase/plugin-action-import-pro/src/server/statics/commands/import-xlsx.ts'],
  }).missingTargets,
  ['plugin-action-import-pro'],
);

assert.deepEqual(
  runCase({
    repository: 'plugin-backups',
    proPlugin: 'backups',
    proPrNumber: '39',
    files: ['src/server/plugin.ts'],
  }).trigger,
  {
    branch: 'develop',
    repository: 'plugin-backups',
    sourceRepo: 'plugin-backups',
    sourceFullName: 'nocobase/plugin-backups',
    triggerType: 'plugin-repo-pr',
    prNumber: '39',
    proPlugin: 'backups',
  },
);

const unsupportedBranch = runCase({
  branch: 'v1',
  repository: 'nocobase',
  files: ['packages/plugins/@nocobase/plugin-block-iframe/src/server/plugin.ts'],
});

assert.equal(unsupportedBranch.e2eRef, 'v1');
assert.equal(unsupportedBranch.e2eRefSupported, false);
assert.equal(unsupportedBranch.shouldRun, false);
assert.equal(unsupportedBranch.targetInput, '');
assert.equal(unsupportedBranch.skippedReason, 'unsupported-e2e-ref');

console.log('resolve-2013-build-e2e-targets tests passed');
