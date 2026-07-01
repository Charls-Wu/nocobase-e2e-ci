#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function usage() {
  console.error(`Usage:
  node scripts/resolve-2013-build-e2e-targets.mjs \\
    --branch <branch> \\
    --repository <repository> \\
    --e2e-repo-dir <dir> \\
    [--nocobase-pr-number <number>] \\
    [--pro-plugin <name>] \\
    [--pro-pr-number <number>] \\
    [--changed-files <file>] \\
    [--github-token <token>] \\
    [--output <file>] \\
    [--github-output <file>]

Examples:
  --branch develop --repository nocobase --nocobase-pr-number 8743 --e2e-repo-dir e2e
  --branch main --repository pro-plugins --pro-pr-number 520 --e2e-repo-dir e2e
  --branch next --repository plugin-backups --pro-pr-number 39 --e2e-repo-dir e2e
`);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key.startsWith('--') || value === undefined || value.startsWith('--')) {
      usage();
      process.exit(2);
    }
    args[key.slice(2)] = value;
    i += 1;
  }
  return args;
}

function clean(value) {
  return String(value || '').trim();
}

function normalizeRepoName(repo) {
  return clean(repo).replace(/^nocobase\//, '');
}

function deriveTrigger(args) {
  const branch = clean(args.branch);
  const repository = normalizeRepoName(args.repository);
  const nocobasePrNumber = clean(args['nocobase-pr-number']);
  const proPlugin = clean(args['pro-plugin']);
  const proPrNumber = clean(args['pro-pr-number']);

  if (!branch || !repository) {
    throw new Error('branch and repository are required');
  }

  if (repository === 'nocobase') {
    return {
      branch,
      repository,
      sourceRepo: 'nocobase',
      sourceFullName: 'nocobase/nocobase',
      triggerType: nocobasePrNumber ? 'main-repo-pr' : 'main-repo-branch',
      prNumber: nocobasePrNumber,
      proPlugin,
    };
  }

  return {
    branch,
    repository,
    sourceRepo: repository,
    sourceFullName: `nocobase/${repository}`,
    triggerType: proPrNumber ? 'plugin-repo-pr' : 'plugin-repo-branch',
    prNumber: proPrNumber,
    proPlugin,
  };
}

function githubHeaders(token) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'nocobase-e2e-target-resolver',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

async function githubJson(url, token) {
  const response = await fetch(url, { headers: githubHeaders(token) });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API failed: ${response.status} ${response.statusText} ${url}\n${body}`);
  }
  return response.json();
}

function repoApiPath(fullName) {
  return fullName.split('/').map(encodeURIComponent).join('/');
}

async function listPullRequestFiles(fullName, prNumber, token) {
  const files = [];
  for (let page = 1; ; page += 1) {
    const url = `https://api.github.com/repos/${repoApiPath(fullName)}/pulls/${encodeURIComponent(prNumber)}/files?per_page=100&page=${page}`;
    const batch = await githubJson(url, token);
    files.push(...batch.map((file) => file.filename));
    if (batch.length < 100) {
      return files;
    }
  }
}

async function listLatestCommitFiles(fullName, branch, token) {
  const url = `https://api.github.com/repos/${repoApiPath(fullName)}/commits/${encodeURIComponent(branch)}`;
  const commit = await githubJson(url, token);
  return (commit.files || []).map((file) => file.filename);
}

async function collectChangedFiles(trigger, args, tempDir) {
  const changedFilesPath = clean(args['changed-files']);
  if (changedFilesPath) {
    return path.resolve(changedFilesPath);
  }

  const token = clean(args['github-token']) || clean(process.env.GITHUB_TOKEN);
  const files = trigger.prNumber
    ? await listPullRequestFiles(trigger.sourceFullName, trigger.prNumber, token)
    : await listLatestCommitFiles(trigger.sourceFullName, trigger.branch, token);
  const file = path.join(tempDir, 'changed-files.txt');
  fs.writeFileSync(file, `${files.join('\n')}\n`);
  return file;
}

function writeGithubOutput(file, outputs) {
  if (!file) {
    return;
  }

  const lines = [];
  for (const [key, value] of Object.entries(outputs)) {
    if (Array.isArray(value)) {
      lines.push(`${key}<<EOF`);
      lines.push(...value);
      lines.push('EOF');
    } else {
      lines.push(`${key}=${value}`);
    }
  }
  fs.appendFileSync(file, `${lines.join('\n')}\n`);
}

try {
  const args = parseArgs(process.argv);
  const e2eRepoDir = clean(args['e2e-repo-dir']);
  if (!e2eRepoDir) {
    throw new Error('e2e-repo-dir is required');
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nocobase-e2e-upstream-'));
  const trigger = deriveTrigger(args);
  const changedFiles = await collectChangedFiles(trigger, args, tempDir);
  const resolverScript = path.join(path.dirname(fileURLToPath(import.meta.url)), 'resolve-upstream-e2e-targets.mjs');
  const resolverOutput = path.join(tempDir, 'resolved-targets.json');

  execFileSync(process.execPath, [
    resolverScript,
    '--source-repo',
    trigger.sourceRepo,
    '--changed-files',
    changedFiles,
    '--e2e-repo-dir',
    path.resolve(e2eRepoDir),
    '--output',
    resolverOutput,
  ], { stdio: 'inherit' });

  const resolved = JSON.parse(fs.readFileSync(resolverOutput, 'utf8'));
  const summary = {
    trigger,
    changedFilesSource: clean(args['changed-files']) ? 'provided-file' : 'github-api',
    ...resolved,
  };

  if (args.output) {
    fs.writeFileSync(path.resolve(args.output), `${JSON.stringify(summary, null, 2)}\n`);
  }

  const githubOutputFile = clean(args['github-output']);
  writeGithubOutput(githubOutputFile ? path.resolve(githubOutputFile) : '', {
    mode: summary.mode,
    should_run: String(summary.shouldRun),
    target_input: summary.targetInput,
    source_repo: summary.sourceRepo,
    source_full_name: trigger.sourceFullName,
    trigger_type: trigger.triggerType,
    source_pr_number: trigger.prNumber,
    runnable_targets: summary.runnableTargets,
    missing_targets: summary.missingTargets,
  });

  console.log(`Trigger type: ${trigger.triggerType}`);
  console.log(`Source repo: ${trigger.sourceFullName}`);
  console.log(`Base branch: ${trigger.branch}`);
  if (trigger.prNumber) {
    console.log(`PR number: ${trigger.prNumber}`);
  }
} catch (error) {
  console.error(`::error::${error.message}`);
  process.exit(1);
}
