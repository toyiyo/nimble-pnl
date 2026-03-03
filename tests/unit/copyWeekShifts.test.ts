import { describe, it, expect } from 'vitest';
import { buildCopyPayload } from '@/lib/copyWeekShifts';
import type { Shift } from '@/types/scheduling';

/**
 * Helper to create a local Date and return its ISO string (UTC),
 * matching the format Supabase returns for timestamptz columns.
 */
function localToISO(dateStr: string): string {
  return new Date(dateStr).toISOString();
}

function mockShift(overrides: Partial<Shift>): Shift {
  return {
    id: crypto.randomUUID(),
    restaurant_id: 'r1',
    employee_id: 'e1',
    start_time: localToISO('2026-03-02T10:00:00'),
    end_time: localToISO('2026-03-02T16:00:00'),
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
  // Source week: Mon Mar 2 - Sun Mar 8
  // Target week: Mon Mar 9 - Sun Mar 15 (offset = +7 days)
  const sourceMonday = new Date('2026-03-02T00:00:00');
  const targetMonday = new Date('2026-03-09T00:00:00');
  const restaurantId = 'r1';

  it('should offset shift dates by the week delta', () => {
    const shifts = [
      mockShift({
        start_time: localToISO('2026-03-02T10:00:00'),
        end_time: localToISO('2026-03-02T16:00:00'),
      }),
    ];
    const result = buildCopyPayload(shifts, sourceMonday, targetMonday, restaurantId);
    expect(result).toHaveLength(1);
    // Time-of-day should be preserved (check via local hours)
    const startDate = new Date(result[0].start_time);
    const endDate = new Date(result[0].end_time);
    expect(startDate.getHours()).toBe(10);
    expect(endDate.getHours()).toBe(16);
    // Day should be offset by 7 (Mon Mar 2 → Mon Mar 9)
    expect(startDate.getDate()).toBe(9);
    expect(startDate.getMonth()).toBe(2); // March
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
      [mockShift({
        start_time: localToISO('2026-03-09T10:00:00'),
        end_time: localToISO('2026-03-09T16:00:00'),
      })],
      new Date('2026-03-09T00:00:00'),
      new Date('2026-03-02T00:00:00'),
      restaurantId,
    );
    const startDate = new Date(result[0].start_time);
    expect(startDate.getDate()).toBe(2);
    expect(startDate.getMonth()).toBe(2); // March
  });

  it('should handle overnight shifts (end_time next day)', () => {
    const shifts = [mockShift({
      start_time: localToISO('2026-03-02T22:00:00'),
      end_time: localToISO('2026-03-03T06:00:00'),
    })];
    const result = buildCopyPayload(shifts, sourceMonday, targetMonday, restaurantId);
    const startDate = new Date(result[0].start_time);
    const endDate = new Date(result[0].end_time);
    expect(startDate.getHours()).toBe(22);
    expect(endDate.getHours()).toBe(6);
    // Start on target Monday (9th), end on target Tuesday (10th)
    expect(startDate.getDate()).toBe(9);
    expect(endDate.getDate()).toBe(10);
  });

  it('should return empty array for empty input', () => {
    const result = buildCopyPayload([], sourceMonday, targetMonday, restaurantId);
    expect(result).toEqual([]);
  });

  it('should handle multi-week offset (2 weeks forward)', () => {
    const twoWeeksLater = new Date('2026-03-16T00:00:00');
    const shifts = [mockShift({
      start_time: localToISO('2026-03-04T10:00:00'),
      end_time: localToISO('2026-03-04T16:00:00'),
    })];
    const result = buildCopyPayload(shifts, sourceMonday, twoWeeksLater, restaurantId);
    // Wed Mar 4 + 14 days = Wed Mar 18
    const startDate = new Date(result[0].start_time);
    expect(startDate.getDate()).toBe(18);
    expect(startDate.getMonth()).toBe(2); // March
  });

  it('should produce ISO strings (matching codebase convention)', () => {
    const shifts = [mockShift()];
    const result = buildCopyPayload(shifts, sourceMonday, targetMonday, restaurantId);
    // Output should be a valid ISO string ending with Z (UTC)
    expect(result[0].start_time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(result[0].end_time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});
