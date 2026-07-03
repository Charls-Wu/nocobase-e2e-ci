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

function clean(value) {
  return String(value || '').trim();
}

function truncate(value, maxLength = 1200) {
  const text = clean(value);
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
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

function parseMissingTargets() {
  const raw = env('MISSING_TARGETS_JSON');
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseDispatchPayload() {
  const raw = env('DISPATCH_PAYLOAD');
  if (!raw) {
    return {
      event_type: 'test',
    };
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('dispatch_payload must be a JSON object');
    }
    return {
      ...parsed,
      event_type: clean(parsed.event_type || 'test'),
    };
  } catch (error) {
    return {
      event_type: 'resolver_failed',
      resolver: {
        error: `Invalid dispatch_payload JSON: ${error.message}`,
      },
    };
  }
}

function dispatchId(payload) {
  return clean(payload.dispatch_id || payload.dispatchId || env('DISPATCH_ID'));
}

function caller(payload) {
  const payloadCaller = payload.caller || {};
  return {
    repo: clean(payloadCaller.repo || env('CALLER_REPO')),
    runId: clean(payloadCaller.run_id || payloadCaller.runId || env('CALLER_RUN_ID')),
    sha: clean(payloadCaller.sha || env('CALLER_SHA')),
  };
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
    case 'missing':
      return '[MISSING]';
    default:
      return '[UNKNOWN]';
  }
}

function cardTemplate(conclusion) {
  if (conclusion === 'success') {
    return 'green';
  }
  if (conclusion === 'missing') {
    return 'yellow';
  }
  if (conclusion === 'cancelled') {
    return 'grey';
  }
  return 'red';
}

function title(summary) {
  if (summary.eventType === 'skipped') {
    return 'NocoBase E2E skipped';
  }
  if (summary.eventType === 'resolver_failed') {
    return 'NocoBase E2E resolver failed';
  }
  if (summary.conclusion === 'missing') {
    return 'NocoBase E2E missing targets';
  }
  return `NocoBase E2E ${summary.conclusion}`;
}

function summarize(expectedPackages, resultFiles, missingTargets, payload) {
  const eventType = payload.event_type || 'test';
  if (eventType === 'skipped') {
    return {
      conclusion: 'success',
      eventType,
      rows: [],
      missingTargets: [],
      payload,
    };
  }

  if (eventType === 'resolver_failed') {
    return {
      conclusion: 'failure',
      eventType,
      rows: [],
      missingTargets: [],
      payload,
    };
  }

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
  if (env('RESOLVE_RESULT') !== 'success') {
    conclusion = 'failure';
  } else if (rows.length === 0) {
    conclusion = missingTargets.length > 0
      ? 'missing'
      : env('TEST_RESULT') === 'success' ? 'success' : 'failure';
  } else if (rows.some((row) => row.conclusion === 'failure' || row.conclusion === 'unknown')) {
    conclusion = 'failure';
  } else if (rows.some((row) => row.conclusion === 'cancelled')) {
    conclusion = 'cancelled';
  } else if (rows.some((row) => row.conclusion !== 'success')) {
    conclusion = 'failure';
  } else if (missingTargets.length > 0) {
    conclusion = 'missing';
  }

  return { conclusion, eventType, rows, missingTargets, payload };
}

