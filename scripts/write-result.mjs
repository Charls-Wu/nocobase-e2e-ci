#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

function env(name, fallback = '') {
  return process.env[name] || fallback;
}

function pickConclusion(outcomes) {
  if (outcomes.run === 'success') {
    return 'success';
  }
  if (Object.values(outcomes).includes('cancelled')) {
    return 'cancelled';
  }
  if (Object.values(outcomes).includes('failure')) {
    return 'failure';
  }
  if (Object.values(outcomes).includes('skipped')) {
    return 'skipped';
  }
  return 'unknown';
}

const outputFile = env('RESULT_FILE');
if (!outputFile) {
  console.error('::error::RESULT_FILE is required');
  process.exit(2);
}

const packageDir = env('PACKAGE_DIR');
const packageName = env('PACKAGE_NAME') || path.basename(packageDir);
const outcomes = {
  checkoutWorker: env('CHECKOUT_WORKER_OUTCOME'),
  checkoutE2E: env('CHECKOUT_E2E_OUTCOME'),
  setupNode: env('SETUP_NODE_OUTCOME'),
  install: env('INSTALL_OUTCOME'),
  run: env('RUN_OUTCOME'),
};

const result = {
  packageDir,
  packageName,
  conclusion: pickConclusion(outcomes),
  outcomes,
  artifacts: {
    playwrightReport: {
      id: env('PLAYWRIGHT_REPORT_ARTIFACT_ID'),
      url: env('PLAYWRIGHT_REPORT_ARTIFACT_URL'),
    },
    testResults: {
      id: env('TEST_RESULTS_ARTIFACT_ID'),
      url: env('TEST_RESULTS_ARTIFACT_URL'),
    },
  },
  targets: env('TARGETS'),
  nocobaseVersion: env('NOCOBASE_DOCKER_VERSION'),
  e2eRepo: env('E2E_REPO'),
  e2eRef: env('E2E_REF'),
  startedAt: env('PACKAGE_STARTED_AT'),
  completedAt: new Date().toISOString(),
  runId: env('GITHUB_RUN_ID'),
  runAttempt: env('GITHUB_RUN_ATTEMPT'),
  runUrl: `${env('GITHUB_SERVER_URL', 'https://github.com')}/${env('GITHUB_REPOSITORY')}/actions/runs/${env('GITHUB_RUN_ID')}`,
};

fs.mkdirSync(path.dirname(outputFile), { recursive: true });
fs.writeFileSync(outputFile, `${JSON.stringify(result, null, 2)}\n`);
console.log(`Wrote E2E result: ${outputFile}`);
console.log(`${packageName}: ${result.conclusion}`);
