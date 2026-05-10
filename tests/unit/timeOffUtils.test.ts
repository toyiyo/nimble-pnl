import { describe, it, expect } from 'vitest';
import { partitionByStatus, daysSince } from '../../src/lib/timeOffUtils';
import type { TimeOffRequest } from '../../src/types/scheduling';

const make = (overrides: Partial<TimeOffRequest>): TimeOffRequest => ({
  id: 'r1',
  restaurant_id: 'rest-1',
  employee_id: 'e1',
  start_date: '2026-05-01',
  end_date: '2026-05-01',
  status: 'pending',
  requested_at: '2026-05-01T00:00:00Z',
  created_at: '2026-05-01T00:00:00Z',
  updated_at: '2026-05-01T00:00:00Z',
  ...overrides,
});

describe('partitionByStatus', () => {
  it('splits requests into pending and decided buckets', () => {
    const requests = [
      make({ id: 'a', status: 'pending', created_at: '2026-05-01T00:00:00Z' }),
      make({ id: 'b', status: 'approved', start_date: '2026-05-10' }),
      make({ id: 'c', status: 'rejected', start_date: '2026-05-11' }),
      make({ id: 'd', status: 'pending', created_at: '2026-04-25T00:00:00Z' }),
    ];
    const { pending, decided } = partitionByStatus(requests);
    expect(pending.map((r) => r.id)).toEqual(['d', 'a']); // oldest pending first
    expect(decided.map((r) => r.id)).toEqual(['c', 'b']); // start_date desc
  });

  it('returns empty arrays for empty input', () => {
    expect(partitionByStatus([])).toEqual({ pending: [], decided: [] });
  });

  it('puts unknown statuses into decided to avoid silent loss', () => {
    const requests = [make({ id: 'x', status: 'weird' as 'approved' })];
    expect(partitionByStatus(requests).decided.map((r) => r.id)).toEqual(['x']);
    expect(partitionByStatus(requests).pending).toEqual([]);
  });
});

describe('daysSince', () => {
  it('returns 0 for the same day', () => {
    const now = new Date('2026-05-10T12:00:00Z');
    expect(daysSince('2026-05-10T08:00:00Z', now)).toBe(0);
  });

  it('counts calendar days regardless of time-of-day', () => {
    const now = new Date('2026-05-10T12:00:00Z');
    // 48h apart and crossing two calendar boundaries.
    expect(daysSince('2026-05-08T12:00:00Z', now)).toBe(2);
    // Only 47h apart but still crosses two calendar boundaries (May 8 → May 10).
    expect(daysSince('2026-05-08T13:00:00Z', now)).toBe(2);
    // 1 calendar day delta (May 9 → May 10).
    expect(daysSince('2026-05-09T23:59:00Z', now)).toBe(1);
  });

  it('returns 0 for a future timestamp (defensive, not negative)', () => {
    const now = new Date('2026-05-10T12:00:00Z');
    expect(daysSince('2026-05-12T12:00:00Z', now)).toBe(0);
  });
});
