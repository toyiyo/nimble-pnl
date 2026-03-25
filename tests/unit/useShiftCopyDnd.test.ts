import { describe, it, expect } from 'vitest';
import { extractLocalTime, buildCopyPayload, shouldAllowDrop } from '@/components/scheduling/useShiftCopyDnd';

describe('extractLocalTime', () => {
  it('extracts HH:MM from a Date in local timezone', () => {
    const date = new Date(2026, 2, 24, 9, 30, 0);
    expect(extractLocalTime(date)).toBe('09:30');
  });
  it('handles midnight correctly', () => {
    const date = new Date(2026, 2, 24, 0, 0, 0);
    expect(extractLocalTime(date)).toBe('00:00');
  });
  it('handles PM times', () => {
    const date = new Date(2026, 2, 24, 22, 15, 0);
    expect(extractLocalTime(date)).toBe('22:15');
  });
});

describe('shouldAllowDrop', () => {
  it('returns false when dropping on the same day', () => {
    expect(shouldAllowDrop({ sourceEmployeeId: 'emp-1', sourceDay: '2026-03-24', targetEmployeeId: 'emp-1', targetDay: '2026-03-24' })).toBe(false);
  });
  it('returns false when dropping on a different employee', () => {
    expect(shouldAllowDrop({ sourceEmployeeId: 'emp-1', sourceDay: '2026-03-24', targetEmployeeId: 'emp-2', targetDay: '2026-03-25' })).toBe(false);
  });
  it('returns true for same employee, different day', () => {
    expect(shouldAllowDrop({ sourceEmployeeId: 'emp-1', sourceDay: '2026-03-24', targetEmployeeId: 'emp-1', targetDay: '2026-03-25' })).toBe(true);
  });
});

describe('buildCopyPayload', () => {
  const baseShift = {
    id: 'shift-1',
    restaurant_id: 'rest-1',
    employee_id: 'emp-1',
    start_time: new Date(2026, 2, 24, 9, 0, 0).toISOString(),
    end_time: new Date(2026, 2, 24, 17, 0, 0).toISOString(),
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

  it('builds payload with correct target date and local times', () => {
    const payload = buildCopyPayload(baseShift, '2026-03-26');
    expect(payload.employee_id).toBe('emp-1');
    expect(payload.restaurant_id).toBe('rest-1');
    expect(payload.position).toBe('Server');
    expect(payload.break_duration).toBe(30);
    expect(payload.notes).toBe('Morning shift');
    const start = new Date(payload.start_time);
    expect(start.getHours()).toBe(9);
    expect(start.getMinutes()).toBe(0);
    expect(start.getDate()).toBe(26);
  });

  it('strips recurrence fields — always creates a one-off', () => {
    const payload = buildCopyPayload(baseShift, '2026-03-26');
    expect(payload.is_recurring).toBe(false);
    expect(payload.recurrence_pattern).toBeNull();
    expect(payload.recurrence_parent_id).toBeNull();
  });

  it('sets status to scheduled and locked to false', () => {
    const payload = buildCopyPayload({ ...baseShift, status: 'confirmed', locked: true }, '2026-03-26');
    expect(payload.status).toBe('scheduled');
    expect(payload.locked).toBe(false);
    expect(payload.is_published).toBe(false);
  });

  it('handles overnight shifts (end time next day)', () => {
    const overnight = {
      ...baseShift,
      start_time: new Date(2026, 2, 24, 22, 0, 0).toISOString(),
      end_time: new Date(2026, 2, 25, 2, 0, 0).toISOString(),
    };
    const payload = buildCopyPayload(overnight, '2026-03-28');
    const start = new Date(payload.start_time);
    const end = new Date(payload.end_time);
    expect(start.getHours()).toBe(22);
    expect(start.getDate()).toBe(28);
    expect(end.getHours()).toBe(2);
    expect(end.getDate()).toBe(29);
  });
});
