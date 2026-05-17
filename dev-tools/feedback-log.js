#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Sanitizer patterns — order matters: restaurant_id and tokens before email/uuid
// so a URL containing both is fully redacted without double-replacing.
const RESTAURANT_ID_PARAM = /restaurant_id=([^&\s"']+)/gi;
const JWT = /\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/g;
const BEARER = /\bBearer\s+[A-Za-z0-9._\-+/=]+\b/gi;
const EMAIL = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const MAX_LEN = 2000;
const TRUNC_SUFFIX = '… [truncated]';

export function sanitize(text) {
  if (typeof text !== 'string') return '';
  let out = text
    .replace(RESTAURANT_ID_PARAM, 'restaurant_id=<redacted>')
    .replace(JWT, '<redacted-token>')
    .replace(BEARER, '<redacted-token>')
    .replace(EMAIL, '<redacted-email>')
    .replace(UUID, '<redacted-uuid>');
  if (out.length > MAX_LEN) {
    const budget = Math.max(0, MAX_LEN - TRUNC_SUFFIX.length);
    out = out.slice(0, budget) + TRUNC_SUFFIX;
  }
  return out;
}

// Test seam — allows unit tests to redirect file I/O without touching env vars.
let _testLogPath = null;

export function _resetLogPathForTests(p) {
  _testLogPath = p;
}

function getLogPath() {
  if (_testLogPath) return _testLogPath;
  if (process.env.NIMBLE_PNL_FEEDBACK_LOG) return process.env.NIMBLE_PNL_FEEDBACK_LOG;
  return path.join(os.homedir(), '.nimble-pnl', 'feedback-log.jsonl');
}

function readAllRows() {
  const p = getLogPath();
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        // Skip malformed lines so one bad row can't block append/query.
        return [];
      }
    });
}

export function appendRow(row) {
  if (!row || typeof row !== 'object') throw new Error('row must be an object');
  if (!row.id || typeof row.id !== 'string') throw new Error('row.id (string) is required');
  const p = getLogPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const existing = readAllRows();
  if (existing.some((r) => r.id === row.id)) return false;
  fs.appendFileSync(p, JSON.stringify(row) + '\n', 'utf8');
  return true;
}

export function queryBySignature(signature, opts = {}) {
  if (typeof signature !== 'string' || signature.length === 0) {
    throw new Error('signature (non-empty string) is required');
  }
  let since = null;
  if (opts.since) {
    since = Date.parse(opts.since);
    if (Number.isNaN(since)) {
      throw new Error('opts.since must be a valid ISO timestamp');
    }
  }
  return readAllRows().filter((row) => {
    if (row.signature !== signature) return false;
    if (since !== null) {
      const t = Date.parse(row.filed_at);
      if (Number.isNaN(t) || t < since) return false;
    }
    return true;
  });
}

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
  });
}

export async function runCli(argv, io = {}) {
  const stdout = io.stdout || ((s) => process.stdout.write(s));
  const [sub, ...rest] = argv;

  try {
    if (sub === 'append') {
      const json = rest[0];
      if (!json) throw new Error('append requires a JSON arg');
      appendRow(JSON.parse(json));
      return 0;
    }
    if (sub === 'query') {
      const sigIdx = rest.indexOf('--signature');
      if (sigIdx === -1 || !rest[sigIdx + 1]) {
        throw new Error('query requires --signature <sig>');
      }
      const opts = {};
      const sinceIdx = rest.indexOf('--since');
      if (sinceIdx !== -1) opts.since = rest[sinceIdx + 1];
      stdout(JSON.stringify(queryBySignature(rest[sigIdx + 1], opts)));
      return 0;
    }
    if (sub === 'sanitize') {
      const text = io.stdin !== undefined ? io.stdin : await readStdin();
      stdout(sanitize(text));
      return 0;
    }
    process.stderr.write(`Unknown subcommand: ${sub}\n`);
    return 1;
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    return 1;
  }
}

// Only run CLI if invoked directly (matches sibling dev-tools/ pattern).
if (import.meta.url === `file://${process.argv[1]}`) {
  runCli(process.argv.slice(2)).then((code) => process.exit(code));
}
