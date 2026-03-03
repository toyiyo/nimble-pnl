import { describe, it, expect } from 'vitest';
import { buildCopyPayload } from '@/lib/copyWeekShifts';
import type { Shift } from '@/types/scheduling';

function mockShift(overrides: Partial<Shift>): Shift {
  return {
    id: crypto.randomUUID(),
    restaurant_id: 'r1',
    employee_id: 'e1',
    start_time: '2026-03-02T10:00:00',
    end_time: '2026-03-02T16:00:00',
    break_duration: 30,
    position: 'Server',
    notes: undefined,
    status: 'scheduled',
    is_published: false,
    locked: false,
    is_recurring: false,
    recurrence_parent_id: null,
    recurrence_pattern: null,
    published_at: null,
    published_by: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  } as Shift;
}

describe('buildCopyPayload', () => {
  const sourceMonday = new Date('2026-03-02T00:00:00');
  const targetMonday = new Date('2026-03-09T00:00:00');
  const restaurantId = 'r1';

  it('should offset shift dates by the week delta', () => {
    const shifts = [
      mockShift({ start_time: '2026-03-02T10:00:00', end_time: '2026-03-02T16:00:00' }),
    ];
    const result = buildCopyPayload(shifts, sourceMonday, targetMonday, restaurantId);
    expect(result).toHaveLength(1);
    expect(result[0].start_time).toContain('2026-03-09');
    expect(result[0].end_time).toContain('2026-03-09');
    expect(new Date(result[0].start_time).getHours()).toBe(10);
    expect(new Date(result[0].end_time).getHours()).toBe(16);
  });

  it('should preserve employee_id, position, break_duration, notes', () => {
    const shifts = [
      mockShift({ employee_id: 'emp-42', position: 'Bartender', break_duration: 45, notes: 'Training shift' }),
    ];
    const result = buildCopyPayload(shifts, sourceMonday, targetMonday, restaurantId);
    expect(result[0].employee_id).toBe('emp-42');
    expect(result[0].position).toBe('Bartender');
    expect(result[0].break_duration).toBe(45);
    expect(result[0].notes).toBe('Training shift');
  });

  it('should always set status=scheduled, is_published=false, locked=false', () => {
    const shifts = [mockShift({ status: 'confirmed', is_published: true, locked: true })];
    const result = buildCopyPayload(shifts, sourceMonday, targetMonday, restaurantId);
    expect(result[0].status).toBe('scheduled');
    expect(result[0].is_published).toBe(false);
    expect(result[0].locked).toBe(false);
  });

  it('should exclude cancelled shifts', () => {
    const shifts = [mockShift({ status: 'scheduled' }), mockShift({ status: 'cancelled' })];
    const result = buildCopyPayload(shifts, sourceMonday, targetMonday, restaurantId);
    expect(result).toHaveLength(1);
  });

  it('should use the provided restaurantId', () => {
    const shifts = [mockShift({ restaurant_id: 'old-r' })];
    const result = buildCopyPayload(shifts, sourceMonday, targetMonday, 'new-r');
    expect(result[0].restaurant_id).toBe('new-r');
  });

  it('should handle negative offset (copying backward)', () => {
    const result = buildCopyPayload(
      [mockShift({ start_time: '2026-03-09T10:00:00', end_time: '2026-03-09T16:00:00' })],
      new Date('2026-03-09T00:00:00'),
      new Date('2026-03-02T00:00:00'),
      restaurantId,
    );
    expect(result[0].start_time).toContain('2026-03-02');
  });

  it('should handle overnight shifts (end_time next day)', () => {
    const shifts = [mockShift({ start_time: '2026-03-02T22:00:00', end_time: '2026-03-03T06:00:00' })];
    const result = buildCopyPayload(shifts, sourceMonday, targetMonday, restaurantId);
    expect(new Date(result[0].start_time).getHours()).toBe(22);
    expect(new Date(result[0].end_time).getHours()).toBe(6);
    expect(result[0].start_time).toContain('2026-03-09');
    expect(result[0].end_time).toContain('2026-03-10');
  });

  it('should return empty array for empty input', () => {
    const result = buildCopyPayload([], sourceMonday, targetMonday, restaurantId);
    expect(result).toEqual([]);
  });

  it('should handle multi-week offset (2 weeks forward)', () => {
    const twoWeeksLater = new Date('2026-03-16T00:00:00');
    const shifts = [mockShift({ start_time: '2026-03-04T10:00:00', end_time: '2026-03-04T16:00:00' })];
    const result = buildCopyPayload(shifts, sourceMonday, twoWeeksLater, restaurantId);
    expect(result[0].start_time).toContain('2026-03-18');
  });
});
