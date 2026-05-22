import { describe, it, expect } from 'vitest';
import {
  utcTimeToLocalTime,
  localTimeToUtcTime,
  convertAvailabilityWindowsToUtc,
} from '@/lib/availabilityTimeUtils';

describe('utcTimeToLocalTime', () => {
  it('converts UTC time to CDT (summer) correctly', () => {
    const refDate = new Date('2026-07-15T12:00:00Z');
    const result = utcTimeToLocalTime('21:30:00', 'America/Chicago', refDate);
    expect(result).toBe('16:30');
  });

  it('converts UTC time to CST (winter) correctly', () => {
    const refDate = new Date('2026-01-15T12:00:00Z');
    const result = utcTimeToLocalTime('21:30:00', 'America/Chicago', refDate);
    expect(result).toBe('15:30');
  });

  it('converts UTC time to EDT (summer) correctly', () => {
    const refDate = new Date('2026-07-15T12:00:00Z');
    const result = utcTimeToLocalTime('20:00:00', 'America/New_York', refDate);
    expect(result).toBe('16:00');
  });

  it('converts UTC time to EST (winter) correctly', () => {
    const refDate = new Date('2026-01-15T12:00:00Z');
    const result = utcTimeToLocalTime('20:00:00', 'America/New_York', refDate);
    expect(result).toBe('15:00');
  });

  it('handles UTC timezone (no offset)', () => {
    const refDate = new Date('2026-07-15T12:00:00Z');
    const result = utcTimeToLocalTime('16:30:00', 'UTC', refDate);
    expect(result).toBe('16:30');
  });

  it('handles HH:MM input (no seconds)', () => {
    const refDate = new Date('2026-07-15T12:00:00Z');
    const result = utcTimeToLocalTime('21:30', 'America/Chicago', refDate);
    expect(result).toBe('16:30');
  });

  it('handles midnight UTC correctly', () => {
    const refDate = new Date('2026-07-15T12:00:00Z');
    const result = utcTimeToLocalTime('00:00:00', 'America/Chicago', refDate);
    expect(result).toBe('19:00');
  });

  it('handles times with minutes correctly', () => {
    const refDate = new Date('2026-07-15T12:00:00Z');
    const result = utcTimeToLocalTime('21:45:00', 'America/Chicago', refDate);
    expect(result).toBe('16:45');
  });
});

describe('localTimeToUtcTime', () => {
  it('converts CDT local time to UTC correctly', () => {
    const refDate = new Date('2026-07-15T12:00:00Z');
    const result = localTimeToUtcTime('16:30', 'America/Chicago', refDate);
    expect(result).toBe('21:30:00');
  });

  it('converts CST local time to UTC correctly', () => {
    const refDate = new Date('2026-01-15T12:00:00Z');
    const result = localTimeToUtcTime('16:30', 'America/Chicago', refDate);
    expect(result).toBe('22:30:00');
  });

  it('converts EDT local time to UTC correctly', () => {
    const refDate = new Date('2026-07-15T12:00:00Z');
    const result = localTimeToUtcTime('16:00', 'America/New_York', refDate);
    expect(result).toBe('20:00:00');
  });

  it('converts EST local time to UTC correctly', () => {
    const refDate = new Date('2026-01-15T12:00:00Z');
    const result = localTimeToUtcTime('16:00', 'America/New_York', refDate);
    expect(result).toBe('21:00:00');
  });

  it('handles UTC timezone (no offset)', () => {
    const refDate = new Date('2026-07-15T12:00:00Z');
    const result = localTimeToUtcTime('16:30', 'UTC', refDate);
    expect(result).toBe('16:30:00');
  });

  it('handles times that cross day boundary', () => {
    const refDate = new Date('2026-07-15T12:00:00Z');
    const result = localTimeToUtcTime('19:00', 'America/Chicago', refDate);
    expect(result).toBe('00:00:00');
  });
});

