import { describe, it, expect } from 'vitest';
import { validateShift } from '@/lib/shiftValidator';
import { ShiftInterval } from '@/lib/shiftInterval';
import type { Shift, TimeOffRequest } from '@/types/scheduling';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

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
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  } as Shift;
}

function mockTimeOff(
  overrides: Partial<TimeOffRequest> & {
    employee_id: string;
    start_date: string;
    end_date: string;
    status: TimeOffRequest['status'];
  },
): TimeOffRequest {
  return {
    id: crypto.randomUUID(),
    restaurant_id: 'r1',
    reason: 'vacation',
    requested_at: '2026-01-01T00:00:00Z',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  } as TimeOffRequest;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('validateShift', () => {
  // 1. No overlap — proposed shift doesn't conflict
  describe('no overlap', () => {
    it('returns valid with no errors or warnings when there are no conflicts', () => {
      // 8+ hour gap: proposed ends 12:00, existing starts 22:00 — 10h rest
      const proposed = ShiftInterval.create('2026-03-10', '06:00', '12:00');
      const existing = mockShift({
        employee_id: 'e1',
        start_time: '2026-03-10T22:00:00',
        end_time: '2026-03-11T04:00:00',
      });

      const result = validateShift(
        { employeeId: 'e1', interval: proposed },
        [existing],
      );

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });
  });

  // 2. Overlap — overlapping shifts produce OVERLAP error
  describe('overlap detection', () => {
    it('returns OVERLAP error when proposed shift overlaps an existing shift', () => {
      const proposed = ShiftInterval.create('2026-03-10', '12:00', '18:00');
      const existing = mockShift({
        employee_id: 'e1',
        start_time: '2026-03-10T10:00:00',
        end_time: '2026-03-10T14:00:00',
      });

      const result = validateShift(
        { employeeId: 'e1', interval: proposed },
        [existing],
      );

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: 'OVERLAP' }),
      );
    });
  });

  // 3. Clopen warning — shifts less than 8h apart
  describe('clopen warning', () => {
    it('warns when rest gap between shifts is less than 8 hours', () => {
      // Closing shift ends at 02:00 on March 11; opening starts at 08:00 — 6h gap
      const closingShift = mockShift({
        employee_id: 'e1',
        start_time: '2026-03-10T18:00:00',
        end_time: '2026-03-11T02:00:00',
      });
      const opening = ShiftInterval.create('2026-03-11', '08:00', '14:00');

      const result = validateShift(
        { employeeId: 'e1', interval: opening },
        [closingShift],
      );

      expect(result.valid).toBe(true);
      expect(result.warnings).toContainEqual(
        expect.objectContaining({ code: 'CLOPEN' }),
      );
      // Verify the message contains the gap amount
      const clopenWarning = result.warnings.find((w) => w.code === 'CLOPEN');
      expect(clopenWarning?.message).toContain('6.0');
      expect(clopenWarning?.message).toContain('minimum 8h');
    });
  });

  // 4. No clopen warning — shifts 8+ hours apart
  describe('no clopen warning when rest is sufficient', () => {
    it('does not warn when rest gap is 8 or more hours', () => {
      // Closing shift ends at 02:00 on March 11; opening starts at 10:00 — exactly 8h
      const closingShift = mockShift({
        employee_id: 'e1',
        start_time: '2026-03-10T18:00:00',
        end_time: '2026-03-11T02:00:00',
      });
      const opening = ShiftInterval.create('2026-03-11', '10:00', '16:00');

      const result = validateShift(
        { employeeId: 'e1', interval: opening },
        [closingShift],
      );

      expect(result.warnings.filter((w) => w.code === 'CLOPEN')).toHaveLength(0);
    });

    it('does not warn when rest gap is well above 8 hours', () => {
      const morningShift = mockShift({
        employee_id: 'e1',
        start_time: '2026-03-10T08:00:00',
        end_time: '2026-03-10T14:00:00',
      });
      // Next shift is the following day — 18h gap
      const nextDay = ShiftInterval.create('2026-03-11', '08:00', '14:00');

      const result = validateShift(
        { employeeId: 'e1', interval: nextDay },
        [morningShift],
      );

      expect(result.warnings).toHaveLength(0);
    });
  });

  // 5. Exclude shift by ID — updating a shift shouldn't conflict with itself
  describe('excludeShiftId option', () => {
    it('does not conflict with the shift being edited when excludeShiftId is set', () => {
      const shiftId = 'shift-being-edited';
      const existing = mockShift({
        id: shiftId,
        employee_id: 'e1',
        start_time: '2026-03-10T10:00:00',
        end_time: '2026-03-10T16:00:00',
      });
      // Proposed interval overlaps the existing shift (same time slot, slight adjustment)
      const proposed = ShiftInterval.create('2026-03-10', '11:00', '17:00');

      const result = validateShift(
        { employeeId: 'e1', interval: proposed },
        [existing],
        { excludeShiftId: shiftId },
      );

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('still detects overlap with other shifts when excludeShiftId is set', () => {
      const editedShift = mockShift({
        id: 'shift-being-edited',
        employee_id: 'e1',
        start_time: '2026-03-10T10:00:00',
        end_time: '2026-03-10T16:00:00',
      });
      const otherShift = mockShift({
        id: 'other-shift',
        employee_id: 'e1',
        start_time: '2026-03-10T15:00:00',
        end_time: '2026-03-10T21:00:00',
      });
      const proposed = ShiftInterval.create('2026-03-10', '14:00', '20:00');

      const result = validateShift(
        { employeeId: 'e1', interval: proposed },
        [editedShift, otherShift],
        { excludeShiftId: 'shift-being-edited' },
      );

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: 'OVERLAP' }),
      );
    });
  });

  // 6. Cancelled shifts ignored
  describe('cancelled shifts', () => {
    it('ignores cancelled shifts when checking for overlaps', () => {
      const cancelledShift = mockShift({
        employee_id: 'e1',
        start_time: '2026-03-10T10:00:00',
        end_time: '2026-03-10T16:00:00',
        status: 'cancelled',
      });
      // Proposed directly overlaps the cancelled shift
      const proposed = ShiftInterval.create('2026-03-10', '12:00', '18:00');

      const result = validateShift(
        { employeeId: 'e1', interval: proposed },
        [cancelledShift],
      );

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('still detects overlap with non-cancelled shifts among mixed statuses', () => {
      const cancelledShift = mockShift({
        employee_id: 'e1',
        start_time: '2026-03-10T10:00:00',
        end_time: '2026-03-10T16:00:00',
        status: 'cancelled',
      });
      const confirmedShift = mockShift({
        employee_id: 'e1',
        start_time: '2026-03-10T14:00:00',
        end_time: '2026-03-10T20:00:00',
        status: 'confirmed',
      });
      const proposed = ShiftInterval.create('2026-03-10', '13:00', '19:00');

      const result = validateShift(
        { employeeId: 'e1', interval: proposed },
        [cancelledShift, confirmedShift],
      );

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].code).toBe('OVERLAP');
    });
  });

  // 7. Different employees — shifts from different employees don't conflict
  describe('different employees', () => {
    it('does not flag overlap when shifts belong to different employees', () => {
      const otherEmployeeShift = mockShift({
        employee_id: 'e2',
        start_time: '2026-03-10T10:00:00',
        end_time: '2026-03-10T16:00:00',
      });
      const proposed = ShiftInterval.create('2026-03-10', '12:00', '18:00');

      const result = validateShift(
        { employeeId: 'e1', interval: proposed },
        [otherEmployeeShift],
      );

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });
  });

  // 8. Time-off conflict — approved time-off blocks shift
  describe('time-off conflict (approved)', () => {
    it('returns TIME_OFF error when shift falls during approved time-off', () => {
      const proposed = ShiftInterval.create('2026-03-15', '09:00', '17:00');
      const timeOff = mockTimeOff({
        employee_id: 'e1',
        start_date: '2026-03-14',
        end_date: '2026-03-16',
        status: 'approved',
      });

      const result = validateShift(
        { employeeId: 'e1', interval: proposed },
        [],
        { timeOffRequests: [timeOff] },
      );

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: 'TIME_OFF' }),
      );
      const timeOffError = result.errors.find((e) => e.code === 'TIME_OFF');
      expect(timeOffError?.message).toContain('approved');
      expect(timeOffError?.message).toContain('2026-03-14');
      expect(timeOffError?.message).toContain('2026-03-16');
    });

    it('returns TIME_OFF error when shift is on a single-day approved time-off', () => {
      const proposed = ShiftInterval.create('2026-03-15', '10:00', '16:00');
      const timeOff = mockTimeOff({
        employee_id: 'e1',
        start_date: '2026-03-15',
        end_date: '2026-03-15',
        status: 'approved',
      });

      const result = validateShift(
        { employeeId: 'e1', interval: proposed },
        [],
        { timeOffRequests: [timeOff] },
      );

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: 'TIME_OFF' }),
      );
    });
  });

  // 9. Pending time-off conflict
  describe('time-off conflict (pending)', () => {
    it('returns TIME_OFF error when shift falls during pending time-off', () => {
      const proposed = ShiftInterval.create('2026-03-15', '09:00', '17:00');
      const timeOff = mockTimeOff({
        employee_id: 'e1',
        start_date: '2026-03-15',
        end_date: '2026-03-15',
        status: 'pending',
      });

      const result = validateShift(
        { employeeId: 'e1', interval: proposed },
        [],
        { timeOffRequests: [timeOff] },
      );

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: 'TIME_OFF' }),
      );
      const timeOffError = result.errors.find((e) => e.code === 'TIME_OFF');
      expect(timeOffError?.message).toContain('pending');
    });
  });

  // 10. Rejected time-off — does not block
  describe('rejected time-off', () => {
    it('does not return TIME_OFF error for rejected time-off requests', () => {
      const proposed = ShiftInterval.create('2026-03-15', '09:00', '17:00');
      const timeOff = mockTimeOff({
        employee_id: 'e1',
        start_date: '2026-03-15',
        end_date: '2026-03-15',
        status: 'rejected',
      });

      const result = validateShift(
        { employeeId: 'e1', interval: proposed },
        [],
        { timeOffRequests: [timeOff] },
      );

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('does not block when time-off belongs to a different employee', () => {
      const proposed = ShiftInterval.create('2026-03-15', '09:00', '17:00');
      const timeOff = mockTimeOff({
        employee_id: 'e2',
        start_date: '2026-03-15',
        end_date: '2026-03-15',
        status: 'approved',
      });

      const result = validateShift(
        { employeeId: 'e1', interval: proposed },
        [],
        { timeOffRequests: [timeOff] },
      );

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  // 11. Multiple overlaps — multiple errors returned
  describe('multiple overlaps', () => {
    it('returns multiple OVERLAP errors when proposed conflicts with several existing shifts', () => {
      const shift1 = mockShift({
        employee_id: 'e1',
        start_time: '2026-03-10T09:00:00',
        end_time: '2026-03-10T13:00:00',
      });
      const shift2 = mockShift({
        employee_id: 'e1',
        start_time: '2026-03-10T14:00:00',
        end_time: '2026-03-10T18:00:00',
      });
      // Proposed spans 10:00-17:00, overlapping both shifts
      const proposed = ShiftInterval.create('2026-03-10', '10:00', '17:00');

      const result = validateShift(
        { employeeId: 'e1', interval: proposed },
        [shift1, shift2],
      );

      expect(result.valid).toBe(false);
      const overlapErrors = result.errors.filter((e) => e.code === 'OVERLAP');
      expect(overlapErrors).toHaveLength(2);
    });

    it('returns both OVERLAP and TIME_OFF errors simultaneously', () => {
      const overlappingShift = mockShift({
        employee_id: 'e1',
        start_time: '2026-03-15T10:00:00',
        end_time: '2026-03-15T16:00:00',
      });
      const timeOff = mockTimeOff({
        employee_id: 'e1',
        start_date: '2026-03-15',
        end_date: '2026-03-15',
        status: 'approved',
      });
      const proposed = ShiftInterval.create('2026-03-15', '12:00', '18:00');

      const result = validateShift(
        { employeeId: 'e1', interval: proposed },
        [overlappingShift],
        { timeOffRequests: [timeOff] },
      );

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === 'OVERLAP')).toBe(true);
      expect(result.errors.some((e) => e.code === 'TIME_OFF')).toBe(true);
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
    });
  });

  // 12. Empty existing shifts — always valid
  describe('empty existing shifts', () => {
    it('returns valid when there are no existing shifts', () => {
      const proposed = ShiftInterval.create('2026-03-10', '09:00', '17:00');

      const result = validateShift(
        { employeeId: 'e1', interval: proposed },
        [],
      );

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('returns valid with no options provided', () => {
      const proposed = ShiftInterval.create('2026-03-10', '09:00', '17:00');

      const result = validateShift(
        { employeeId: 'e1', interval: proposed },
        [],
        undefined,
      );

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------

  describe('edge cases', () => {
    it('handles adjacent shifts (end equals start) without overlap or clopen warning', () => {
      // Shift ends at 16:00, proposed starts at 16:00 — gap is 0, which is not < 8
      // restHoursUntil returns 0 for abutting, and checkRestGap skips when gap <= 0
      const existing = mockShift({
        employee_id: 'e1',
        start_time: '2026-03-10T10:00:00',
        end_time: '2026-03-10T16:00:00',
      });
      const proposed = ShiftInterval.create('2026-03-10', '16:00', '22:00');

      const result = validateShift(
        { employeeId: 'e1', interval: proposed },
        [existing],
      );

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('detects clopen warning in both directions (proposed before existing)', () => {
      // Proposed ends at 14:00, existing starts at 19:00 — 5h gap
      const existing = mockShift({
        employee_id: 'e1',
        start_time: '2026-03-10T19:00:00',
        end_time: '2026-03-11T01:00:00',
      });
      const proposed = ShiftInterval.create('2026-03-10', '08:00', '14:00');

      const result = validateShift(
        { employeeId: 'e1', interval: proposed },
        [existing],
      );

      expect(result.valid).toBe(true);
      const clopenWarnings = result.warnings.filter((w) => w.code === 'CLOPEN');
      expect(clopenWarnings.length).toBeGreaterThanOrEqual(1);
      // Should mention "before next shift"
      expect(clopenWarnings.some((w) => w.message.includes('before next shift'))).toBe(true);
    });

    it('handles midnight-crossing shifts correctly for overlap', () => {
      // Existing shift: 22:00 to 06:00 next day
      const existing = mockShift({
        employee_id: 'e1',
        start_time: '2026-03-10T22:00:00',
        end_time: '2026-03-11T06:00:00',
      });
      // Proposed shift: 04:00 to 10:00 on March 11 — overlaps the tail end
      const proposed = ShiftInterval.create('2026-03-11', '04:00', '10:00');

      const result = validateShift(
        { employeeId: 'e1', interval: proposed },
        [existing],
      );

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: 'OVERLAP' }),
      );
    });

    it('does not flag overlap when time-off requests are not provided in options', () => {
      const proposed = ShiftInterval.create('2026-03-15', '09:00', '17:00');

      const result = validateShift(
        { employeeId: 'e1', interval: proposed },
        [],
        { excludeShiftId: 'some-id' }, // options present but no timeOffRequests
      );

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('handles completed shift status (non-cancelled) as a valid conflict source', () => {
      const completedShift = mockShift({
        employee_id: 'e1',
        start_time: '2026-03-10T10:00:00',
        end_time: '2026-03-10T16:00:00',
        status: 'completed',
      });
      const proposed = ShiftInterval.create('2026-03-10', '12:00', '18:00');

      const result = validateShift(
        { employeeId: 'e1', interval: proposed },
        [completedShift],
      );

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: 'OVERLAP' }),
      );
    });
  });
});
