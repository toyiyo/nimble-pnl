import { describe, it, expect } from 'vitest';
import {
  restaurantWallClock,
  ymdInTimeZone,
  toLocalYMD,
  addDays,
  calculateDateRange,
  daysBetweenYmd,
  laborWindowMismatchReason,
  restaurantDayBounds,
} from '../../supabase/functions/_shared/restaurantDate';

// Every assertion uses a fixed UTC instant and compares calendar strings, so
// the result does not depend on the host timezone. `npm run test:tz` runs
// this file under Chicago, Auckland and UTC.

describe('ymdInTimeZone', () => {
  it('gives the Chicago day when the UTC date is already the next day (CDT)', () => {
    const instant = new Date('2026-09-25T02:00:00Z'); // 21:00 CDT on Sep 24
    expect(ymdInTimeZone(instant, 'America/Chicago')).toBe('2026-09-24');
    expect(ymdInTimeZone(instant, 'UTC')).toBe('2026-09-25');
  });

  it('gives the Chicago day in winter (CST, UTC-6)', () => {
    const instant = new Date('2026-01-15T05:30:00Z'); // 23:30 CST on Jan 14
    expect(ymdInTimeZone(instant, 'America/Chicago')).toBe('2026-01-14');
  });

  it('gives the next day for a zone ahead of UTC', () => {
    const instant = new Date('2026-09-24T13:00:00Z'); // 01:00 NZST on Sep 25
    expect(ymdInTimeZone(instant, 'Pacific/Auckland')).toBe('2026-09-25');
  });

  it('falls back to America/Chicago for an invalid zone', () => {
    const instant = new Date('2026-09-25T02:00:00Z');
    expect(ymdInTimeZone(instant, 'Not/AZone')).toBe('2026-09-24');
    expect(ymdInTimeZone(instant, '')).toBe('2026-09-24');
  });
});

describe('restaurantWallClock', () => {
  it('returns a Date whose local fields equal the restaurant wall clock', () => {
    const wall = restaurantWallClock(new Date('2026-09-25T02:15:30Z'), 'America/Chicago');
    expect(wall.getFullYear()).toBe(2026);
    expect(wall.getMonth()).toBe(8); // September
    expect(wall.getDate()).toBe(24);
    expect(wall.getHours()).toBe(21);
    expect(wall.getMinutes()).toBe(15);
    expect(wall.getSeconds()).toBe(30);
  });

  it('maps midnight to hour 0, not 24', () => {
    const wall = restaurantWallClock(new Date('2026-09-24T05:00:00Z'), 'America/Chicago');
    expect(toLocalYMD(wall)).toBe('2026-09-24');
    expect(wall.getHours()).toBe(0);
  });
});

