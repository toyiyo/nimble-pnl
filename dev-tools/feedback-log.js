'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const EMAIL = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const JWT = /\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/g;
const BEARER = /Bearer\s+[A-Za-z0-9._\-+/=]+/g;
const RESTAURANT_ID_PARAM = /restaurant_id=([^&\s"']+)/gi;
const MAX_LEN = 2000;

function sanitize(text) {
  if (typeof text !== 'string') return '';
  let out = text;
  out = out.replace(RESTAURANT_ID_PARAM, 'restaurant_id=<redacted>');
  out = out.replace(JWT, '<redacted-token>');
  out = out.replace(BEARER, '<redacted-token>');
  out = out.replace(EMAIL, '<redacted-email>');
  out = out.replace(UUID, '<redacted-uuid>');
  if (out.length > MAX_LEN) out = out.slice(0, MAX_LEN) + '… [truncated]';
  return out;
}

let _testLogPath = null;

function _resetLogPathForTests(p) {
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
  const text = fs.readFileSync(p, 'utf8');
  return text
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

function appendRow(row) {
  if (!row || typeof row !== 'object') throw new Error('row must be an object');
  if (!row.id || typeof row.id !== 'string') throw new Error('row.id (string) is required');
  const p = getLogPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const existing = readAllRows();
  if (existing.some((r) => r.id === row.id)) return false;
  fs.appendFileSync(p, JSON.stringify(row) + '\n', 'utf8');
  return true;
}

function queryBySignature(signature, opts = {}) {
  if (typeof signature !== 'string' || signature.length === 0) {
    throw new Error('signature (non-empty string) is required');
  }
  const since = opts.since ? Date.parse(opts.since) : null;
  return readAllRows().filter((row) => {
    if (row.signature !== signature) return false;
    if (since !== null) {
      const t = Date.parse(row.filed_at);
      if (Number.isNaN(t) || t < since) return false;
    }
    return true;
  });
}

async function runCli(argv, io = {}) {
  const stdout = io.stdout || ((s) => process.stdout.write(s));
  const stdin = io.stdin;
  const [sub, ...rest] = argv;

  try {
    if (sub === 'append') {
      const json = rest[0];
      if (!json) throw new Error('append requires a JSON arg');
      const row = JSON.parse(json);
      appendRow(row);
      return 0;
    }
    if (sub === 'query') {
      const sigIdx = rest.indexOf('--signature');
      if (sigIdx === -1 || !rest[sigIdx + 1]) {
        throw new Error('query requires --signature <sig>');
      }
      const sinceIdx = rest.indexOf('--since');
      const opts = {};
      if (sinceIdx !== -1) opts.since = rest[sinceIdx + 1];
      const rows = queryBySignature(rest[sigIdx + 1], opts);
      stdout(JSON.stringify(rows));
      return 0;
    }
    if (sub === 'sanitize') {
      const text = stdin !== undefined ? stdin : await readStdin();
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

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
  });
}

if (require.main === module) {
  runCli(process.argv.slice(2)).then((code) => process.exit(code));
}

module.exports = {
  sanitize,
  appendRow,
  queryBySignature,
  runCli,
  _resetLogPathForTests,
};
