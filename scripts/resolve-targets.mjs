#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

function usage() {
  console.error(`Usage:
  node scripts/resolve-targets.mjs --repo-dir <dir> --targets <targets> --output <file> [--github-output <file>]

Targets:
  *                         Resolve all packages with scripts.test:e2e
  plugin-block-iframe       Resolve packages/plugin-block-iframe
  plugin-a,plugin-b         Resolve multiple package names
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

function readPackageJson(packageDir) {
  const packageJsonPath = path.join(packageDir, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
}

function hasE2EScript(packageDir) {
  const packageJson = readPackageJson(packageDir);
  return Boolean(packageJson?.scripts?.['test:e2e']);
}

function normalizeTargetName(rawTarget) {
  const target = rawTarget.trim();
  if (!target) {
    return '';
  }

  if (target.includes('\\') || target.includes('..')) {
    throw new Error(`Invalid target "${target}": path traversal is not allowed`);
  }

  if (target.startsWith('packages/')) {
    return target.replace(/\/+$/, '');
  }

  if (target.includes('/')) {
    throw new Error(`Invalid target "${target}": use a package name or packages/<name>`);
  }

  return `packages/${target}`;
}

function listAllE2EPackages(repoDir) {
  const packagesDir = path.join(repoDir, 'packages');
  if (!fs.existsSync(packagesDir)) {
    throw new Error(`Missing packages directory: ${packagesDir}`);
  }

  return fs
    .readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `packages/${entry.name}`)
    .filter((packagePath) => hasE2EScript(path.join(repoDir, packagePath)))
    .sort();
}

function resolveNamedTargets(repoDir, targets) {
  return targets.split(',').map(normalizeTargetName).filter(Boolean).map((packagePath) => {
    const absolutePackageDir = path.join(repoDir, packagePath);
    if (!fs.existsSync(path.join(absolutePackageDir, 'package.json'))) {
      throw new Error(`Target package does not exist: ${packagePath}`);
    }
    if (!hasE2EScript(absolutePackageDir)) {
      throw new Error(`Target package has no scripts.test:e2e: ${packagePath}`);
    }
    return packagePath;
  });
}

function unique(items) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    if (!seen.has(item)) {
      seen.add(item);
      result.push(item);
    }
  }
  return result;
}

function toMatrix(resolved) {
  return {
    include: resolved.map((packagePath) => ({
      package_dir: packagePath,
      package_name: path.basename(packagePath),
    })),
  };
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
  const repoDir = path.resolve(args['repo-dir'] || '');
  const targets = args.targets?.trim();
  const outputFile = args.output ? path.resolve(args.output) : '';
  const githubOutputFile = args['github-output'] ? path.resolve(args['github-output']) : '';

  if (!repoDir || !targets || !outputFile) {
    usage();
    process.exit(2);
  }

  if (!fs.existsSync(repoDir)) {
    throw new Error(`E2E repo directory does not exist: ${repoDir}`);
  }

  const resolved = unique(targets === '*' ? listAllE2EPackages(repoDir) : resolveNamedTargets(repoDir, targets));

  if (resolved.length === 0) {
    throw new Error(`No E2E target packages resolved from targets="${targets}"`);
  }

  fs.writeFileSync(outputFile, `${resolved.join('\n')}\n`);
  writeGithubOutput(githubOutputFile, {
    count: String(resolved.length),
    packages: resolved,
    packages_json: JSON.stringify(resolved),
    matrix: JSON.stringify(toMatrix(resolved)),
  });

  console.log(`Resolved ${resolved.length} E2E package(s):`);
  for (const packagePath of resolved) {
    console.log(`- ${packagePath}`);
  }
} catch (error) {
  console.error(`::error::${error.message}`);
  process.exit(1);
}
