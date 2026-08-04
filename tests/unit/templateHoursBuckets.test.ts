import { describe, it, expect } from 'vitest';

import {
  bucketTemplateShifts,
  durationMinutes,
  type LinkedShift,
} from '@/lib/scheduling/templateHoursBuckets';

const TZ = 'America/Chicago';
const NOW = new Date('2026-03-02T12:00:00Z');

function shift(overrides: Partial<LinkedShift> & { id: string }): LinkedShift {
  return {
    start_time: '2026-03-10T14:00:00Z', // 09:00 America/Chicago (CDT, UTC-5)
    end_time: '2026-03-10T22:00:00Z',   // 17:00 America/Chicago
    is_published: false,
    locked: false,
    employee_id: 'emp-1',
    employeeName: 'Casey',
    ...overrides,
  };
}

const BASE = {
  oldStart: '09:00',
  oldEnd: '17:00',
  newStart: '10:00',
  newEnd: '18:00',
  tz: TZ,
  now: NOW,
};

describe('durationMinutes', () => {
  it('measures a same-day range', () => {
    expect(durationMinutes('09:00', '17:00')).toBe(480);
  });

  it('wraps a midnight-crossing range to the next day', () => {
    expect(durationMinutes('22:00', '02:00')).toBe(240);
  });

  it('treats an equal start and end as a full 24 hours', () => {
    expect(durationMinutes('09:00', '09:00')).toBe(1440);
  });
});

describe('bucketTemplateShifts', () => {
  it('returns empty buckets for no shifts', () => {
    const result = bucketTemplateShifts({ ...BASE, shifts: [] });
    expect(result.moving).toEqual([]);
    expect(result.drifted).toEqual([]);
    expect(result.past).toEqual([]);
    expect(result.locked).toEqual([]);
    expect(result.publishedMovingIds).toEqual([]);
    expect(result.movingHoursDelta).toBe(0);
  });

  it('buckets a matching future unlocked shift as moving', () => {
    const result = bucketTemplateShifts({ ...BASE, shifts: [shift({ id: 's1' })] });
    expect(result.moving).toEqual(['s1']);
  });

  it('buckets a past shift as past even when it matches', () => {
    const result = bucketTemplateShifts({
      ...BASE,
      shifts: [shift({ id: 's1', start_time: '2026-02-10T15:00:00Z', end_time: '2026-02-10T23:00:00Z' })],
    });
    expect(result.past).toEqual(['s1']);
    expect(result.moving).toEqual([]);
  });

  it('reports a locked PAST shift as past, not locked', () => {
    const result = bucketTemplateShifts({
      ...BASE,
      shifts: [shift({
        id: 's1',
        locked: true,
        start_time: '2026-02-10T15:00:00Z',
        end_time: '2026-02-10T23:00:00Z',
      })],
    });
    expect(result.past).toEqual(['s1']);
    expect(result.locked).toEqual([]);
  });

  it('buckets a locked future shift as locked', () => {
    const result = bucketTemplateShifts({ ...BASE, shifts: [shift({ id: 's1', locked: true })] });
    expect(result.locked).toEqual(['s1']);
    expect(result.moving).toEqual([]);
  });

  it('buckets a hand-edited future shift as drifted', () => {
    const result = bucketTemplateShifts({
      ...BASE,
      shifts: [shift({ id: 's1', start_time: '2026-03-10T16:00:00Z', end_time: '2026-03-11T00:00:00Z' })],
    });
    expect(result.moving).toEqual([]);
    expect(result.drifted).toHaveLength(1);
  });

  it('gives every drift row a shiftId and a restaurant-local date and times', () => {
    const result = bucketTemplateShifts({
      ...BASE,
      shifts: [shift({ id: 's1', start_time: '2026-03-10T16:00:00Z', end_time: '2026-03-11T00:00:00Z' })],
    });
    expect(result.drifted[0]).toEqual({
      shiftId: 's1',
      employeeName: 'Casey',
      localDate: '2026-03-10',
      currentStart: '11:00',
      currentEnd: '19:00',
      hoursDelta: 0, // 11:00-19:00 (8h) -> 10:00-18:00 (8h)
    });
  });

  it('flags published shifts that are actually moving', () => {
    const result = bucketTemplateShifts({
      ...BASE,
      shifts: [shift({ id: 's1', is_published: true }), shift({ id: 's2' })],
    });
    expect(result.publishedMovingIds).toEqual(['s1']);
  });

  it('does not flag a published shift that is locked', () => {
    const result = bucketTemplateShifts({
      ...BASE,
      shifts: [shift({ id: 's1', is_published: true, locked: true })],
    });
    expect(result.publishedMovingIds).toEqual([]);
  });

  it('compares in the restaurant timezone, not UTC', () => {
    // 00:00Z on 2026-03-11 is 09:00 Asia/Tokyo — a perfect match for the
    // template. Comparing the raw UTC time-of-day would call it drifted.
    const result = bucketTemplateShifts({
      ...BASE,
      tz: 'Asia/Tokyo',
      shifts: [shift({ id: 's1', start_time: '2026-03-11T00:00:00Z', end_time: '2026-03-11T08:00:00Z' })],
    });
    expect(result.moving).toEqual(['s1']);
    expect(result.drifted).toEqual([]);
  });

  it('still matches a shift whose local date crosses a spring-forward boundary', () => {
    // 2026-03-08 is the US spring-forward date. 09:00 local that day is 14:00Z
    // (CDT already in effect at 09:00), and the shift must still read as 09:00.
    const result = bucketTemplateShifts({
      ...BASE,
      now: new Date('2026-03-01T12:00:00Z'),
      shifts: [shift({ id: 's1', start_time: '2026-03-08T14:00:00Z', end_time: '2026-03-08T22:00:00Z' })],
    });
    expect(result.moving).toEqual(['s1']);
  });

  it('matches a midnight-crossing shift against a midnight-crossing template', () => {
    const result = bucketTemplateShifts({
      oldStart: '22:00',
      oldEnd: '02:00',
      newStart: '23:00',
      newEnd: '03:00',
      tz: TZ,
      now: NOW,
      shifts: [shift({ id: 's1', start_time: '2026-03-11T03:00:00Z', end_time: '2026-03-11T07:00:00Z' })],
    });
    expect(result.moving).toEqual(['s1']);
  });

  it('computes the signed scheduled-hours delta across the moving set', () => {
    const result = bucketTemplateShifts({
      ...BASE,
      newStart: '10:00',
      newEnd: '19:00', // 9h vs the old 8h
      shifts: [shift({ id: 's1' }), shift({ id: 's2' })],
    });
    expect(result.movingHoursDelta).toBe(2);
  });

  it('reports a zero delta for a shift that moves later without changing length', () => {
    const result = bucketTemplateShifts({ ...BASE, shifts: [shift({ id: 's1' })] });
    expect(result.movingHoursDelta).toBe(0);
  });

  it('falls back to a null employee name when the join did not resolve', () => {
    const result = bucketTemplateShifts({
      ...BASE,
      shifts: [shift({
        id: 's1',
        employeeName: null,
        start_time: '2026-03-10T16:00:00Z',
        end_time: '2026-03-11T00:00:00Z',
      })],
    });
    expect(result.drifted[0].employeeName).toBeNull();
  });
});
