#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const VALID_EVENT_TYPES = new Set(['test', 'skipped', 'resolver_failed']);

function usage() {
  console.error(`Usage:
  node scripts/resolve-worker-event.mjs --payload <json> [--output <file>] [--github-output <file>]
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

function parsePayload(raw) {
  const text = clean(raw);
  if (!text) {
    return {
      event_type: 'test',
    };
  }

  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('dispatch_payload must be a JSON object');
    }

    const eventType = clean(parsed.event_type || 'test');
    if (!VALID_EVENT_TYPES.has(eventType)) {
      throw new Error(`unsupported event_type: ${eventType || '<empty>'}`);
    }

    return {
      ...parsed,
      event_type: eventType,
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

function writeGithubOutput(file, outputs) {
  if (!file) {
    return;
  }

  const lines = [];
  for (const [key, value] of Object.entries(outputs)) {
    if (String(value).includes('\n')) {
      lines.push(`${key}<<EOF`);
      lines.push(value);
      lines.push('EOF');
    } else {
      lines.push(`${key}=${value}`);
    }
  }
  fs.appendFileSync(file, `${lines.join('\n')}\n`);
}

try {
  const args = parseArgs(process.argv);
  const payload = parsePayload(args.payload || '');
  const eventType = payload.event_type || 'test';
  const notificationOnly = eventType !== 'test';
  const normalizedPayload = JSON.stringify(payload);

  if (args.output) {
    fs.writeFileSync(path.resolve(args.output), `${JSON.stringify(payload, null, 2)}\n`);
  }

  writeGithubOutput(args['github-output'] ? path.resolve(args['github-output']) : '', {
    event_type: eventType,
    notification_only: String(notificationOnly),
    dispatch_payload_json: normalizedPayload,
    count: '0',
    runnable_count: '0',
    missing_count: '0',
    packages_json: '[]',
    missing_targets_json: '[]',
    matrix: '{"include":[]}',
  });

  console.log(`Worker event type: ${eventType}`);
  console.log(`Notification only: ${notificationOnly}`);
} catch (error) {
  console.error(`::error::${error.message}`);
  process.exit(1);
}
