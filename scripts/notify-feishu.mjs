#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key.startsWith('--') || value === undefined || value.startsWith('--')) {
      throw new Error('Usage: node scripts/notify-feishu.mjs --results-dir <dir> [--summary-file <file>]');
    }
    args[key.slice(2)] = value;
    i += 1;
  }
  return args;
}

function env(name, fallback = '') {
  return process.env[name] || fallback;
}

function readJsonFiles(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...readJsonFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      results.push(JSON.parse(fs.readFileSync(fullPath, 'utf8')));
    }
  }
  return results;
}

function parseExpectedPackages() {
  const raw = env('TARGET_MATRIX');
  if (!raw) {
    return [];
  }
  try {
    const matrix = JSON.parse(raw);
    return Array.isArray(matrix.include) ? matrix.include : [];
  } catch {
    return [];
  }
}

function icon(conclusion) {
  switch (conclusion) {
    case 'success':
      return '[OK]';
    case 'failure':
      return '[FAIL]';
    case 'cancelled':
      return '[CANCELLED]';
    case 'skipped':
      return '[SKIPPED]';
    default:
      return '[UNKNOWN]';
  }
}

function cardTemplate(conclusion) {
  if (conclusion === 'success') {
    return 'green';
  }
  if (conclusion === 'cancelled') {
    return 'grey';
  }
  return 'red';
}

function summarize(expectedPackages, resultFiles) {
  const byPackage = new Map();
  for (const result of resultFiles) {
    byPackage.set(result.packageDir, result);
  }

  const rows = [];
  for (const item of expectedPackages) {
    const result = byPackage.get(item.package_dir);
    rows.push(result || {
      packageDir: item.package_dir,
      packageName: item.package_name || path.basename(item.package_dir),
      conclusion: 'unknown',
      completedAt: '',
      runUrl: env('RUN_URL'),
    });
  }

  for (const result of resultFiles) {
    if (!rows.some((row) => row.packageDir === result.packageDir)) {
      rows.push(result);
    }
  }

  let conclusion = 'success';
  if (rows.length === 0) {
    conclusion = env('TEST_RESULT') === 'success' ? 'success' : 'failure';
  } else if (rows.some((row) => row.conclusion === 'failure' || row.conclusion === 'unknown')) {
    conclusion = 'failure';
  } else if (rows.some((row) => row.conclusion === 'cancelled')) {
    conclusion = 'cancelled';
  } else if (rows.some((row) => row.conclusion !== 'success')) {
    conclusion = 'failure';
  }

  return { conclusion, rows };
}

function markdownSummary(summary) {
  const runUrl = env('RUN_URL');
  const lines = [
    `# NocoBase E2E ${summary.conclusion}`,
    '',
    `- targets: ${env('TARGETS')}`,
    `- image version: ${env('NOCOBASE_DOCKER_VERSION')}`,
    `- E2E ref: ${env('E2E_REPO')}@${env('E2E_REF')}`,
    `- run: ${runUrl}`,
    '',
    '| Package | Result | Report | Test results |',
    '| --- | --- | --- | --- |',
  ];

  for (const row of summary.rows) {
    const reportUrl = row.artifacts?.playwrightReport?.url;
    const testResultsUrl = row.artifacts?.testResults?.url;
    lines.push(
      `| ${row.packageName || row.packageDir} | ${icon(row.conclusion)} ${row.conclusion} | ${reportUrl ? `[download](${reportUrl})` : '-'} | ${testResultsUrl ? `[download](${testResultsUrl})` : '-'} |`,
    );
  }

  lines.push('');
  return `${lines.join('\n')}\n`;
}

function feishuSign(secret, timestamp) {
  const stringToSign = `${timestamp}\n${secret}`;
  return crypto.createHmac('sha256', stringToSign).update('').digest('base64');
}

function buildFeishuPayload(summary) {
  const runUrl = env('RUN_URL');
  const title = `NocoBase E2E ${summary.conclusion}`;
  const resultLines = summary.rows.map((row) => {
    const reportUrl = row.artifacts?.playwrightReport?.url;
    const testResultsUrl = row.artifacts?.testResults?.url;
    const links = [
      reportUrl ? `[HTML报告](${reportUrl})` : '',
      testResultsUrl ? `[测试附件](${testResultsUrl})` : '',
    ].filter(Boolean);
    return `${icon(row.conclusion)} ${row.packageName || row.packageDir}: ${row.conclusion}${links.length ? ` ${links.join(' ')}` : ''}`;
  });
  const content = [
    `**镜像版本**: ${env('NOCOBASE_DOCKER_VERSION')}`,
    `**E2E 分支**: ${env('E2E_REPO')}@${env('E2E_REF')}`,
    `**触发目标**: ${env('TARGETS')}`,
    '',
    resultLines.join('\n') || 'No package result files were found.',
  ].join('\n');

  const payload = {
    msg_type: 'interactive',
    card: {
      config: {
        wide_screen_mode: true,
      },
      header: {
        template: cardTemplate(summary.conclusion),
        title: {
          tag: 'plain_text',
          content: title,
        },
      },
      elements: [
        {
          tag: 'div',
          text: {
            tag: 'lark_md',
            content,
          },
        },
        {
          tag: 'action',
          actions: [
            {
              tag: 'button',
              text: {
                tag: 'plain_text',
                content: '查看 GitHub Actions',
              },
              url: runUrl,
              type: 'primary',
            },
          ],
        },
      ],
    },
  };

  const secret = env('FEISHU_SECRET');
  if (secret) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    payload.timestamp = timestamp;
    payload.sign = feishuSign(secret, timestamp);
  }

  return payload;
}

async function sendFeishu(summary) {
  const webhook = env('FEISHU_WEBHOOK_URL');
  if (!webhook) {
    console.log('FEISHU_WEBHOOK_URL is not configured. Skip Feishu notification.');
    return;
  }

  const response = await fetch(webhook, {
    method: 'POST',
    headers: {
      'content-type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(buildFeishuPayload(summary)),
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Feishu webhook failed with HTTP ${response.status}: ${body}`);
  }

  console.log(`Feishu webhook response: ${body}`);
}

try {
  const args = parseArgs(process.argv);
  const resultsDir = path.resolve(args['results-dir'] || '');
  if (!resultsDir) {
    throw new Error('--results-dir is required');
  }

  const expectedPackages = parseExpectedPackages();
  const resultFiles = readJsonFiles(resultsDir);
  const summary = summarize(expectedPackages, resultFiles);
  const markdown = markdownSummary(summary);

  console.log(markdown);
  if (args['summary-file']) {
    fs.appendFileSync(args['summary-file'], markdown);
  }

  await sendFeishu(summary);
} catch (error) {
  console.error(`::error::${error.message}`);
  process.exit(1);
}
