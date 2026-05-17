import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// CommonJS import — feedback-log.js is plain Node, no TS
import {
  sanitize,
  appendRow,
  queryBySignature,
  _resetLogPathForTests,
} from '../../dev-tools/feedback-log.js';

describe('feedback-log: sanitize', () => {
  it('strips email addresses', () => {
    expect(sanitize('contact monica@rushbowls.com about this')).toBe(
      'contact <redacted-email> about this',
    );
  });

  it('strips UUIDs', () => {
    expect(sanitize('user 4bb07d19-bb65-4661-89c6-bb537b0fa1de failed')).toBe(
      'user <redacted-uuid> failed',
    );
  });

  it('strips bearer tokens and JWT-shaped strings', () => {
    expect(sanitize('Authorization: Bearer abc.def.ghi')).toContain('<redacted-token>');
    expect(sanitize('token eyJhbGciOi.eyJzdWIiOi.signaturepart')).toContain(
      '<redacted-token>',
    );
  });

  it('redacts restaurant_id query/url segments', () => {
    expect(sanitize('restaurant_id=ae87f51e-e2c0-44f4-b6bb-3953d5bbdbff')).toBe(
      'restaurant_id=<redacted>',
    );
  });

  it('truncates output longer than 2000 chars with ellipsis marker', () => {
    const input = 'a'.repeat(5000);
    const out = sanitize(input);
    expect(out.length).toBeLessThanOrEqual(2000 + '… [truncated]'.length);
    expect(out.endsWith('… [truncated]')).toBe(true);
  });

  it('passes through clean text unchanged', () => {
    expect(sanitize('Scroll does not work on /pos-sales')).toBe(
      'Scroll does not work on /pos-sales',
    );
  });
});

describe('feedback-log: appendRow', () => {
  let dir: string;
  let logPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'feedback-log-test-'));
    logPath = join(dir, 'feedback-log.jsonl');
    _resetLogPathForTests(logPath);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    _resetLogPathForTests(null);
  });

  it('creates parent directory if missing', () => {
    const nested = join(dir, 'a', 'b', 'log.jsonl');
    _resetLogPathForTests(nested);
    appendRow({ id: '1', signature: 'x', filed_at: '2026-05-16T00:00:00Z' });
    expect(existsSync(nested)).toBe(true);
  });

  it('appends a JSONL line per call', () => {
    appendRow({ id: '1', signature: 'a', filed_at: '2026-05-16T00:00:00Z' });
    appendRow({ id: '2', signature: 'b', filed_at: '2026-05-16T00:01:00Z' });
    const contents = readFileSync(logPath, 'utf8');
    const lines = contents.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).id).toBe('1');
    expect(JSON.parse(lines[1]).id).toBe('2');
  });

  it('is idempotent on duplicate id (does not append again)', () => {
    appendRow({ id: '1', signature: 'a', filed_at: '2026-05-16T00:00:00Z' });
    appendRow({ id: '1', signature: 'a', filed_at: '2026-05-16T00:00:00Z' });
    const lines = readFileSync(logPath, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
  });

  it('throws on missing id field', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => appendRow({ signature: 'a' } as any)).toThrow(/id/i);
  });
});

describe('feedback-log: queryBySignature', () => {
  let dir: string;
  let logPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'feedback-log-test-'));
    logPath = join(dir, 'log.jsonl');
    _resetLogPathForTests(logPath);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    _resetLogPathForTests(null);
  });

  it('returns empty array when log does not exist', () => {
    expect(queryBySignature('anything')).toEqual([]);
  });

  it('returns rows matching the signature', () => {
    appendRow({ id: '1', signature: 'pos-sales:scroll', filed_at: '2026-05-16T00:00:00Z' });
    appendRow({ id: '2', signature: 'pos-sales:scroll', filed_at: '2026-05-16T01:00:00Z' });
    appendRow({ id: '3', signature: 'dashboard:tz', filed_at: '2026-05-16T02:00:00Z' });
    const rows = queryBySignature('pos-sales:scroll');
    expect(rows).toHaveLength(2);
    expect(rows.map((r: { id: string }) => r.id).sort()).toEqual(['1', '2']);
  });

  it('filters by since (ISO timestamp)', () => {
    appendRow({ id: '1', signature: 's', filed_at: '2026-05-01T00:00:00Z' });
    appendRow({ id: '2', signature: 's', filed_at: '2026-05-15T00:00:00Z' });
    const rows = queryBySignature('s', { since: '2026-05-10T00:00:00Z' });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('2');
  });
});