function markdownSummary(summary) {
  const runUrl = env('RUN_URL');
  const source = caller(summary.payload);
  const callerRepo = source.repo;
  const callerRunId = source.runId;
  const callerRunUrl = callerRepo && callerRunId ? `https://github.com/${callerRepo}/actions/runs/${callerRunId}` : '';
  const resolver = summary.payload.resolver || {};
  const lines = [
    `# ${title(summary)}`,
    '',
    `- targets: ${env('TARGETS')}`,
    `- image version: ${env('NOCOBASE_DOCKER_VERSION')}`,
    `- E2E ref: ${env('E2E_REPO')}@${env('E2E_REF')}`,
    `- run: ${runUrl}`,
    dispatchId(summary.payload) ? `- dispatch id: ${dispatchId(summary.payload)}` : '',
    callerRunUrl ? `- caller: [${callerRepo}#${callerRunId}](${callerRunUrl})` : '',
    source.sha ? `- caller sha: ${source.sha}` : '',
  ].filter((line) => line !== '');

  if (summary.eventType === 'skipped') {
    lines.push('');
    lines.push('## Skipped');
    lines.push('');
    lines.push('此次构建无需触发端到端测试。');
    lines.push('');
    lines.push('原因：');
    lines.push(resolver.reason_text || '所有 changed files 都命中 ignored-doc-or-config 规则。');
    lines.push('');
    lines.push('规则范围：');
    lines.push(resolver.rule_scope || 'docs/**、.github/**、*.md、README.md、.node-version 等文档或配置文件变更不触发 E2E。');
  }

  if (summary.eventType === 'resolver_failed') {
    lines.push('');
    lines.push('## Resolver Failed');
    lines.push('');
    lines.push('上游 targets 解析失败，无法判断本次构建应该触发哪些 E2E 包。');
    lines.push('');
    lines.push('错误摘要：');
    lines.push('');
    lines.push('```text');
    lines.push(truncate(resolver.error || resolver.log || 'Unknown resolver error.'));
    lines.push('```');
    lines.push('');
    lines.push('排查入口：请查看来源 workflow 的 dispatch-e2e / Resolve E2E targets 日志。');
  }

  if (summary.missingTargets.length > 0) {
    lines.push('');
    lines.push('## Missing E2E targets');
    lines.push('');
    lines.push('| Target | Reason |');
    lines.push('| --- | --- |');
    for (const item of summary.missingTargets) {
      lines.push(`| ${item.packageName || item.packageDir} | ${item.message || item.reason || 'missing'} |`);
    }
  }

  if (summary.rows.length > 0) {
    lines.push('');
    lines.push('## Package results');
    lines.push('');
    lines.push('| Package | Result | Report | Test results |');
    lines.push('| --- | --- | --- | --- |');
    for (const row of summary.rows) {
      const reportUrl = row.artifacts?.playwrightReport?.url;
      const testResultsUrl = row.artifacts?.testResults?.url;
      lines.push(
        `| ${row.packageName || row.packageDir} | ${icon(row.conclusion)} ${row.conclusion} | ${reportUrl ? `[download](${reportUrl})` : '-'} | ${testResultsUrl ? `[download](${testResultsUrl})` : '-'} |`,
      );
    }
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
  const cardTitle = title(summary);
  const source = caller(summary.payload);
  const callerRepo = source.repo;
  const callerRunId = source.runId;
  const callerRunUrl = callerRepo && callerRunId ? `https://github.com/${callerRepo}/actions/runs/${callerRunId}` : '';
  const resolver = summary.payload.resolver || {};
  const resultLines = summary.rows.map((row) => {
    const reportUrl = row.artifacts?.playwrightReport?.url;
    const testResultsUrl = row.artifacts?.testResults?.url;
    const links = [
      reportUrl ? `[HTML报告](${reportUrl})` : '',
      testResultsUrl ? `[测试附件](${testResultsUrl})` : '',
    ].filter(Boolean);
    return `${icon(row.conclusion)} ${row.packageName || row.packageDir}: ${row.conclusion}${links.length ? ` ${links.join(' ')}` : ''}`;
  });
  const missingLines = summary.missingTargets.map((item) => (
    `${icon('missing')} ${item.packageName || item.packageDir}: ${item.message || item.reason || 'missing'}`
  ));
  const eventLines = [];
  if (summary.eventType === 'skipped') {
    eventLines.push('**结果**: 此次构建无需触发端到端测试。');
    eventLines.push(`**原因**: ${resolver.reason_text || '所有 changed files 都命中 ignored-doc-or-config 规则。'}`);
    eventLines.push(`**规则范围**: ${resolver.rule_scope || 'docs/**、.github/**、*.md、README.md、.node-version 等文档或配置文件变更不触发 E2E。'}`);
  }
  if (summary.eventType === 'resolver_failed') {
    eventLines.push('**错误类型**: 上游 targets 解析失败，无法判断本次构建应该触发哪些 E2E 包。');
    eventLines.push(`**错误摘要**: ${truncate(resolver.error || resolver.log || 'Unknown resolver error.', 900)}`);
    eventLines.push('**排查入口**: 请查看来源 workflow 的 dispatch-e2e / Resolve E2E targets 日志。');
  }
  const content = [
    `**镜像版本**: ${env('NOCOBASE_DOCKER_VERSION')}`,
    `**E2E 分支**: ${env('E2E_REPO')}@${env('E2E_REF')}`,
    `**触发目标**: ${env('TARGETS')}`,
    dispatchId(summary.payload) ? `**Dispatch ID**: ${dispatchId(summary.payload)}` : '',
    callerRunUrl ? `**来源 workflow**: [${callerRepo}#${callerRunId}](${callerRunUrl})` : '',
    source.sha ? `**来源 SHA**: ${source.sha}` : '',
    '',
    eventLines.length ? eventLines.join('\n') : '',
    missingLines.length ? `**缺失测试包**\n${missingLines.join('\n')}` : '',
    resultLines.length ? `**测试结果**\n${resultLines.join('\n')}` : '',
    !eventLines.length && !missingLines.length && !resultLines.length ? 'No package result files were found.' : '',
  ].filter((line) => line !== '').join('\n');

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
          content: cardTitle,
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
  const missingTargets = parseMissingTargets();
  const dispatchPayload = parseDispatchPayload();
  const resultFiles = readJsonFiles(resultsDir);
  const summary = summarize(expectedPackages, resultFiles, missingTargets, dispatchPayload);
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
