import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { computeHourBudget } from
  '../../supabase/functions/_shared/schedule-prompt-builder';

// `computeHourBudget(dob, weekStart)` returns the weekly cap for an
// employee given their date of birth and the first day of the schedule
// week. Both inputs are YYYY-MM-DD strings; the helper is UTC-anchored
// so the result is identical regardless of host TZ.

describe('computeHourBudget', () => {
  // The schedule week we test against; June 8 2026 is a Monday.
  const weekStart = '2026-06-08';

  it('returns adult cap for an adult DOB (30 years before weekStart)', () => {
    expect(computeHourBudget('1996-06-08', weekStart)).toEqual({
      is_minor: false,
      max_weekly_hours: 40,
    });
  });

  it('returns 16-17yo minor cap (40h) for DOB ~17.5 years before weekStart', () => {
    // Born ~17.5 years ago → age 17 on weekStart.
    expect(computeHourBudget('2008-12-08', weekStart)).toEqual({
      is_minor: true,
      max_weekly_hours: 40,
    });
  });

  it('returns under-16 minor cap (18h) for DOB 14 years before weekStart', () => {
    expect(computeHourBudget('2012-06-08', weekStart)).toEqual({
      is_minor: true,
      max_weekly_hours: 18,
    });
  });

  it('returns adult cap for null DOB', () => {
    expect(computeHourBudget(null, weekStart)).toEqual({
      is_minor: false,
      max_weekly_hours: 40,
    });
  });

  it('returns adult cap for undefined DOB', () => {
    expect(computeHourBudget(undefined, weekStart)).toEqual({
      is_minor: false,
      max_weekly_hours: 40,
    });
  });

  it('returns adult cap for malformed DOB strings', () => {
    expect(computeHourBudget('not-a-date', weekStart)).toEqual({
      is_minor: false,
      max_weekly_hours: 40,
    });
    expect(computeHourBudget('2010-13-40', weekStart)).toEqual({
      is_minor: false,
      max_weekly_hours: 40,
    });
  });

  it('returns adult cap for future DOB (data error)', () => {
    expect(computeHourBudget('2027-06-08', weekStart)).toEqual({
      is_minor: false,
      max_weekly_hours: 40,
    });
  });

  it('throws on invalid weekStart', () => {
    expect(() => computeHourBudget('1996-06-08', 'not-a-date')).toThrow();
  });

  it('treats employee as 15 when their 16th birthday is later in the same week', () => {
    // weekStart = Mon 2026-06-08; birthday is Fri 2026-06-12 → still 15
    // on Monday → under-16 minor cap.
    expect(computeHourBudget('2010-06-12', weekStart)).toEqual({
      is_minor: true,
      max_weekly_hours: 18,
    });
  });

  it('treats employee as 16 when their 16th birthday IS the weekStart Monday (inclusive boundary)', () => {
    // Birthday inclusive: an employee who turns 16 on weekStart is age 16,
    // not 15. They get the 16-17yo minor cap (40h), not the under-16 cap.
    expect(computeHourBudget('2010-06-08', weekStart)).toEqual({
      is_minor: true,
      max_weekly_hours: 40,
    });
  });

  // ── TZ portability ────────────────────────────────────────────────────────
  // A local-time `new Date(year, monthIdx, day)` implementation would flip
  // the age across the date-line on Pacific/Auckland (UTC+12). Both runs
  // must produce identical output because the helper parses YMD as
  // UTC midnight.
  describe('TZ portability', () => {
    const originalTz = process.env.TZ;
    afterEach(() => {
      process.env.TZ = originalTz;
    });

    it('returns the same result in America/Chicago (UTC-6) and Pacific/Auckland (UTC+12)', () => {
      process.env.TZ = 'America/Chicago';
      const chicago = computeHourBudget('2010-06-08', '2026-06-08');

      process.env.TZ = 'Pacific/Auckland';
      const auckland = computeHourBudget('2010-06-08', '2026-06-08');

      // DOB 2010-06-08, weekStart 2026-06-08 → turns 16 on Monday →
      // inclusive boundary → { is_minor: true, max: 40 }.
      expect(chicago).toEqual({ is_minor: true, max_weekly_hours: 40 });
      expect(auckland).toEqual(chicago);
    });
  });
});
