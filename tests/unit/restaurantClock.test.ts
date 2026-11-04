import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatInTimeZone } from 'date-fns-tz';

import {
  DEFAULT_TIMEZONE,
  addDaysToDateStr,
  businessDayRangeToInstants,
  businessDaysBetween,
  daysBetweenDateStrs,
  firstInstantOfDay,
  formatInstant,
  parseWallClock,
  safeTz,
  toBusinessDay,
  toWallClockInput,
  tzAbbrev,
  tzOffsetMinutes,
} from '@/lib/restaurantClock';

const CHI = 'America/Chicago';

describe('safeTz', () => {
  it('returns a valid IANA zone unchanged', () => {
    expect(safeTz(CHI)).toBe(CHI);
  });

  it('falls back on null, empty, and invalid zones', () => {
    expect(safeTz(null)).toBe(DEFAULT_TIMEZONE);
    expect(safeTz(undefined)).toBe(DEFAULT_TIMEZONE);
    expect(safeTz('')).toBe(DEFAULT_TIMEZONE);
    expect(safeTz('Not/AZone')).toBe(DEFAULT_TIMEZONE);
  });
});

describe('toBusinessDay', () => {
  it('buckets an instant by the restaurant day, not the host day', () => {
    // 2026-07-23T01:56:20Z is Jul 22 20:56 in Chicago.
    expect(toBusinessDay('2026-07-23T01:56:20Z', CHI)).toBe('2026-07-22');
  });

  it('handles a zone ahead of UTC', () => {
    expect(toBusinessDay('2026-07-22T13:00:00Z', 'Pacific/Auckland')).toBe('2026-07-23');
  });

  it('is DST-aware at the spring-forward boundary', () => {
    // 07:30Z on 2026-03-08 is 01:30 CST; 08:30Z is 03:30 CDT. Same day.
    expect(toBusinessDay('2026-03-08T07:30:00Z', CHI)).toBe('2026-03-08');
    expect(toBusinessDay('2026-03-08T08:30:00Z', CHI)).toBe('2026-03-08');
  });

  it('gives YYYY-MM-DD, the day of formatInTimeZone, for each hour of a year in several zones', () => {
    // toBusinessDay uses a cached en-CA Intl formatter. en-CA with 2-digit
    // month and day gives YYYY-MM-DD in Node (full ICU).
    const zones = [CHI, 'Pacific/Auckland', 'UTC', 'America/Santiago', 'Asia/Kolkata', 'Australia/Lord_Howe'];
    const start = Date.UTC(2026, 0, 1);
    for (const zone of zones) {
      for (let h = 0; h < 366 * 24; h += 7) {
        const instant = new Date(start + h * 3600e3);
        const day = toBusinessDay(instant, zone);
        expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(day).toBe(formatInTimeZone(instant, zone, 'yyyy-MM-dd'));
      }
    }
  });
});

