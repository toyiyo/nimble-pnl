import { describe, it, expect } from 'vitest';
import { validateShift } from '@/lib/shiftValidator';
import { ShiftInterval } from '@/lib/shiftInterval';
import type { Shift } from '@/types/scheduling';

function mockShift(
  overrides: Partial<Shift> & {
    start_time: string;
    end_time: string;
    employee_id: string;
  },
): Shift {
  return {
    id: crypto.randomUUID(),
    restaurant_id: 'r1',
    break_duration: 0,
    position: 'Server',
    status: 'scheduled',
    is_published: false,
    locked: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  } as Shift;
}

describe('ShiftValidator', () => {
  describe('duration validation', () => {
    it('should pass for valid shift duration', () => {
      const interval = ShiftInterval.create('2026-02-28', '10:00', '16:00');
      const result = validateShift({ employeeId: 'e1', interval }, []);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('overlap detection', () => {
    it('should error when proposed shift overlaps existing shift for same employee', () => {
      const existing = mockShift({
        employee_id: 'e1',
        start_time: '2026-02-28T10:00:00',
        end_time: '2026-02-28T16:00:00',
      });
      const proposed = ShiftInterval.create('2026-02-28', '14:00', '20:00');
      const result = validateShift(
        { employeeId: 'e1', interval: proposed },
        [existing],
      );
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: 'OVERLAP' }),
      );
    });

    it('should not error when proposed shift overlaps shift for different employee', () => {
      const existing = mockShift({
        employee_id: 'e2',
        start_time: '2026-02-28T10:00:00',
        end_time: '2026-02-28T16:00:00',
      });
      const proposed = ShiftInterval.create('2026-02-28', '14:00', '20:00');
      const result = validateShift(
        { employeeId: 'e1', interval: proposed },
        [existing],
      );
      expect(result.valid).toBe(true);
    });

    it('should not error for adjacent (non-overlapping) shifts', () => {
      const existing = mockShift({
        employee_id: 'e1',
        start_time: '2026-02-28T10:00:00',
        end_time: '2026-02-28T16:00:00',
      });
      const proposed = ShiftInterval.create('2026-02-28', '16:00', '22:00');
      const result = validateShift(
        { employeeId: 'e1', interval: proposed },
        [existing],
      );
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should skip cancelled shifts in overlap check', () => {
      const existing = mockShift({
        employee_id: 'e1',
        start_time: '2026-02-28T10:00:00',
        end_time: '2026-02-28T16:00:00',
        status: 'cancelled',
      });
      const proposed = ShiftInterval.create('2026-02-28', '14:00', '20:00');
      const result = validateShift(
        { employeeId: 'e1', interval: proposed },
        [existing],
      );
      expect(result.valid).toBe(true);
    });

    it('should allow excluding a specific shift ID (for edits)', () => {
      const existing = mockShift({
        id: 'shift-being-edited',
        employee_id: 'e1',
        start_time: '2026-02-28T10:00:00',
        end_time: '2026-02-28T16:00:00',
      });
      const proposed = ShiftInterval.create('2026-02-28', '11:00', '17:00');
      const result = validateShift(
        { employeeId: 'e1', interval: proposed },
        [existing],
        { excludeShiftId: 'shift-being-edited' },
      );
      expect(result.valid).toBe(true);
    });
  });

  describe('clopen guard (rest hours)', () => {
    it('should warn when less than 8 hours rest between shifts', () => {
      const closingShift = mockShift({
        employee_id: 'e1',
        start_time: '2026-02-28T18:00:00',
        end_time: '2026-03-01T02:00:00',
      });
      const opening = ShiftInterval.create('2026-03-01', '08:00', '14:00');
      const result = validateShift(
        { employeeId: 'e1', interval: opening },
        [closingShift],
      );
      expect(result.valid).toBe(true);
      expect(result.warnings).toContainEqual(
        expect.objectContaining({ code: 'CLOPEN' }),
      );
    });

    it('should not warn when 8+ hours rest between shifts', () => {
      const closingShift = mockShift({
        employee_id: 'e1',
        start_time: '2026-02-28T18:00:00',
        end_time: '2026-03-01T02:00:00',
      });
      const opening = ShiftInterval.create('2026-03-01', '10:00', '16:00');
      const result = validateShift(
        { employeeId: 'e1', interval: opening },
        [closingShift],
      );
      expect(result.warnings.filter((w) => w.code === 'CLOPEN')).toHaveLength(
        0,
      );
    });
  });

  describe('time-off conflict', () => {
    it('should error when shift falls during approved time-off', () => {
      const proposed = ShiftInterval.create('2026-02-28', '10:00', '16:00');
      const result = validateShift(
        { employeeId: 'e1', interval: proposed },
        [],
        {
          timeOffRequests: [
            {
              id: 'to1',
              restaurant_id: 'r1',
              employee_id: 'e1',
              start_date: '2026-02-28',
              end_date: '2026-02-28',
              status: 'approved',
              reason: 'vacation',
              requested_at: new Date().toISOString(),
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ],
        },
      );
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: 'TIME_OFF' }),
      );
    });

    it('should error when shift falls during pending time-off', () => {
      const proposed = ShiftInterval.create('2026-02-28', '10:00', '16:00');
      const result = validateShift(
        { employeeId: 'e1', interval: proposed },
        [],
        {
          timeOffRequests: [
            {
              id: 'to2',
              restaurant_id: 'r1',
              employee_id: 'e1',
              start_date: '2026-02-28',
              end_date: '2026-02-28',
              status: 'pending',
              reason: 'personal',
              requested_at: new Date().toISOString(),
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ],
        },
      );
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: 'TIME_OFF' }),
      );
    });

    it('should not error for rejected time-off requests', () => {
      const proposed = ShiftInterval.create('2026-02-28', '10:00', '16:00');
      const result = validateShift(
        { employeeId: 'e1', interval: proposed },
        [],
        {
          timeOffRequests: [
            {
              id: 'to1',
              restaurant_id: 'r1',
              employee_id: 'e1',
              start_date: '2026-02-28',
              end_date: '2026-02-28',
              status: 'rejected',
              reason: 'vacation',
              requested_at: new Date().toISOString(),
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ],
        },
      );
      expect(result.valid).toBe(true);
    });

    it('should not error for time-off belonging to a different employee', () => {
      const proposed = ShiftInterval.create('2026-02-28', '10:00', '16:00');
      const result = validateShift(
        { employeeId: 'e1', interval: proposed },
        [],
        {
          timeOffRequests: [
            {
              id: 'to3',
              restaurant_id: 'r1',
              employee_id: 'e2',
              start_date: '2026-02-28',
              end_date: '2026-02-28',
              status: 'approved',
              reason: 'vacation',
              requested_at: new Date().toISOString(),
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ],
        },
      );
      expect(result.valid).toBe(true);
    });
  });

  describe('combined validations', () => {
    it('should return both errors and warnings together', () => {
      const overlapping = mockShift({
        employee_id: 'e1',
        start_time: '2026-02-28T14:00:00',
        end_time: '2026-02-28T20:00:00',
      });
      const previousLateShift = mockShift({
        employee_id: 'e1',
        start_time: '2026-02-27T18:00:00',
        end_time: '2026-02-28T02:00:00',
      });
      const proposed = ShiftInterval.create('2026-02-28', '08:00', '16:00');
      const result = validateShift(
        { employeeId: 'e1', interval: proposed },
        [overlapping, previousLateShift],
      );
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(1);
      expect(result.warnings.length).toBeGreaterThanOrEqual(1);
    });
  });
});
