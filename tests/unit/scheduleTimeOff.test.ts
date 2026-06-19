import { describe, it, expect } from 'vitest';
import { buildWeekTimeOff } from '@/lib/scheduleTimeOff';
import type { TimeOffRequest } from '@/types/scheduling';

// Mon 2026-06-22 .. Sun 2026-06-28
const WEEK = ['2026-06-22','2026-06-23','2026-06-24','2026-06-25','2026-06-26','2026-06-27','2026-06-28'];

function makeReq(o: Partial<TimeOffRequest>): TimeOffRequest {
  return {
    id: o.id ?? 'r1',
    restaurant_id: 'rest1',
    employee_id: o.employee_id ?? 'e1',
    start_date: o.start_date ?? '2026-06-24',
    end_date: o.end_date ?? '2026-06-24',
    reason: o.reason,
    status: o.status ?? 'approved',
    requested_at: '2026-06-01T00:00:00Z',
    reviewed_at: o.reviewed_at,
    reviewed_by: o.reviewed_by,
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
  };
}

describe('buildWeekTimeOff', () => {
  it('marks a single approved off-day', () => {
    const map = buildWeekTimeOff([makeReq({ start_date: '2026-06-24', end_date: '2026-06-24' })], WEEK);
    const off = map.get('e1')!;
    expect([...off.offDayKeys]).toEqual(['2026-06-24']);
    expect(off.spans).toEqual([{ startKey: '2026-06-24', endKey: '2026-06-24', dayCount: 1, reasons: [] }]);
  });

  it('groups a contiguous multi-day run into one span', () => {
    const map = buildWeekTimeOff([makeReq({ start_date: '2026-06-24', end_date: '2026-06-26', reason: 'Vacation' })], WEEK);
    const off = map.get('e1')!;
    expect(off.offDayKeys.size).toBe(3);
    expect(off.spans).toEqual([{ startKey: '2026-06-24', endKey: '2026-06-26', dayCount: 3, reasons: ['Vacation'] }]);
  });

  it('excludes pending and rejected requests', () => {
    const map = buildWeekTimeOff([
      makeReq({ employee_id: 'p', status: 'pending' }),
      makeReq({ employee_id: 'x', status: 'rejected' }),
    ], WEEK);
    expect(map.has('p')).toBe(false);
    expect(map.has('x')).toBe(false);
  });

  it('omits employees with no in-week overlap', () => {
    const map = buildWeekTimeOff([makeReq({ start_date: '2026-07-01', end_date: '2026-07-03' })], WEEK);
    expect(map.has('e1')).toBe(false);
  });

  it('clips a request that straddles the week boundary to in-week days', () => {
    const map = buildWeekTimeOff([makeReq({ start_date: '2026-06-20', end_date: '2026-06-23' })], WEEK);
    const off = map.get('e1')!;
    expect([...off.offDayKeys]).toEqual(['2026-06-22','2026-06-23']);
    expect(off.spans[0].startKey).toBe('2026-06-22');
  });

  it('produces two spans for two separate same-employee requests', () => {
    const map = buildWeekTimeOff([
      makeReq({ id: 'a', start_date: '2026-06-22', end_date: '2026-06-22', reason: 'Personal' }),
      makeReq({ id: 'b', start_date: '2026-06-25', end_date: '2026-06-26', reason: 'Family' }),
    ], WEEK);
    const off = map.get('e1')!;
    expect(off.offDayKeys.size).toBe(3);
    expect(off.spans.map((s) => [s.startKey, s.endKey])).toEqual([['2026-06-22','2026-06-22'],['2026-06-25','2026-06-26']]);
  });

  it('tolerates datetime-suffixed date strings', () => {
    const map = buildWeekTimeOff([makeReq({ start_date: '2026-06-24T00:00:00Z', end_date: '2026-06-24T23:59:59Z' })], WEEK);
    expect(map.get('e1')!.offDayKeys.has('2026-06-24')).toBe(true);
  });

  it('ignores empty/whitespace reasons but keeps real ones', () => {
    const map = buildWeekTimeOff([makeReq({ start_date: '2026-06-24', end_date: '2026-06-24', reason: '   ' })], WEEK);
    expect(map.get('e1')!.spans[0].reasons).toEqual([]);
  });

  it('matches purely by string (no Date dependence in overlap)', () => {
    // weekDayKeys are arbitrary plain strings; overlap is lexicographic.
    const map = buildWeekTimeOff([makeReq({ start_date: '2026-06-23', end_date: '2026-06-25' })], WEEK);
    expect([...map.get('e1')!.offDayKeys]).toEqual(['2026-06-23','2026-06-24','2026-06-25']);
  });
});