describe('local-midnight reference dates (parseDateOnly callers)', () => {
  // The helpers anchor DST off the calendar day of `referenceDate`. Callers
  // that derive `referenceDate` from `parseDateOnly("YYYY-MM-DD")` produce a
  // Date at *local* midnight, whose UTC representation can fall on the prior
  // day in zones east of UTC. The helpers must therefore read the local
  // fields (`.getFullYear()` / `.getMonth()` / `.getDate()`), not the UTC
  // ones, or DST-transition days flip to the wrong offset for those users.

  it('utcTimeToLocalTime uses local calendar day on DST-start (Chicago)', () => {
    // March 8, 2026 = CST → CDT in America/Chicago. Local midnight ensures
    // the same calendar day in any process TZ.
    const refDate = new Date(2026, 2, 8);
    const result = utcTimeToLocalTime('21:30:00', 'America/Chicago', refDate);
    expect(result).toBe('16:30'); // CDT (UTC-5), the correct anchor for Mar 8
  });

  it('localTimeToUtcTime uses local calendar day on DST-start (Chicago)', () => {
    const refDate = new Date(2026, 2, 8);
    const result = localTimeToUtcTime('16:30', 'America/Chicago', refDate);
    expect(result).toBe('21:30:00'); // 16:30 CDT → 21:30 UTC
  });

  it('utcTimeToLocalTime uses local calendar day on DST-end (New York)', () => {
    // November 1, 2026 = EDT → EST in America/New_York.
    const refDate = new Date(2026, 10, 1);
    const result = utcTimeToLocalTime('20:00:00', 'America/New_York', refDate);
    expect(result).toBe('15:00'); // EST (UTC-5), the correct anchor for Nov 1
  });
});

describe('convertAvailabilityWindowsToUtc', () => {
  // The exact production-data shape: a Chicago (CDT) restaurant saved
  // 10:00–22:30 local hours via the bulk-set sheet. The writer must now
  // convert those to UTC (15:00–03:30) so readers — which all assume the
  // UTC contract on employee_availability — render them back correctly.

  it('converts CDT local windows to UTC for available days', () => {
    const refDate = new Date('2026-07-15T12:00:00Z');
    const windows = [
      { day_of_week: 1, start_time: '10:00', end_time: '22:30', is_available: true },
      { day_of_week: 2, start_time: '10:00', end_time: '22:30', is_available: true },
    ];
    const out = convertAvailabilityWindowsToUtc(windows, 'America/Chicago', refDate);
    expect(out).toEqual([
      { day_of_week: 1, start_time: '15:00:00', end_time: '03:30:00', is_available: true },
      { day_of_week: 2, start_time: '15:00:00', end_time: '03:30:00', is_available: true },
    ]);
  });

  it('passes is_available=false rows through unchanged', () => {
    const refDate = new Date('2026-07-15T12:00:00Z');
    const windows = [
      { day_of_week: 0, start_time: '09:00', end_time: '17:00', is_available: false },
      { day_of_week: 1, start_time: '10:00', end_time: '22:30', is_available: true },
    ];
    const out = convertAvailabilityWindowsToUtc(windows, 'America/Chicago', refDate);
    expect(out[0]).toEqual({
      day_of_week: 0,
      start_time: '09:00',
      end_time: '17:00',
      is_available: false,
    });
    expect(out[1].start_time).toBe('15:00:00');
    expect(out[1].end_time).toBe('03:30:00');
  });

  it('is a no-op for UTC restaurants', () => {
    const refDate = new Date('2026-07-15T12:00:00Z');
    const windows = [
      { day_of_week: 1, start_time: '10:00', end_time: '22:30', is_available: true },
    ];
    const out = convertAvailabilityWindowsToUtc(windows, 'UTC', refDate);
    expect(out).toEqual([
      { day_of_week: 1, start_time: '10:00:00', end_time: '22:30:00', is_available: true },
    ]);
  });

  it('uses CST offset in winter for Chicago', () => {
    const refDate = new Date('2026-01-15T12:00:00Z');
    const windows = [
      { day_of_week: 1, start_time: '10:00', end_time: '22:30', is_available: true },
    ];
    const out = convertAvailabilityWindowsToUtc(windows, 'America/Chicago', refDate);
    expect(out[0].start_time).toBe('16:00:00');
    expect(out[0].end_time).toBe('04:30:00');
  });
});

describe('roundtrip conversion', () => {
  it('local → UTC → local preserves time (CDT)', () => {
    const refDate = new Date('2026-07-15T12:00:00Z');
    const tz = 'America/Chicago';
    const utc = localTimeToUtcTime('16:30', tz, refDate);
    const local = utcTimeToLocalTime(utc, tz, refDate);
    expect(local).toBe('16:30');
  });

  it('local → UTC → local preserves time (CST)', () => {
    const refDate = new Date('2026-01-15T12:00:00Z');
    const tz = 'America/Chicago';
    const utc = localTimeToUtcTime('16:30', tz, refDate);
    const local = utcTimeToLocalTime(utc, tz, refDate);
    expect(local).toBe('16:30');
  });

  it('UTC → local → UTC preserves time (EDT)', () => {
    const refDate = new Date('2026-07-15T12:00:00Z');
    const tz = 'America/New_York';
    const local = utcTimeToLocalTime('20:00:00', tz, refDate);
    const utc = localTimeToUtcTime(local, tz, refDate);
    expect(utc).toBe('20:00:00');
  });
});
