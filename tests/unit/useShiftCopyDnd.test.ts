import { describe, it, expect } from 'vitest';
import { buildCopyPayload, shouldAllowDrop } from '@/components/scheduling/useShiftCopyDnd';

describe('shouldAllowDrop', () => {
  it('returns false when dropping on the same day', () => {
    expect(shouldAllowDrop({ sourceEmployeeId: 'emp-1', sourceDay: '2026-03-24', targetEmployeeId: 'emp-1', targetDay: '2026-03-24' })).toBe(false);
  });
  it('returns true when dropping on a different employee, different day', () => {
    expect(shouldAllowDrop({ sourceEmployeeId: 'emp-1', sourceDay: '2026-03-24', targetEmployeeId: 'emp-2', targetDay: '2026-03-25' })).toBe(true);
  });
  it('returns true when dropping on a different employee, same day', () => {
    expect(shouldAllowDrop({ sourceEmployeeId: 'emp-1', sourceDay: '2026-03-24', targetEmployeeId: 'emp-2', targetDay: '2026-03-24' })).toBe(true);
  });
  it('returns true for same employee, different day', () => {
    expect(shouldAllowDrop({ sourceEmployeeId: 'emp-1', sourceDay: '2026-03-24', targetEmployeeId: 'emp-1', targetDay: '2026-03-25' })).toBe(true);
  });
});

describe('buildCopyPayload', () => {
  const UTC = 'UTC';
  const baseShift = {
    id: 'shift-1',
    restaurant_id: 'rest-1',
    employee_id: 'emp-1',
    start_time: '2026-03-24T09:00:00.000Z',
    end_time: '2026-03-24T17:00:00.000Z',
    break_duration: 30,
    position: 'Server',
    notes: 'Morning shift',
    status: 'scheduled' as const,
    is_recurring: true,
    recurrence_pattern: { type: 'weekly' as const, endType: 'never' as const },
    recurrence_parent_id: 'parent-1',
    is_published: false,
    locked: false,
    created_at: '',
    updated_at: '',
  };

  it('builds payload with correct target date and restaurant-local time', () => {
    const payload = buildCopyPayload(baseShift, '2026-03-26', UTC);
    expect(payload.employee_id).toBe('emp-1');
    expect(payload.restaurant_id).toBe('rest-1');
    expect(payload.position).toBe('Server');
    expect(payload.break_duration).toBe(30);
    expect(payload.notes).toBe('Morning shift');
    expect(payload.start_time).toBe('2026-03-26T09:00:00.000Z');
  });

  it('strips recurrence fields — always creates a one-off', () => {
    const payload = buildCopyPayload(baseShift, '2026-03-26', UTC);
    expect(payload.is_recurring).toBe(false);
    expect(payload.recurrence_pattern).toBeNull();
    expect(payload.recurrence_parent_id).toBeNull();
  });

  it('sets status to scheduled and locked to false', () => {
    const payload = buildCopyPayload({ ...baseShift, status: 'confirmed', locked: true }, '2026-03-26', UTC);
    expect(payload.status).toBe('scheduled');
    expect(payload.locked).toBe(false);
    expect(payload.is_published).toBe(false);
  });

  it('uses target employee ID when provided', () => {
    const payload = buildCopyPayload(baseShift, '2026-03-26', UTC, 'emp-2');
    expect(payload.employee_id).toBe('emp-2');
    expect(payload.position).toBe('Server'); // keeps source position
  });

  it('defaults to source employee when no target employee provided', () => {
    const payload = buildCopyPayload(baseShift, '2026-03-26', UTC);
    expect(payload.employee_id).toBe('emp-1');
  });

  it('handles overnight shifts (end time next day), duration-preserving', () => {
    const overnight = {
      ...baseShift,
      start_time: '2026-03-24T22:00:00.000Z',
      end_time: '2026-03-25T02:00:00.000Z',
    };
    const payload = buildCopyPayload(overnight, '2026-03-28', UTC);
    expect(payload.start_time).toBe('2026-03-28T22:00:00.000Z');
    expect(payload.end_time).toBe('2026-03-29T02:00:00.000Z');
  });

  it('anchors to the restaurant timezone, not the host device — the headline surface-6 defect', () => {
    // Restaurant is America/Chicago; the previous implementation read the
    // HOST's local hour/minute (`srcStart.getHours()`) instead, so under a
    // host TZ other than Chicago the copy would land on the wrong wall-clock
    // hour. 09:00 Chicago (CDT, UTC-5) on 2026-03-24 is 14:00Z.
    const chicagoShift = { ...baseShift, start_time: '2026-03-24T14:00:00.000Z', end_time: '2026-03-24T22:00:00.000Z' };
    const payload = buildCopyPayload(chicagoShift, '2026-03-26', 'America/Chicago');
    // 09:00 CDT on the target day, still 2026-03-26 in Chicago -> 14:00Z.
    expect(payload.start_time).toBe('2026-03-26T14:00:00.000Z');
  });

  it('preserves the restaurant-local wall clock across a DST transition the host does not observe', () => {
    // US Spring Forward: America/Chicago skips 02:00 CST -> 03:00 CDT on 2026-03-08.
    // A 09:00 CST (UTC-6) shift on Mon Mar 2, copied to Sun Mar 8 (already CDT,
    // UTC-5), must still read 09:00 restaurant-local — a different UTC instant,
    // not a naive same-ms-offset copy.
    const chicagoTz = 'America/Chicago';
    const shift = { ...baseShift, start_time: '2026-03-02T15:00:00.000Z', end_time: '2026-03-02T19:00:00.000Z' }; // 09:00-13:00 CST
    const payload = buildCopyPayload(shift, '2026-03-08', chicagoTz);
    expect(payload.start_time).toBe('2026-03-08T14:00:00.000Z'); // 09:00 CDT
    expect(payload.end_time).toBe('2026-03-08T18:00:00.000Z'); // 13:00 CDT
  });

  it('throws on an invalid/empty timezone rather than silently falling back', () => {
    expect(() => buildCopyPayload(baseShift, '2026-03-26', '')).toThrow();
    expect(() => buildCopyPayload(baseShift, '2026-03-26', 'Not/AZone')).toThrow();
  });
});