describe('addDaysToDateStr', () => {
  it('adds and subtracts days across month, year and leap-day edges', () => {
    expect(addDaysToDateStr('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDaysToDateStr('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDaysToDateStr('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDaysToDateStr('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysToDateStr('2027-01-01', -366)).toBe('2025-12-31');
  });
});

describe('businessDaysBetween', () => {
  it('returns a single day for a shift inside one restaurant day', () => {
    // 18:00 -> 22:00 Chicago on Jul 22.
    expect(businessDaysBetween('2026-07-22T23:00:00Z', '2026-07-23T03:00:00Z', CHI)).toEqual([
      '2026-07-22',
    ]);
  });

  it('returns both days for an overnight shift', () => {
    // 20:00 Jul 22 -> 02:00 Jul 23 Chicago.
    expect(businessDaysBetween('2026-07-23T01:00:00Z', '2026-07-23T07:00:00Z', CHI)).toEqual([
      '2026-07-22',
      '2026-07-23',
    ]);
  });

  it('spans a DST transition without dropping or duplicating a day', () => {
    // Mar 7 22:00 -> Mar 8 12:00 Chicago, across spring forward.
    expect(businessDaysBetween('2026-03-08T04:00:00Z', '2026-03-08T17:00:00Z', CHI)).toEqual([
      '2026-03-07',
      '2026-03-08',
    ]);
  });

  it('returns the start day when the range is inverted', () => {
    expect(businessDaysBetween('2026-07-23T07:00:00Z', '2026-07-23T01:00:00Z', CHI)).toEqual([
      '2026-07-23',
    ]);
  });
});

describe('businessDayRangeToInstants', () => {
  it('returns the restaurant-zone midnight-to-midnight bounds for a single day', () => {
    const { start, end } = businessDayRangeToInstants('2026-07-22', '2026-07-22', CHI);
    expect(start.toISOString()).toBe('2026-07-22T05:00:00.000Z'); // 00:00:00.000 CDT
    expect(end.toISOString()).toBe('2026-07-23T04:59:59.999Z'); // 23:59:59.999 CDT
  });

  it('spans an inclusive multi-day range', () => {
    const { start, end } = businessDayRangeToInstants('2026-07-06', '2026-07-12', CHI);
    expect(start.toISOString()).toBe('2026-07-06T05:00:00.000Z');
    expect(end.toISOString()).toBe('2026-07-13T04:59:59.999Z');
  });

  it('handles a zone ahead of UTC', () => {
    const { start, end } = businessDayRangeToInstants('2026-07-23', '2026-07-23', 'Pacific/Auckland');
    // Auckland is UTC+12 in July (winter, no DST there).
    expect(start.toISOString()).toBe('2026-07-22T12:00:00.000Z');
    expect(end.toISOString()).toBe('2026-07-23T11:59:59.999Z');
  });

  it('is DST-aware at the spring-forward boundary: the end-of-day bound follows the new offset', () => {
    // 2026-03-08 is Chicago's spring-forward day (02:00 CST -> 03:00 CDT).
    // Midnight is still CST (-6:00); 23:59:59.999 is already CDT (-5:00).
    const { start, end } = businessDayRangeToInstants('2026-03-08', '2026-03-08', CHI);
    expect(start.toISOString()).toBe('2026-03-08T06:00:00.000Z'); // 00:00:00.000 CST
    expect(end.toISOString()).toBe('2026-03-09T04:59:59.999Z'); // 23:59:59.999 CDT
  });

  it('rejects a startDay/endDay that is not a calendar-day string', () => {
    expect(() => businessDayRangeToInstants('2026-07-28T00:00:00Z', '2026-07-28', CHI)).toThrow(/calendar day/i);
    expect(() => businessDayRangeToInstants('2026-07-28', '2026-07-28T00:00:00Z', CHI)).toThrow(/calendar day/i);
  });

  it('starts a day at its first real instant when DST starts at local midnight (Santiago gap)', () => {
    // 2026-09-06 00:00 -04 does not exist in Santiago: the clock jumps to 01:00 -03.
    // The day starts at 01:00 -03 = 04:00Z, not at 03:00Z (23:00 on Sep 5 local).
    const { start } = businessDayRangeToInstants('2026-09-06', '2026-09-06', 'America/Santiago');
    expect(start.toISOString()).toBe('2026-09-06T04:00:00.000Z');
  });

  it('ends a day after the repeated hour when DST ends at local midnight (Santiago overlap)', () => {
    // 2026-04-05 00:00 -03 goes back to 2026-04-04 23:00 -04, so Apr 4 has 25 hours.
    // The day ends at 2026-04-05 00:00 -04 = 04:00Z, minus 1 ms.
    const { end } = businessDayRangeToInstants('2026-04-04', '2026-04-04', 'America/Santiago');
    expect(end.toISOString()).toBe('2026-04-05T03:59:59.999Z');
  });
});

describe('firstInstantOfDay', () => {
  it('returns local midnight for a Chicago day', () => {
    expect(firstInstantOfDay('2026-07-22', CHI).toISOString()).toBe('2026-07-22T05:00:00.000Z');
    expect(firstInstantOfDay('2026-03-08', CHI).toISOString()).toBe('2026-03-08T06:00:00.000Z');
    expect(firstInstantOfDay('2026-11-01', CHI).toISOString()).toBe('2026-11-01T05:00:00.000Z');
  });

  it('returns local midnight for an Auckland day', () => {
    expect(firstInstantOfDay('2026-07-23', 'Pacific/Auckland').toISOString()).toBe('2026-07-22T12:00:00.000Z');
    // NZDT (+13) in January.
    expect(firstInstantOfDay('2026-01-15', 'Pacific/Auckland').toISOString()).toBe('2026-01-14T11:00:00.000Z');
  });

  it('returns the first real instant when local midnight does not exist (Santiago)', () => {
    expect(firstInstantOfDay('2026-09-06', 'America/Santiago').toISOString()).toBe('2026-09-06T04:00:00.000Z');
  });

  it('returns the first of the two midnights after an overlap day (Santiago)', () => {
    // Apr 4 00:00 -03 is 03:00Z. Apr 5 00:00 -04 is 04:00Z.
    expect(firstInstantOfDay('2026-04-04', 'America/Santiago').toISOString()).toBe('2026-04-04T03:00:00.000Z');
    expect(firstInstantOfDay('2026-04-05', 'America/Santiago').toISOString()).toBe('2026-04-05T04:00:00.000Z');
  });

  it('falls back to the default zone for an invalid zone', () => {
    expect(firstInstantOfDay('2026-07-22', 'Not/AZone').toISOString()).toBe(
      firstInstantOfDay('2026-07-22', DEFAULT_TIMEZONE).toISOString(),
    );
    expect(firstInstantOfDay('2026-07-22', '').toISOString()).toBe('2026-07-22T05:00:00.000Z');
  });

  it('rejects a value that is not a calendar-day string', () => {
    expect(() => firstInstantOfDay('2026-07-28T00:00:00Z', CHI)).toThrow(/calendar day/i);
  });
});

describe('formatInstant', () => {
  it('renders in the restaurant zone', () => {
    expect(formatInstant('2026-07-23T01:56:20Z', CHI, 'yyyy-MM-dd HH:mm')).toBe('2026-07-22 20:56');
  });
});

describe('wall-clock round trip', () => {
  it('survives a load/save cycle unchanged', () => {
    const original = '2026-07-23T01:56:20.000Z';
    const shown = toWallClockInput(original, CHI);
    expect(shown).toBe('2026-07-22T20:56');
    // Seconds are not editable in a datetime-local field, so compare to the minute.
    expect(parseWallClock(shown, CHI)).toBe('2026-07-23T01:56:00.000Z');
  });
});

describe('shape guards', () => {
  it('formatInstant rejects a calendar day', () => {
    expect(() => formatInstant('2026-07-28', CHI, 'HH:mm')).toThrow(/calendar day/i);
  });

  it('toBusinessDay rejects a calendar day', () => {
    expect(() => toBusinessDay('2026-07-28', CHI)).toThrow(/calendar day/i);
  });

  it('parseWallClock rejects an instant', () => {
    expect(() => parseWallClock('2026-07-28T18:00:00Z', CHI)).toThrow(/wall clock/i);
  });
});

describe('production fallback for a calendar day (no error boundary in prod)', () => {
  // `reject()` throws in DEV/Vitest but only logs in production, where
  // `asInstant` falls through to a fallback instant. Force that branch by
  // stubbing `import.meta.env` to look like a production build, and assert
  // `console.error` fired so we have positive evidence the fallback --
  // not the throw -- actually ran.
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function stubProdEnv(): void {
    vi.stubEnv('DEV', false);
    vi.stubEnv('MODE', 'production');
  }

  it('formatInstant reads a date-only string as midnight in a zone behind UTC (Chicago)', () => {
    stubProdEnv();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(formatInstant('2026-07-15', CHI, 'yyyy-MM-dd')).toBe('2026-07-15');
    expect(errorSpy).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  it('formatInstant reads a date-only string as midnight in a zone ahead of UTC (Auckland)', () => {
    stubProdEnv();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(formatInstant('2026-07-15', 'Pacific/Auckland', 'yyyy-MM-dd')).toBe('2026-07-15');
    expect(errorSpy).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  it('formatInstant reads a date-only string as midnight in UTC itself', () => {
    stubProdEnv();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(formatInstant('2026-07-15', 'UTC', 'yyyy-MM-dd')).toBe('2026-07-15');
    expect(errorSpy).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  it('toBusinessDay round-trips a date-only string back to the same day (Chicago)', () => {
    stubProdEnv();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(toBusinessDay('2026-07-15', CHI)).toBe('2026-07-15');
    expect(errorSpy).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  it('businessDaysBetween round-trips a date-only start/end back to the same day (Auckland)', () => {
    stubProdEnv();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(businessDaysBetween('2026-07-15', '2026-07-15', 'Pacific/Auckland')).toEqual([
      '2026-07-15',
    ]);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('toWallClockInput anchors a date-only string to local midnight (UTC)', () => {
    stubProdEnv();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(toWallClockInput('2026-07-15', 'UTC')).toBe('2026-07-15T00:00');
    expect(errorSpy).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });
});

describe('parseWallClock at DST edges (Postgres parity)', () => {
  // Expected values are fixed literals, verified against local Postgres via
  // `('...'::timestamp AT TIME ZONE tz)::text`, NOT derived from `new Date()`
  // -- an assertion correct in July and wrong in November would be a defect.
  // Postgres resolves both the repeated (ambiguous) and nonexistent wall
  // clock using the numerically SMALLER of the two candidate UTC offsets --
  // equivalently, of the two candidate instants it always takes the LATER
  // one. Confirmed in both hemispheres (America/Chicago DST is Mar-Nov;
  // Australia/Sydney DST is Oct-Apr, opposite direction) so it is not a
  // northern-hemisphere fluke.
  //
  // The rule is PURELY NUMERIC, not designation-based. In Chicago and Sydney
  // the smaller offset happens to be the zone's standard (non-DST) one, so
  // those four cases alone cannot distinguish "smaller offset" from
  // "standard offset" -- an implementation that looked up tzdb's standard
  // offset would pass all of them and still be wrong. Europe/Dublin is the
  // decisive case: tzdb models it with NEGATIVE DST (standard is IST +1:00,
  // and winter GMT +0:00 is the DST offset), so there "standard" is the
  // LARGER offset and the two rules give different answers. The Dublin
  // expectations below are what production Postgres actually returns, and
  // they match the numeric rule, not the designation one.
  const SYD = 'Australia/Sydney';
  const DUB = 'Europe/Dublin';

  it('resolves the repeated hour (fall-back) in Chicago with the smaller (CST) offset', () => {
    expect(parseWallClock('2026-11-01T01:30', CHI)).toBe('2026-11-01T07:30:00.000Z');
  });

  it('resolves the nonexistent hour (spring-forward) in Chicago with the smaller (CST) offset', () => {
    expect(parseWallClock('2026-03-08T02:30', CHI)).toBe('2026-03-08T08:30:00.000Z');
  });

  it('resolves the repeated hour (fall-back) in Sydney with the smaller (AEST) offset', () => {
    // Sydney DST ends 2026-04-05; 02:30 is the repeated hour. The AFTER
    // offset (AEST, +10:00) is the smaller of the two candidates here.
    expect(parseWallClock('2026-04-05T02:30', SYD)).toBe('2026-04-04T16:30:00.000Z');
  });

  it('resolves the nonexistent hour (spring-forward) in Sydney with the smaller (AEST) offset', () => {
    // Sydney DST starts 2026-10-04; 02:30 does not exist. The BEFORE offset
    // (AEST, +10:00) is the smaller one here -- the opposite side from the
    // fall-back case above, which is why "smaller offset" (not
    // "before"/"after") is the rule that describes both.
    expect(parseWallClock('2026-10-04T02:30', SYD)).toBe('2026-10-03T16:30:00.000Z');
  });

  // The two cases below are the reason this whole block exists. If someone
  // "simplifies" parseWallClock's `Math.min(offsetBefore, offsetAfter)` into
  // a tzdb standard-offset lookup, every other test here still passes and
  // only these two go red.
  it('resolves the repeated hour (fall-back) in Dublin with the SMALLER offset, not the standard one', () => {
    // Dublin DST ends 2026-10-25; 01:30 is the repeated hour. Candidates are
    // 00:30Z (at IST +1:00) and 01:30Z (at GMT +0:00). Postgres returns the
    // later instant -- i.e. the smaller offset -- even though +1:00 is the
    // zone's *standard* offset. Verified against production Postgres:
    // ('2026-10-25T01:30:00'::timestamp AT TIME ZONE 'Europe/Dublin')
    //   => 2026-10-25 01:30:00+00
    expect(parseWallClock('2026-10-25T01:30', DUB)).toBe('2026-10-25T01:30:00.000Z');
  });

  it('resolves the nonexistent hour (spring-forward) in Dublin with the SMALLER offset, not the standard one', () => {
    // Dublin DST starts 2026-03-29; 01:30 does not exist (01:00 -> 02:00).
    // Verified against production Postgres:
    // ('2026-03-29T01:30:00'::timestamp AT TIME ZONE 'Europe/Dublin')
    //   => 2026-03-29 01:30:00+00
    expect(parseWallClock('2026-03-29T01:30', DUB)).toBe('2026-03-29T01:30:00.000Z');
  });

  it('resolves an unambiguous Chicago wall clock without touching the standard-offset fallback', () => {
    expect(parseWallClock('2026-07-22T20:56', CHI)).toBe('2026-07-23T01:56:00.000Z');
  });

  it('resolves an unambiguous Sydney wall clock without touching the standard-offset fallback', () => {
    expect(parseWallClock('2026-06-15T10:00', SYD)).toBe('2026-06-15T00:00:00.000Z');
  });
});

describe('daysBetweenDateStrs', () => {
  it('is the inverse of addDaysToDateStr', () => {
    expect(daysBetweenDateStrs('2026-03-01', addDaysToDateStr('2026-03-01', 5))).toBe(5);
    expect(daysBetweenDateStrs('2026-03-01', addDaysToDateStr('2026-03-01', 0))).toBe(0);
  });

  it('counts calendar days across a DST transition, not 24h blocks', () => {
    // 2026-03-07 -> 2026-03-09 spans Chicago's spring-forward, so the elapsed
    // time is 47h. This is calendar arithmetic on date strings, though — no
    // instants, no zone — so the answer is 2, not 1.
    expect(daysBetweenDateStrs('2026-03-07', '2026-03-09')).toBe(2);
  });

  it('counts across a month and a year boundary', () => {
    expect(daysBetweenDateStrs('2026-01-31', '2026-02-01')).toBe(1);
    expect(daysBetweenDateStrs('2026-12-31', '2027-01-01')).toBe(1);
    expect(daysBetweenDateStrs('2024-02-28', '2024-03-01')).toBe(2); // leap year
  });

  it('returns a negative count when the range is inverted', () => {
    expect(daysBetweenDateStrs('2026-03-05', '2026-03-01')).toBe(-4);
  });
});

describe('offset and abbreviation', () => {
  it('reports the CDT offset in July', () => {
    expect(tzOffsetMinutes(CHI, new Date('2026-07-15T12:00:00Z'))).toBe(-300);
  });

  it('reports the CST offset in January', () => {
    expect(tzOffsetMinutes(CHI, new Date('2026-01-15T12:00:00Z'))).toBe(-360);
  });

  it('names the zone', () => {
    expect(tzAbbrev(CHI, new Date('2026-07-15T12:00:00Z'))).toBe('CDT');
  });
});
