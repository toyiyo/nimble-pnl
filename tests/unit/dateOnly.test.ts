import { describe, expect, it } from 'vitest';
import { format } from 'date-fns';
import { parseDateOnly, toDateOnlyString, formatDateOnly } from '@/lib/dateOnly';

// All assertions here use TZ-independent properties (wall-clock fields read in
// the runner's local TZ; helper anchors to local midnight by construction).
// CI runs in UTC; developers may run in any TZ. The Tristen Liu regression
// asserts that parseDateOnly("2026-05-29") yields a Date whose getDate()
// returns 29 in any TZ — proving the helper sidesteps the UTC-midnight trap.

describe('parseDateOnly', () => {
  it('parses "2026-05-29" as local midnight (May 29 in any TZ)', () => {
    const d = parseDateOnly('2026-05-29');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(4); // May (0-indexed)
    expect(d.getDate()).toBe(29);
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
    expect(d.getSeconds()).toBe(0);
    expect(d.getMilliseconds()).toBe(0);
  });

  it('parses leap-day "2024-02-29" correctly', () => {
    const d = parseDateOnly('2024-02-29');
    expect(d.getFullYear()).toBe(2024);
    expect(d.getMonth()).toBe(1);
    expect(d.getDate()).toBe(29);
  });

  it('parses month-end "2026-12-31" correctly', () => {
    const d = parseDateOnly('2026-12-31');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(11);
    expect(d.getDate()).toBe(31);
  });

  it('rejects malformed input', () => {
    expect(() => parseDateOnly('2026/05/29')).toThrow(/invalid/i);
    expect(() => parseDateOnly('2026-5-9')).toThrow(/invalid/i);
    expect(() => parseDateOnly('2026-05-29T00:00:00')).toThrow(/invalid/i);
    expect(() => parseDateOnly('not a date')).toThrow(/invalid/i);
    expect(() => parseDateOnly('')).toThrow(/invalid/i);
  });

  it('rejects out-of-range month/day', () => {
    expect(() => parseDateOnly('2026-13-01')).toThrow(/invalid/i);
    expect(() => parseDateOnly('2026-02-30')).toThrow(/invalid/i);
    expect(() => parseDateOnly('2026-04-31')).toThrow(/invalid/i);
  });
});

describe('toDateOnlyString', () => {
  it('serializes a local-midnight Date to YYYY-MM-DD', () => {
    const d = new Date(2026, 4, 29); // May 29 LOCAL midnight
    expect(toDateOnlyString(d)).toBe('2026-05-29');
  });

  it('zero-pads month and day', () => {
    const d = new Date(2026, 0, 5); // Jan 5 LOCAL
    expect(toDateOnlyString(d)).toBe('2026-01-05');
  });

  it('uses LOCAL fields (not UTC), preserving the calendar-day click', () => {
    // Date constructed via numeric ctor uses local TZ — this is what
    // react-day-picker hands back from the calendar widget.
    const d = new Date(2026, 11, 31, 23, 59, 59); // Dec 31 LOCAL, late evening
    expect(toDateOnlyString(d)).toBe('2026-12-31');
  });
});

describe('round-trip', () => {
  it('parseDateOnly -> toDateOnlyString is identity', () => {
    for (const s of ['2026-01-01', '2026-05-29', '2026-12-31', '2024-02-29']) {
      expect(toDateOnlyString(parseDateOnly(s))).toBe(s);
    }
  });
});

describe('formatDateOnly', () => {
  it('formats with default pattern "MMM d, yyyy"', () => {
    expect(formatDateOnly('2026-05-29')).toBe('May 29, 2026');
  });

  it('accepts a custom date-fns pattern', () => {
    expect(formatDateOnly('2026-05-29', 'yyyy-MM-dd')).toBe('2026-05-29');
    expect(formatDateOnly('2026-05-29', 'EEEE, MMMM d')).toBe('Friday, May 29');
  });

  it('matches a parseDateOnly + format composition', () => {
    const expected = format(parseDateOnly('2026-05-29'), 'MMM d, yyyy');
    expect(formatDateOnly('2026-05-29', 'MMM d, yyyy')).toBe(expected);
  });
});

// Regression: Tristen Liu's bug. parseDateOnly must NEVER shift to the prior
// day, regardless of the runner TZ. This test would catch a regression to the
// `new Date("YYYY-MM-DD")` UTC-midnight pattern in any negative-offset TZ
// (where getDate() would return 28 instead of 29).
describe('regression: Tristen Liu off-by-one', () => {
  it('parseDateOnly("2026-05-29") preserves day 29 (not 28)', () => {
    const d = parseDateOnly('2026-05-29');
    expect(d.getDate()).toBe(29);
    expect(d.getMonth()).toBe(4);
    expect(d.getFullYear()).toBe(2026);
  });

  it('documents the trap that this helper avoids', () => {
    // This test does NOT use the helper — it documents why the helper exists.
    // `new Date("2026-05-29")` parses as UTC midnight regardless of runner TZ.
    const buggy = new Date('2026-05-29');
    expect(buggy.toISOString()).toBe('2026-05-29T00:00:00.000Z');
    // Its LOCAL getDate() varies by runner TZ — that's the bug we sidestep.
    // We don't assert the local value here (CI=UTC, dev=anything) because the
    // helper test above proves the FIX is TZ-independent.
  });
});
