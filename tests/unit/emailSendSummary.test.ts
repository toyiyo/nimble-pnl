import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { summarizeSends } from '../../supabase/functions/_shared/emailSendSummary';

type Employee = { id: string; email: string };

const emp = (id: string): Employee => ({ id, email: `${id}@example.com` });

const ok = (id: string) => ({ recipient: emp(id), ok: true, status: 200, attempts: 1 });
const fail = (id: string, status: number, error?: string) => ({
  recipient: emp(id),
  ok: false,
  status,
  error,
  attempts: 1,
});

describe('summarizeSends', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('tallies successes and failures', () => {
    const summary = summarizeSends([ok('a'), fail('b', 500, 'boom'), ok('c')], 'test');

    expect(summary.sent).toBe(2);
    expect(summary.failed).toBe(1);
  });

  it('counts a 429 as both failed and rate-limited', () => {
    const summary = summarizeSends([fail('a', 429, 'too many'), fail('b', 500, 'boom')], 'test');

    // The whole reason this module exists: "2 failed" and "1 of those was the
    // rate limit" are different operational stories.
    expect(summary.failed).toBe(2);
    expect(summary.rateLimited).toBe(1);
  });

  it('keeps the first failure message and ignores later ones', () => {
    const summary = summarizeSends([fail('a', 500, 'first'), fail('b', 500, 'second')], 'test');

    expect(summary.firstError).toBe('first');
  });

  it('truncates a long error rather than pasting a whole Resend body into the response', () => {
    const summary = summarizeSends([fail('a', 500, 'x'.repeat(500))], 'test');

    expect(summary.firstError).toHaveLength(201);
    expect(summary.firstError?.endsWith('…')).toBe(true);
  });

  it('falls back to the status when a failure carries no message', () => {
    const summary = summarizeSends([fail('a', 502)], 'test');

    expect(summary.firstError).toBe('HTTP 502');
  });

  it('omits firstError entirely when nothing failed', () => {
    const summary = summarizeSends([ok('a')], 'test');

    expect(summary).toEqual({ sent: 1, failed: 0, rateLimited: 0 });
  });

  it('logs the employee id and never the email address', () => {
    summarizeSends([fail('a', 429, 'too many')], 'broadcast');

    const logged = vi.mocked(console.error).mock.calls.flat().join(' ');
    // Function logs are readable well outside the tenant; a bounce is not a
    // reason to spill the roster's addresses into them.
    expect(logged).toContain('a');
    expect(logged).not.toContain('a@example.com');
  });

  it('redacts an email address embedded in the Resend error body itself', () => {
    const summary = summarizeSends(
      [fail('a', 400, 'Invalid `to` field: a@example.com is not a valid email')],
      'broadcast',
    );

    const logged = vi.mocked(console.error).mock.calls.flat().join(' ');
    // Resend can echo the recipient back inside the error text, not just via
    // our own id/email fields — the redaction has to catch that case too.
    expect(logged).not.toContain('a@example.com');
    expect(summary.firstError).not.toContain('a@example.com');
    expect(summary.firstError).toContain('[redacted]');
  });

  it('returns zeros for an empty result set without logging', () => {
    const summary = summarizeSends([], 'test');

    expect(summary).toEqual({ sent: 0, failed: 0, rateLimited: 0 });
    expect(console.error).not.toHaveBeenCalled();
  });
});
