import { describe, it, expect } from 'vitest';
import {
  toBusinessDay,
  toBusinessDayFor,
  safeCutoffHour,
  DEFAULT_BUSINESS_DAY_START_HOUR,
  MAX_BUSINESS_DAY_START_HOUR,
} from '@/lib/businessDay';
import { SQL_PARITY_FIXTURES } from './fixtures/businessDayFixtures';

describe('safeCutoffHour', () => {
  it('passes through legal values including both bounds', () => {
    expect(safeCutoffHour(0)).toBe(0);
    expect(safeCutoffHour(2)).toBe(2);
    expect(safeCutoffHour(11)).toBe(11);
  });

  it('clamps out-of-range values to the legal domain', () => {
    expect(safeCutoffHour(-1)).toBe(0);
    expect(safeCutoffHour(12)).toBe(MAX_BUSINESS_DAY_START_HOUR);
    expect(safeCutoffHour(9999)).toBe(MAX_BUSINESS_DAY_START_HOUR);
  });

  it('coerces null, undefined, and NaN to the default', () => {
    expect(safeCutoffHour(null)).toBe(DEFAULT_BUSINESS_DAY_START_HOUR);
    expect(safeCutoffHour(undefined)).toBe(DEFAULT_BUSINESS_DAY_START_HOUR);
    expect(safeCutoffHour(NaN)).toBe(DEFAULT_BUSINESS_DAY_START_HOUR);
  });

  it('truncates a fractional hour rather than producing a sub-hour cutoff', () => {
    expect(safeCutoffHour(2.7)).toBe(2);
  });
});

describe('toBusinessDay', () => {
  // This is the SQL-parity table. supabase/tests/business_day_cutoff.test.sql
  // asserts the same `expected` values against public.business_day().
  it.each(SQL_PARITY_FIXTURES)('$name', ({ instant, tz, cutoffHour, expected }) => {
    expect(toBusinessDay(instant, tz, cutoffHour)).toBe(expected);
  });

  it('returns a string, never a Date', () => {
    const result = toBusinessDay('2026-07-29T06:00:00+00:00', 'America/Chicago', 2);
    expect(typeof result).toBe('string');
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('accepts a Date as well as an ISO string', () => {
    const iso = '2026-07-29T06:00:00+00:00';
    expect(toBusinessDay(new Date(iso), 'America/Chicago', 2)).toBe(
      toBusinessDay(iso, 'America/Chicago', 2),
    );
  });

  it('falls back to UTC for a null, empty, or invalid zone', () => {
    // 06:00 UTC minus 2h = 04:00 UTC, still Jul 29.
    const inst = '2026-07-29T06:00:00+00:00';
    expect(toBusinessDay(inst, null, 2)).toBe('2026-07-29');
    expect(toBusinessDay(inst, '', 2)).toBe('2026-07-29');
    expect(toBusinessDay(inst, 'Not/AZone', 2)).toBe('2026-07-29');
  });

  it('toBusinessDayFor is the config-object form of the same function', () => {
    const inst = '2026-07-29T06:00:00+00:00';
    expect(toBusinessDayFor(inst, { tz: 'America/Chicago', cutoffHour: 2 })).toBe(
      toBusinessDay(inst, 'America/Chicago', 2),
    );
  });

  it('rejects the subtract-before-convert ordering (design section 4.1)', () => {
    // Guard against a future "simplification". Inside the fall-back repeated
    // hour the two orderings differ by a full calendar day.
    const inst = '2026-11-01T07:30:00+00:00';
    expect(toBusinessDay(inst, 'America/Chicago', 2)).toBe('2026-10-31');

    const wrong = new Date(new Date(inst).getTime() - 2 * 3600_000);
    // Formatting the pre-subtracted instant in the zone yields Nov 1, not Oct 31.
    const wrongDay = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Chicago',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(wrong);
    expect(wrongDay).toBe('2026-11-01');
  });
});
