import { describe, test, expect } from '@playwright/test';
import {
  calculateShiftMinutes,
  shiftsOverlap,
  shiftConflictsWithTimeOff,
  detectShiftConflicts,
  calculateEmployeeMinutes,
  calculateDailyOvertime,
  calculateWeeklyOvertime,
  validateShift,
} from '../../src/utils/shiftValidation';
import { Shift, TimeOffRequest, OvertimeRules } from '../../src/types/scheduling';

describe('Shift Validation Utils', () => {
  describe('calculateShiftMinutes', () => {
    test('should calculate net working minutes correctly', () => {
      const shift: Shift = {
        id: '1',
        restaurant_id: 'r1',
        employee_id: 'e1',
        start_time: '2024-01-15T09:00:00Z',
        end_time: '2024-01-15T17:00:00Z',
        break_duration: 30,
        position: 'Server',
        status: 'scheduled',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };

      const minutes = calculateShiftMinutes(shift);
      expect(minutes).toBe(450); // 8 hours - 30 min break = 450 minutes
    });

    test('should not return negative minutes', () => {
      const shift: Shift = {
        id: '1',
        restaurant_id: 'r1',
        employee_id: 'e1',
        start_time: '2024-01-15T09:00:00Z',
        end_time: '2024-01-15T10:00:00Z',
        break_duration: 90, // longer than shift
        position: 'Server',
        status: 'scheduled',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };

      const minutes = calculateShiftMinutes(shift);
      expect(minutes).toBe(0);
    });
  });

  describe('shiftsOverlap', () => {
    test('should detect overlapping shifts', () => {
      const shift1: Shift = {
        id: '1',
        restaurant_id: 'r1',
        employee_id: 'e1',
        start_time: '2024-01-15T09:00:00Z',
        end_time: '2024-01-15T17:00:00Z',
        break_duration: 30,
        position: 'Server',
        status: 'scheduled',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };

      const shift2: Shift = {
        ...shift1,
        id: '2',
        start_time: '2024-01-15T16:00:00Z',
        end_time: '2024-01-15T20:00:00Z',
      };

      expect(shiftsOverlap(shift1, shift2)).toBe(true);
    });

    test('should not detect overlapping for back-to-back shifts', () => {
      const shift1: Shift = {
        id: '1',
        restaurant_id: 'r1',
        employee_id: 'e1',
        start_time: '2024-01-15T09:00:00Z',
        end_time: '2024-01-15T17:00:00Z',
        break_duration: 30,
        position: 'Server',
        status: 'scheduled',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };

      const shift2: Shift = {
        ...shift1,
        id: '2',
        start_time: '2024-01-15T17:00:00Z',
        end_time: '2024-01-15T20:00:00Z',
      };

      expect(shiftsOverlap(shift1, shift2)).toBe(false);
    });
  });

  describe('detectShiftConflicts', () => {
    test('should detect double-booking', () => {
      const newShift = {
        restaurant_id: 'r1',
        employee_id: 'e1',
        start_time: '2024-01-15T09:00:00Z',
        end_time: '2024-01-15T17:00:00Z',
        break_duration: 30,
        position: 'Server',
        status: 'scheduled' as const,
      };

      const existingShifts: Shift[] = [
        {
          id: '1',
          ...newShift,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        },
      ];

      const conflicts = detectShiftConflicts(newShift, existingShifts, [], undefined);

      expect(conflicts.length).toBe(1);
      expect(conflicts[0].type).toBe('double_booking');
      expect(conflicts[0].severity).toBe('error');
    });

    test('should detect time-off conflicts', () => {
      const newShift = {
        restaurant_id: 'r1',
        employee_id: 'e1',
        start_time: '2024-01-15T09:00:00Z',
        end_time: '2024-01-15T17:00:00Z',
        break_duration: 30,
        position: 'Server',
        status: 'scheduled' as const,
      };

      const timeOffRequests: TimeOffRequest[] = [
        {
          id: 't1',
          restaurant_id: 'r1',
          employee_id: 'e1',
          start_date: '2024-01-14',
          end_date: '2024-01-16',
          status: 'approved',
          requested_at: '2024-01-01T00:00:00Z',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        },
      ];

      const conflicts = detectShiftConflicts(newShift, [], timeOffRequests, undefined);

      expect(conflicts.length).toBe(1);
      expect(conflicts[0].type).toBe('time_off_conflict');
    });
  });

  describe('calculateDailyOvertime', () => {
    const overtimeRules: OvertimeRules = {
      id: 'or1',
      restaurant_id: 'r1',
      daily_threshold_minutes: 480, // 8 hours
      weekly_threshold_minutes: 2400,
      enabled: true,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    };

    test('should detect daily overtime', () => {
      const shifts: Shift[] = [
        {
          id: '1',
          restaurant_id: 'r1',
          employee_id: 'e1',
          start_time: '2024-01-15T08:00:00Z',
          end_time: '2024-01-15T18:00:00Z', // 10 hours
          break_duration: 30,
          position: 'Server',
          status: 'scheduled',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        },
      ];

      const warning = calculateDailyOvertime(
        'e1',
        new Date('2024-01-15'),
        shifts,
        overtimeRules
      );

      expect(warning).not.toBeNull();
      expect(warning?.type).toBe('daily');
      expect(warning?.overtimeMinutes).toBe(90); // 9.5 hours - 8 hours = 90 minutes
    });

    test('should return null when no overtime', () => {
      const shifts: Shift[] = [
        {
          id: '1',
          restaurant_id: 'r1',
          employee_id: 'e1',
          start_time: '2024-01-15T09:00:00Z',
          end_time: '2024-01-15T17:00:00Z', // 8 hours
          break_duration: 30,
          position: 'Server',
          status: 'scheduled',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        },
      ];

      const warning = calculateDailyOvertime(
        'e1',
        new Date('2024-01-15'),
        shifts,
        overtimeRules
      );

      expect(warning).toBeNull();
    });
  });

  describe('validateShift', () => {
    const overtimeRules: OvertimeRules = {
      id: 'or1',
      restaurant_id: 'r1',
      daily_threshold_minutes: 480,
      weekly_threshold_minutes: 2400,
      enabled: true,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    };

    test('should return valid when no issues', () => {
      const newShift = {
        restaurant_id: 'r1',
        employee_id: 'e1',
        start_time: '2024-01-15T09:00:00Z',
        end_time: '2024-01-15T17:00:00Z',
        break_duration: 30,
        position: 'Server',
        status: 'scheduled' as const,
      };

      const result = validateShift(newShift, [], [], overtimeRules, undefined);

      expect(result.isValid).toBe(true);
      expect(result.conflicts.length).toBe(0);
      expect(result.overtimeWarnings.length).toBe(0);
    });

    test('should return invalid when conflicts exist', () => {
      const newShift = {
        restaurant_id: 'r1',
        employee_id: 'e1',
        start_time: '2024-01-15T09:00:00Z',
        end_time: '2024-01-15T17:00:00Z',
        break_duration: 30,
        position: 'Server',
        status: 'scheduled' as const,
      };

      const existingShifts: Shift[] = [
        {
          id: '1',
          ...newShift,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        },
      ];

      const result = validateShift(newShift, existingShifts, [], overtimeRules, undefined);

      expect(result.isValid).toBe(false);
      expect(result.conflicts.length).toBeGreaterThan(0);
    });
  });
});
