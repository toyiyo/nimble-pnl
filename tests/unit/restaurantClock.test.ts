import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TIMEZONE,
  businessDaysBetween,
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
