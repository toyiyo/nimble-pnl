import { describe, it, expect } from 'vitest';
import { zonedNaiveToUtc, safeTz, tzOffsetMs } from '../../supabase/functions/_shared/timezone';

// All assertions compare against explicit UTC ISO strings (via Date.UTC / toISOString)
// so they are TZ-portable and do not depend on the host machine's local timezone.

describe('zonedNaiveToUtc', () => {
  it('converts a naive America/Chicago datetime in CDT (summer, UTC-5)', () => {
    const result = zonedNaiveToUtc('2026-07-19T07:32:16', 'America/Chicago');
    expect(result.toISOString()).toBe('2026-07-19T12:32:16.000Z');
  });

  it('converts a naive America/Chicago datetime in CST (winter, UTC-6)', () => {
    const result = zonedNaiveToUtc('2026-01-15T07:32:16', 'America/Chicago');
    expect(result.toISOString()).toBe('2026-01-15T13:32:16.000Z');
  });

  it('handles the DST spring-forward transition day (2026-03-08) correctly on either side', () => {
    // 2026-03-08 02:00 local -> 03:00 local in America/Chicago (spring forward).
    // Before the transition (still CST, UTC-6):
    const before = zonedNaiveToUtc('2026-03-08T01:30:00', 'America/Chicago');
    expect(before.toISOString()).toBe('2026-03-08T07:30:00.000Z');

    // After the transition (now CDT, UTC-5):
    const after = zonedNaiveToUtc('2026-03-08T10:00:00', 'America/Chicago');
    expect(after.toISOString()).toBe('2026-03-08T15:00:00.000Z');
  });

  it('falls back to America/Chicago for an empty timezone string, no throw', () => {
    expect(() => zonedNaiveToUtc('2026-07-19T07:32:16', '')).not.toThrow();
    const result = zonedNaiveToUtc('2026-07-19T07:32:16', '');
    expect(result.toISOString()).toBe('2026-07-19T12:32:16.000Z');
  });

  it('falls back to America/Chicago for an invalid/bogus timezone string, no throw', () => {
    expect(() => zonedNaiveToUtc('2026-07-19T07:32:16', 'Bogus/Zone')).not.toThrow();
    const result = zonedNaiveToUtc('2026-07-19T07:32:16', 'Bogus/Zone');
    expect(result.toISOString()).toBe('2026-07-19T12:32:16.000Z');
  });

  it('falls back to America/Chicago for a null/undefined timezone, no throw', () => {
    // @ts-expect-error - exercising runtime guard against non-string input
    const result = zonedNaiveToUtc('2026-01-15T07:32:16', null);
    expect(result.toISOString()).toBe('2026-01-15T13:32:16.000Z');
  });

  it('parses a space-separated naive datetime the same as a T-separated one', () => {
    const result = zonedNaiveToUtc('2026-07-19 07:32:16', 'America/Chicago');
    expect(result.toISOString()).toBe('2026-07-19T12:32:16.000Z');
  });

  it('defaults seconds to :00 when omitted', () => {
    const result = zonedNaiveToUtc('2026-07-19T07:32', 'America/Chicago');
    expect(result.toISOString()).toBe('2026-07-19T12:32:00.000Z');
  });

  it('returns an invalid Date for an unparseable naive string, no throw', () => {
    expect(() => zonedNaiveToUtc('not-a-date', 'America/Chicago')).not.toThrow();
    const result = zonedNaiveToUtc('not-a-date', 'America/Chicago');
    expect(Number.isNaN(result.getTime())).toBe(true);
  });
});

describe('safeTz', () => {
  it('passes through a valid IANA timezone', () => {
    expect(safeTz('America/New_York')).toBe('America/New_York');
  });

  it('falls back to America/Chicago for an invalid timezone', () => {
    expect(safeTz('Bogus/Zone')).toBe('America/Chicago');
  });

  it('falls back to America/Chicago for an empty string', () => {
    expect(safeTz('')).toBe('America/Chicago');
  });

  it('falls back to America/Chicago for null/undefined', () => {
    expect(safeTz(null)).toBe('America/Chicago');
    expect(safeTz(undefined)).toBe('America/Chicago');
  });
});

describe('tzOffsetMs', () => {
  it('returns -5h in ms for America/Chicago during CDT', () => {
    const date = new Date(Date.UTC(2026, 6, 19, 12, 0, 0)); // July -> CDT
    expect(tzOffsetMs(date, 'America/Chicago')).toBe(-5 * 60 * 60 * 1000);
  });

  it('returns -6h in ms for America/Chicago during CST', () => {
    const date = new Date(Date.UTC(2026, 0, 15, 12, 0, 0)); // January -> CST
    expect(tzOffsetMs(date, 'America/Chicago')).toBe(-6 * 60 * 60 * 1000);
  });

  it('returns 0 for UTC', () => {
    const date = new Date(Date.UTC(2026, 0, 15, 12, 0, 0));
    expect(tzOffsetMs(date, 'UTC')).toBe(0);
  });
});
