import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// CommonJS import — feedback-log.js is plain Node, no TS
import {
  sanitize,
  appendRow,
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
