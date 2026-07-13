import { describe, it, expect } from 'vitest';
import { validateTimeZone, distributeWorkedHours } from '@/lib/splhAnalytics';
import type { WorkSession } from '@/utils/timePunchProcessing';

describe('validateTimeZone', () => {
  it('passes through a valid IANA zone', () => {
    expect(validateTimeZone('America/New_York')).toBe('America/New_York');
  });
  it('falls back to UTC for an invalid zone', () => {
    expect(validateTimeZone('Not/AZone')).toBe('UTC');
    expect(validateTimeZone('')).toBe('UTC');
    expect(validateTimeZone(undefined)).toBe('UTC');
  });
});

function session(partial: Partial<WorkSession>): WorkSession {
  return {
    sessionId: 's', employee_id: 'e', employee_name: 'n',
    clock_in: new Date(), clock_out: undefined, breaks: [],
    total_minutes: 0, break_minutes: 0, worked_minutes: 0,
    is_complete: false, has_anomalies: false, anomalies: [],
    ...partial,
  };
}

describe('distributeWorkedHours', () => {
  const tz = 'America/New_York'; // UTC-4 in July (DST)

  it('returns [] for an incomplete session', () => {
    expect(distributeWorkedHours(session({ clock_in: new Date(Date.UTC(2026,6,1,20,0)) }), tz)).toEqual([]);
  });

  it('buckets a 2h15m single-day session by local hour', () => {
    // 17:00–19:15 local EDT = 21:00Z–23:15Z on 2026-07-01
    const s = session({
      clock_in: new Date(Date.UTC(2026,6,1,21,0)),
      clock_out: new Date(Date.UTC(2026,6,1,23,15)),
      is_complete: true,
    });
    const c = distributeWorkedHours(s, tz);
    expect(c.map(x => [x.hour, Math.round(x.hours*100)/100])).toEqual([[17,1],[18,1],[19,0.25]]);
    expect(c.every(x => x.localDate === '2026-07-01')).toBe(true);
    expect(c[0].dow).toBe(3); // 2026-07-01 is a Wednesday
  });

  it('excludes a complete break from the buckets', () => {
    // 17:00–19:00 local, 30-min break 17:30–18:00 → worked hour17=0.5, hour18=1
    const s = session({
      clock_in: new Date(Date.UTC(2026,6,1,21,0)),
      clock_out: new Date(Date.UTC(2026,6,1,23,0)),
      breaks: [{ break_start: new Date(Date.UTC(2026,6,1,21,30)), break_end: new Date(Date.UTC(2026,6,1,22,0)), duration_minutes: 30, is_complete: true }],
      is_complete: true,
    });
    const c = distributeWorkedHours(s, tz);
    const byHour = Object.fromEntries(c.map(x => [x.hour, Math.round(x.hours*100)/100]));
    expect(byHour).toEqual({ 17: 0.5, 18: 1 });
  });

  it('splits an overnight shift across two dates/dows', () => {
    // 22:00 Wed → 02:00 Thu local = 02:00Z Thu → 06:00Z Thu
    const s = session({
      clock_in: new Date(Date.UTC(2026,6,2,2,0)),
      clock_out: new Date(Date.UTC(2026,6,2,6,0)),
      is_complete: true,
    });
    const c = distributeWorkedHours(s, tz);
    const dates = new Set(c.map(x => x.localDate));
    expect(dates.has('2026-07-01')).toBe(true); // 22:00,23:00 Wed
    expect(dates.has('2026-07-02')).toBe(true); // 00:00,01:00 Thu
  });
});