describe('toLocalYMD and addDays', () => {
  it('formats local fields with zero padding', () => {
    expect(toLocalYMD(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('moves by calendar days across a month end', () => {
    expect(toLocalYMD(addDays(new Date(2026, 8, 30), 1))).toBe('2026-10-01');
    expect(toLocalYMD(addDays(new Date(2026, 8, 24), -30))).toBe('2026-08-25');
  });

  it('keeps a fractional day, so the time of day can move the date', () => {
    // 18:00 + 1.5 days = 06:00 two days later.
    const d = addDays(new Date(2026, 8, 24, 18, 0, 0), 1.5);
    expect(toLocalYMD(d)).toBe('2026-09-26');
    expect(d.getHours()).toBe(6);
    // 08:00 + 1.5 days = 20:00 the next day.
    expect(toLocalYMD(addDays(new Date(2026, 8, 24, 8, 0, 0), 1.5))).toBe('2026-09-25');
  });
});

describe('calculateDateRange with the restaurant clock', () => {
  const chicagoEvening = () => restaurantWallClock(new Date('2026-09-25T02:00:00Z'), 'America/Chicago');

  it('resolves "today" to the restaurant day, not the UTC day', () => {
    const r = calculateDateRange('today', undefined, undefined, chicagoEvening());
    expect(r.startDateStr).toBe('2026-09-24');
    expect(r.endDateStr).toBe('2026-09-24');
  });

  it('resolves "yesterday" to the restaurant day before', () => {
    const r = calculateDateRange('yesterday', undefined, undefined, chicagoEvening());
    expect(r.startDateStr).toBe('2026-09-23');
    expect(r.endDateStr).toBe('2026-09-23');
  });

  it('resolves "month" to the restaurant month on the last evening of a month', () => {
    // 21:00 CDT on Sep 30 is Oct 1 in UTC.
    const now = restaurantWallClock(new Date('2026-10-01T02:00:00Z'), 'America/Chicago');
    const r = calculateDateRange('month', undefined, undefined, now);
    expect(r.startDateStr).toBe('2026-09-01');
    expect(r.endDateStr).toBe('2026-09-30');
  });

  it('keeps custom dates as given', () => {
    const r = calculateDateRange('custom', '2026-02-01', '2026-02-28', chicagoEvening());
    expect(r.startDateStr).toBe('2026-02-01');
    expect(r.endDateStr).toBe('2026-02-28');
  });

  it('throws for custom without dates', () => {
    expect(() => calculateDateRange('custom', undefined, undefined, chicagoEvening())).toThrow(
      'Custom period requires start_date and end_date',
    );
  });
});

describe('daysBetweenYmd', () => {
  it('counts whole calendar days', () => {
    expect(daysBetweenYmd('2026-09-20', '2026-09-24')).toBe(4);
    expect(daysBetweenYmd('2026-09-24', '2026-09-24')).toBe(0);
  });

  it('is not changed by a DST change', () => {
    // Nov 1 2026 is the US fall-back day.
    expect(daysBetweenYmd('2026-10-31', '2026-11-02')).toBe(2);
    expect(daysBetweenYmd('2026-03-07', '2026-03-09')).toBe(2);
  });
});

describe('laborWindowMismatchReason', () => {
  const range = (start: string, end: string) => ({ startDateStr: start, endDateStr: end });

  it('returns undefined when the labor and sales windows are the same days', () => {
    expect(laborWindowMismatchReason(range('2026-09-01', '2026-09-30'), range('2026-09-01', '2026-09-30'))).toBeUndefined();
  });

  it('returns a reason when the UTC day is ahead of the restaurant day', () => {
    // 21:00 CDT on Sep 24: sales use Sep 24, the server clock gives Sep 25.
    const reason = laborWindowMismatchReason(range('2026-09-24', '2026-09-24'), range('2026-09-25', '2026-09-25'));
    expect(reason).toMatch(/omitted/);
  });

  it('gives a mismatch for "today" in the Chicago evening, with real clocks', () => {
    const instant = new Date('2026-09-25T02:00:00Z');
    const sales = calculateDateRange('today', undefined, undefined, restaurantWallClock(instant, 'America/Chicago'));
    const labor = calculateDateRange('today', undefined, undefined, restaurantWallClock(instant, 'UTC'));
    expect(laborWindowMismatchReason(sales, labor)).toBeDefined();
  });
});

describe('restaurantDayBounds', () => {
  it('gives the CDT instant bounds for a single restaurant day', () => {
    const { start, end } = restaurantDayBounds('2026-09-25', '2026-09-25', 'America/Chicago');
    expect(start.toISOString()).toBe('2026-09-25T05:00:00.000Z');
    expect(end.toISOString()).toBe('2026-09-26T04:59:59.999Z');
  });

  it('gives the CST instant bounds for a single restaurant day', () => {
    const { start, end } = restaurantDayBounds('2026-12-10', '2026-12-10', 'America/Chicago');
    expect(start.toISOString()).toBe('2026-12-10T06:00:00.000Z');
    expect(end.toISOString()).toBe('2026-12-11T05:59:59.999Z');
  });

  it('gives a 25-hour window on the DST end day', () => {
    const { start, end } = restaurantDayBounds('2026-11-01', '2026-11-01', 'America/Chicago');
    expect(start.toISOString()).toBe('2026-11-01T05:00:00.000Z');
    expect(end.toISOString()).toBe('2026-11-02T05:59:59.999Z');
    expect(end.getTime() - start.getTime()).toBe(25 * 60 * 60 * 1000 - 1);
  });

  it('gives bounds across a multi-day range', () => {
    const { start, end } = restaurantDayBounds('2026-09-21', '2026-09-27', 'America/Chicago');
    expect(start.toISOString()).toBe('2026-09-21T05:00:00.000Z');
    expect(end.toISOString()).toBe('2026-09-28T04:59:59.999Z');
  });

  it('gives UTC midnight bounds for the UTC zone', () => {
    const { start, end } = restaurantDayBounds('2026-09-25', '2026-09-25', 'UTC');
    expect(start.toISOString()).toBe('2026-09-25T00:00:00.000Z');
    expect(end.toISOString()).toBe('2026-09-25T23:59:59.999Z');
  });

  it('falls back to America/Chicago for an invalid zone', () => {
    const chicago = restaurantDayBounds('2026-09-25', '2026-09-25', 'America/Chicago');
    const invalid = restaurantDayBounds('2026-09-25', '2026-09-25', 'Not/AZone');
    expect(invalid.start.toISOString()).toBe(chicago.start.toISOString());
    expect(invalid.end.toISOString()).toBe(chicago.end.toISOString());
  });

  it('rolls the end day across a month end', () => {
    const { end } = restaurantDayBounds('2026-09-30', '2026-09-30', 'America/Chicago');
    expect(end.toISOString()).toBe('2026-10-01T04:59:59.999Z');
  });

  it('starts a day at its first real instant when DST starts at local midnight (Santiago gap)', () => {
    // 2026-09-06 00:00 -04 does not exist in Santiago: the clock jumps to
    // 01:00 -03. The day must start at 01:00 -03 = 04:00Z, not at 03:00Z
    // (which reads back as 23:00 on Sep 5, one hour into the wrong day).
    const { start } = restaurantDayBounds('2026-09-06', '2026-09-06', 'America/Santiago');
    expect(start.toISOString()).toBe('2026-09-06T04:00:00.000Z');
  });

  it('ends a day after the repeated hour when DST ends at local midnight (Santiago overlap)', () => {
    // 2026-04-05 00:00 -03 goes back to 2026-04-04 23:00 -04, so Apr 4 has
    // 25 hours. The day ends at 2026-04-05 00:00 -04 = 04:00Z, minus 1 ms.
    const { end } = restaurantDayBounds('2026-04-04', '2026-04-04', 'America/Santiago');
    expect(end.toISOString()).toBe('2026-04-05T03:59:59.999Z');
  });
});
