#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

function usage() {
  console.error(`Usage:
  node scripts/resolve-upstream-e2e-targets.mjs \\
    --source-repo <repo> \\
    --changed-files <file> \\
    [--e2e-repo-dir <dir>] \\
    [--output <file>] \\
    [--github-output <file>]

Examples:
  --source-repo nocobase --changed-files /tmp/files.txt --e2e-repo-dir e2e
  --source-repo pro-plugins --changed-files /tmp/files.txt --e2e-repo-dir e2e
  --source-repo plugin-backups --changed-files /tmp/files.txt --e2e-repo-dir e2e
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

function normalizeRepoName(repo) {
  return repo.trim().replace(/^nocobase\//, '');
}

function readChangedFiles(file) {
  const content = file === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(file, 'utf8');
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function readPackageJson(packageDir) {
  const packageJsonPath = path.join(packageDir, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
}

function listExecutableE2EPackages(repoDir) {
  if (!repoDir) {
    return null;
  }

  const packagesDir = path.join(repoDir, 'packages');
  if (!fs.existsSync(packagesDir)) {
    throw new Error(`Missing E2E packages directory: ${packagesDir}`);
  }

  return new Set(
    fs
      .readdirSync(packagesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => Boolean(readPackageJson(path.join(packagesDir, name))?.scripts?.['test:e2e']))
      .sort(),
  );
}

function isIgnoredFile(file) {
  return (
    file === '.gitignore' ||
    file === '.ignore' ||
    file === '.node-version' ||
    file === 'README.md' ||
    file.startsWith('.github/') ||
    file.startsWith('docs/') ||
    file.endsWith('.md')
  );
}

function addTarget(result, file, target, rule) {
  result.matched.push({ file, target, rule });
  result.targets.add(target);
}

function addAll(result, file, rule) {
  result.matched.push({ file, target: '*', rule });
  result.all = true;
}

function resolveNocobaseFile(result, file) {
  if (isIgnoredFile(file)) {
    result.ignored.push({ file, reason: 'ignored-doc-or-config' });
    return;
  }

  const pluginMatch = file.match(/^packages\/plugins\/@nocobase\/([^/]+)\//);
  if (pluginMatch) {
    addTarget(result, file, pluginMatch[1], 'main-repo-plugin-path');
    return;
  }

  addAll(result, file, 'main-repo-runtime-or-shared-change');
}

function resolveProPluginsFile(result, file) {
  if (isIgnoredFile(file)) {
    result.ignored.push({ file, reason: 'ignored-doc-or-config' });
    return;
  }

  const scopedPluginMatch = file.match(/^@nocobase\/([^/]+)\//);
  if (scopedPluginMatch) {
    addTarget(result, file, scopedPluginMatch[1], 'pro-plugins-scoped-plugin-path');
    return;
  }

  const packageMatch = file.match(/^([^/.][^/]+)\//);
  if (packageMatch) {
    addTarget(result, file, packageMatch[1], 'pro-plugins-package-path');
    return;
  }

  addAll(result, file, 'pro-plugins-root-or-shared-change');
}

function resolveStandalonePluginFile(result, sourceRepo, file) {
  if (isIgnoredFile(file)) {
    result.ignored.push({ file, reason: 'ignored-doc-or-config' });
    return;
  }

  addTarget(result, file, sourceRepo, 'standalone-plugin-repo-change');
}

function filterTargets(rawTargets, executablePackages) {
  if (!executablePackages) {
    return {
      runnableTargets: [...rawTargets],
      missingTargets: [],
    };
  }

  const runnableTargets = [];
  const missingTargets = [];
  for (const target of rawTargets) {
    if (executablePackages.has(target)) {
      runnableTargets.push(target);
    } else {
      missingTargets.push(target);
    }
  }

  return { runnableTargets, missingTargets };
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
  const sourceRepo = normalizeRepoName(args['source-repo'] || '');
  const changedFilesPath = args['changed-files'] || '';
  const e2eRepoDir = args['e2e-repo-dir'] ? path.resolve(args['e2e-repo-dir']) : '';
  const outputFile = args.output ? path.resolve(args.output) : '';
  const githubOutputFile = args['github-output'] ? path.resolve(args['github-output']) : '';

  if (!sourceRepo || !changedFilesPath) {
    usage();
    process.exit(2);
  }

  const changedFiles = readChangedFiles(changedFilesPath);
  const executablePackages = listExecutableE2EPackages(e2eRepoDir);
  const result = {
    sourceRepo,
    changedFiles,
    all: false,
    targets: new Set(),
    matched: [],
    ignored: [],
  };

  for (const file of changedFiles) {
    if (sourceRepo === 'nocobase') {
      resolveNocobaseFile(result, file);
    } else if (sourceRepo === 'pro-plugins') {
      resolveProPluginsFile(result, file);
    } else {
      resolveStandalonePluginFile(result, sourceRepo, file);
    }
  }

  const rawTargets = [...result.targets].sort();
  const { runnableTargets, missingTargets } = filterTargets(rawTargets, executablePackages);
  let mode = 'none';
  let targetInput = '';

  if (result.all) {
    mode = 'all';
    targetInput = '*';
  } else if (runnableTargets.length > 0) {
    mode = 'packages';
    targetInput = runnableTargets.join(',');
  }

  const summary = {
    sourceRepo,
    mode,
    shouldRun: mode !== 'none',
    targetInput,
    runnableTargets,
    missingTargets,
    rawTargets,
    matched: result.matched,
    ignored: result.ignored,
    changedFileCount: changedFiles.length,
    executableE2EPackages: executablePackages ? [...executablePackages] : null,
  };

  if (outputFile) {
    fs.writeFileSync(outputFile, `${JSON.stringify(summary, null, 2)}\n`);
  }

  writeGithubOutput(githubOutputFile, {
    mode,
    should_run: String(summary.shouldRun),
    target_input: targetInput,
    runnable_targets: runnableTargets,
    missing_targets: missingTargets,
  });

  console.log(`Source repo: ${sourceRepo}`);
  console.log(`Changed files: ${changedFiles.length}`);
  console.log(`Mode: ${mode}`);
  console.log(`Target input: ${targetInput || '<none>'}`);
  if (runnableTargets.length) {
    console.log(`Runnable targets: ${runnableTargets.join(', ')}`);
  }
  if (missingTargets.length) {
    console.log(`Missing E2E targets: ${missingTargets.join(', ')}`);
  }
} catch (error) {
  console.error(`::error::${error.message}`);
  process.exit(1);
}
