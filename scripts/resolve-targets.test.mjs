#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = path.join(rootDir, 'scripts/resolve-targets.mjs');

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value)}\n`);
}

function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-worker-targets-'));
  const repoDir = path.join(dir, 'e2e');

  writeJson(path.join(repoDir, 'packages/plugin-block-iframe/package.json'), {
    scripts: { 'test:e2e': 'playwright test' },
  });
  writeJson(path.join(repoDir, 'packages/plugin-ai/plugin-ai-execution/package.json'), {
    scripts: { 'test:e2e': 'playwright test' },
  });
  writeJson(path.join(repoDir, 'packages/plugin-ai/plugin-ai-chat/package.json'), {
    scripts: { 'test:e2e': 'playwright test' },
  });
  writeJson(path.join(repoDir, 'packages/e2e-shared/package.json'), {
    scripts: {},
  });

  return { dir, repoDir };
}

function runCase(targets) {
  const { dir, repoDir } = makeFixture();
  const output = path.join(dir, 'output.txt');
  const githubOutput = path.join(dir, 'github-output.txt');

  execFileSync('node', [
    scriptPath,
    '--repo-dir',
    repoDir,
    '--targets',
    targets,
    '--output',
    output,
    '--github-output',
    githubOutput,
  ]);

  const rawGithubOutput = fs.readFileSync(githubOutput, 'utf8');
  const matrixMatch = rawGithubOutput.match(/^matrix=(.+)$/m);
  assert.ok(matrixMatch, 'matrix output is required');

  return {
    output: fs.readFileSync(output, 'utf8'),
    matrix: JSON.parse(matrixMatch[1]),
  };
}

assert.deepEqual(
  runCase('*').matrix.include.map((item) => item.package_dir),
  [
    'packages/plugin-ai/plugin-ai-chat',
    'packages/plugin-ai/plugin-ai-execution',
    'packages/plugin-block-iframe',
  ],
);

assert.deepEqual(
  runCase('plugin-ai').matrix.include.map((item) => item.package_dir),
  [
    'packages/plugin-ai/plugin-ai-chat',
    'packages/plugin-ai/plugin-ai-execution',
  ],
);

assert.deepEqual(
  runCase('packages/plugin-ai/plugin-ai-execution').matrix.include,
  [{
    package_dir: 'packages/plugin-ai/plugin-ai-execution',
    package_name: 'plugin-ai/plugin-ai-execution',
    package_key: 'plugin-ai__plugin-ai-execution',
  }],
);

assert.match(runCase('missing-package').output, /# missing\npackages\/missing-package not_found/);

console.log('resolve-targets tests passed');
